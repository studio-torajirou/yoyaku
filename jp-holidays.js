/**
 * jp-holidays.js — 日本の祝日を計算で出す（予約ページと管理画面で同じものを使う）
 *
 * ★なぜ計算で出すのか
 *   祝日の一覧を外から取ってくると、その取り寄せ先が止まったときに表示が消える。
 *   一覧を書き込んでおくと、毎年だれかが足さなければならない。
 *   法律の決まり（2026年時点）を計算にしておけば、10年放っておいても出続ける。
 *
 * ★限界（ここだけは人の手が要る）
 *   ・法律で祝日が変わったとき（新しい祝日・日付の移動）は、この表を直す必要がある
 *   ・春分・秋分の日は天文計算の近似式。2099年まで正しい
 *
 * 同じファイルを user/ と admin/ に置いている。直すときは両方を直すこと。
 */
(function (global) {
  'use strict';

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function key(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }

  /** その月の第n月曜日 */
  function nthMonday(y, m, n) {
    var first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();   // 0=日
    var day = 1 + ((8 - first) % 7) + (n - 1) * 7;
    return day;
  }

  var cache = {};

  function holidaysOf(y) {
    if (cache[y]) return cache[y];
    var h = {};
    var add = function (m, d, name) { h[key(y, m, d)] = name; };

    add(1, 1, '元日');
    add(1, nthMonday(y, 1, 2), '成人の日');
    add(2, 11, '建国記念の日');
    add(2, 23, '天皇誕生日');
    add(3, Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)), '春分の日');
    add(4, 29, '昭和の日');
    add(5, 3, '憲法記念日');
    add(5, 4, 'みどりの日');
    add(5, 5, 'こどもの日');
    add(7, nthMonday(y, 7, 3), '海の日');
    add(8, 11, '山の日');
    add(9, nthMonday(y, 9, 3), '敬老の日');
    add(9, Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)), '秋分の日');
    add(10, nthMonday(y, 10, 2), 'スポーツの日');
    add(11, 3, '文化の日');
    add(11, 23, '勤労感謝の日');

    var dayMs = 86400000;
    var toKey = function (t) { var d = new Date(t); return key(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); };
    var base = Object.keys(h).sort();

    // 国民の休日：祝日と祝日にはさまれた平日
    base.forEach(function (k) {
      var p = k.split('-').map(Number);
      var t = Date.UTC(p[0], p[1] - 1, p[2]);
      var next = toKey(t + dayMs), next2 = toKey(t + 2 * dayMs);
      if (h[next2] && !h[next] && new Date(t + dayMs).getUTCDay() !== 0 && next.slice(0, 4) === String(y)) {
        h[next] = '国民の休日';
      }
    });

    // 振替休日：日曜の祝日の、次の祝日でない日
    Object.keys(h).sort().forEach(function (k) {
      var p = k.split('-').map(Number);
      var t = Date.UTC(p[0], p[1] - 1, p[2]);
      if (new Date(t).getUTCDay() !== 0 || h[k] === '振替休日') return;
      var n = t + dayMs;
      while (h[toKey(n)]) n += dayMs;
      if (toKey(n).slice(0, 4) === String(y)) h[toKey(n)] = '振替休日';
    });

    cache[y] = h;
    return h;
  }

  /** 'YYYY-MM-DD' を渡すと祝日名、祝日でなければ空文字 */
  function nameOf(dateStr) {
    var m = String(dateStr || '').match(/^(\d{4})-\d{2}-\d{2}$/);
    if (!m) return '';
    return holidaysOf(Number(m[1]))[dateStr] || '';
  }

  global.TorajiroHolidays = { nameOf: nameOf, of: holidaysOf };
})(typeof window !== 'undefined' ? window : globalThis);
