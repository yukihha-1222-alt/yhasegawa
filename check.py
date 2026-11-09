#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
文言と改行の確認

    python3 check.py              1280 / 1024 / 390px で全ページを見る
    python3 check.py 390          幅を指定する

見るのは6つ。

    1. 読点が3つ以上ある文
    2. 80字を超える文
    3. リンク切れ（ページ内の #見出し も含む）
    4. 置き換え忘れた [サービス名]
    5. 最後の1〜2文字だけが次の行に落ちている箇所
    6. 単語の途中で切れている箇所

1〜4はHTMLを読めば分かる。5と6は実際に描かないと分からないので、
ヘッドレスChromeで一文字ずつ位置を測り、同じ高さに並ぶものを1行と
みなしている。

【測り方の注意】
ヘッドレスChromeの窓は500pxより狭くできない。390pxで見るときは、
広い窓の中に390pxのiframeを置いて、その中を測っている。
メディアクエリはiframeの幅で効くので、これで実機と同じ条件になる。
Googleフォント（BIZ UDPGothic）の読み込み待ちもしている。
"""

import io, os, re, sys, json, glob, time, subprocess

ROOT   = os.path.dirname(os.path.abspath(__file__))
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
PORT   = 8799
WIDTHS = (1280, 1024, 390)
PROFILE = os.path.join(ROOT, '.chrome-check')

# 配信するのは dist/ の中だけ。確認も dist/ を見る。
DIST = os.path.join(ROOT, 'dist')
PAGES = ['/index.html'] + sorted(
    '/%s/index.html' % d for d in os.listdir(DIST)
    if os.path.isdir(os.path.join(DIST, d))
    and os.path.isfile(os.path.join(DIST, d, 'index.html')))


# ---------------------------------------------------------------- 読むだけで分かるもの

def visible_text(html):
    """画面に出る文字だけにする。タグ・属性・コメントを落とす。"""
    h = re.sub(r'<!--.*?-->', '', html, flags=re.S)
    h = re.sub(r'<(script|style|title)\b.*?</\1>', '', h, flags=re.S)
    h = h.replace('<wbr>', '')
    h = re.sub(r'<br\s*/?>', '\n', h)
    h = re.sub(r'</(p|li|h1|h2|h3|h4|dd|dt|div|section|summary|label|span|td|th)>', '\n', h)
    h = re.sub(r'<[^>]+>', '', h)
    return h.replace('&amp;', '&').replace('&nbsp;', ' ')


def sentences(html):
    for block in visible_text(html).split('\n'):
        block = re.sub(r'[ \t]+', '', block).strip()
        if not block:
            continue
        for s in re.split(r'(?<=。)', block):
            s = s.strip()
            if len(s) >= 2:
                yield s


def read_all():
    return {p: io.open(os.path.join(DIST, p.strip('/')), encoding='utf-8').read()
            for p in PAGES}


def check_text(pages):
    comma, long_, leftover = [], [], []
    for p, h in pages.items():
        for s in sentences(h):
            if s.count('、') >= 3:
                comma.append((p, s.count('、'), s))
            if len(s) > 80:
                long_.append((p, len(s), s))
        for m in re.finditer(r'\[サービス名\]', h):
            leftover.append(p)
    return comma, long_, leftover


def check_links(pages):
    """リンク先が実在するか。ページ内の #id も確かめる。"""
    ids = {p: set(re.findall(r'id="([^"]+)"', h)) for p, h in pages.items()}
    bad = []
    for p, h in pages.items():
        for href in re.findall(r'href="([^"]+)"', h):
            if href.startswith(('mailto:', 'tel:', 'http://', 'https://', 'data:')):
                continue
            target, _, frag = href.partition('#')
            if not target:
                if frag and frag not in ids[p]:
                    bad.append((p, href, 'このページに #%s がない' % frag))
                continue
            if target == '/':
                tp = '/index.html'
            elif target.endswith('/'):
                tp = target + 'index.html'
            else:
                tp = target
            if tp in pages:
                if frag and frag not in ids[tp]:
                    bad.append((p, href, '%s に #%s がない' % (tp, frag)))
            elif not os.path.isfile(os.path.join(DIST, tp.lstrip('/'))):
                bad.append((p, href, 'ファイルがない'))
    return bad


# ---------------------------------------------------------------- 描いて測るもの

PROBE = r'''<!DOCTYPE html><html><head><meta charset="utf-8">
<style>html,body{margin:0}</style></head><body><div id="r">まだ</div><script>
var PAGES = __PAGES__, W = __W__, out = [], i = 0;

/* 一文字ずつ位置を測り、上端が同じものを1行にまとめる。
   どの要素の中の文字かも覚えておく。要素が変われば、そこは
   もともと別の文なので「語の途中で切れた」とは数えない。 */
function linesOf(el) {
  var w = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT), n, nodes = [];
  while ((n = w.nextNode())) nodes.push(n);
  var r = el.ownerDocument.createRange(), lines = [], cur = null, last = null;
  var ok = true;   /* 次の文字の手前に、切ってよい印があるか */
  for (var a = 0; a < nodes.length; a++) {
    var data = nodes[a].data, par = nodes[a].parentNode;
    /* 直前の兄弟に <wbr> があれば、そこは切ってよい場所 */
    var prev = nodes[a].previousSibling;
    if (prev && prev.nodeType === 1 && prev.tagName === 'WBR') ok = true;
    for (var b = 0; b < data.length; b++) {
      if (/\s/.test(data[b])) { ok = true; continue; }
      r.setStart(nodes[a], b); r.setEnd(nodes[a], b + 1);
      var rc = r.getClientRects()[0];
      if (!rc || !rc.height) continue;
      var top = Math.round(rc.top);
      if (last === null || Math.abs(top - last) > 4) { cur = []; lines.push(cur); last = top; }
      cur.push({ c: data[b], p: par, ok: ok });
      ok = false;
    }
  }
  return lines;
}
function textOf(line) {
  return line.map(function (x) { return x.c; }).join('');
}

var KATA = /[ァ-ヺー]/, ALNUM = /[0-9A-Za-z]/, KANJI = /[一-鿿]/;

function scan(d) {
  var found = { orphan: [], mid: [], lefts: [],
                vw: d.documentElement.clientWidth, seen: 0, multi: 0 };

  /* 節ごとの本文の左端。ずれていればここで分かる */
  var secs = d.querySelectorAll('section > .wrap');
  for (var s = 0; s < secs.length; s++) {
    var first = secs[s].querySelector(
      ':scope > .sec-head > h1, :scope > .sec-head > h2, :scope > .sec-head > p,'
      + ':scope > h1, :scope > h2, :scope > h3, :scope > p, :scope > ul');
    if (!first) continue;
    var sec = secs[s].parentNode;
    found.lefts.push({ cls: sec.className,
                       left: Math.round(first.getBoundingClientRect().left),
                       w: Math.round(first.getBoundingClientRect().width) });
  }

  var els = d.querySelectorAll('h1,h2,h3,h4,p,li,dd,dt,th,td,summary,figcaption,'
                             + 'label,legend,.a,.t,.d,.hint,.sub,.what,.name');
  for (var i2 = 0; i2 < els.length; i2++) {
    var el = els[i2];
    if (el.closest('.hp')) continue;   /* 画面の外に置いた隠し欄 */
    if (el.querySelector('p,li,h1,h2,h3,h4,ul,ol,div,section,figure,table')) continue;
    var txt = (el.textContent || '').replace(/\s+/g, '');
    if (txt.length < 10) continue;
    var ls;
    try { ls = linesOf(el); } catch (e) { continue; }
    found.seen++;
    if (ls.length < 2) continue;
    found.multi++;

    var tail = textOf(ls[ls.length - 1]);
    if (tail.length <= 2 && !/^[。、！？」』）]+$/.test(tail))
      found.orphan.push({ tail: tail, text: txt.slice(0, 40), tag: el.tagName });

    for (var j = 0; j + 1 < ls.length; j++) {
      var x = ls[j][ls[j].length - 1], y = ls[j + 1][0];
      var a = x.c, b = y.c;
      var bad = (KATA.test(a) && KATA.test(b)) || (ALNUM.test(a) && ALNUM.test(b))
             || (KANJI.test(a) && KANJI.test(b));
      if (!bad) continue;
      var why = (x.p !== y.p) ? '要素の境' : (y.ok ? '<wbr>あり' : '');
      found.mid.push({ at: a + '／' + b, text: txt.slice(0, 40), tag: el.tagName, why: why });
    }
  }
  return found;
}

function go() {
  if (i >= PAGES.length) {
    document.getElementById('r').textContent = 'MARK' + JSON.stringify(out) + 'KRAM';
    return;
  }
  var url = PAGES[i++], f = document.createElement('iframe');
  f.style.cssText = 'width:' + W + 'px;height:1000px;border:0;display:block';
  f.src = url;
  f.onload = function () {
    var d = f.contentDocument;
    var fin = function () {
      var res;
      try { res = scan(d); } catch (e) { res = { orphan: [], mid: [], lefts: [], err: String(e) }; }
      res.url = url;
      res.font = d.fonts ? d.fonts.check('17px "BIZ UDPGothic"') : null;
      out.push(res);
      f.remove(); go();
    };
    if (d.fonts && d.fonts.ready) { d.fonts.ready.then(fin, fin); } else { fin(); }
  };
  document.body.appendChild(f);
}
go();
</script></body></html>
'''


def render(width):
    probe = os.path.join(DIST, '_probe.html')
    io.open(probe, 'w', encoding='utf-8').write(
        PROBE.replace('__PAGES__', json.dumps(PAGES)).replace('__W__', str(width)))
    try:
        r = subprocess.run(
            [CHROME, '--headless=new', '--disable-gpu', '--no-first-run',
             '--user-data-dir=' + PROFILE,
             '--window-size=%d,1000' % max(width + 40, 560),
             '--virtual-time-budget=60000', '--dump-dom',
             # 同じURLだとChromeが前回の結果を使い回す。幅と時刻を付けて避ける
             'http://127.0.0.1:%d/_probe.html?w=%d&t=%d' % (PORT, width, time.time())],
            capture_output=True, text=True, timeout=240)
        m = re.search(r'MARK(\[.*?\])KRAM', r.stdout, re.S)
        return json.loads(m.group(1)) if m else None
    finally:
        if os.path.isfile(probe):
            os.remove(probe)


# ---------------------------------------------------------------- 報告

def main():
    widths = [int(a) for a in sys.argv[1:]] or list(WIDTHS)
    pages = read_all()

    print('■ 対象 %d ページ' % len(PAGES))
    print()

    comma, long_, leftover = check_text(pages)
    print('■ 読点が3つ以上ある文')
    for p, n, s in comma:
        print('   %-20s 読点%d  %s' % (p, n, s[:60]))
    print('   → %d件' % len(comma))
    print()
    print('■ 80字を超える文')
    for p, n, s in long_:
        print('   %-20s %d字  %s' % (p, n, s[:60]))
    print('   → %d件' % len(long_))
    print()
    print('■ 残っている [サービス名]')
    for p in leftover:
        print('   %s' % p)
    print('   → %d件' % len(leftover))
    print()
    bad = check_links(pages)
    print('■ リンク切れ')
    for p, href, why in bad:
        print('   %-20s %-22s %s' % (p, href, why))
    print('   → %d件' % len(bad))

    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)],
                           cwd=DIST, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(1.2)
        for w in widths:
            print()
            print('■ %dpx' % w)
            res = render(w)
            if res is None:
                print('   測れませんでした')
                continue
            if not all(r.get('font') for r in res):
                print('   ※ BIZ UDPGothic が読み込めていないページがあります')
            print('   測った幅 %s / 対象の要素 %d / 2行以上 %d'
                  % (sorted({r.get('vw') for r in res}),
                     sum(r.get('seen', 0) for r in res),
                     sum(r.get('multi', 0) for r in res)))
            o = m = 0
            skipped = {}
            for r in res:
                if r.get('err'):
                    print('   %-20s 測定で例外 %s' % (r['url'], r['err']))
                for x in r['mid']:
                    # 要素のつなぎ目や <wbr> のある所で切れたのは狙いどおり。
                    # 本当に語の途中で切れたものだけを出す。
                    if x.get('why'):
                        skipped[x['why']] = skipped.get(x['why'], 0) + 1
                        continue
                    print('   %-20s 語の途中 %s  %s…' % (r['url'], x['at'], x['text'])); m += 1
                for x in r['orphan']:
                    print('   %-20s 最後が「%s」だけ  %s…' % (r['url'], x['tail'], x['text'])); o += 1
            print('   → 語の途中 %d件 / 1〜2文字落ち %d件%s'
                  % (m, o, ('（ほかに ' + '、'.join('%sで%d' % kv for kv in sorted(skipped.items()))
                            + ' は正しい位置なので除外）') if skipped else ''))

            # 節ごとの左端。そろっていない節だけ出す
            ng = []
            for r in res:
                base = {}
                for x in r['lefts']:
                    base.setdefault(x['left'], 0)
                    base[x['left']] += 1
                common = max(base, key=lambda k: base[k])
                for x in r['lefts']:
                    if abs(x['left'] - common) > 2:
                        ng.append((r['url'], x['cls'] or 'section', x['left'], common))
            print('   節ごとの本文の左端がそろっていない箇所')
            for url, cls, got, want in ng:
                print('     %-20s %-22s %dpx（ほかは %dpx）' % (url, cls, got, want))
            print('     → %d件' % len(ng))
    finally:
        srv.terminate()


if __name__ == '__main__':
    main()
