/* ==================================================================
   yhasegawa.com

   やることは3つだけ。重い処理は入れない。
     1. 狭い画面でメニューを折りたたむ
     2. 旧い1ページ構成のリンクで来た方を、新しいページへ送る
     3. 本文をそっと出す（動きを減らす設定の方には何もしない）
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


  /* ---- 4. 本文の出現 ------------------------------------------------ */
  var slow = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var targets = document.querySelectorAll('.rise');
  if (!targets.length) return;
  if (slow || !('IntersectionObserver' in window)) {
    Array.prototype.forEach.call(targets, function (el) { el.classList.add('shown'); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('shown'); io.unobserve(e.target); }
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  Array.prototype.forEach.call(targets, function (el) { io.observe(el); });
})();
