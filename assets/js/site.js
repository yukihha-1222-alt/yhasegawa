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
    '#process': '/ryokin/',
    '#faq':     '/faq/',
    '#works':   '/about/',
    '#solo':    '/about/',
    '#apps':    '/works/',
    '#tapuda':  '/tapuda/',
    '#genba':   '/#gyoshu'
  };
  if (location.pathname === '/' || location.pathname === '/index.html') {
    var to = OLD[location.hash];
    if (to) location.replace(to);
  }

  /* ---- 3. 本文の出現 ------------------------------------------------ */
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
