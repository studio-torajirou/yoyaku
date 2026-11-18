/**
 * site-image.js — 予約ページの、背景の写真
 *                 （先生が管理画面の「ホームページの編集」で替えたときだけ働く。2026-10-03）
 *
 * ★考え方
 *   ・このページに最初から入っている写真が「元」。通信が届かなくても、替えていなくても、元の写真が出る。
 *   ・先生が替えた写真の場所は、予約ページを開いたときにバックエンドから届く（script.js が渡してくる）。
 *     一度届いたら端末に覚えておき、次からは開いた瞬間にその写真を出す（途中で切り替わるのを見せない）。
 *   ・覚えていた写真がもう無くなっていたら、元の写真に戻す（真っ白にしない）。
 *
 * 写真の入れ物（<picture>）のすぐ下で読み込むこと。
 */
(function () {
  var KEY = 'torajiro_yoyaku_img_v1';
  // バックエンドが配る写真の住所の形（…/media/英数字）。これ以外は受け付けない
  var SHAPE = /^https:\/\/[a-z0-9.-]+\/media\/[A-Za-z0-9_-]{8,64}$/;

  var pic = document.querySelector('.hero-container picture');
  var img = pic && pic.querySelector('img');
  if (!img) { window.applyYoyakuImage = function () {}; return; }
  var source = pic.querySelector('source');
  var original = { src: img.getAttribute('src'), srcset: source ? source.getAttribute('srcset') : null };
  var current = '';   // いま出している「替えた写真」。元の写真のときは空

  function restore() {
    current = '';
    img.onerror = null;
    if (source && original.srcset) source.setAttribute('srcset', original.srcset);
    img.setAttribute('src', original.src);
  }
  function show(url) {
    current = url;
    // 元の写真（WebP）の指定を外す。外さないと、そちらが優先されて替わらない
    if (source) source.removeAttribute('srcset');
    img.onerror = function () {
      try { localStorage.removeItem(KEY); } catch (e) {}
      restore();
    };
    img.setAttribute('src', url);
  }

  /** バックエンドの答えが届いたときに呼ぶ。url が空なら元の写真に戻す */
  window.applyYoyakuImage = function (url) {
    url = (typeof url === 'string' && SHAPE.test(url)) ? url : '';
    try { if (url) localStorage.setItem(KEY, url); else localStorage.removeItem(KEY); } catch (e) {}
    if (url === current) return;
    if (!url) { restore(); return; }
    // 新しい写真を先に読み込み、読めてから、ふわっと入れ替える
    var pre = new Image();
    pre.onload = function () {
      img.style.transition = 'opacity 0.4s ease';
      img.style.opacity = '0';
      setTimeout(function () { show(url); img.style.opacity = '1'; }, 400);
    };
    pre.src = url;
  };

  try {
    var saved = localStorage.getItem(KEY);
    if (saved && SHAPE.test(saved)) show(saved);
  } catch (e) { /* 覚え書きが読めない端末では、元の写真のまま */ }
})();
