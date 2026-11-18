# worker/

`yhasegawa.com` を配信している Worker のコードです。

- `index.js` … `/api/form` を受けてメールにする。それ以外は `dist/` を返す
- 設定は、ひとつ上の `wrangler.toml`

## 手元で動かす

    npx wrangler dev

`http://localhost:8787` で開きます。
ただし **メールの送信と Turnstile の検証は手元では動きません**。
`send_email` は Cloudflare の上でしか使えず、Turnstile の Secret も
手元には置いていないためです。見た目の確認だけに使ってください。

## 送信の流れ

    ブラウザ
      │  POST /api/form（urlencoded）
      ▼
    worker/index.js
      │  1. 隠し欄（_hp）が空かを見る
      │  2. フォームに無い名前の欄が来ていないかを見る
      │     （一覧は worker/form_fields.js。build.py がフォームから書き出す）
      │  3. Turnstile のトークンを Cloudflare に問い合わせて検証
      │     トークンが無ければ（JavaScript が動いていない・ボット）送らない
      │  4. 入力を順番に並べて本文にする
      │  5. send_email でメールを送る。Reply-To に入力のアドレスを入れる
      ▼
    長谷川のメール

失敗したときは、入力内容を載せたページを返します。白い画面にはしません。

## 入力欄の名前について

`pages/monitor.html` と `pages/contact.html` の入力欄は、`name` に
「会社名」「お名前」… と見出しそのものを入れてあります。
Worker は受け取った順に並べるだけなので、見出しがそのままメールの項目名になります。

欄を足したり名前を変えたりしたら、`python3 build.py` を実行して
`worker/form_fields.js` も一緒にコミットしてください。
一覧に無い名前の欄が来ると、Worker は送信を止めます。

## 先行モニターの申し込み（2026-11-18 から）

`_form` が「先行モニター申込」の送信は、`worker/monitor.js` が受けます。
項目と同意の記録の決まりは、VideoTask のリポジトリの `docs/hp-form.md` の 1.・2. です。
申込者には、メールを自動で送りません（Email Sending は有料プランが要るため）。

    index.js の守り（隠し欄・欄の名前・Turnstile）
      ▼
    monitor.js
      │  1. 必須・形・規約への同意・同意した規約の制定日を確かめる
      │     （制定日は worker/form_fields.js の TERMS_DATES にあるものだけ）
      │  2. D1 の monitor_applications に 1 行残す。残せなければ止める
      │     本番（yhasegawa.com）は DB、プレビュー（*.workers.dev）は DB_PREVIEW
      │  3. SUPPORT（Email Routing。無料）で support@videotask.app に送る。
      │     送れなければ止める。結果は D1 の ops_mail に書く
      │  4. 受け付けた内容を返す → 送信した直後の画面に出す（保存・印刷してもらう）
      ▼
    運営者が、管理画面のご案内とあわせて、受け付けた内容をメールで送る

- 表は `worker/schema.sql`。IP アドレスは残しません
- SUPPORT は Verified のアドレスにしか送れません。Email Routing の宛先に
  support@videotask.app を足して、確認のリンクを押しておくこと
- 相談のフォームは今までどおり、MAIL で自分あてに送るだけです

## 先行モニター規約の版

`terms/monitor/` に 1 版 1 ファイルで置きます。`build.py` が、
`/monitor-terms/<制定日>/`（版ごと）と `/monitor-terms/`（いまの版）を作り、
フォームの同意の印の文と、Worker が受け付ける制定日の一覧を書き出します。
規約を変えるときは、前の版のファイルを消さずに、新しいファイルを足します。

## テスト

    python3 build.py
    node --import ./test/register.mjs --test test/worker.test.mjs

D1・メール・Turnstile は偽物に差し替えます。本物のメールは送りません。
