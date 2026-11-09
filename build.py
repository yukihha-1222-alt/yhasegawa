#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
yhasegawa.com の組み立て

    python3 build.py

parts/ の共通部品と pages/ の各ページ本文を合わせて、配信用のHTMLを書き出す。
npm も node_modules も使わない。使う外部ライブラリは BudouX ひとつだけで、
それも vendor/ に同梱してある（pip も venv も要らない）。

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

ROOT = os.path.dirname(os.path.abspath(__file__))

# 文節の切れ目を判定する BudouX（Google）。
# システムのPythonには入れず、vendor/ に同梱したものを読む。
#   pip3 install --target vendor budoux    ← 入れ直すときはこれ
sys.path.insert(0, os.path.join(ROOT, 'vendor'))
import budoux

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

# サービス名。ページでは常に {{service}} と書けばよい。
# 「各ページで最初の1回だけ読みを添える」のは build.py がやる（first_full）。
# 手で書き分けると、共通の末尾ブロックが先に来るページで取りこぼす。
SERVICE      = 'VideoTask'
SERVICE_FULL = 'VideoTask（ビデオタスク）'
# ------------------------------------------------------------------

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


# ------------------------------------------------------------------
# 文節の切れ目に <wbr> を入れる
#
# 日本語には語の区切りがないので、ブラウザは放っておくと
# 「先行モニ／ター」「お知らせし／ます」のようにどこでも切る。
# BudouX に文節の切れ目を聞いて、そこに <wbr>（切ってよい印）を入れておく。
# CSS 側で word-break:keep-all にしてあるので、印のある所でしか切れなくなる。
#
# <wbr> は画面には出ず、文字数にも数えられず、コピーにも入らない。
# なので「入れてよい所を並べる」のではなく「入れない所だけ」を決めている。
#   ・script style textarea title option pre code svg の中には入れない
#   ・属性値には入れない（タグは丸ごと素通しするので自然にそうなる）
#   ・メールアドレス・電話番号・URL はまたがせない
#   ・英数字どうしのあいだには入れない（VideoTask を割らない）
#   ・括弧や句読点の肩には入れない（<wbr> は禁則処理より強いため）
#
# 【なぜ一覧にしないか】
# はじめは h1 h2 h3 p li dd dt th td figcaption だけにしていたが、
# よくあるご質問の答えは <div class="a">、質問は <summary>、
# フォームの補足は <span class="hint"> で、どれも漏れた。
# 入れ物の名前を数え上げると必ず取りこぼす。
# ------------------------------------------------------------------

NO_WBR_TAGS = {'script', 'style', 'textarea', 'title', 'option', 'pre',
               'code', 'svg', 'select'}
# そのまま置いておきたいかたまり。ここをまたいで切らない
KEEP_WHOLE = re.compile(
    r'[\w.+-]+@[\w.-]+\.\w+'          # メールアドレス
    r'|https?://[^\s<>"\u3000]+'        # URL
    r'|\d[\d\-()\u2212 ]{7,}\d')     # 電話番号

TOKEN = re.compile(r'<!--.*?-->|<[^>]*>|[^<]+', re.S)
ALNUM = re.compile(r'[0-9A-Za-z]')

# <wbr> はブラウザの禁則処理より強い。ここで切ると「（」が行末に残ったり
# 「」」が行頭に来たりするので、自分で避ける。
NO_BREAK_AFTER  = '\u3014\u3008\u300a\u300c\u300e\u3010\uff08\uff3b\uff5b\u2018\u201c('
NO_BREAK_BEFORE = ('\u3015\u3009\u300b\u300d\u300f\u3011\uff09\uff3d\uff5d\u2019\u201d)'
                   '\u3001\u3002\uff0c\uff0e\uff01\uff1f\u30fb'
                   '\u3041\u3043\u3045\u3047\u3049\u3063\u3083\u3085\u3087\u308e'
                   '\u30a1\u30a3\u30a5\u30a7\u30a9\u30c3\u30e3\u30e5\u30e7\u30ee'
                   '\u30fc\u301c\u2026\u2015')

_parser = None


def phrase_wbr(text):
    """ひとつながりの文字に <wbr> を入れて返す。"""
    global _parser
    if not text.strip() or not re.search(r'[^\x00-\x7F]', text):
        return text                      # 日本語がなければ何もしない
    if _parser is None:
        _parser = budoux.load_default_japanese_parser()

    out, pos = [], 0
    for m in KEEP_WHOLE.finditer(text):
        out.append(_split(text[pos:m.start()]))
        out.append(m.group(0))           # メール・URL・電話はそのまま
        pos = m.end()
    out.append(_split(text[pos:]))
    return ''.join(out)


def _hira(ch):
    return '\u3041' <= ch <= '\u309f'


def _kanji(ch):
    return '\u4e00' <= ch <= '\u9fff' or ch == '\u3005'


def _split(s):
    if not s.strip() or not re.search(r'[^\x00-\x7F]', s):
        return s
    head = s[:len(s) - len(s.lstrip())]
    tail = s[len(s.rstrip()):]
    body = s.strip()

    parts = _parser.parse(body)
    # 漢字1文字だけの切片が、次も漢字で始まるときは熟語を割っている。
    # 「つくった研修動画を」が つくった／研／修動画を になるなど。足し戻す。
    i = 0
    while i < len(parts) - 1:
        if len(parts[i]) == 1 and _kanji(parts[i]) and _kanji(parts[i + 1][0]):
            parts[i + 1] = parts[i] + parts[i + 1]
            parts.pop(i)
        else:
            i += 1

    # 「1か月」の数え方を割らない。1か／月後に にならないように。
    i = 0
    while i < len(parts) - 1:
        if re.search(r'[0-9０-９]+[かケヵヶカ]$', parts[i]):
            parts[i + 1] = parts[i] + parts[i + 1]
            parts.pop(i)
        else:
            i += 1

    joined = parts[0]
    for p in parts[1:]:
        a, b = joined[-1], p[0]
        # 英数字の途中では切らない。VideoTask が Video／Task にならないように。
        #
        # ひらがなが続く所でも切らない。BudouX はここを外しやすく
        # （「しくみ」が しく／み、「使うしくみを」が 使うしく／みを）、
        # しかもひらがなの列は語の切れ目が目に見えないので、
        # 間違えたときの読みにくさがいちばん大きい。
        # 入りきらないときは overflow-wrap が切るので、通らなくなるわけではない。
        if (ALNUM.match(a) and ALNUM.match(b)) or (_hira(a) and _hira(b)) \
           or a in NO_BREAK_AFTER or b in NO_BREAK_BEFORE:
            joined += p
        else:
            joined += '<wbr>' + p
    # 「大手家電量販店｜公式スマートフォンアプリ」のような並記は、
    # BudouX がひとかたまりと見るので、区切り記号の後ろは手で足す。
    joined = re.sub(r'(?<=[\uff5c\uff0f])(?!<wbr>)(?=[^\x00-\x7F])', '<wbr>', joined)
    return head + joined + tail


def wbr_ja(html):
    """本文の文節の切れ目に <wbr> を入れる。tidy_ja のあとに通すこと。

    tidy_ja は日本語どうしのあいだの改行を詰める。先に <wbr> を入れると
    そこでタグに分断されて詰められなくなるので、順番を変えないこと。
    """
    out, quiet = [], 0
    for tok in TOKEN.findall(html):
        if tok.startswith('<!--'):
            out.append(tok)
            continue
        if tok.startswith('<'):
            close = re.match(r'</\s*([A-Za-z][\w-]*)', tok)
            if close:
                if close.group(1).lower() in NO_WBR_TAGS:
                    quiet = max(0, quiet - 1)
            else:
                open_ = re.match(r'<\s*([A-Za-z][\w-]*)', tok)
                if open_ and open_.group(1).lower() in NO_WBR_TAGS \
                   and not tok.rstrip().endswith('/>'):
                    quiet += 1
            out.append(tok)
            continue
        out.append(tok if quiet else phrase_wbr(tok))
    return ''.join(out)


def first_full(html):
    """<main> の中で最初に出てくるサービス名にだけ、読みを添える。

    ヘッダーのロゴ下にも名前が入っているが、あれは全ページ共通の説明文
    なので数えない。属性値やコメントの中も数えない。
    """
    m = re.search(r'<main\b.*?</main>', html, re.S)
    if not m:
        return html

    done = [False]

    def one(tok):
        if done[0] or tok.startswith('<'):
            return tok
        if SERVICE_FULL in tok:
            done[0] = True
            return tok
        if SERVICE in tok:
            done[0] = True
            return tok.replace(SERVICE, SERVICE_FULL, 1)
        return tok

    body = ''.join(one(t) for t in TOKEN.findall(m.group(0)))
    return html[:m.start()] + body + html[m.end():]


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
    scalars = {'mail': MAIL, 'service': SERVICE, 'service_full': SERVICE_FULL}
    common = {name: fill(read(os.path.join(PARTS, name + '.html')), scalars, strict=False)
              for name in ('header', 'footer', 'mobilebar',
                           'tail_monitor', 'tail_soudan')}
    common.update(scalars)

    built = []
    for fn in sorted(os.listdir(PAGES)):
        # 頭に _ の付くファイルは出力しない。消さずに取っておくための印。
        if not fn.endswith('.html') or fn.startswith('_'):
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
        # ページの末尾に置くブロックを選ぶ。
        #   monitor … 先行モニターの申し込み（プラットフォーム側のページ）
        #   soudan  … ご相談（受託・補助金など、受託側のページ）
        #   no      … 置かない（申し込みページと相談ページ自身）
        tail = meta.get('tail', 'monitor')
        values['tail'] = {'monitor': common['tail_monitor'],
                          'soudan':  common['tail_soudan'],
                          'no':      ''}.get(tail)
        if values['tail'] is None:
            sys.exit('%s: tail は monitor / soudan / no のどれか' % fn)
        values.update({
            # title と description にも {{service}} と書ける。
            # layout に差し込んだあとは走査されないので、ここで埋める。
            'title':       fill(meta['title'], scalars),
            'description': fill(meta['description'], scalars),
            'url':         url,
            'current':     slug,
            'body':        body.strip(),
        })
        page = wbr_ja(first_full(tidy_ja(fill(layout, values))))
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
