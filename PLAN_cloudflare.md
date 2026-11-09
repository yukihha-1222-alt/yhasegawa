# Cloudflare の計画（A-1 配信範囲 ＋ A-8 フォーム）

A-1「ソースファイルが丸ごと公開される」と A-8「フォームが届かない人がいる」は、
どちらも同じ Worker の設定に触ります。片方ずつ本番に当てると切り替えが2回に
なるので、1つの計画にまとめました。

**これは計画です。実装はまだしていません。** 確認をいただいてから着手します。

- 書いた日: 2026年11月10日
- 対象ブランチ: `renewal`（`main` には触れません）

---

## 0. 先に確かめていただきたいこと（5分）

**いまの本番が、どうやって更新されているかが分かっていません。** これだけは
手元から調べられないので、ダッシュボードを見ていただく必要があります。

`dash.cloudflare.com` → 左メニュー **Compute (Workers)** → `yhasegawa` の Worker
→ **Settings** → **Build**

| 見えるもの | 意味 | この計画での進め方 |
|---|---|---|
| GitHub のリポジトリが繋がっている | **Workers Builds** です。push するとCloudflareが自動で作り直します | ビルドコマンドに `python3 build.py` を入れられるので、`dist/` をリポジトリに入れなくて済みます |
| 何も繋がっていない | 手元から `wrangler deploy` しています | `dist/` をリポジトリに入れて、`wrangler deploy` で上げます |

同じ画面の **Branch control** に「Production branch」があれば、それが `main` に
なっているはずです。**ここは触らないでください。** `renewal` を production に
するとそのまま公開されます。

あわせて、同じ Worker の **Settings → Assets** に **Not found handling** が
あります。いまは既定（`none`）のはずです。切り替えのときに `404-page` にします
（先に作ってある `404.html` が出るようになります）。

---

## 1. できあがりの形

```
yhasegawa.com/*
   │
   ├─ POST /api/form  ───→ Worker のコードが処理
   │                        1. Turnstile のトークンを検証
   │                        2. 入力を読み、メールの本文に組み立てる
   │                        3. Email Routing でメールを送る
   │                        4. JSあり → JSON を返す / JSなし → お礼のページを返す
   │
   └─ それ以外        ───→ dist/ の中のファイルだけを返す
                            （pages/ parts/ vendor/ build.py は dist/ に入らない）
```

`dist/` に入れないものは、配信の対象になりません。これが A-1 の答えです。
いまのように「リポジトリの中身がそのままURLになる」状態ではなくなります。

---

## 2. A-1 … 書き出したものだけを配信する

### 2-1. `build.py` の変更

出力先を、リポジトリ直下から `dist/` に変えます。

```
いま                          変更後
  index.html                   dist/index.html
  about/index.html             dist/about/index.html
  404.html                     dist/404.html
  assets/css/site.css          dist/assets/css/site.css   ← コピーする
  assets/img/…                 dist/assets/img/…          ← コピーする
```

`dist/` に入るのは次の4種類だけです。

- 各ページの `index.html`（12枚）と `404.html`
- `assets/css/site.css` と `assets/js/site.js`
- `assets/img/` の画像、`assets/favicon*`、`assets/apple-touch-icon.png`、`assets/qr/`、ストアのバッジ
- `robots.txt` と `sitemap.xml`（C-1・C-2。ついでに入れます）

**入らないもの**：`pages/` `parts/` `vendor/` `build.py` `check.py` `*.md`
`.vscode/` `.gitignore`。いまは全部 URL で読めます。

### 2-2. 古い出力を消す

リポジトリ直下にある `index.html` `about/` `faq/` … は要らなくなるので削除します。
**残したままだと `dist/` と二重になり、どちらが配信されているか分からなくなります。**

### 2-3. `dist/` をリポジトリに入れるかどうか

上の「0.」の結果で決まります。

- **Workers Builds が繋がっている場合** … `dist/` は `.gitignore` に入れ、
  Cloudflare 側の **Build command** に `python3 build.py` を、
  **Deploy command** に `npx wrangler deploy` を入れます。
  リポジトリには書き出したHTMLが入らなくなり、見通しがよくなります。
- **繋がっていない場合** … `dist/` もコミットします（いまと同じやり方）。

---

## 3. A-8 … フォームを Worker で受けてメールにする

### 3-1. なぜ Email Routing で送るのか

すでに `yhasegawa.com` の受信が Cloudflare Email Routing で動いています。
Worker から **`send_email` バインディング**を使うと、**外部のメール配信サービスを
契約せずに**、そのまま本人宛てに送れます。費用もかかりません。

**1点だけ確かめる必要があります。** `send_email` の宛先は「Email Routing で
確認済みの宛先」でなければなりません。いま確認済みなのは転送先の Gmail です。
`hasegawa@yhasegawa.com` をそのまま宛先に指定できるかは、実際に試さないと
分かりません。だめだった場合は Gmail を宛先にします（届く場所は同じです）。
どちらも無理だった場合の逃げ道として、Resend（月3000通まで無料）を使う手も
ありますが、独自ドメインの送信設定が別に要るので最後の手段です。

### 3-2. 新しく作るファイル

| ファイル | 中身 |
|---|---|
| `wrangler.toml`（直下・新規） | Worker の名前、`dist/` を静的ファイルとして配る設定、`send_email` の宛先、Turnstile のキー |
| `worker/index.js`（新規） | `/api/form` の処理。それ以外は静的ファイルに渡す |
| `build.py`（変更） | 出力先を `dist/` に。Turnstile のウィジェットをフォームに差し込む |
| `assets/js/site.js`（変更） | `mailto:` をやめ、`fetch` で `/api/form` に送る |
| `pages/monitor.html` `pages/contact.html`（変更） | `<form method="post" action="/api/form">`、Turnstile の枠、`<noscript>` の案内 |

**`wrangler.toml` は、切り替えの当日まで置きません。** 先に置くと、Workers Builds が
繋がっていた場合に、次の push でそれを読んで動きが変わる可能性があるためです。

### 3-3. `wrangler.toml` の案

```toml
name = "yhasegawa"
main = "worker/index.js"
compatibility_date = "2026-11-10"

[assets]
directory = "./dist"
binding = "ASSETS"
not_found_handling = "404-page"
run_worker_first = ["/api/*"]      # /api/ だけ先にコードへ。残りは静的ファイル

[[send_email]]
name = "MAIL"
destination_address = "hasegawa@yhasegawa.com"   # 3-1 の確認しだいで Gmail に

[vars]
TURNSTILE_SITEKEY = "0x4AAAAAAA..."   # 画面に出る鍵。公開してよい
# TURNSTILE_SECRET は Secret で入れる。リポジトリには絶対に書かない
```

### 3-4. Worker のすること（`worker/index.js`）

```
POST /api/form を受けたら

 1. 本文を読む（urlencoded と FormData の両方を受ける）
 2. 迷惑メール対策
    ・Turnstile のトークンがある → Cloudflare に問い合わせて検証。だめなら拒否
    ・トークンが無い（JSが動いていない）
        - 隠し欄（ハニーポット）が空か
        - フォームを開いてから3秒以上経っているか
        - 同じIPから1分に3件を超えていないか
      をすべて満たせば通す。件名に「JSなし」と印を付ける
 3. 入力をそのまま並べてメールの本文にする
    入力欄の name は「会社名」「お名前」…と日本語にしてあるので、
    JSが動いても動かなくても同じ形のメールが届く（実装済み）
 4. 送る。Reply-To に入力されたメールアドレスを入れる（そのまま返信できる）
 5. 返す
    ・fetch から来た（Accept: application/json） → {"ok":true} を返す
    ・ふつうの送信（JSなし） → お礼のページをHTMLで返す
 6. 送信に失敗したら
    入力した内容をそのまま載せたページを返し、
    「お手数ですがこの内容をコピーして hasegawa@yhasegawa.com へ」と出す。
    ここが「入力が消えない」の最後の砦です
```

### 3-5. JavaScript が動かない場合

| | いま（mailto） | 変更後 |
|---|---|---|
| JSあり・メールソフトあり | 届く | 届く |
| JSあり・Web版のGmailだけ | **届かない** | 届く |
| **JSなし** | **入力が消える**（`<form>` に `action` が無いため再読み込み） | **届く**（ハニーポットと時間で判定） |
| 送信に失敗 | 何も残らない | 入力を載せたページが出る |

`<noscript>` にも、電話番号とメールアドレスを出します。

### 3-6. Turnstile について

- 見た目：チェックを求めない「Managed」モードにします。ほとんどの人は何も
  操作せずに通ります。
- 置き場所：送信ボタンのすぐ上。
- 読み込み：`https://challenges.cloudflare.com/turnstile/v0/api.js`（外部ファイルが
  1つ増えます。`defer` で読むので表示は遅くなりません）
- Cookie：追跡のための Cookie は使わない仕組みですが、プライバシーポリシーには
  「スパム判定に Cloudflare のしくみを使っています」と書きます（下の 6.）。

---

## 4. 長谷川がダッシュボードでする操作

順番どおりに進めてください。**4-1 から 4-3 までは本番に影響しません。**

### 4-1. Turnstile の鍵を作る（影響なし）

`dash.cloudflare.com` → 左メニュー **Turnstile** → **Add site**

| 欄 | 入れるもの |
|---|---|
| Site name | `yhasegawa.com` |
| Domains | `yhasegawa.com` |
| Widget Mode | **Managed** |

作ると **Site Key**（`0x4AAA…`）と **Secret Key** が出ます。
Site Key はそのまま教えてください（公開してよいものです）。
**Secret Key は、この画面に貼らないでください。** 4-4 でダッシュボードに直接入れます。

### 4-2. 送信元のアドレスを作る（影響なし）

`dash.cloudflare.com` → `yhasegawa.com` → **メール** → **Email Routing**
→ **Routing rules**

`form@yhasegawa.com` という宛先を1つ足し、転送先をいまと同じ Gmail にします。
Worker はこのアドレスを「差出人」として使います。受信もできる状態にしておくと、
不達の通知を受け取れます。

### 4-3. 宛先が確認済みか見る（影響なし）

同じ画面の **Destination addresses** に、`hasegawa@yhasegawa.com` の転送先の
Gmail が **Verified** で並んでいるはずです。ここの一覧に載っているアドレスしか、
Worker からは送れません。載っているアドレスを教えてください。

### 4-4. Secret を入れる（切り替えの直前）

**Compute (Workers)** → `yhasegawa` → **Settings** → **Variables and Secrets**
→ **Add** → Type を **Secret** にして

| 名前 | 値 |
|---|---|
| `TURNSTILE_SECRET` | 4-1 で出た Secret Key |

### 4-5. Not found handling を変える（切り替えのとき）

**Compute (Workers)** → `yhasegawa` → **Settings** → **Assets**
→ **Not found handling** を **404-page** に。

### 4-6. ビルドの設定（Workers Builds が繋がっている場合だけ）

**Settings** → **Build**

| 欄 | 入れるもの |
|---|---|
| Build command | `python3 build.py` |
| Deploy command | `npx wrangler deploy` |

---

## 5. 切り替えの手順と、戻し方

### 5-1. 切り替え

1. `renewal` で実装し、`python3 check.py` と手元のプレビューで確認する
2. Turnstile の Site Key を `build.py` に入れて作り直す
3. **4-4** で Secret を入れる
4. `renewal` を `origin/renewal` に push する（**ここまで本番は変わりません**）
5. Workers Builds が繋がっている場合は、Cloudflare の **Preview URL**
   （`<ブランチ>.yhasegawa.workers.dev` のような形）で本番前に確認できます
6. 問題なければ `main` に取り込んで push → ここで本番が切り替わります
7. **4-5** で Not found handling を `404-page` に
8. 切り替え直後に見るもの
   - トップが出るか／`/shikumi/` などが出るか
   - `https://yhasegawa.com/build.py` が **404 になるか**（A-1 の確認）
   - `https://yhasegawa.com/pages/index.html` が **404 になるか**
   - `https://yhasegawa.com/xxxxx` で 404ページが出るか
   - フォームから自分で1件送ってみて、Gmail に届くか
   - JavaScript を切ったブラウザでも送れるか

### 5-2. 戻し方（3段階）

| 手順 | やり方 | 戻るまで |
|---|---|---|
| いちばん速い | **Compute (Workers)** → `yhasegawa` → **Deployments** → ひとつ前の版の右の **…** → **Rollback** | 30秒ほど |
| ふつう | `git revert` で切り替えのコミットを取り消して `main` に push | 1〜2分 |
| フォームだけ戻す | `assets/js/site.js` を `mailto:` の版に戻して push。Worker はそのままでよい | 1〜2分 |

**いちばん速い戻し方があるので、切り替えは平日の昼間に、手元にパソコンがある
状態でやってください。** 夜中や外出先は避けてください。

---

## 6. 費用

**すべて無料の範囲に収まります。**

| | 無料の範囲 | この計画での見込み |
|---|---|---|
| Workers のリクエスト | 1日10万回 | 静的ファイルの配信は Workers のリクエストに数えられません。数えられるのは `/api/form` だけで、1日に数件です |
| Email Routing | 無料 | 受信・転送とも無料 |
| Worker からのメール送信（`send_email`） | 無料 | 1日に数件 |
| Turnstile | 月100万回の検証 | 桁がまったく違います |
| Static Assets の容量 | 2万ファイル／1ファイル25MBまで | いま42ファイル、合計3MB |

**有料になりうるのは、1日10万回を超えたときだけです。** いまの閲覧数とは
桁が違うので、当面その心配はありません。もし超えるほど伸びたら、
Workers の有料プラン（月5ドル）に上げる判断をすればよい段階です。

---

## 7. プライバシーポリシーの書き換え案

いまの `pages/privacy.html` の「どう管理しているか」は、**mailto を前提に
書いてあるので、切り替えると事実と違ってしまいます。**

### いまの文（そのままにはできません）

> **入力された内容が、このサイトのサーバーに保存されることはありません。**
> 申し込みフォームと相談フォームは、入力した内容をお使いのメールソフトに
> 引き渡すだけのつくりになっています。

### 差し替えの案

> 申し込みフォームと相談フォームに入力された内容は、このサイトを動かしている
> Cloudflare のしくみがいったん受け取り、そのまま長谷川のメールに送ります。
> **内容をためておく場所（データベース）は持っていません。**
> 受け取ってメールにするまでの、ごく短いあいだだけ通過します。
>
> 届いたメールは、長谷川侑希のメールの受信箱で管理しています。
> 見られるのは長谷川だけです。ほかの人に見せることはありません。
>
> やり取りが終わった情報は、お見積りや契約の記録として必要な期間だけ残します。
> 必要がなくなったものは消します。

### 「集めている情報」に足す1文

> いたずらの送信を防ぐために、Cloudflare のしくみ（Turnstile）を使っています。
> 送信のときに、人が操作しているかどうかだけを見ています。
> 広告のために後を追うことはしません。

**反映は確認をいただいてからにします。** いまのところ privacy.html は
触っていません。

---

## 8. この計画で残ること（別の話）

- `hasegawa@yhasegawa.com` からの**返信**は、いまも Gmail のアドレスのままです。
  受信だけが独自ドメインで、送信は別の設定が要ります。この計画には含めていません。
- `robots.txt` と `sitemap.xml`（C-1・C-2）は、`dist/` を作るついでに入れます。
