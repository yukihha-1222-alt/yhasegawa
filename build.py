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
    全角スペース（長谷川　侑希 など）は意図して入れているので触らない。
    """
    out = []
    for part in re.split(r'(<[^>]*>)', html):
        if not part.startswith('<'):
            part = re.sub(r'(?<=[^\x00-\x7F])[ \t\r\n]+(?=[^\x00-\x7F])', '', part)
        out.append(part)
    return ''.join(out)


def fill(template, values):
    """{{name}} を values[name] に置き換える。残ったら間違いなので落とす。"""
    out = re.sub(r'\{\{\s*(\w+)\s*\}\}',
                 lambda m: values.get(m.group(1), m.group(0)), template)
    left = re.findall(r'\{\{\s*(\w+)\s*\}\}', out)
    if left:
        raise ValueError('差し込めなかった項目: ' + ', '.join(sorted(set(left))))
    return out


def main():
    if not os.path.isdir(PARTS) or not os.path.isdir(PAGES):
        sys.exit('parts/ か pages/ が見つかりません')

    layout = read(os.path.join(PARTS, 'layout.html'))
    common = {name: read(os.path.join(PARTS, name + '.html'))
              for name in ('header', 'contact', 'footer', 'mobilebar')}

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

        values = dict(common)
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

    print('%d ページを組み立てました' % len(built))
    for url, path, n in built:
        print('  %-14s → %-26s 本文 %5d 字' % (url, path, n))

    # 置き去りになった古い出力に気づけるように
    known = {p for _, p, _ in built}
    for d in sorted(os.listdir(ROOT)):
        p = os.path.join(d, 'index.html')
        if os.path.isdir(os.path.join(ROOT, d)) and d not in ('.git', 'assets', 'parts', 'pages') \
           and os.path.isfile(os.path.join(ROOT, p)) and p not in known:
            print('  ※ pages/ に対応がない出力が残っています: ' + p)


if __name__ == '__main__':
    main()
