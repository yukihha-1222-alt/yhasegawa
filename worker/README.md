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
