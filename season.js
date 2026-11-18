/**
 * season.js — 季節で色合いを少し変える（2026-09-15 採用）。先に決めておくと、開いた瞬間に色が切り替わって見えない
 *   ★2026-10-26：予約ページ（と、2026-11-10 にやめたマイページ）の HTML の中にあった物を、そのまま外のファイルへ移した（CSP の script-src から 'unsafe-inline' を外すため）
 *   <head> の中で、スタイルより前に読む（読み込みを待ってから画面を描くので、色が切り替わる瞬間は見えない）
 */
(function () {
  var m = new Date(Date.now() + 9 * 3600000).getUTCMonth() + 1;   // 日本時間の月
  var s = (m >= 3 && m <= 5) ? 'spring' : (m >= 6 && m <= 8) ? 'summer' : (m >= 9 && m <= 11) ? 'autumn' : 'winter';
  // 他の季節を見比べるための切り替え（例: ?season=spring）。決まった4つ以外は受け付けない
  var q = /[?&]season=(spring|summer|autumn|winter)(&|$)/.exec(location.search);
  if (q) s = q[1];
  document.documentElement.className += ' season-' + s;
})();
