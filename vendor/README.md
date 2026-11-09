# vendor/

build.py が使う外部ライブラリを、そのまま置いてある場所です。

いま入っているのは BudouX（Google、Apache-2.0）だけ。
日本語の文節の切れ目を判定して、`<wbr>`（折り返してよい印）を
入れるのに使っています。

ここに置いてあるので、`pip install` も仮想環境も要りません。
`python3 build.py` だけで動きます。

入れ直すとき:

    pip3 install --target vendor --upgrade budoux
    rm -rf vendor/bin
