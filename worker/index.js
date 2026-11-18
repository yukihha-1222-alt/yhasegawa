/**
 * yhasegawa.com の Worker
 *
 * やることは2つだけ。
 *
 *   1. POST /api/form  … 申し込みと相談のフォームを受け取り、メールにして送る
 *   2. それ以外        … dist/ の中の静的ファイルをそのまま返す
 *
 * メールは Cloudflare Email Routing の send_email バインディングで送る。
 * Email Routing で確かめた（Verified の）アドレスにだけ送れる。費用はかからない。
 *   MAIL    … 相談のフォーム。長谷川あて
 *   SUPPORT … 先行モニターの申し込み。support@videotask.app あて（worker/monitor.js）
 * 申込者には、メールを自動で送らない（2026-11-18 の決め）。受け付けた内容は、
 * 送信した直後の画面に出す。
 * 先行モニターの申し込みは、送る前に D1 に同意の記録を残す。
 * D1 は本番（DB）とプレビュー（DB_PREVIEW）で分ける。試しの記録を本番に混ぜない。
 *
 * 【入力を落とさないこと】
 * この仕組みの目的は、フォームに書いてくれた人を取りこぼさないこと。
 * 失敗したときも、入力した内容をそのまま画面に返して、
 * コピーしてメールで送れるようにする。白い画面で終わらせない。
 */

import { EmailMessage } from 'cloudflare:email';
import { mime } from './mail.js';
/* フォームにある欄の名前の一覧。build.py が dist/ のフォームから書き出す。
   手で直さないこと（次のビルドで上書きされる）。 */
import { FIELD_NAMES, TERMS_DATES } from './form_fields.js';
/* 先行モニターの申し込みだけの処理（同意の記録・運営者あてのメール・受け付けた内容） */
import { handleMonitor, MONITOR_FORM, receiptHtml } from './monitor.js';

/* 2026-11-10 にURLを英語に直した。古いURLを控えている方のために転送する。
   このリストは wrangler.toml の run_worker_first と対になっている。
   片方だけ消すと転送が効かなくなるので、消すときは両方。 */
const MOVED = {
  '/shikumi': '/how-it-works/',
  '/jutaku':  '/development/',
  '/hojokin': '/subsidy/',
};

/* 本番のドメイン。これ以外（プレビューの *.workers.dev など）で配るときは、
   検索エンジンに載せない。プレビューが検索結果に出ると、本物と二重になる。 */
const SITE_HOST = 'yhasegawa.com';

const FROM = 'form@yhasegawa.com';
const TO_FALLBACK = 'hasegawa@yhasegawa.com';

/* 1通あたりの上限。長すぎる本文はメールを壊すので切る */
const MAX_FIELD = 4000;
const MAX_TOTAL = 20000;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/form') {
      if (request.method !== 'POST') {
        return new Response('POST だけを受け付けます', {
          status: 405,
          headers: { 'content-type': 'text/plain; charset=utf-8', allow: 'POST' },
        });
      }
      return handleForm(request, env);
    }

    /* 古いURLなら、新しいURLへ恒久的に送る（301）。
       /shikumi も /shikumi/ も、その下の何かも受ける。 */
    for (const from in MOVED) {
      if (url.pathname === from || url.pathname.startsWith(from + '/')) {
        return Response.redirect(new URL(MOVED[from] + url.search, url.origin).toString(), 301);
      }
    }

    const res = await env.ASSETS.fetch(request);

    /* 本番のドメイン以外は、検索エンジンに載せない。
       プレビューURLが検索結果に出ると、本物と同じ内容が二重に並ぶ。
       ヘッダーで返すので、HTMLだけでなく PDF や画像にも効く。 */
    if (url.hostname !== SITE_HOST) {
      const out = new Response(res.body, res);
      out.headers.set('X-Robots-Tag', 'noindex, nofollow');
      return out;
    }
    return res;
  },
};

/* ------------------------------------------------------------------ */

async function handleForm(request, env) {
  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return fail(request, null, '送信された内容を読み取れませんでした。');
  }

  /* 入力を順番のまま拾う。name には「会社名」「お名前」… と
     見出しそのものを入れてあるので、並べるだけで読めるメールになる。
     _ で始まるものは、こちらの都合で付けた隠し欄。 */
  const fields = [];
  let total = 0;
  for (const [k, v] of form.entries()) {
    if (k.startsWith('_') || k === 'cf-turnstile-response') continue;
    const val = String(v).slice(0, MAX_FIELD).trim();
    total += k.length + val.length;
    if (total > MAX_TOTAL) break;
    const found = fields.find((f) => f.k === k);
    if (found) found.v.push(val);          /* チェックボックスは同じ名前が続く */
    else fields.push({ k, v: [val] });
  }

  const formName = (form.get('_form') || 'お問い合わせ').toString().slice(0, 40);
  const honeypot = (form.get('_hp') || '').toString().trim();
  const token = (form.get('cf-turnstile-response') || '').toString();
  const ip = request.headers.get('CF-Connecting-IP') || '';

  /* 迷惑メール対策 */
  let note = '';
  if (honeypot) {
    /* 人には見えない欄が埋まっている。ほぼ確実に機械。
       それでも万一のために、入力を返す画面は出す。 */
    return fail(request, fields, '送信を確認できませんでした。');
  }

  /* フォームに無い名前の欄が来たら送らない。
     ボットは欄の名前を作り替えて送ってくることがある
     （2026-11-15、日本語の名前が「??????」になったものが届いた）。
     人がフォームから送れば、ここに引っかかることはない。
     例外は、フォームの欄を変えた直後に古いページから送った場合。
     そのときも入力は返す画面に残る。 */
  for (const k of form.keys()) {
    if (!FIELD_NAMES.has(k)) {
      return fail(request, fields,
        '送信された項目がフォームと合いませんでした。ページを読み込み直してお試しください。');
    }
  }

  if (!token) {
    /* トークンが無い。JavaScript が動いていないか、Turnstile の読み込みが
       止められている。以前はここを通していたが、ボットはトークンを付けずに
       送るだけで判定をすり抜けられた。
       止めても入力は消えない。返す画面に入力とメールで送るボタンが出る。
       フォームの <noscript> でも、メールで送るよう案内している。 */
    return fail(request, fields,
      '「人が操作しているか」の確認ができませんでした。' +
      'JavaScript が動いていないか、確認のしくみの読み込みが止められているようです。');
  }
  if (env.TURNSTILE_SECRET) {
    const ok = await verifyTurnstile(token, ip, env.TURNSTILE_SECRET);
    if (!ok) {
      return fail(request, fields, '「人が操作しているか」の確認が通りませんでした。');
    }
  } else {
    /* ウィジェットは出ているが、Secret がまだ入っていない。
       Cloudflare は「コードのない Worker」に変数を足させないので、
       いちばん最初のデプロイの前は必ずこの状態になる。
       ここで止めると、せっかくの送信が消える。通したうえで、
       メールの先頭に書いて気づけるようにする。 */
    note = '（Turnstile の Secret が未設定です。自動判定をしていません）';
  }

  if (fields.length === 0) {
    return fail(request, fields, '入力が空のようです。');
  }

  /* 先行モニターの申し込みは、項目を確かめて、同意の記録を残してから送る */
  if (formName === MONITOR_FORM) {
    const live = new URL(request.url).hostname === SITE_HOST;
    const r = await handleMonitor(fields, env, { note, termsDates: TERMS_DATES, live });
    if (!r.ok) return fail(request, fields, r.error, r.mailTo);
    return done(request, formName, r.receipt);
  }

  const body = buildBody(fields, request, note);
  const subject = '【' + formName + '】' + (fields[0] ? fields[0].v[0].slice(0, 30) : '');
  const replyTo = findEmail(fields);

  try {
    const to = env.MAIL_TO || TO_FALLBACK;
    const msg = new EmailMessage(FROM, to, mime({ from: FROM, to, subject, body, replyTo }));
    await env.MAIL.send(msg);
  } catch (e) {
    return fail(request, fields, 'メールの送信に失敗しました（' + String(e).slice(0, 120) + '）');
  }

  return done(request, formName);
}

/* ------------------------------------------------------------------ */

async function verifyTurnstile(token, ip, secret) {
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',
                          { method: 'POST', body });
    const j = await r.json();
    return j.success === true;
  } catch (e) {
    /* Cloudflare 側が落ちているときに、人の送信まで止めない */
    return true;
  }
}

function findEmail(fields) {
  for (const f of fields) {
    for (const v of f.v) {
      const m = v.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
      if (m) return m[0];
    }
  }
  return '';
}

function buildBody(fields, request, note) {
  /* 送信元の IP アドレスは書かない（2026-11-18 の決め。プライバシーポリシーにも書いていない） */
  const lines = [];
  if (note) lines.push(note, '');
  for (const f of fields) {
    lines.push('■ ' + f.k);
    lines.push(f.v.filter(Boolean).join('、') || '（未記入）');
    lines.push('');
  }
  lines.push('--');
  lines.push('yhasegawa.com のフォームから');
  lines.push('日時: ' + new Date().toISOString());
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */

function wantsJson(request) {
  return (request.headers.get('accept') || '').includes('application/json');
}

function done(request, formName, receipt) {
  if (wantsJson(request)) {
    return json(receipt ? { ok: true, receipt } : { ok: true });
  }
  if (receipt) {
    /* 先行モニター。JavaScript が動かずにふつうに送られたとき。
       受け付けた内容を、フォームのページと同じ形で出す */
    return html(200, '受け付けました', receiptHtml(receipt, esc) +
      '<p><a href="/">ホームへもどる</a></p>');
  }
  return html(200, 'ありがとうございます', `
    <h1>ありがとうございます</h1>
    <p>${esc(formName)}を受け取りました。数日以内に長谷川からご連絡します。</p>
    <p><a href="/">ホームへもどる</a></p>
  `);
}

function fail(request, fields, why, mailTo) {
  const to = mailTo || TO_FALLBACK;
  if (wantsJson(request)) {
    return json({ ok: false, error: why }, 400);
  }
  /* 書いてくれた内容を返す。ここが「入力が消えない」の最後の砦 */
  const text = fields && fields.length
    ? fields.map((f) => '■ ' + f.k + '\n' + (f.v.filter(Boolean).join('、') || '（未記入）')).join('\n\n')
    : '';
  const mailto = 'mailto:' + to +
    '?subject=' + encodeURIComponent('【お問い合わせ】') +
    '&body=' + encodeURIComponent(text);
  return html(400, '送信できませんでした', `
    <h1>うまく送信できませんでした</h1>
    <p>${esc(why)}</p>
    <p><b>入力していただいた内容は、下に残してあります。</b>
       お手数ですが、コピーしてメールでお送りください。</p>
    <p><a class="btn" href="${mailto}">この内容をメールで送る</a>
       <a class="btn" href="mailto:${to}">${to}</a></p>
    ${text ? '<textarea readonly rows="14">' + esc(text) + '</textarea>' : ''}
    <p><a href="/">ホームへもどる</a></p>
  `);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* サイトと同じ配色の、素の1枚ページ。CSS は読み込まずに埋め込む。
   送信に失敗した場面で、さらに読み込みに失敗することがないように。 */
function html(status, title, inner) {
  return new Response(`<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}｜長谷川侑希</title>
<style>
  /* 色はサイトの CSS と同じ決まり。ここだけ読み込みに失敗しても
     読めるよう、変数ごと埋め込んでいる。
     明るい緑に白文字は載せない（2.37:1 で読めない）。 */
  :root{
    color-scheme:light dark;
    --bg:#F1F3F2; --card:#FFFFFF; --ink:#17201D; --line:#D7E3DC;
    --green-bright:#34BE84; --on-green:#0E3B2C; --green-text:#157B54;
    --hl:#FFE45C; --on-hl:#17201D;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#0E1512; --card:#17211D; --ink:#E8F0EB; --line:#27332D;
      --green-text:#5FD6A2;
    }
  }
  body{margin:0;padding:40px 20px;background:var(--bg);color:var(--ink);
       font-family:"BIZ UDPGothic","Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif;
       line-height:1.9;font-size:17px}
  main{max-width:40rem;margin-inline:auto}
  h1{font-size:1.5rem;line-height:1.5;margin:0 0 18px}
  a{color:var(--green-text)}
  .btn{display:inline-block;margin:6px 10px 6px 0;padding:12px 20px;border-radius:10px;
       background:var(--hl);color:var(--on-hl);font-weight:700;text-decoration:none;
       border:1.5px solid var(--hl)}
  .btn+.btn{background:var(--card);border-color:var(--green-text);color:var(--green-text)}
  dl{display:grid;grid-template-columns:auto 1fr;gap:4px 16px;padding:14px 16px;
     background:var(--card);border:1px solid var(--line);border-radius:10px}
  dt{opacity:.7} dd{margin:0;overflow-wrap:anywhere}
  textarea{width:100%;box-sizing:border-box;margin-top:14px;padding:14px;
           border:1px solid var(--line);border-radius:10px;background:var(--card);
           color:var(--ink);font:inherit;font-size:15px;line-height:1.8}
</style></head><body><main>${inner}</main></body></html>`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
