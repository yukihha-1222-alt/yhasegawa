/**
 * yhasegawa.com の Worker
 *
 * やることは2つだけ。
 *
 *   1. POST /api/form  … 申し込みと相談のフォームを受け取り、メールにして送る
 *   2. それ以外        … dist/ の中の静的ファイルをそのまま返す
 *
 * メールは Cloudflare Email Routing の send_email バインディングで送る。
 * 外部のメール配信サービスは使わない。費用もかからない。
 *
 * 【入力を落とさないこと】
 * この仕組みの目的は、フォームに書いてくれた人を取りこぼさないこと。
 * 失敗したときも、入力した内容をそのまま画面に返して、
 * コピーしてメールで送れるようにする。白い画面で終わらせない。
 */

import { EmailMessage } from 'cloudflare:email';

/* 2026-11-10 にURLを英語に直した。古いURLを控えている方のために転送する。
   このリストは wrangler.toml の run_worker_first と対になっている。
   片方だけ消すと転送が効かなくなるので、消すときは両方。 */
const MOVED = {
  '/shikumi': '/how-it-works/',
  '/jutaku':  '/development/',
  '/hojokin': '/subsidy/',
};

const FROM = 'form@yhasegawa.com';
const TO_FALLBACK = 'hasegawa@yhasegawa.com';
const PHONE = '080-6206-1245';

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

    return env.ASSETS.fetch(request);
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
  if (token && env.TURNSTILE_SECRET) {
    const ok = await verifyTurnstile(token, ip, env.TURNSTILE_SECRET);
    if (!ok) {
      return fail(request, fields, '「人が操作しているか」の確認が通りませんでした。');
    }
  } else if (token) {
    /* ウィジェットは出ているが、Secret がまだ入っていない。
       Cloudflare は「コードのない Worker」に変数を足させないので、
       いちばん最初のデプロイの前は必ずこの状態になる。
       ここで止めると、せっかくの送信が消える。通したうえで、
       メールの先頭に書いて気づけるようにする。 */
    note = '（Turnstile の Secret が未設定です。自動判定をしていません）';
  } else {
    /* JavaScript が動いていないとき。Turnstile はJSが要るのでトークンが無い。
       ここで止めると、書いてくれた内容がそのまま消える。
       隠し欄が空であることだけを根拠に通し、件名に印を付けて送る。 */
    note = '（自動判定なし・JavaScript が動いていない環境からの送信）';
  }

  if (fields.length === 0) {
    return fail(request, fields, '入力が空のようです。');
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
  const lines = [];
  if (note) lines.push(note, '');
  for (const f of fields) {
    lines.push('■ ' + f.k);
    lines.push(f.v.filter(Boolean).join('、') || '（未記入）');
    lines.push('');
  }
  lines.push('--');
  lines.push('yhasegawa.com のフォームから');
  lines.push('送信元: ' + (request.headers.get('CF-Connecting-IP') || '不明'));
  lines.push('日時: ' + new Date().toISOString());
  return lines.join('\n');
}

/* 日本語の件名は、そのままだと文字化けする。RFC 2047 の形にする */
function encodeSubject(s) {
  const b = btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  return '=?UTF-8?B?' + b + '?=';
}

function mime({ from, to, subject, body, replyTo }) {
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(body)));
  const wrapped = b64.match(/.{1,76}/g).join('\r\n');
  const id = '<' + Date.now().toString(36) + '.' + Math.random().toString(36).slice(2) +
             '@yhasegawa.com>';
  const head = [
    'From: ' + encodeSubject('yhasegawa.com フォーム') + ' <' + from + '>',
    'To: <' + to + '>',
    replyTo ? 'Reply-To: <' + replyTo + '>' : null,
    'Subject: ' + encodeSubject(subject),
    'Message-ID: ' + id,
    'Date: ' + new Date().toUTCString(),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean);
  return head.join('\r\n') + '\r\n\r\n' + wrapped + '\r\n';
}

/* ------------------------------------------------------------------ */

function wantsJson(request) {
  return (request.headers.get('accept') || '').includes('application/json');
}

function done(request, formName) {
  if (wantsJson(request)) {
    return json({ ok: true });
  }
  return html(200, 'ありがとうございます', `
    <h1>ありがとうございます</h1>
    <p>${esc(formName)}を受け取りました。数日以内に長谷川からご連絡します。</p>
    <p><a href="/">ホームへもどる</a></p>
  `);
}

function fail(request, fields, why) {
  if (wantsJson(request)) {
    return json({ ok: false, error: why }, 400);
  }
  /* 書いてくれた内容を返す。ここが「入力が消えない」の最後の砦 */
  const text = fields && fields.length
    ? fields.map((f) => '■ ' + f.k + '\n' + (f.v.filter(Boolean).join('、') || '（未記入）')).join('\n\n')
    : '';
  const mailto = 'mailto:' + TO_FALLBACK +
    '?subject=' + encodeURIComponent('【お問い合わせ】') +
    '&body=' + encodeURIComponent(text);
  return html(400, '送信できませんでした', `
    <h1>うまく送信できませんでした</h1>
    <p>${esc(why)}</p>
    <p><b>入力していただいた内容は、下に残してあります。</b>
       お手数ですが、コピーしてメールでお送りいただくか、お電話ください。</p>
    <p><a class="btn" href="${mailto}">この内容をメールで送る</a>
       <a class="btn" href="tel:${PHONE.replace(/-/g, '')}">電話する（${PHONE}）</a></p>
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
  :root{color-scheme:light dark}
  body{margin:0;padding:40px 20px;background:#F1F3F2;color:#17201D;
       font-family:"BIZ UDPGothic","Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif;
       line-height:1.9;font-size:17px}
  main{max-width:40rem;margin-inline:auto}
  h1{font-size:1.5rem;line-height:1.5;margin:0 0 18px}
  a{color:#173F35}
  .btn{display:inline-block;margin:6px 10px 6px 0;padding:12px 20px;border-radius:10px;
       background:#FFE45C;color:#17201D;font-weight:700;text-decoration:none;
       border:1.5px solid #FFE45C}
  .btn+.btn{background:#fff;border-color:#173F35;color:#173F35}
  textarea{width:100%;box-sizing:border-box;margin-top:14px;padding:14px;
           border:1px solid #DCE2DF;border-radius:10px;background:#fff;
           font:inherit;font-size:15px;line-height:1.8}
  @media (prefers-color-scheme: dark){
    body{background:#0F1A17;color:#E8EEEB} a{color:#6FB89F}
    textarea{background:#17241F;border-color:#2A3833;color:#E8EEEB}
    .btn+.btn{background:#17241F;border-color:#4E9B84;color:#6FB89F}
  }
</style></head><body><main>${inner}</main></body></html>`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
