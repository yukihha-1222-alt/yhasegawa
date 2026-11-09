# 切り替えの手順

`PLAN_cloudflare.md` の計画を実装しました。**まだ push していません。**
下の「1.」をダッシュボードで終えてから、push の指示をください。

---

## ⚠️ 先に1つだけ確認してください

`wrangler.toml` の1行目あたりに

```toml
name = "yhasegawa"
```

と書いてあります。**ここは、いまダッシュボードにある Worker の名前と
同じでなければいけません。**

`dash.cloudflare.com` → 左メニュー **Compute (Workers)** の一覧に出ている
名前を見てください。`yhasegawa` でなければ、その名前を教えてください。
こちらで直します。

違う名前のまま進めると、**別の Worker が新しく作られ、`yhasegawa.com` は
いまの古いサイトのまま**になります（本番が壊れることはありませんが、
プレビューを見ても新しいサイトが出ません）。

---

## 1. push の前にする操作

### 1-1. Turnstile に、プレビューのドメインを足す

`dash.cloudflare.com` → 左メニュー **Turnstile** → 作ったウィジェット
→ **Settings** → **Hostname Management**（または Domains）

いまは `yhasegawa.com` だけです。ここに次の2つを足してください。

| 足すもの | 何のため |
|---|---|
| `workers.dev` | プレビューURLのドメイン。下の「3.」参照 |
| `localhost` | 手元で確かめるとき。入れておくと後で楽です |

**足さないと、プレビューではフォームの確認が通らず、送信できません。**

### 1-2. Secret Key を入れる

**Compute (Workers)** → 対象の Worker → **Settings**
→ **Variables and Secrets** → **＋ Add**

| 欄 | 入れるもの |
|---|---|
| Type | **Secret**（Text ではありません） |
| Variable name | `TURNSTILE_SECRET` |
| Value | Turnstile の Secret Key |

入れたら **Deploy** / **Save** を押してください。
※ Secret はこのチャットにも、リポジトリにも書きません。

### 1-3. non-production branch のデプロイのしかたを確かめる

**Compute (Workers)** → 対象の Worker → **Settings** → **Build**

- **Build command** … **空欄のままで構いません。**
  書き出したページは `dist/` としてリポジトリに入れてあるので、
  Cloudflare 側でビルドする必要がありません。
- **Deploy command** … `npx wrangler deploy` のままで構いません。
- **Non-production branch deploy command**（または
  「Preview branches」の項目）… ここを見てください。
  **`npx wrangler versions upload` になっているのが正しい状態**です。
  もし `npx wrangler deploy` になっていたら、**`npx wrangler versions upload`
  に変えてください。**

> **なぜ確かめるのか**
> `wrangler deploy` は「本番として配る」命令です。これが
> non-production branch にも使われる設定だと、`renewal` に push した瞬間に
> `yhasegawa.com` が切り替わってしまいます。
> `versions upload` は「版を上げるだけで、本番には出さない」命令なので、
> プレビューURLだけができます。

**この3つが終わったら教えてください。`renewal` に push します。**

---

## 2. push したあとにすること

こちらで `git push origin renewal` を実行します（指示をいただいてから）。
`main` には触れません。

Cloudflare の **Compute (Workers)** → 対象の Worker → **Deployments**
（または **Builds**）に、`renewal` のビルドが出ます。

---

## 3. プレビューURLの形

Workers Builds が non-production branch のビルドで作るのは、
**版ごとのプレビューURL**です。形は次のどちらかです。

```
https://<8桁の英数字>-<Worker名>.<アカウントのサブドメイン>.workers.dev
例: https://a1b2c3d4-yhasegawa.yhasegawa.workers.dev
```

正確なURLは、**Deployments（Builds）の画面に「Preview URL」として表示されます。**
ビルドが終わったら、そこからコピーしてください。

**`workers.dev` を Turnstile に足しておく必要があるのは、このためです**（1-1）。

### プレビューで本番と違うところ

| | プレビュー | 本番 |
|---|---|---|
| Turnstile | 1-1 でドメインを足していないと通らない | `yhasegawa.com` で通る |
| メールの送信 | **本番と同じ**。`sakamotoyuki.develop@gmail.com` に届く | 同じ |
| Secret | 同じ Worker の設定を使う（1-2 を済ませてあれば効く） | 同じ |
| 独自ドメイン | 付かない（`workers.dev` のまま） | `yhasegawa.com` |
| Web Analytics | 計測タグは入っています。プレビューの閲覧も数に混ざります | — |

**プレビューから送ったメールも、本物として届きます。** 件名で見分けられるよう、
テストのときは会社名に「テスト」と入れてください。

---

## 4. プレビューで確かめること

### 4-1. 見た目

- [ ] トップが出る。ファーストビューに「開発中」の札、見出し、申し込みボタンが見える
- [ ] 申し込みボタンが、スクロールせずに見える
- [ ] 管理画面の画像の**文字が読める**（「まだ見ていない人」「4人に催促する」など）
- [ ] スマホで見ると、画像が1行だけの別の切り出しに変わる
- [ ] `/shikumi/` `/monitor/` `/partner/` `/jutaku/` `/privacy/` が開く
- [ ] タブに緑のアイコンが出る
- [ ] ページの下のメニューに「プライバシーポリシー」がある

### 4-2. ソースが読めなくなっていること（A-1）

ブラウザのアドレス欄に直接入れて、**すべて 404 になること**を見てください。

- [ ] `<プレビューURL>/build.py` → **404**
- [ ] `<プレビューURL>/pages/index.html` → **404**
- [ ] `<プレビューURL>/parts/layout.html` → **404**
- [ ] `<プレビューURL>/vendor/budoux/` → **404**
- [ ] `<プレビューURL>/wrangler.toml` → **404**
- [ ] `<プレビューURL>/LAUNCH_CHECKLIST.md` → **404**
- [ ] `<プレビューURL>/.vscode/settings.json` → **404**
- [ ] `<プレビューURL>/あいうえお` → **404のページ**（真っ白ではなく、案内が出る）
- [ ] `<プレビューURL>/robots.txt` → 中身が出る
- [ ] `<プレビューURL>/sitemap.xml` → 中身が出る

### 4-3. フォームの送信（A-8）

**ふつうに送る**

- [ ] `/monitor/` を開く。送信ボタンの上に Turnstile の枠が出る
- [ ] 会社名に「テスト」と入れて、必須だけ埋めて送信する
- [ ] ページが切り替わらず、その場で「ありがとうございます」が出る
- [ ] `sakamotoyuki.develop@gmail.com` に
      **件名「【先行モニター申込】テスト…」**のメールが届く
- [ ] 本文が「■ 会社名／■ お名前…」の形で読める
- [ ] メールに**返信**すると、入力したメールアドレス宛になる（Reply-To）

**JavaScript を切って送る**（ここが今回の肝です）

Chrome なら、プレビューURLを開いた状態で
F12 →（Macは `⌘ + ⌥ + I`）→ 右上の歯車 → **Debugger** の
「**Disable JavaScript**」にチェック → ページを再読み込み。

- [ ] Turnstile の枠は出ない。代わりに電話番号とメールの案内が出る
- [ ] 入力して送信すると、**入力が消えずに**「ありがとうございます」のページが出る
- [ ] メールが届く。**本文の先頭に「（自動判定なし…）」と入っている**
- [ ] 確認が終わったら「Disable JavaScript」のチェックを外す

**わざと失敗させる**（任意）

- [ ] `/contact/` で何も入力せずに送信 → 入力内容を載せたページが出て、
      「この内容をメールで送る」「電話する」のボタンが出る

---

## 5. 本番への切り替え（プレビューで問題がなければ）

1. ご指示をいただいたら、こちらで `renewal` を `main` に取り込みます
2. **長谷川が** `git push origin main` を実行します（公開のタイミングはご本人が握る）
3. 切り替わったら、**Compute (Workers)** → 対象の Worker → **Settings**
   → **Assets** → **Not found handling** を **404-page** に
   （`wrangler.toml` にも書いてありますが、ダッシュボード側が優先されることが
   あるため、念のため見てください）
4. 本番で 4-2 と 4-3 をもう一度、今度は `https://yhasegawa.com/` で確かめる

## 6. 戻し方

| 速さ | やり方 |
|---|---|
| 30秒 | **Compute (Workers)** → Worker → **Deployments** → ひとつ前の版の **…** → **Rollback** |
| 1〜2分 | `git revert` して `main` に push |

**切り替えは平日の昼間、手元にパソコンがある状態でやってください。**
