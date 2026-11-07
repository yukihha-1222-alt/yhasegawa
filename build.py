#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
yhasegawa.com の組み立て

    python3 build.py

parts/ の共通部品と pages/ の各ページ本文を合わせて、配信用のHTMLを書き出す。
npm も node_modules も使わない。Python の標準ライブラリだけで動く。

    parts/layout.html   全ページの骨組み。{{...}} が差し込み口
    parts/header.html   ヘッダー（ナビ）
    parts/contact.html  相談ブロック。全ページの末尾に入る
    parts/footer.html   フッター
    parts/mobilebar.html スマホの画面下に固定するボタン
    pages/<名前>.html    そのページだけの本文。先頭にページ情報を書く

生成されるのは

    pages/index.html     →  index.html
    pages/kensetsu.html  →  kensetsu/index.html

HTMLを直接さわらないこと。次のビルドで消える。pages/ と parts/ を直す。
"""

import io, os, re, sys, shutil

# ------------------------------------------------------------------
# サイト全体で使う値。ページや部品の中で {{mail}} と書けば差し込まれる。
#
# 受信は Cloudflare Email Routing の転送。
#   hasegawa@yhasegawa.com → 本人のGmail（転送先はサイトには出さない）
#   設定は dash.cloudflare.com → yhasegawa.com → メール → Email Routing
#   転送先を変えるときもダッシュボード側だけでよく、ここは触らない。
#
# 【注意】返信すると差出人はGmailのままになる。
#   Gmailのエイリアス送信が使えるか、別のSMTPを用意するかは未定。
MAIL = 'hasegawa@yhasegawa.com'
# ------------------------------------------------------------------

ROOT  = os.path.dirname(os.path.abspath(__file__))
PARTS = os.path.join(ROOT, 'parts')
PAGES = os.path.join(ROOT, 'pages')

WARNING = (
    '<!-- ============================================================\n'
    '     このファイルは build.py が組み立てたものです。直接編集しても、\n'
    '     次のビルドで消えます。本文は pages/{src}、\n'
    '     共通部分は parts/ を編集して python3 build.py を実行してください。\n'
    '     ============================================================ -->\n'
)


def read(path):
    with io.open(path, encoding='utf-8') as f:
        return f.read()


def write(path, text):
    d = os.path.dirname(path)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(path, 'w', encoding='utf-8') as f:
        f.write(text)


def parse_page(text):
    """先頭の <!--page ... --> からページ情報を取り出し、本文と分けて返す。

    <!--page
    slug: kensetsu
    title: 建設・設備工事の現場へ｜…
    description: …
    -->
    """
    m = re.match(r'\s*<!--page\s*(.*?)-->\s*', text, re.S)
    if not m:
        raise ValueError('先頭に <!--page ... --> がありません')
    meta = {}
    for line in m.group(1).strip().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if ':' not in line:
            raise ValueError('ページ情報の書き方が違います: ' + line)
        k, v = line.split(':', 1)
        meta[k.strip()] = v.strip()
    for need in ('slug', 'title', 'description'):
        if need not in meta:
            raise ValueError('ページ情報に %s がありません' % need)
    return meta, text[m.end():]


def tidy_ja(html):
    """日本語の文字どうしのあいだにある改行とインデントを取り除く。

    HTMLでは改行が半角の空きとして表示されるため、ソースを読みやすく
    折り返すと「入力する。 その二度手間」のように妙な隙間ができる。
    タグの外側の文字だけを見て、両隣が日本語のときだけ詰める。

    【注意】取り除くのは改行をはさんだ空きだけにすること。
    改行のない半角スペース（「初期 約100〜200万円」など）は、
    読みやすさのために手で入れたものなので残す。
    全角スペース（長谷川　侑希 など）も同じ理由で触らない。
    """
    out = []
    for part in re.split(r'(<[^>]*>)', html):
        if not part.startswith('<'):
            part = re.sub(r'(?<=[^\x00-\x7F])[ \t]*[\r\n]+[ \t]*(?=[^\x00-\x7F])', '', part)
        out.append(part)
    return ''.join(out)


def fill(template, values, strict=True):
    """{{name}} を values[name] に置き換える。

    strict のときは、埋まらなかった項目が残っていたら間違いとみなして落とす。
    部品を先に埋める段階では、まだ値のない項目が残っていてよいので strict=False。
    """
    out = re.sub(r'\{\{\s*(\w+)\s*\}\}',
                 lambda m: values.get(m.group(1), m.group(0)), template)
    if strict:
        left = re.findall(r'\{\{\s*(\w+)\s*\}\}', out)
        if left:
            raise ValueError('差し込めなかった項目: ' + ', '.join(sorted(set(left))))
    return out


PREVIEW = os.path.join(ROOT, '_preview')


def to_preview(html, slug):
    """見せるためだけの、持ち出せる形に書き換える。

    本番は Workers Static Assets に置くので /kensetsu/ のような絶対パスで
    よいが、プレビューはどこに置かれるか分からない。
    すべて相対パスの平たいファイル（kensetsu.html）に直す。
    あわせて計測タグを外す。下書きを見た回数が本番の数字に混ざると困る。
    """
    # 計測タグ。プレビューの閲覧を Web Analytics に入れない
    html = re.sub(r'<!-- Cloudflare Web Analytics.*?</script>', '', html, flags=re.S)

    # ページへのリンク。/kensetsu/ → kensetsu.html、/ → index.html
    html = re.sub(r'href="/([a-z]+)/(#[^"]*)?"',
                  lambda m: 'href="%s.html%s"' % (m.group(1), m.group(2) or ''), html)
    html = re.sub(r'href="/(#[^"]*)?"',
                  lambda m: 'href="index.html%s"' % (m.group(1) or ''), html)
    # 置き場所に依存しないよう、資材も相対にする
    html = html.replace('href="/assets/', 'href="assets/')
    html = html.replace('src="/assets/', 'src="assets/')
    return html


def main():
    if not os.path.isdir(PARTS) or not os.path.isdir(PAGES):
        sys.exit('parts/ か pages/ が見つかりません')
    preview = '--preview' in sys.argv

    layout = read(os.path.join(PARTS, 'layout.html'))
    # サイト共通の値を先に部品へ埋める。
    # 部品は本文に差し込まれたあと走査されないので、ここで埋めておかないと
    # footer の {{mail}} がそのまま残ってしまう。
    scalars = {'mail': MAIL}
    common = {name: fill(read(os.path.join(PARTS, name + '.html')), scalars, strict=False)
              for name in ('header', 'contact', 'footer', 'mobilebar', 'pricebrief')}
    common.update(scalars)

    built = []
    for fn in sorted(os.listdir(PAGES)):
        if not fn.endswith('.html'):
            continue
        src = os.path.join(PAGES, fn)
        try:
            meta, body = parse_page(read(src))
        except ValueError as e:
            sys.exit('%s: %s' % (fn, e))

        slug = meta['slug']
        # トップだけは直下。ほかは /<slug>/index.html に置き、URLの末尾を / にする
        out = os.path.join(ROOT, 'index.html') if slug == 'index' \
            else os.path.join(ROOT, slug, 'index.html')
        url = '/' if slug == 'index' else '/%s/' % slug

        # 本文の中の {{pricebrief}} などを先に埋める。
        # layout を埋めたあとでは、差し込んだ本文は走査されない。
        try:
            body = fill(body, common)
        except ValueError as e:
            sys.exit('%s: %s' % (fn, e))

        values = dict(common)
        # ご相談ページ自身には、末尾の相談ブロックを入れない。
        # 同じ見出しと同じボタンが1枚の中に二度出てしまう。
        if meta.get('contact', 'yes') == 'no':
            values['contact'] = ''
        values.update({
            'title':       meta['title'],
            'description': meta['description'],
            'url':         url,
            'current':     slug,
            'body':        body.strip(),
        })
        page = tidy_ja(fill(layout, values))
        write(out, WARNING.format(src='pages/' + fn) + page)
        built.append((url, os.path.relpath(out, ROOT), len(body)))

        if preview:
            write(os.path.join(PREVIEW, slug + '.html'), to_preview(page, slug))

    if preview:
        # CSS の中の画像も相対に直す。site.css は assets/css/ にあるので1つ上
        css = read(os.path.join(ROOT, 'assets', 'css', 'site.css'))
        write(os.path.join(PREVIEW, 'assets', 'css', 'site.css'),
              css.replace('url(/assets/', 'url(../'))
        for rel in ('assets/js/site.js', 'assets/store-appstore-ja.svg',
                    'assets/store-googleplay-ja.png', 'assets/store-googleplay-ja.webp'):
            src = os.path.join(ROOT, rel)
            if os.path.isfile(src):
                shutil.copy(src, os.path.join(PREVIEW, rel)) if os.path.isdir(
                    os.path.dirname(os.path.join(PREVIEW, rel))) else (
                    os.makedirs(os.path.dirname(os.path.join(PREVIEW, rel))),
                    shutil.copy(src, os.path.join(PREVIEW, rel)))
        print('プレビューを _preview/ に書き出しました（相対パス・計測タグなし）')

    print('%d ページを組み立てました' % len(built))
    for url, path, n in built:
        print('  %-14s → %-26s 本文 %5d 字' % (url, path, n))

    # 置き去りになった古い出力に気づけるように
    known = {p for _, p, _ in built}
    for d in sorted(os.listdir(ROOT)):
        p = os.path.join(d, 'index.html')
        if os.path.isdir(os.path.join(ROOT, d)) and d not in ('.git', 'assets', 'parts', 'pages', '_preview') \
           and os.path.isfile(os.path.join(ROOT, p)) and p not in known:
            print('  ※ pages/ に対応がない出力が残っています: ' + p)


if __name__ == '__main__':
    main()
