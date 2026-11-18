-- 先行モニターの申し込みの記録。worker/monitor.js が書く。
-- D1 は 2 つ。同じ表を両方に作る。
--   yhasegawa-form          … 本番（yhasegawa.com からの送信。binding DB）
--   yhasegawa-form-preview  … プレビュー（*.workers.dev からの送信。binding DB_PREVIEW）
--
-- 作るとき（1 回だけ）:
--   npx wrangler d1 execute yhasegawa-form         --remote --file worker/schema.sql
--   npx wrangler d1 execute yhasegawa-form-preview --remote --file worker/schema.sql
--
-- 残す期間（HP のプライバシーポリシーと、VideoTask の docs/hp-form.md の 4.）:
--   ・同意の記録（submitted_at, company, applicant_name, applicant_title, terms_date）
--     … 先行モニターが終わってから 5 年間
--   ・それ以外（applicant_email, referrer, fields_json）
--     … 先行モニターが終わってから 1 年以内に消す
--       （お申し込みだけで始めなかった場合は、お申し込みから 1 年以内）
--     消すときの例:
--       UPDATE monitor_applications
--          SET applicant_email = '', referrer = '', fields_json = '{}', erased_at = '<日付>'
--        WHERE id = <受付番号>;
-- IP アドレスは残さない。

CREATE TABLE IF NOT EXISTS monitor_applications (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,  -- 受付番号（メールの件名にも出る）
  submitted_at     TEXT NOT NULL,              -- 送信の日時。日本時間「YYYY-MM-DD HH:MM」
  company          TEXT NOT NULL,              -- 会社名
  applicant_name   TEXT NOT NULL,              -- お申し込みの方のお名前（同意した方）
  applicant_title  TEXT NOT NULL DEFAULT '',   -- 役職
  applicant_email  TEXT NOT NULL,              -- メールアドレス
  terms_date       TEXT NOT NULL,              -- 同意した規約の制定日「YYYY-MM-DD」
  referrer         TEXT NOT NULL DEFAULT '',   -- ご紹介くださった先生のお名前
  fields_json      TEXT NOT NULL,              -- フォームの全部の項目（見出し → 値）
  ops_mail         TEXT NOT NULL DEFAULT '',   -- 運営者あてのメール「sent 日時」か「failed: 理由」
  erased_at        TEXT NOT NULL DEFAULT ''    -- 同意の記録以外を消した日
);
