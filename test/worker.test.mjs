/* worker/index.js と worker/monitor.js のテスト。
 *
 *   node --import ./test/register.mjs --test test/
 *
 * D1・メール・Turnstile の問い合わせは偽物に差し替える。本物のメールは送らない。
 * 欄の名前の一覧は、build.py が書き出した本物の worker/form_fields.js を使う
 * （先に python3 build.py を実行しておくこと）。 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { TERMS_DATES } from '../worker/form_fields.js';
import { jstDate } from '../worker/monitor.js';

const TERMS = [...TERMS_DATES].sort().at(-1);

/* ---------------- 偽物 ---------------- */

function fakeDB({ failInsert = false } = {}) {
  const db = { rows: [], updates: [] };
  db.prepare = (sql) => ({
    bind: (...args) => ({
      run: async () => {
        if (sql.startsWith('INSERT')) {
          if (failInsert) throw new Error('D1_ERROR: no such table');
          db.rows.push({ sql, args });
          return { meta: { last_row_id: db.rows.length } };
        }
        db.updates.push({ sql, args });
        return { meta: {} };
      },
    }),
  });
  return db;
}

/* Email Routing の send_email の偽物。EmailMessage（from, to, raw）を覚える */
function fakeMail({ fail = false } = {}) {
  const m = { sent: [] };
  m.send = async (msg) => {
    if (fail) throw new Error('destination address not verified');
    m.sent.push(msg);
  };
  return m;
}

/* MIME の本文と件名を読む */
function decode(msg) {
  const [head, body] = msg.raw.split('\r\n\r\n');
  const subj = head.match(/^Subject: =\?UTF-8\?B\?(.*)\?=$/m)[1];
  const reply = (head.match(/^Reply-To: <(.*)>$/m) || [])[1];
  return {
    subject: Buffer.from(subj, 'base64').toString('utf8'),
    text: Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8'),
    replyTo: reply,
  };
}

let turnstileAnswer = true;
let turnstileCalls = 0;
const realFetch = globalThis.fetch;
beforeEach(() => {
  turnstileAnswer = true;
  turnstileCalls = 0;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /challenges\.cloudflare\.com\/turnstile/);
    turnstileCalls++;
    return new Response(JSON.stringify({ success: turnstileAnswer }));
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

function makeEnv(opts = {}) {
  return {
    TURNSTILE_SECRET: 'secret' in opts ? opts.secret : 'test-secret',
    DB: fakeDB(opts.db),
    DB_PREVIEW: fakeDB(),
    SUPPORT: fakeMail(opts.support),
    MAIL: fakeMail(),
    MAIL_TO: 'owner@example.com',
  };
}

/* ---------------- 送るもの ---------------- */

function monitorForm(over = {}) {
  const base = {
    _form: '先行モニター申込',
    _hp: '',
    '会社名': '見本商事株式会社',
    'お申し込みの方のお名前': '見本 太郎',
    'お申し込みの方の役職': '総務部長',
    'お申し込みの方のメールアドレス': 'taro@example.com',
    '最初の管理者のお名前': '見本 花子',
    '最初の管理者のメールアドレス': 'hanako@example.com',
    '最初の管理者のお電話番号': '078-000-0000',
    '社員の方の人数（iPhone）': '12',
    '社員の方の人数（Android）': '5',
    '社員の方の人数（パソコン）': '3',
    'Android のアプリのご希望': 'ブラウザで使う',
    '開始日のご希望': '準備ができしだい',
    '開始日のご希望の日付': '',
    'ご紹介くださった先生のお名前': '見本 一郎 先生',
    'ご質問など': '',
    '先行モニター規約への同意': '同意します',
    '同意した規約の制定日': TERMS,
    'cf-turnstile-response': 'token-ok',
  };
  const all = { ...base, ...over };
  const fd = new FormData();
  for (const [k, v] of Object.entries(all)) {
    if (v === undefined) continue;          /* undefined は「送らない」 */
    for (const x of [].concat(v)) fd.append(k, x);
  }
  return fd;
}

function contactForm(over = {}) {
  const all = {
    _form: 'ご相談', _hp: '',
    '業種・会社名': '製造・見本工業', 'ご相談の内容': '相談です',
    'お名前・ご連絡先': '見本 次郎 jiro@example.com',
    'お電話でのご連絡を希望される場合': 'メールでの返信を希望',
    '電話番号': '', 'つながりやすい時間帯': '',
    'cf-turnstile-response': 'token-ok',
    ...over,
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries(all)) if (v !== undefined) fd.append(k, v);
  return fd;
}

async function post(env, fd, host = 'yhasegawa.com') {
  const req = new Request('https://' + host + '/api/form', {
    method: 'POST', body: fd,
    headers: { accept: 'application/json', 'CF-Connecting-IP': '203.0.113.7' },
  });
  const res = await worker.fetch(req, env, {});
  return { status: res.status, body: await res.json() };
}

function nothingHappened(env) {
  assert.equal(env.DB.rows.length, 0, 'D1 に書いていない');
  assert.equal(env.DB_PREVIEW.rows.length, 0, 'プレビューの D1 にも書いていない');
  assert.equal(env.SUPPORT.sent.length, 0, '運営者あてに送っていない');
  assert.equal(env.MAIL.sent.length, 0, '相談のメールも送っていない');
}

/* ================= 今までの守り（両方のフォーム） ================= */

for (const [name, make] of [['先行モニター', monitorForm], ['相談', contactForm]]) {
  test(`${name}: 隠し欄が埋まっていたら止める`, async () => {
    const env = makeEnv();
    const r = await post(env, make({ _hp: 'http://spam.example' }));
    assert.equal(r.status, 400);
    nothingHappened(env);
  });

  test(`${name}: フォームに無い名前の欄が来たら止める`, async () => {
    const env = makeEnv();
    const fd = make();
    fd.append('??????', 'x');
    const r = await post(env, fd);
    assert.equal(r.status, 400);
    assert.match(r.body.error, /項目がフォームと合いません/);
    nothingHappened(env);
  });

  test(`${name}: Turnstile のトークンが無ければ止める`, async () => {
    const env = makeEnv();
    const r = await post(env, make({ 'cf-turnstile-response': undefined }));
    assert.equal(r.status, 400);
    assert.match(r.body.error, /確認ができませんでした/);
    assert.equal(turnstileCalls, 0);
    nothingHappened(env);
  });

  test(`${name}: Turnstile の検証が通らなければ止める`, async () => {
    turnstileAnswer = false;
    const env = makeEnv();
    const r = await post(env, make());
    assert.equal(r.status, 400);
    assert.match(r.body.error, /確認が通りませんでした/);
    assert.equal(turnstileCalls, 1);
    nothingHappened(env);
  });
}

test('POST 以外は 405', async () => {
  const res = await worker.fetch(new Request('https://yhasegawa.com/api/form'), makeEnv(), {});
  assert.equal(res.status, 405);
});

/* ================= 相談のフォーム（今までどおり） ================= */

test('相談: Email Routing で自分あてに送る。IP アドレスは書かない', async () => {
  const env = makeEnv();
  const r = await post(env, contactForm());
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.equal(env.MAIL.sent.length, 1);
  assert.equal(env.MAIL.sent[0].to, 'owner@example.com');
  assert.equal(env.SUPPORT.sent.length, 0);
  assert.equal(env.DB.rows.length, 0, '相談は D1 に残さない');
  const raw = env.MAIL.sent[0].raw;
  const body = Buffer.from(raw.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
  assert.match(body, /相談です/);
  assert.doesNotMatch(body, /203\.0\.113\.7/);
  assert.doesNotMatch(body, /送信元/);
});

/* ================= 先行モニター ================= */

test('先行モニター: 記録を残し、運営者に送り、受け付けた内容を返す。申込者には送らない', async () => {
  const env = makeEnv();
  const r = await post(env, monitorForm());
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);

  /* D1 の記録（本番の DB） */
  assert.equal(env.DB.rows.length, 1);
  assert.equal(env.DB_PREVIEW.rows.length, 0);
  const [at, company, name, title, email, terms, referrer, json] = env.DB.rows[0].args;
  assert.match(at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(company, '見本商事株式会社');
  assert.equal(name, '見本 太郎');
  assert.equal(title, '総務部長');
  assert.equal(email, 'taro@example.com');
  assert.equal(terms, TERMS);
  assert.equal(referrer, '見本 一郎 先生');
  const all = JSON.parse(json);
  assert.equal(all['最初の管理者のお電話番号'], '078-000-0000');
  assert.equal(all['開始日のご希望'], '準備ができしだい');
  assert.equal(all['同意した規約の制定日'], TERMS);
  assert.ok(!JSON.stringify(env.DB.rows).includes('203.0.113.7'), 'IP アドレスを残さない');

  /* メールは運営者あての 1 通だけ（Email Routing。申込者には送らない） */
  assert.equal(env.SUPPORT.sent.length, 1);
  assert.equal(env.MAIL.sent.length, 0);
  const msg = env.SUPPORT.sent[0];
  assert.equal(msg.from, 'form@yhasegawa.com');
  assert.equal(msg.to, 'support@videotask.app');
  const ops = decode(msg);
  assert.equal(ops.replyTo, 'taro@example.com');
  assert.match(ops.subject, /^【先行モニター申込】見本商事株式会社（受付番号 1）$/);
  assert.match(ops.text, new RegExp('送信の日時：' + at));
  assert.match(ops.text, new RegExp('同意した規約の制定日：' + TERMS));
  assert.match(ops.text, /見本 一郎 先生/);
  assert.doesNotMatch(ops.text, /203\.0\.113\.7/);
  assert.deepEqual(env.DB.updates.map((u) => u.sql.match(/SET (\w+)/)[1]), ['ops_mail']);

  /* 画面に出す、受け付けた内容 */
  const rc = r.body.receipt;
  assert.equal(rc.id, 1);
  assert.equal(rc.submittedAt, at);
  assert.equal(rc.termsDate, TERMS);
  assert.equal(rc.termsUrl, 'https://yhasegawa.com/monitor-terms/' + TERMS + '/');
  const items = Object.fromEntries(rc.items);
  for (const k of ['会社名', 'お申し込みの方のお名前', 'お申し込みの方のメールアドレス',
                   '最初の管理者のお名前', '最初の管理者のメールアドレス',
                   '社員の方の人数（iPhone）', '社員の方の人数（Android）', '社員の方の人数（パソコン）',
                   'Android のアプリのご希望', '開始日のご希望', 'ご紹介くださった先生のお名前',
                   '最初の管理者のお電話番号', 'ご質問など']) {
    assert.ok(k in items, k);
  }
  assert.equal(items['ご紹介くださった先生のお名前'], '見本 一郎 先生');
});

test('先行モニター: JavaScript なしで送られたときは、受け付けた内容のページを返す', async () => {
  const env = makeEnv();
  const req = new Request('https://yhasegawa.com/api/form', { method: 'POST', body: monitorForm() });
  const res = await worker.fetch(req, env, {});
  assert.equal(res.status, 200);
  const page = await res.text();
  assert.match(page, /受け付けました/);
  assert.match(page, /この画面を保存・印刷してください/);
  assert.match(page, /見本商事株式会社/);
  assert.ok(page.includes('/monitor-terms/' + TERMS + '/'));
});

test('先行モニター: プレビューからの送信は、プレビューの D1 に残し、件名に【プレビュー】', async () => {
  const env = makeEnv();
  const r = await post(env, monitorForm(), 'abc123-yhasegawa.appron.workers.dev');
  assert.equal(r.status, 200);
  assert.equal(env.DB.rows.length, 0, '本番の同意の記録に混ぜない');
  assert.equal(env.DB_PREVIEW.rows.length, 1);
  assert.match(decode(env.SUPPORT.sent[0]).subject, /^【プレビュー】【先行モニター申込】/);
});

test('先行モニター: ご紹介の先生が空なら、空のまま記録とお知らせに入る', async () => {
  const env = makeEnv();
  const r = await post(env, monitorForm({ 'ご紹介くださった先生のお名前': '' }));
  assert.equal(r.status, 200);
  assert.equal(env.DB.rows[0].args[6], '');
  assert.match(decode(env.SUPPORT.sent[0]).text, /ご紹介くださった先生のお名前\n（未記入）/);
  assert.equal(Object.fromEntries(r.body.receipt.items)['ご紹介くださった先生のお名前'], '');
});

test('先行モニター: 規約への同意の印が無ければ止める（記録もメールもしない）', async () => {
  const env = makeEnv();
  const r = await post(env, monitorForm({ '先行モニター規約への同意': undefined }));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /同意/);
  nothingHappened(env);
});

test('先行モニター: 載せていない版の制定日なら止める', async () => {
  const env = makeEnv();
  const r = await post(env, monitorForm({ '同意した規約の制定日': '2099-01-01' }));
  assert.equal(r.status, 400);
  nothingHappened(env);
});

test('先行モニター: 必須の欄が空なら止める', async () => {
  for (const k of ['会社名', 'お申し込みの方のお名前', 'お申し込みの方のメールアドレス',
                   '最初の管理者のお名前', '最初の管理者のメールアドレス',
                   '最初の管理者のお電話番号', '社員の方の人数（Android）']) {
    const env = makeEnv();
    const r = await post(env, monitorForm({ [k]: '' }));
    assert.equal(r.status, 400, k);
    assert.match(r.body.error, new RegExp(k.replace(/[()（）]/g, '.')));
    nothingHappened(env);
  }
});

test('先行モニター: 形の違う入力は止める', async () => {
  const cases = {
    'お申し込みの方のメールアドレス': 'not-an-email',
    '最初の管理者のメールアドレス': 'a@b',
    '最初の管理者のお電話番号': '078-000-000a',
    '社員の方の人数（iPhone）': '-1',
    'Android のアプリのご希望': 'どちらでも',
    '開始日のご希望': 'あした',
    '会社名': 'あ'.repeat(101),
    'ご質問など': 'あ'.repeat(1001),
  };
  for (const [k, v] of Object.entries(cases)) {
    const env = makeEnv();
    const r = await post(env, monitorForm({ [k]: v }));
    assert.equal(r.status, 400, k);
    nothingHappened(env);
  }
});

test('先行モニター: 全角の電話番号と人数は半角にして受け付ける', async () => {
  const env = makeEnv();
  const r = await post(env, monitorForm({ '最初の管理者のお電話番号': '０７８－０００－００００',
                                          '社員の方の人数（パソコン）': '３' }));
  assert.equal(r.status, 200);
  const all = JSON.parse(env.DB.rows[0].args[7]);
  assert.equal(all['最初の管理者のお電話番号'], '078-000-0000');
  assert.equal(all['社員の方の人数（パソコン）'], '3');
});

test('先行モニター: 開始日は3日後〜14日後だけ', async () => {
  const now = new Date();
  for (const [days, ok] of [[2, false], [3, true], [14, true], [15, false]]) {
    const env = makeEnv();
    const r = await post(env, monitorForm({ '開始日のご希望': '日付を選ぶ',
                                            '開始日のご希望の日付': jstDate(now, days) }));
    assert.equal(r.status, ok ? 200 : 400, days + '日後');
    if (ok) assert.equal(JSON.parse(env.DB.rows[0].args[7])['開始日のご希望'], jstDate(now, days));
  }
  const env = makeEnv();
  const r = await post(env, monitorForm({ '開始日のご希望': '日付を選ぶ', '開始日のご希望の日付': '' }));
  assert.equal(r.status, 400);
});

test('先行モニター: 同じ欄が二重に来たら止める', async () => {
  const env = makeEnv();
  const r = await post(env, monitorForm({ '会社名': ['A社', 'B社'] }));
  assert.equal(r.status, 400);
  nothingHappened(env);
});

test('先行モニター: 記録を残せなければ、メールも送らずに止める', async () => {
  const env = makeEnv({ db: { failInsert: true } });
  const r = await post(env, monitorForm());
  assert.equal(r.status, 400);
  assert.match(r.body.error, /記録を残せませんでした/);
  assert.equal(env.SUPPORT.sent.length, 0);
});

test('先行モニター: D1 がつながっていなければ止める', async () => {
  const env = makeEnv();
  delete env.DB;
  const r = await post(env, monitorForm());
  assert.equal(r.status, 400);
  assert.equal(env.SUPPORT.sent.length, 0);
});

test('先行モニター: 運営者あてが送れなければ止める（記録には失敗を書く）', async () => {
  const env = makeEnv({ support: { fail: true } });
  const r = await post(env, monitorForm());
  assert.equal(r.status, 400);
  assert.equal(r.body.receipt, undefined);
  assert.equal(env.DB.rows.length, 1);
  assert.match(env.DB.updates[0].args[0], /^failed: /);
});

test('先行モニター: Secret が無いときは、トークンがあれば通し、メールの先頭に書く（今までどおり）', async () => {
  const env = makeEnv({ secret: undefined });
  const r = await post(env, monitorForm());
  assert.equal(r.status, 200);
  assert.equal(turnstileCalls, 0);
  assert.match(decode(env.SUPPORT.sent[0]).text, /^（Turnstile の Secret が未設定です/);
});

test('フォームのページの欄が、Worker の欄の一覧に全部ある', async () => {
  const { readFileSync } = await import('node:fs');
  const page = readFileSync(new URL('../dist/monitor/index.html', import.meta.url), 'utf8');
  const { FIELD_NAMES } = await import('../worker/form_fields.js');
  const names = [...page.matchAll(/<(?:input|textarea)\b[^>]*\bname="([^"]+)"/g)].map((m) => m[1]);
  for (const n of names) assert.ok(FIELD_NAMES.has(n), n);
  /* 同意の印の文と制定日が、いまの版を指している */
  assert.ok(page.includes('value="' + TERMS + '"'));
  assert.ok(page.includes('href="/monitor-terms/' + TERMS + '/"'));
});
