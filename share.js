/**
 * share.js — 予約のあとに出す「カレンダーに入れる」「LINEで誘う」
 *
 * 予約ページ（index.html）で使う（2026-11-10 まではマイページでも使っていた）。
 *
 * ★名前のぶつかりを避ける
 *   この画面は、ふつうの <script> を何本も読み込んでいる。
 *   同じ名前（例えば esc や DOW）を2本で宣言すると、
 *   あとから読んだほうが丸ごと動かなくなる。
 *   そこで、このファイルの中身は全部カッコの中に閉じ込め、
 *   外に出すのは TorajiroShare という名前1つだけにしてある。
 */
(function () {
  var WEEK = ['日', '月', '火', '水', '木', '金', '土'];

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function jpDate(date, time) {
    var p = String(date).split('-').map(Number);
    var w = WEEK[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
    return p[1] + '月' + p[2] + '日(' + w + ')' + (time ? ' ' + time : '');
  }

  /** iPhone / iPad（新しいiPadはパソコンのふりをするので、指で触れるかも見る） */
  function isApple() {
    var ua = navigator.userAgent || '';
    return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }

  function compact(date, time) {
    return String(date).replace(/-/g, '') + 'T' + String(time || '00:00').replace(':', '') + '00';
  }

  /**
   * カレンダーに入れる先。
   *   iPhone … 予定ファイル（開くと「カレンダーに追加」がそのまま出る）
   *   それ以外 … Googleカレンダー
   */
  function calendarUrl(lesson) {
    var api = (typeof API_URL !== 'undefined') ? API_URL : '';
    if (isApple() && api && lesson.slotId) {
      return api + '/ics?slot=' + encodeURIComponent(lesson.slotId);
    }
    var end = lesson.endTime;
    if (!end) {
      var hm = String(lesson.startTime || '00:00').split(':').map(Number);
      end = String(Math.min(23, hm[0] + 2)).padStart(2, '0') + ':' + String(hm[1] || 0).padStart(2, '0');
    }
    var q = new URLSearchParams({
      action: 'TEMPLATE',
      text: 'studio 寅次郎「' + (lesson.lessonName || 'レッスン') + '」',
      dates: compact(lesson.date, lesson.startTime) + '/' + compact(lesson.date, end),
      location: lesson.address || 'studio 寅次郎',
      ctz: 'Asia/Tokyo',
    });
    return 'https://calendar.google.com/calendar/render?' + q.toString();
  }

  /** LINEでお友だちに送る文面。お名前などは入れない（送る本人が見て送る） */
  function lineUrl(lesson) {
    var nl = String.fromCharCode(10);
    // 予約ページのある場所（github.io では /yoyaku/）
    var link = location.origin + location.pathname.replace(/[^/]*$/, '') + '?date=' + encodeURIComponent(lesson.date);
    var text = 'studio 寅次郎の「' + (lesson.lessonName || 'レッスン') + '」、ご一緒しませんか？' + nl
      + jpDate(lesson.date, lesson.startTime) + '〜' + nl + nl
      + 'ご予約はこちらから' + nl + link;
    return 'https://line.me/R/share?text=' + encodeURIComponent(text);
  }

  /**
   * 予約が済んだあとの2つの問いかけを、1つの画面の中に並べる。
   * 押さなければ「入れない」「誘わない」と同じ。何度も聞かない。
   */
  function afterBookingHtml(lesson) {
    return ''
      + '<div class="after-book">'
      +   '<div class="after-book-row">'
      +     '<div class="after-book-q">この予約を、お使いのカレンダーに入れておきますか？</div>'
      // iPhoneは同じ画面のまま「カレンダーに追加」が出るので、新しいタブで開かない
      +     '<a class="after-book-btn after-book-btn--cal"' + (isApple() ? '' : ' target="_blank" rel="noopener"') + ' href="' + esc(calendarUrl(lesson)) + '">カレンダーに入れる</a>'
      +   '</div>'
      +   '<div class="after-book-row">'
      +     '<div class="after-book-q">お友だちもLINEで誘ってみませんか？</div>'
      // LINEはアプリが開く。新しいタブにすると空のタブが残るので、そのまま開く
      +     '<a class="after-book-btn after-book-btn--line" href="' + esc(lineUrl(lesson)) + '">LINEで誘う</a>'
      +   '</div>'
      + '</div>';
  }

  window.TorajiroShare = {
    calendarUrl: calendarUrl,
    lineUrl: lineUrl,
    afterBookingHtml: afterBookingHtml,
    jpDate: jpDate,
    isApple: isApple,
  };
})();
