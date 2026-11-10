/* ==================================================================
   yhasegawa.com

   やることは5つだけ。重い処理は入れない。
     1. 狭い画面でメニューを折りたたむ
     2. 旧い1ページ構成のリンクで来た方を、新しいページへ送る
     3. フォームを、ページを離れずに送る
     4. ページを開いたら、いちばん上から見せる
     5. 本文をそっと出す（動きを減らす設定の方には何もしない）
================================================================== */
(function () {
  'use strict';

  /* ---- 1. メニューの折りたたみ ------------------------------------
     CSS 側は .js が付いているときだけ折りたたむようにしてある。
     JSが動かない環境では、メニューは開いたまま折り返して出る。 */
  var nav = document.querySelector('.site-head .nav');
  var who = document.querySelector('.site-head .who');
  if (nav && who && who.parentNode) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nav-toggle';
    btn.textContent = 'メニュー';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'mainnav');
    nav.id = 'mainnav';
    who.parentNode.insertBefore(btn, nav);

    btn.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.textContent = open ? '閉じる' : 'メニュー';
    });

    /* メニュー内のリンクを押したら閉じる */
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) {
        nav.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
        btn.textContent = 'メニュー';
      }
    });
  }

  /* ---- 2. 旧いリンクの受け止め --------------------------------------
     以前は1ページにすべて入っていたので、#contact のような
     リンクが外に出回っている可能性がある。
     【制約】# から後ろはサーバーに送られないため、Cloudflare 側では
     転送できない。ここで見て送るしかない。 */
  var OLD = {
    '#contact': '/contact/',
    '#process': '/jutaku/',
    '#faq':     '/faq/',
    '#works':   '/about/',
    '#solo':    '/jutaku/',
    '#apps':    '/works/',
    '#tapuda':  '/tapuda/',
    '#genba':   '/jutaku/'
  };
  if (location.pathname === '/' || location.pathname === '/index.html') {
    var to = OLD[location.hash];
    if (to) location.replace(to);
  }

  /* ---- 3. フォーム --------------------------------------------------
     送信先は同じドメインの /api/form。受けているのは worker/index.js。

     <form> には method と action を書いてあるので、JavaScript が動かなくても
     そのまま送れる。ここでやるのは「ページを離れずに送る」ことだけ。
     つまり、この節が丸ごと動かなくても、入力は失われない。 */
  var forms = document.querySelectorAll('form[action="/api/form"]');
  Array.prototype.forEach.call(forms, function (form) {
    var btn = form.querySelector('[type=submit]');

    form.addEventListener('submit', function (e) {
      /* fetch が無い古いブラウザは、ふつうの送信に任せる */
      if (!window.fetch || !window.FormData) return;
      e.preventDefault();

      var label = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = '送信しています…'; }
      var old = form.querySelector('.form-error');
      if (old) old.remove();

      fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { 'Accept': 'application/json' }
      }).then(function (r) {
        return r.json().catch(function () { return { ok: r.ok }; });
      }).then(function (j) {
        if (!j.ok) throw new Error(j.error || '送信できませんでした。');
        var thanks = document.getElementById(form.getAttribute('data-thanks'));
        if (thanks) {
          form.hidden = true;
          thanks.classList.add('shown');
          thanks.scrollIntoView({ block: 'center' });
        } else {
          form.submit();
        }
      }).catch(function (err) {
        /* 失敗しても入力はそのまま。やり直せることを伝える */
        if (btn) { btn.disabled = false; btn.textContent = label; }
        var p = document.createElement('p');
        p.className = 'form-error';
        p.setAttribute('role', 'alert');
        p.textContent = String(err.message || err) +
          ' 入力はそのまま残っています。もう一度お試しいただくか、' +
          'お電話（080-6206-1245）でもお受けします。';
        form.appendChild(p);
        /* Turnstile は1回しか使えないので、作り直す */
        if (window.turnstile) { try { window.turnstile.reset(); } catch (e) {} }
      });
    });
  });


  /* ---- 4. ページを開いたら、いちばん上から ---------------------------
     リンクをたどった先が、前のページで読んでいた位置あたりから
     開いてしまうことがある。ブラウザがスクロール位置を復元する
     ためで、長いページほど目立つ。

     戻るボタンのときは、元の位置に戻るのが正しい。なので
     「前に進んだとき」だけ上に戻す。進んだか戻ったかは
     Navigation Timing で見分ける（取れない古い環境では何もしない）。

     #見出し 付きのリンクで来たときも、そこへ飛ぶのが正しいので触らない。 */
  function wentForward() {
    try {
      var nav = performance.getEntriesByType('navigation')[0];
      if (nav) return nav.type === 'navigate' || nav.type === 'reload';
      return performance.navigation.type === 0;   /* 古い書き方 */
    } catch (e) { return false; }
  }
  if (!location.hash && wentForward() && window.scrollY > 0) {
    /* html に scroll-behavior:smooth が効いているので、
       ここだけ切る。切らないと、上まで動く様子が見えてしまう。 */
    var root = document.documentElement;
    var keep = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    window.scrollTo(0, 0);
    root.style.scrollBehavior = keep;
  }


  /* ---- 5. 本文の出現 ------------------------------------------------
     節ごとに、少し下から浮かび上がらせる。

     【隠すのは、まだ見えていないものだけ】
     すでに画面に入っているものまで opacity:0 にすると、
     一度見えたものが消えてから出てくる。ちらつく。
     この処理が走った時点で画面の下にあるものだけを隠す。

     【JSが動かないときに消えないこと】
     .rise を付けるのも JS。付かなければ CSS も効かないので、
     何も起きずに全部見えたままになる。 */
  var slow = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (slow || !('IntersectionObserver' in window)) return;

  var fold = window.innerHeight * 0.92;
  var targets = [];
  var boxes = document.querySelectorAll(
    '.section:not(.hero) > .wrap > *, .section:not(.hero) > .wrap.narrow > *');
  Array.prototype.forEach.call(boxes, function (el) {
    if (el.getBoundingClientRect().top > fold) {
      el.classList.add('rise');
      targets.push(el);
    }
  });
  if (!targets.length) return;

  function show(el) { el.classList.add('shown'); }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { show(e.target); io.unobserve(e.target); }
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  targets.forEach(function (el) { io.observe(el); });

  /* 【保険】
     隠したまま出てこない、という事故だけは起こしたくない。
     IntersectionObserver が働かない場面（描画が止められている、
     古い実装、拡張機能との衝突）でも出るように、
     自分でも見にいく道を2本持たせる。

       ・スクロールと画面の回転のたびに見る
       ・0.4秒ごとにも見る（スクロールの通知が来ない環境のため）

     どちらも requestAnimationFrame を使わない。
     全部出たら両方とも止める。最後の砦として、60秒たっても
     残っていたら無条件で出す。 */
  function sweep() {
    var left = 0;
    targets.forEach(function (el) {
      if (el.classList.contains('shown')) return;
      if (el.getBoundingClientRect().top < window.innerHeight * 0.92) show(el);
      else left++;
    });
    if (!left) stop();
    return left;
  }
  var last = 0;
  function onScroll() {
    var now = Date.now();
    if (now - last < 80) return;   /* 間引きは時刻で。rAF に頼らない */
    last = now;
    sweep();
  }
  var tick = window.setInterval(sweep, 400);
  function stop() {
    window.clearInterval(tick);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    window.removeEventListener('orientationchange', onScroll);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  window.addEventListener('orientationchange', onScroll, { passive: true });
  window.setTimeout(function () { targets.forEach(show); stop(); }, 60000);
})();
