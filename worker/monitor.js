/**
 * 先行モニターの申し込み（pages/monitor.html のフォーム）
 *
 * VideoTask のリポジトリの docs/hp-form.md の 1.・2. のとおりにする。
 * ただし、申込者への自動の受付メールは送らない（2026-11-18 の決め。
 * Email Sending は Workers の有料プランが要り、今の申し込みの量では見合わない）。
 *
 *   1. 項目を確かめる（必須・形・規約への同意・同意した規約の制定日）
 *   2. 同意の記録を D1 に残す（送信の日時・会社名・お名前・役職・メールアドレス・
 *      規約の制定日・全部の項目）。残せなければ、メールも送らずに止める。
 *      本番は DB、プレビュー（yhasegawa.com 以外）は DB_PREVIEW
 *   3. 運営者あて（support@videotask.app）に、同じ内容を送る（Email Routing。無料）。
 *      送れなければ止める（入力は返す画面に残る）
 *   4. 受け付けた内容を返す。送信した直後の画面に出す（保存・印刷してもらう）。
 *      メールでは、運営者が管理画面のご案内とあわせて送る
 *
 * ここに来る前に、index.js が隠し欄・欄の名前・Turnstile を確かめている。
 * IP アドレスは残さない（2026-11-18 の決め）。
 */

import { EmailMessage } from 'cloudflare:email';
import { mime } from './mail.js';

export const MONITOR_FORM = '先行モニター申込';

const SITE_URL = 'https://yhasegawa.com';
const OPS_TO = 'support@videotask.app';
const FROM = 'form@yhasegawa.com';

/* 欄の名前（pages/monitor.html の name と同じ）。並びは docs/hp-form.md の 1.〜11. */
const F = {
  company:      '会社名',
  name:         'お申し込みの方のお名前',
  title:        'お申し込みの方の役職',
  email:        'お申し込みの方のメールアドレス',
  adminName:    '最初の管理者のお名前',
  adminEmail:   '最初の管理者のメールアドレス',
  adminPhone:   '最初の管理者のお電話番号',
  iphone:       '社員の方の人数（iPhone）',
  android:      '社員の方の人数（Android）',
  pc:           '社員の方の人数（パソコン）',
  androidApp:   'Android のアプリのご希望',
  start:        '開始日のご希望',
  startDate:    '開始日のご希望の日付',
  referrer:     'ご紹介くださった先生のお名前',
  question:     'ご質問など',
  consent:      '先行モニター規約への同意',
  termsDate:    '同意した規約の制定日',
};

const ANDROID_CHOICES = ['ブラウザで使う', 'アプリを使いたい'];
const START_ASAP = '準備ができしだい';
const START_DATE = '日付を選ぶ';
const CONSENT_VALUE = '同意します';

/* 文字数の上限（フォームの maxlength と同じ） */
const MAX = {
  [F.company]: 100, [F.name]: 100, [F.title]: 100, [F.adminName]: 100,
  [F.referrer]: 100, [F.question]: 1000, [F.email]: 254, [F.adminEmail]: 254,
};

/**
 * @param fields  index.js が拾った入力 [{k, v: [..]}]
 * @param env     DB / DB_PREVIEW（D1）と SUPPORT（support@videotask.app あての send_email）
 * @param live    本番のドメインから来たか。false なら DB_PREVIEW に残し、件名に【プレビュー】
 * @returns {ok:true, receipt} か {ok:false, error, mailTo}
 */
export async function handleMonitor(fields, env,
                                    { note = '', termsDates, live = true, now = new Date() } = {}) {
  const bad = (error) => ({ ok: false, error, mailTo: OPS_TO });

  /* ---- 1. 確かめる ---- */
  for (const f of fields) {
    if (f.v.length > 1) return bad('「' + f.k + '」が二重に送られました。ページを読み込み直してお試しください。');
  }
  const get = (k) => {
    const f = fields.find((x) => x.k === k);
    return f ? f.v[0] : '';
  };

  for (const k of [F.company, F.name, F.email, F.adminName, F.adminEmail, F.adminPhone,
                   F.iphone, F.android, F.pc, F.androidApp]) {
    if (!get(k)) return bad('「' + k + '」をお書きください。');
  }
  for (const k in MAX) {
    if ([...get(k)].length > MAX[k]) return bad('「' + k + '」は ' + MAX[k] + ' 字までです。');
  }
  for (const k of [F.email, F.adminEmail]) {
    if (!isEmail(get(k))) return bad('「' + k + '」の形が違うようです。');
  }
  const phone = toHalf(get(F.adminPhone));
  const digits = phone.replace(/-/g, '');
  if (!/^[0-9]+(-[0-9]+)*$/.test(phone) || digits.length < 10 || digits.length > 15) {
    return bad('「' + F.adminPhone + '」は、半角の数字とハイフンでお書きください。');
  }
  const counts = {};
  for (const k of [F.iphone, F.android, F.pc]) {
    const n = toHalf(get(k));
    if (!/^[0-9]{1,5}$/.test(n) || Number(n) > 10000) {
      return bad('「' + k + '」は、0 から 10000 までの数でお書きください。');
    }
    counts[k] = String(Number(n));
  }
  if (!ANDROID_CHOICES.includes(get(F.androidApp))) {
    return bad('「' + F.androidApp + '」をお選びください。');
  }

  const start = get(F.start) || START_ASAP;
  let startText = START_ASAP;
  if (start === START_DATE) {
    const d = get(F.startDate);
    const lo = jstDate(now, 3), hi = jstDate(now, 14);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < lo || d > hi) {
      return bad('開始日は、' + lo + ' から ' + hi + ' までの日をお選びください（お申し込みの3日後から14日後まで）。');
    }
    startText = d;
  } else if (start !== START_ASAP) {
    return bad('「' + F.start + '」をお選びください。');
  }

  if (get(F.consent) !== CONSENT_VALUE) {
    return bad('先行モニター規約に同意いただけると、お申し込みできます。規約への同意の印を付けてください。');
  }
  const termsDate = get(F.termsDate);
  if (!termsDates || !termsDates.has(termsDate)) {
    /* 載せていない版。古いページを開いたままか、作り替えられた送信 */
    return bad('同意いただいた規約の版を確かめられませんでした。ページを読み込み直してお試しください。');
  }
  const termsUrl = SITE_URL + '/monitor-terms/' + termsDate + '/';
  const termsLine = '先行モニター規約（制定日 ' + dateJa(termsDate) + '）を読み、同意します';

  /* ---- 受け付けた内容（メールと記録に同じものを使う） ---- */
  const submittedAt = jstMinute(now);
  const items = [
    [F.company,    get(F.company)],
    [F.name,       get(F.name)],
    [F.title,      get(F.title)],
    [F.email,      get(F.email)],
    [F.adminName,  get(F.adminName)],
    [F.adminEmail, get(F.adminEmail)],
    [F.adminPhone, phone],
    [F.iphone,     counts[F.iphone]],
    [F.android,    counts[F.android]],
    [F.pc,         counts[F.pc]],
    [F.androidApp, get(F.androidApp)],
    [F.start,      startText],
    [F.referrer,   get(F.referrer)],
    [F.question,   get(F.question)],
    [F.consent,    termsLine],
    [F.termsDate,  termsDate],
  ];

  /* ---- 2. 同意の記録を残す ---- */
  const db = live ? env.DB : env.DB_PREVIEW;
  if (!db) {
    return bad('受付の記録を残せませんでした（記録の場所が設定されていません）。');
  }
  let id;
  try {
    const r = await db.prepare(
      'INSERT INTO monitor_applications ' +
      '(submitted_at, company, applicant_name, applicant_title, applicant_email, ' +
      ' terms_date, referrer, fields_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(submittedAt, get(F.company), get(F.name), get(F.title), get(F.email),
           termsDate, get(F.referrer), JSON.stringify(Object.fromEntries(items))).run();
    id = r && r.meta ? r.meta.last_row_id : undefined;
  } catch (e) {
    return bad('受付の記録を残せませんでした（' + String(e).slice(0, 120) + '）。');
  }
  const mark = async (col, val) => {
    if (id === undefined) return;
    try {
      await db.prepare('UPDATE monitor_applications SET ' + col + ' = ? WHERE id = ?')
        .bind(val, id).run();
    } catch (e) { /* 記録の本体は残っている。メールの結果だけ書けなかった */ }
  };

  const listText = items.map(([k, v]) => '■ ' + k + '\n' + (v || '（未記入）')).join('\n\n');

  /* ---- 3. 運営者あて ---- */
  const tag = live ? '' : '【プレビュー】';
  const opsBody = [
    note,
    note ? '' : null,
    live ? null : '（プレビューからの送信です。記録はプレビュー用の D1 に残しています）',
    live ? null : '',
    '先行モニターのお申し込みを受け付けました。',
    'このメールは「先行モニターの同意の記録」のフォルダに入れ、先行モニターが終わってから5年間残してください（規約の 14.）。',
    'お申し込みの方には、自動のメールは送っていません。管理画面のご案内とあわせて、受け付けた内容をお送りください。',
    '',
    '【同意の記録】',
    '受付番号：' + (id ?? '（不明）'),
    '送信の日時：' + submittedAt + '（日本時間）',
    '会社名：' + get(F.company),
    'お名前：' + get(F.name),
    '役職：' + (get(F.title) || '（未記入）'),
    'メールアドレス：' + get(F.email),
    '同意した規約の制定日：' + termsDate,
    '規約：' + termsUrl,
    '',
    '【フォームの全部の項目】',
    listText,
    '',
    '--',
    'yhasegawa.com の先行モニターのお申し込みのフォームから',
  ].filter((x) => x !== null).join('\n');
  try {
    const to = OPS_TO;
    await env.SUPPORT.send(new EmailMessage(FROM, to, mime({
      from: FROM, to, replyTo: get(F.email), fromName: 'VideoTask 先行モニター',
      subject: tag + '【先行モニター申込】' + get(F.company).slice(0, 40) + '（受付番号 ' + (id ?? '-') + '）',
      body: opsBody,
    })));
    await mark('ops_mail', 'sent ' + jstMinute(new Date()));
  } catch (e) {
    await mark('ops_mail', 'failed: ' + errText(e));
    return bad('お申し込みを送れませんでした（' + errText(e) + '）。');
  }

  /* ---- 4. 受け付けた内容を返す（送信した直後の画面に出す） ---- */
  return {
    ok: true,
    receipt: {
      id: id ?? null,
      submittedAt,
      termsDate,
      termsDateJa: dateJa(termsDate),
      termsUrl,
      items: [
        [F.company,    get(F.company)],
        [F.name,       get(F.name)],
        [F.title,      get(F.title)],
        [F.email,      get(F.email)],
        [F.adminName,  get(F.adminName)],
        [F.adminEmail, get(F.adminEmail)],
        [F.iphone,     counts[F.iphone]],
        [F.android,    counts[F.android]],
        [F.pc,         counts[F.pc]],
        [F.androidApp, get(F.androidApp)],
        [F.start,      startText],
        [F.referrer,   get(F.referrer)],
      ],
    },
  };
}

/* 受け付けた内容の HTML。JavaScript が動かずに送られたときの返すページで使う。
   JavaScript が動くときは、assets/js/site.js が同じ形をフォームのページに出す。 */
export function receiptHtml(r, esc) {
  const rows = r.items.map(([k, v]) =>
    '<dt>' + esc(k) + '</dt><dd>' + (v ? esc(v) : '（未記入）') + '</dd>').join('');
  return '<h1>受け付けました</h1>' +
    '<p>2営業日以内に、管理画面のご案内とあわせて、受け付けた内容をメールでお送りします。</p>' +
    '<p><b>この画面を保存・印刷してください。</b></p>' +
    '<dl>' +
    '<dt>受付番号</dt><dd>' + esc(String(r.id ?? '')) + '</dd>' +
    '<dt>送信の日時</dt><dd>' + esc(r.submittedAt) + '（日本時間）</dd>' +
    rows +
    '<dt>同意した規約</dt><dd>先行モニター規約（制定日 ' + esc(r.termsDateJa) + '）<br>' +
    '<a href="' + esc(r.termsUrl) + '">' + esc(r.termsUrl) + '</a></dd>' +
    '</dl>';
}

/* ------------------------------------------------------------------ */

function isEmail(s) {
  return s.length <= 254 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(s);
}

/* 全角の数字とハイフンを半角に。電話番号と人数で、全角で書かれても受け付ける */
function toHalf(s) {
  return String(s)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[－―‐ー−]/g, '-')
    .trim();
}

function jst(d) {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString();
}

/* 日本時間の「YYYY-MM-DD HH:MM」 */
export function jstMinute(d) {
  const s = jst(d);
  return s.slice(0, 10) + ' ' + s.slice(11, 16);
}

/* 日本時間で、今日から days 日後の「YYYY-MM-DD」 */
export function jstDate(d, days) {
  return jst(new Date(d.getTime() + days * 86400 * 1000)).slice(0, 10);
}

function dateJa(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return y + '年' + m + '月' + d + '日';
}

function errText(e) {
  return String((e && (e.code ? e.code + ' ' : '') + (e.message || e)) || e).slice(0, 160);
}
