/**
 * script.js
 * ユーザー画面用メインスクリプト (UI構造維持・キャンセル待ち機能完全対応版)
 */

window.onerror = function(msg, url, line) {
  const logEl = document.getElementById("debug-log");
  if(logEl) logEl.textContent = "Sys Err: " + msg;
  return false;
};

(function(){
  const state = {
    lessons: [],
    currYear: new Date().getFullYear(),
    currMonth: new Date().getMonth(),
    selectedLesson: null,
    bookingData: {},
    isWaitlistMode: false
  };

  /**
   * esc — 人が入力した文字を、画面に「文字として」出すための下ごしらえ。
   * レッスン名や先生名は管理画面から入る文字なので、そのままHTMLとして
   * 差し込むと、記号の入った名前で表示が崩れる。必ずここを通す。
   */
  /**
   * 日本時間の「今日」。端末が海外の時間帯になっていても日本の日付で数える。
   * （旅行帰りなどで端末の時間帯がずれていると、「済」の印や今日の枠がずれるため）
   */
  function jstToday() {
    return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  }

  /**
   * 金額の出し方。「4000」ではなく「4,000円」。
   * 0円（お食事会など、当日に実費をいただく回）は何も出さない。数字でない書き方はそのまま出す。
   */
  function fmtYen(v) {
    const raw = String(v == null ? '' : v).trim();
    if (!raw) return '';
    const n = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(n)) return raw;
    return n > 0 ? n.toLocaleString('ja-JP') + '円' : '';
  }
  /** 日付の出し方。「2026-11-01」→「11月1日（日）」 */
  function fmtDateJp(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(iso || '');
    const w = '日月火水木金土'[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
    return `${+m[2]}月${+m[3]}日（${w}）`;
  }
  /** 先生の名前。「大成」→「大成先生」（もう「先生」と付いているものはそのまま） */
  function fmtTeacher(name) {
    const t = String(name || '').trim();
    if (!t) return '';
    return /先生$/.test(t) ? t : t + '先生';
  }
  /** 一覧の2行目。「大成先生・4,000円」。片方しか無ければ片方だけ */
  function lessonSubLine(l) {
    return [fmtTeacher(l.teacherName), fmtYen(l.price)].filter(Boolean).join('・');
  }

  /** そのレッスンが、もう始まっているか（始まった回には申し込めない） */
  function hasStarted(l) {
    const t = Date.parse(`${l.date}T${l.startTime}:00+09:00`);
    return Number.isFinite(t) && t <= Date.now();
  }

  function numSetting(key, def) {
    const s = window.torajiroSettings || {};
    const n = Number(s[key]);
    return Number.isFinite(n) && s[key] !== '' && s[key] != null ? n : def;
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * ★スマホの「戻る」で、窓だけを閉じる（2026-10-18）
   *   以前は、予約の窓を開いたまま「戻る」を押すと、窓が閉じずにページから出てしまい、入れた内容も消えた。
   *   窓を開くときに、ブラウザの履歴に1つだけ印を足す。「戻る」が押されたら、いちばん上の窓だけを閉じる（入れた内容は消さない）。
   *   ×や「閉じる」で閉じて、窓が1つも無くなったときは、足した印を戻す（「戻る」を2回押さないと出られない、をなくす）。
   *   対象は、日付の一覧・予約の窓・予約の取り消し・スタジオの案内・お問い合わせ。お知らせの窓（予約完了など）は対象にしない。
   */
  const Layers = (function () {
    let stack = [];        // いま開いている窓（開いた順）
    let pushed = false;    // 履歴に印を足してあるか
    let skipPop = 0;       // こちらで戻した分の popstate は、窓を閉じる合図として扱わない
    function isOpen(el) { return !!el && el.classList.contains('open'); }
    function open(el) {
      if (!el) return;
      el.classList.add('open');
      if (stack.indexOf(el) < 0) stack.push(el);
      if (!pushed) {
        try { history.pushState({ tjLayer: 1 }, ''); pushed = true; } catch (e) { /* 古い端末では、今までどおり */ }
      }
    }
    function close(el, fromBack) {
      if (!el) return;
      el.classList.remove('open');
      stack = stack.filter(x => x !== el);
      if (!stack.length && pushed && !fromBack) {
        pushed = false;
        skipPop++;
        try { history.back(); } catch (e) { skipPop--; }
      }
    }
    window.addEventListener('popstate', () => {
      if (skipPop > 0) { skipPop--; return; }
      if (!pushed) return;
      pushed = false;
      const top = stack[stack.length - 1];
      if (top) close(top, true);
      // まだ下に窓が残っていれば、次の「戻る」のために、もう一度印を足す
      if (stack.length) { try { history.pushState({ tjLayer: 1 }, ''); pushed = true; } catch (e) {} }
    });
    return { open, close, isOpen };
  })();

  /**
   * ★この端末で予約した回の控え（2026-10-18）
   *   入れるのは「予約ID・日時・レッスン名・キャンセル待ちか」だけ（お名前や連絡先は入れない）。
   *   予約IDで取り消すとき、どのレッスンかを確かめの窓に出すために使う。
   * ★2026-11-10：マイページをやめたので、この控えを予約ページの上に「あなたのご予約」として出す（下の renderMine）。
   *   前は「控えの中身を、打たずに見せることはしない」にしていた（ご家族で使う端末を心配したため）。
   *   寅次郎には、端末を家族で使う予約は無い（運用者の確認）。出すのは日時とレッスン名だけで、この端末の持ち主が予約した物。
   *   【分かっていて残す弱さ】この端末を手に取った人は、ここから取り消せる（予約完了のメールを開けば同じことができるのと同じ）。
   */
  const MY_BOOKINGS_KEY = 'torajiro_my_bookings';
  /**
   * ★控えを置いておく長さ（2026-11-10 に30日 → 200日）。
   *   30日（2026-10-18。点検の低7）のままだと、5週間先の回を予約した方の控えが、その回より前に消えてしまう（予約できるのは6か月先まで）。
   *   終わった回の物は、今までどおりその場で消す。件数は今までどおり20件まで。
   */
  const MY_BOOKINGS_KEEP_DAYS = 200;
  function keepMyBooking(b, nowMs) {
    if (!b || typeof b !== 'object' || !b.id) return false;
    // 控えた日から200日（控えた時刻の無い物は、回の日時だけで決める）
    if (Number(b.savedAt) > 0 && nowMs - Number(b.savedAt) > MY_BOOKINGS_KEEP_DAYS * 86400000) return false;
    // 終わった回（終わりの時刻が無いときは、始まりの時刻）
    const t = String(b.endTime || b.startTime || '23:59').substring(0, 5);
    const endMs = Date.parse(`${b.date}T${t}:00+09:00`);
    return Number.isFinite(endMs) ? endMs > nowMs : false;
  }
  function readMyBookings() {
    try {
      const v = JSON.parse(localStorage.getItem(MY_BOOKINGS_KEY) || '[]');
      if (!Array.isArray(v)) return [];
      const now = Date.now();
      const kept = v.filter(b => keepMyBooking(b, now));
      // 古い物が混ざっていたら、その場で消して書き戻す
      if (kept.length !== v.length) writeMyBookings(kept);
      return kept;
    } catch (e) { return []; }
  }
  /**
   * ★数を超えたら「回の日時が遠い物」から外す（2026-11-10。点検の8）。
   *   前は「先に控えた物」から20件で外していた。控えを200日置くようにしたので、半年先まで予約した方は、いちばん近い回が先に消えてしまう。
   *   いまは日時の近い順に40件まで（週1回で半年ぶんより多い）。
   */
  const MY_BOOKINGS_MAX = 40;
  // keepId … いま予約した控え。数を超えても、これだけは必ず残す（代わりに、ほかでいちばん遠い1件を外す。2回目の点検の6）
  function writeMyBookings(list, keepId) {
    try {
      const when = (b) => String((b && b.date) || '') + ' ' + String((b && b.startTime) || '');
      const sorted = list.slice().sort((a, b) => when(a).localeCompare(when(b)));
      let kept = sorted.slice(0, MY_BOOKINGS_MAX);
      if (keepId && !kept.some(b => b && b.id === keepId)) {
        const mustKeep = sorted.find(b => b && b.id === keepId);
        if (mustKeep) kept = [...kept.slice(0, MY_BOOKINGS_MAX - 1), mustKeep];
      }
      if (kept.length) localStorage.setItem(MY_BOOKINGS_KEY, JSON.stringify(kept));
      else localStorage.removeItem(MY_BOOKINGS_KEY);
    } catch (e) { /* 覚えられなくても、取り消しはできる */ }
  }
  function rememberBooking(id, l, isWaitlist) {
    if (!id || !l) return;
    // ★取り消し済みの控え（gone）で、同じ回の物は外す（同じ回に予約し直したとき、2行並ばないように。4回目の点検の5）
    const st0 = String(l.startTime || '').substring(0, 5);
    const list = readMyBookings().filter(b => b.id !== id && !(b.gone && b.date === l.date && String(b.startTime || '').substring(0, 5) === st0));
    // slotId … 回の番号。届いた一覧と見比べて、先生が日時を変えた回に気づくため（点検の3）
    list.push({ id: String(id), slotId: String(l.slotId || ''), date: l.date, startTime: l.startTime, endTime: l.endTime || '', name: l.className || l.lessonName || '',
      wait: !!isWaitlist, savedAt: Date.now(), checkedAt: Date.now() });   // 予約した直後は、状態が分かっているので、すぐには聞かない（3回目の点検の7）
    writeMyBookings(list, String(id));
    rememberHabit(l);
  }
  /** 控えの1件を書き換える（キャンセル待ちが繰り上がった・確かめた時刻） */
  function updateMyBooking(id, patch) {
    const key = normCancelId(id);
    writeMyBookings(readMyBookings().map(b => (b && normCancelId(b.id) === key) ? Object.assign({}, b, patch) : b));
  }

  /**
   * ★いつものレッスン（2026-11-10。マイページの「お勧めのレッスン」を、ログインなしにした物）
   *   この端末で予約した回の「曜日・始まりの時刻・レッスン名」だけを、10件まで覚える（予約ID・日付・お名前は入れない）。
   *   終わった回の控え（上）は消えるので、こちらは別に持つ。120日より前の物は使わない（通い方が変わった方に、古い時間を勧めないため）。
   */
  const HABIT_KEY = 'torajiro_usual';
  const HABIT_KEEP_DAYS = 120;
  function readHabits() {
    try {
      const v = JSON.parse(localStorage.getItem(HABIT_KEY) || '[]');
      if (!Array.isArray(v)) return [];
      const now = Date.now();
      return v.filter(h => h && /^\d$/.test(String(h.wd)) && /^\d{2}:\d{2}$/.test(String(h.t || ''))
        && Number(h.at) > 0 && now - Number(h.at) < HABIT_KEEP_DAYS * 86400000);
    } catch (e) { return []; }
  }
  function rememberHabit(l) {
    if (!l || !/^\d{4}-\d{2}-\d{2}$/.test(String(l.date || ''))) return;
    const t = String(l.startTime || '').substring(0, 5);
    if (!/^\d{2}:\d{2}$/.test(t)) return;
    // 曜日は、日本の暦の日付から数える（端末の時間帯に左右されない）
    const p = String(l.date).split('-').map(Number);
    const wd = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
    const list = readHabits();
    list.push({ wd, t, name: String(l.className || l.lessonName || '').slice(0, 60), at: Date.now() });
    try { localStorage.setItem(HABIT_KEY, JSON.stringify(list.slice(-10))); } catch (e) { /* 覚えられなくても、予約はできる */ }
  }
  /**
   * ★取り消した回を、いつものレッスンで勧めない（2026-11-10。点検の7）
   *   取り消すと控えが消えるので、「もう入っている回」の見分けから外れ、取り消した直後に同じ回を「予約する」で勧めていた。
   *   ・その回（日付と時刻）は、回が終わるまで勧めない（SKIP_KEY）
   *   ・同じ曜日・時刻の覚えを、新しい物から1つ減らす（打ちまちがいで1回予約して取り消しただけの方に、その時間を勧め続けないため）
   */
  const SKIP_KEY = 'torajiro_usual_skip';
  function readSkips() {
    try {
      const v = JSON.parse(localStorage.getItem(SKIP_KEY) || '[]');
      const today = jstToday();
      const kept = Array.isArray(v) ? v.filter(k => typeof k === 'string' && k.slice(0, 10) >= today) : [];
      // 過ぎた日の物は、その場で消して書き戻す（5回目の点検の6）
      if (!Array.isArray(v) || kept.length !== v.length) {
        if (kept.length) localStorage.setItem(SKIP_KEY, JSON.stringify(kept)); else localStorage.removeItem(SKIP_KEY);
      }
      return kept;
    } catch (e) { return []; }
  }
  /** その回（日付と時刻）を、回が終わるまで勧めない */
  function addSkip(b) {
    if (!b || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.date || ''))) return;
    const k = b.date + '|' + String(b.startTime || '').substring(0, 5);
    try {
      const skips = readSkips().filter(x => x !== k);
      skips.push(k);
      localStorage.setItem(SKIP_KEY, JSON.stringify(skips.slice(-20)));
    } catch (e) { /* 覚えられなくても、取り消しは済んでいる */ }
  }
  function forgetHabitOf(b) {
    if (!b || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.date || ''))) return;
    const t = String(b.startTime || '').substring(0, 5);
    addSkip(b);
    try {
      const p = String(b.date).split('-').map(Number);
      const wd = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
      const list = readHabits();
      for (let i = list.length - 1; i >= 0; i--) {
        if (Number(list[i].wd) === wd && list[i].t === t) { list.splice(i, 1); break; }
      }
      localStorage.setItem(HABIT_KEY, JSON.stringify(list));
    } catch (e) { /* 覚えを直せなくても、取り消しは済んでいる */ }
  }
  // ページを開いたときに、古い控えを片づける（読むだけで、消す物があれば消える）
  readMyBookings();
  function findMyBooking(id) {
    const key = normCancelId(id);
    return readMyBookings().find(b => b && normCancelId(b.id) === key) || null;
  }
  function forgetBooking(id) {
    const key = normCancelId(id);
    writeMyBookings(readMyBookings().filter(b => b && normCancelId(b.id) !== key));
  }
  /** 予約IDのそろえ方（全角・空白・いろいろな横棒）。裏側と同じ考え方 */
  function normCancelId(v) {
    return String(v || '').normalize('NFKC').replace(/\s+/g, '').replace(/[ー―‐−]/g, '-');
  }

  /**
   * ★打ち間違いの「〜ではありませんか？」（2026-10-18）
   *   よくある綴りの間違いだけを拾う。止めはしない（本当にその宛先の方もいるかもしれないため）。
   */
  const MAIL_FIX = {
    'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gamil.com': 'gmail.com',
    'gmaill.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.cm': 'gmail.com',
    'gmail.con': 'gmail.com', 'gmail.om': 'gmail.com', 'gmail.comm': 'gmail.com', 'gmail.cpm': 'gmail.com',
    'yahoo.co.jo': 'yahoo.co.jp', 'yahoo.co.j': 'yahoo.co.jp', 'yahoo.co.jpp': 'yahoo.co.jp', 'yahoo.cojp': 'yahoo.co.jp',
    'yahoo.co.pj': 'yahoo.co.jp', 'yaho.co.jp': 'yahoo.co.jp', 'yahooo.co.jp': 'yahoo.co.jp', 'yhoo.co.jp': 'yahoo.co.jp',
    'icloud.co': 'icloud.com', 'icloud.cm': 'icloud.com', 'icloud.con': 'icloud.com', 'icloud.om': 'icloud.com',
    'iclod.com': 'icloud.com', 'icoud.com': 'icloud.com', 'icluod.com': 'icloud.com',
    'docomo.ne.j': 'docomo.ne.jp', 'docomo.ne.jo': 'docomo.ne.jp', 'docomo.ne.jpp': 'docomo.ne.jp', 'docono.ne.jp': 'docomo.ne.jp',
    'ezweb.ne.j': 'ezweb.ne.jp', 'ezweb.ne.jo': 'ezweb.ne.jp',
    'softbank.ne.j': 'softbank.ne.jp', 'softbank.ne.jo': 'softbank.ne.jp',
    'i.softbank.co.jp': 'i.softbank.jp', 'i.softbank.ne.jp': 'i.softbank.jp',
    'hotmai.com': 'hotmail.com', 'hotmial.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hotmail.con': 'hotmail.com',
    'outlok.com': 'outlook.com', 'outlook.co': 'outlook.com', 'outlook.con': 'outlook.com',
  };
  /** 打ち間違いらしければ、直した形のアドレスを返す。違いそうでなければ '' */
  function mailSuggestion(raw) {
    const v = String(raw || '').normalize('NFKC').trim();
    const at = v.lastIndexOf('@');
    if (at < 1) return '';
    const local = v.slice(0, at);
    const dom = v.slice(at + 1).toLowerCase();
    let fixed = MAIL_FIX[dom] || '';
    if (!fixed && /\.con$/.test(dom)) fixed = dom.replace(/\.con$/, '.com');
    if (!fixed && /\.(co|ne)\.jo$/.test(dom)) fixed = dom.replace(/\.jo$/, '.jp');
    return fixed && fixed !== dom ? local + '@' + fixed : '';
  }
  /** 携帯の番号（090・080・070 で始まる）なのに 11けたでないときの知らせ。問題なければ '' */
  function phoneHint(raw) {
    const d = String(raw || '').normalize('NFKC').replace(/\D/g, '');
    if (/^0[789]0/.test(d) && d.length !== 11) {
      return `携帯電話の番号は11けたです（いま${d.length}けたです）。打ち間違いがないか、ご確認ください。`;
    }
    return '';
  }
  /** 欄の下の知らせを出す・消す。メールは「直す」のボタンつき */
  function showHint(hintId, text, fix) {
    const h = document.getElementById(hintId);
    if (!h) return;
    h.textContent = '';
    if (!text) { h.style.display = 'none'; return; }
    h.appendChild(document.createTextNode(text));
    if (fix) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'field-hint__fix';
      b.textContent = 'この形に直す';
      b.addEventListener('click', fix);
      h.appendChild(b);
    }
    h.style.display = '';
  }
  function watchMailTypo(inputId, hintId) {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    const check = () => {
      const s = mailSuggestion(inp.value);
      showHint(hintId, s ? `「${s}」ではありませんか？（このままでよければ、そのままお進みください）` : '', s ? () => {
        inp.value = s;
        showHint(hintId, '');
        inp.focus();
      } : null);
    };
    inp.addEventListener('blur', check);
    inp.addEventListener('input', () => { if (document.getElementById(hintId).style.display !== 'none') check(); });
  }
  function watchPhone(inputId, hintId) {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    const check = () => showHint(hintId, phoneHint(inp.value));
    inp.addEventListener('blur', check);
    inp.addEventListener('input', () => { if (document.getElementById(hintId).style.display !== 'none') check(); });
  }

  document.addEventListener("DOMContentLoaded", () => {
    // ★2026-10-26：入力の欄で Enter を押しても、ページが送られて開き直さないように（前は HTML の onsubmit="return false;"。
    //   CSP の script-src から 'unsafe-inline' を外すため、ここで受ける。送るのは、今までどおりボタンを押したときだけ）
    ['booking-form', 'contact-form'].forEach((id) => {
      const f = document.getElementById(id);
      if (f) f.addEventListener('submit', (e) => e.preventDefault());
    });
    const params = new URLSearchParams(window.location.search);
    const cancelId = params.get('cancel_id');
    if(cancelId) {
       const el = document.getElementById("url-cancel-id");
       if(el) el.value = cancelId;
       // ★読んだら、住所の欄から予約ID を外す（5回目の点検の3。取り消さずに住所を共有・コピーすると、予約ID ごと人に渡り、
       //   受け取った人が取り消せた。開き直すたびに取り消しの窓が出るのも止まる）
       try {
         const u = new URL(window.location.href);
         u.searchParams.delete('cancel_id');
         history.replaceState(history.state, '', u.pathname + u.search + u.hash);
       } catch (e) { /* 外せなくても、取り消しは今までどおり */ }
    }

    // 住所に ?date=YYYY-MM-DD が付いて来たとき、その日を開く
    const jumpDate = params.get('date');

    // この端末でのご予約は、つながる前から出せる（端末の控えだけで出す。状態の確かめは、一覧が届いてから）
    renderMine();

    renderCalendar();

    loadInit();

    function loadInit() {
    gas("apiGetInit").then(jsonStr => {
      const data = JSON.parse(jsonStr);
      hideLoading();
      // ★つながらないとき（1日に使える回数を使い切った日・混み合っているとき・先生が受付を止めたとき）は、
      //   この端末で最後に見た予定を「見るだけ」で出し、帯で知らせて、自動でつなぎ直す（2026-10-17）。
      if (!data.success) { enterOffline(data); return; }
      leaveOffline();
      saveLastSchedule(data);
      state.lessons = data.lessons || [];

      const logText = (data.success ? "OK" : "Err") +
                    (data.debug ? ("/" + data.debug) : "") +
                      (data.error ? ("/" + data.error) : "");
      const dbg = document.getElementById("debug-log");
      if(dbg) {
        dbg.textContent = logText;
        dbg.style.color = data.success ? "#bbb" : "red";
      }

      // ★先に月を合わせてから描く。翌月の日を指定されても正しく開くように
      if (jumpDate && /^\d{4}-\d{2}-\d{2}$/.test(jumpDate)) {
        const jp = jumpDate.split('-').map(Number);
        state.currYear = jp[0];
        state.currMonth = jp[1] - 1;
      }

      renderCalendar();

      if(data.success && data.settings){
          window.torajiroSettings = data.settings;
          updateAboutInfo(data.settings);
          // 背景の写真（先生が管理画面で替えたときだけ届く）。当スタジオのバックエンドの写真だけ受け付ける
          if (typeof window.applyYoyakuImage === 'function') {
            const yi = String(data.settings.yoyakuImage || '');
            const mediaBase = String(API_URL).replace(/\/+$/, '') + '/media/';
            window.applyYoyakuImage(yi.indexOf(mediaBase) === 0 ? yi : '');
          }
      }
      // ★2026-11-10：マイページをやめて、その良い所をここに出す（先生のお知らせ・あなたのご予約・いつものレッスン）
      renderNotices(data.notices);
      renderMine();
      renderUsual();
      refreshMineStatus();

      // ★読み込めなかったとき、以前は画面の隅に小さく「Err」と出るだけで、
      //   お客様には「今月はレッスンが無い」ように見えた（2026-09-15 の監査）。
      //   いまは、上の enterOffline が帯で知らせる。

      // Googleで調べた方に、レッスンの日程が出るようにする目印
      if (data.success) addLessonMarkup(state.lessons, data.settings || {}, data.today);

      if (jumpDate && /^\d{4}-\d{2}-\d{2}$/.test(jumpDate)) openDrawer(jumpDate);

    }).catch(e => {
      hideLoading();
      const dbg = document.getElementById("debug-log");
      if(dbg) dbg.textContent = "Net Err: " + e;
      enterOffline({ success: false, error_code: 'offline' });
    });
    }
    /** 「予定を読み込んでいます…」の印を消す */
    function hideLoading() {
      const el = document.getElementById("cal-loading");
      if (el) el.style.display = "none";
    }

    // ---------------------------------------------------------------
    // ★つながらないとき（2026-10-17）
    //   ・予定は、この端末で最後に見たものを出す（お名前などは入っていない。レッスンの予定だけ）
    //   ・予約のボタンは「いまは予約できません」にする（古い空き状況で申し込ませない）
    //   ・1分おきに、10回までつなぎ直す。画面に戻ってきたときも、つなぎ直す。つながったら、帯を消して元に戻る
    //   先生もお客様も、何もしなくてよい。
    // ---------------------------------------------------------------
    const LAST_KEY = "torajiro_last_schedule";
    const LAST_MAX_DAYS = 30;          // これより古い控えは出さない
    const RETRY_MS = 60000, RETRY_MAX = 10;
    let retryTimer = null, retryCount = 0, lastTry = 0;

    function saveLastSchedule(data) {
      try {
        const today = String(data.today || jstToday());
        const lessons = (data.lessons || []).filter(l => String(l.date) >= today).slice(0, 200);
        localStorage.setItem(LAST_KEY, JSON.stringify({ savedAt: Date.now(), lessons }));
      } catch (e) { /* 覚えられなくても、ふだんの表示には困らない */ }
    }
    function readLastSchedule() {
      try {
        const v = JSON.parse(localStorage.getItem(LAST_KEY) || "null");
        if (!v || !Array.isArray(v.lessons) || !(v.savedAt > 0)) return null;
        if (Date.now() - v.savedAt > LAST_MAX_DAYS * 86400000) return null;
        return v;
      } catch (e) { return null; }
    }
    function fmtSaved(ms) {
      const d = new Date(ms + 9 * 3600000);   // 日本時間で言う
      return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${d.getUTCHours()}時${String(d.getUTCMinutes()).padStart(2, "0")}分`;
    }

    function enterOffline(data) {
      const firstTime = !state.offline;
      state.offline = true;
      const code = String(data.error_code || "");
      const last = readLastSchedule();
      if (firstTime || !state.lessons.length) {
        state.lessons = last ? last.lessons : [];
        if (jumpDate && /^\d{4}-\d{2}-\d{2}$/.test(jumpDate)) {
          const jp = jumpDate.split('-').map(Number);
          state.currYear = jp[0]; state.currMonth = jp[1] - 1;
        }
        renderCalendar();
        if (firstTime && last && jumpDate && /^\d{4}-\d{2}-\d{2}$/.test(jumpDate)) openDrawer(jumpDate);
      }
      const head = code === "paused"
        ? "ただいま、予約の受付をお休みしています"
        : "ただいま、予約システムにつながりません";
      const lines = [];
      if (last) {
        lines.push(`下の予定は、${esc(fmtSaved(last.savedAt))}ごろに、この端末で確かめたものです。空き状況は変わっているかもしれません。`);
      }
      lines.push("いまは、この画面から予約・キャンセルができません。少し時間をおくと、自動でつながります。");
      if (code === "offline") lines.push("お店やホテルの無料Wi-Fiをお使いの場合は、Wi-Fiを切って、携帯の回線でもお試しください。");
      lines.push(esc(STUDIO_CONTACT_LINE));
      const band = document.getElementById("offline-band");
      if (band) {
        band.innerHTML = `<strong>${esc(head)}</strong>${lines.map(t => `<p>${t}</p>`).join("")}`
          + `<div class="offline-actions"><a href="https://www.instagram.com/${encodeURIComponent(STUDIO_INSTAGRAM)}/" target="_blank" rel="noopener">Instagram を開く</a>`
          + `<button type="button" id="btn-offline-retry">もう一度つなぐ</button></div>`;
        band.style.display = "";
        const rb = document.getElementById("btn-offline-retry");
        if (rb) rb.onclick = () => { rb.disabled = true; rb.textContent = "つないでいます…"; tryAgain(true); };
      }
      scheduleRetry();
    }

    function leaveOffline() {
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      if (!state.offline) return;
      state.offline = false;
      retryCount = 0;
      const band = document.getElementById("offline-band");
      if (band) { band.style.display = "none"; band.innerHTML = ""; }
      // 開いていた日の一覧は、古い予定のままなので閉じる
      const drawer = document.getElementById("detail-drawer");
      if (drawer && Layers.isOpen(drawer)) Layers.close(drawer);
    }

    function scheduleRetry() {
      if (retryTimer || retryCount >= RETRY_MAX) return;
      retryTimer = setTimeout(() => { retryTimer = null; tryAgain(false); }, RETRY_MS);
    }
    function tryAgain(byHand) {
      if (!byHand) retryCount++;
      lastTry = Date.now();
      loadInit();
    }
    // ★開いたままの画面に戻ってきたら、あなたのご予約・いつものレッスンを描き直す（4回目の点検の6。締切や回の終わりで、札とボタンが変わるため）。
    //   裏側に聞くのは、refreshMineStatus の決まり（30分・12時間に1回など）の中だけ
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible" || state.offline) return;
      renderMine(); renderUsual(); refreshMineStatus();
    });
    // 別のアプリから戻ってきたとき（1分以上たっていれば）つなぎ直す
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && state.offline && Date.now() - lastTry > RETRY_MS) tryAgain(true);
    });

    const cidVal = document.getElementById("url-cancel-id") ? document.getElementById("url-cancel-id").value : "";
    if (cidVal) {
      const inp = document.getElementById("inp-cancel-id");
      if(inp) inp.value = cidVal;
      openCancelModal();
    }

    // イベントリスナー設定
    document.getElementById("btn-prev").addEventListener("click", () => moveMonth(-1));
    document.getElementById("btn-next").addEventListener("click", () => moveMonth(1));
    document.getElementById("close-drawer").addEventListener("click", () => Layers.close(document.getElementById("detail-drawer")));

    // ★最初の1画面の「↓ 下のカレンダーから日付を選んでください」。押すと、カレンダーまで動く（住所に # は付けない）
    const goCal = document.getElementById("btn-go-cal");
    if (goCal) {
      goCal.addEventListener("click", (e) => {
        const panel = document.getElementById("cal-panel");
        if (!panel) return;
        e.preventDefault();
        panel.classList.add("is-shown");   // ふわっと出てくる前に押されても、すぐ見えるように
        try { panel.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (err) { panel.scrollIntoView(); }
        // なめらかに動かす仕組みが働かない端末・設定では、少し待ってから、ひと息に動かす
        setTimeout(() => {
          if (Math.abs(panel.getBoundingClientRect().top) > 40) panel.scrollIntoView();
        }, 900);
      });
    }

    // 打ち間違いの知らせ（止めはしない）
    watchMailTypo("inp-email", "hint-email");
    watchPhone("inp-phone", "hint-phone");
    watchMailTypo("contact-email", "hint-contact-email");

    const closeModalFunc = () => Layers.close(document.getElementById("modal-overlay"));
    document.getElementById("btn-close-detail").addEventListener("click", closeModalFunc);

    document.getElementById("btn-to-form").addEventListener("click", () => switchStep("view-form"));
    document.getElementById("btn-back-detail").addEventListener("click", () => switchStep("view-detail"));
    document.getElementById("btn-to-confirm").addEventListener("click", validateAndToConfirm);
    document.getElementById("btn-back-form").addEventListener("click", () => switchStep("view-form"));

    const chkAgree = document.getElementById("chk-agree");
    if(chkAgree) {
      // --- IAB（アプリ内ブラウザ）対策: イベントの冗長化と非同期評価 ---
      ['change', 'input', 'click', 'touchend'].forEach(eventType => {
        chkAgree.addEventListener(eventType, () => {
          setTimeout(() => {
            const btn = document.getElementById("btn-finalize");
            if(btn) btn.disabled = !chkAgree.checked;
          }, 100);
        });
      });

      // --- IAB（アプリ内ブラウザ）対策: ラベルタップ時の強制イベント発火 ---
      const chkLabel = chkAgree.closest('label');
      if(chkLabel) {
        chkLabel.addEventListener('click', (e) => {
          // input自身をクリックした場合はブラウザの標準挙動に任せる
          if(e.target.tagName.toLowerCase() === 'input') return;

          e.preventDefault(); // デフォルトの挙動をブロック
          chkAgree.checked = !chkAgree.checked; // 状態を強制反転

          // 強制的にchangeイベントを生成して発火させる
          let syntheticEvent;
          if(typeof Event === 'function') {
            syntheticEvent = new Event('change', { bubbles: true });
          } else {
            syntheticEvent = document.createEvent('Event');
            syntheticEvent.initEvent('change', true, true);
          }
          chkAgree.dispatchEvent(syntheticEvent);
        });
      }
    }

    document.getElementById("btn-finalize").addEventListener("click", finalizeBooking);
    document.getElementById("btn-open-cancel").addEventListener("click", openCancelModal);
    document.getElementById("btn-close-cancel").addEventListener("click", closeCancelModal);
    document.getElementById("btn-to-cancel-confirm").addEventListener("click", toCancelConfirm);
    document.getElementById("btn-cancel-keep").addEventListener("click", closeCancelModal);
    document.getElementById("btn-exec-cancel").addEventListener("click", execCancel);

    document.getElementById("btn-msg-ok").addEventListener("click", () => {
      const modal = document.getElementById("msg-modal");
      modal.classList.remove("open");
      if (modal.dataset.redirect) {
        if (modal.dataset.redirect !== window.location.href) {
            window.top.location.href = modal.dataset.redirect;
        } else {
            window.location.href = modal.dataset.redirect;
        }
      }
    });

    const btnAbout = document.getElementById("btn-open-about");
    if(btnAbout) {
      btnAbout.addEventListener("click", () => {
        Layers.open(document.getElementById("aboutModal"));
      });
    }
    const btnCloseAboutX = document.getElementById("btn-close-about-x");
    if(btnCloseAboutX) {
      btnCloseAboutX.addEventListener("click", () => {
        Layers.close(document.getElementById("aboutModal"));
      });
    }
    const btnCloseAboutFt = document.getElementById("btn-close-about-ft");
    if(btnCloseAboutFt) {
      btnCloseAboutFt.addEventListener("click", () => {
        Layers.close(document.getElementById("aboutModal"));
      });
    }

    setupCalendarZoom();
    setupExtensions();
  });

  /**
   * スマホのカレンダーを大きくする。
   *
   * ★スマホでは7日分を1画面に収めるため、カレンダーの中の文字が8.5pxしかない。
   *   年配の方には読めないので、押すと文字を大きくし、横に動かして見られるようにする。
   *   ふだんの見た目（1画面で1か月が見渡せる）は変えない。選んだ大きさは、その端末で覚えておく。
   */
  function setupCalendarZoom() {
    const btn = document.getElementById("btn-cal-zoom");
    const panel = document.querySelector(".glass-panel");
    if (!btn || !panel) return;
    const KEY = "torajiro_cal_zoom";

    const apply = (on, scroll) => {
      panel.classList.toggle("cal-zoom", on);
      btn.textContent = on ? "元の大きさに戻す" : "🔍 カレンダーを大きくする";
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) {}
      // 大きくしたら、今日の列が見えるところまで横に動かす
      if (on && scroll) {
        const wrap = panel.querySelector(".calendar-wrapper");
        const today = panel.querySelector(".cell.today");
        if (wrap && today) wrap.scrollLeft = Math.max(0, today.offsetLeft - 40);
      }
    };

    let saved = false;
    try { saved = localStorage.getItem(KEY) === "1"; } catch (e) {}
    apply(saved, false);
    btn.addEventListener("click", () => apply(!panel.classList.contains("cal-zoom"), true));
  }

  function isLightColor(hex) {
    if (!hex) return false;
    if (hex.startsWith('#')) hex = hex.slice(1);
    if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return yiq >= 160;
  }

  /**
   * Google向けの目印（レッスン日程）をページに書き込む。
   *
   * ★いまはGoogleに出ない
   *   このお試しサイトは robots.txt で「検索に出さない」にしてある。
   *   本番（GitHub版）と検索の評価を奪い合わないためで、移設のときに外す。
   *   目印そのものは今から入れておき、外した瞬間から効くようにしてある。
   *
   * ★出すのは、これからの公開レッスンだけ（先生の私用の予定は元々届かない）
   */
  function addLessonMarkup(lessons, settings, serverToday) {
    try {
      // ★「今日」はサーバーの日本時間の日付を使う。
      //   ブラウザの時計だと、世界標準時で読みに来るGoogleには、
      //   日本時間の0〜9時に「前日の回」まで「これから」に見えてしまう。
      const today = /^\d{4}-\d{2}-\d{2}$/.test(String(serverToday || '')) ? serverToday : formatDate(new Date());
      const tp = today.split('-').map(Number);
      const lim = new Date(Date.UTC(tp[0], tp[1] - 1, tp[2] + 60));
      const limit = lim.toISOString().slice(0, 10);
      const studio = String(settings.studioName || 'studio 寅次郎').replace(/　/g, ' ');
      const place = {
        '@type': 'Place',
        name: studio,
        address: { '@type': 'PostalAddress', streetAddress: settings.address || '', addressCountry: 'JP' },
      };
      // 予約ページのある場所（github.io では /yoyaku/）。トップ（/）ではなくここを指す
      const pageBase = location.origin + location.pathname.replace(/[^/]*$/, '');
      const events = lessons
        .filter(l => l.date >= today && l.date <= limit)
        .slice(0, 50)
        .map(l => {
          const full = l.capacity > 0 && l.reserved >= l.capacity;
          const ev = {
            '@type': 'Event',
            name: `${l.className}（${studio}）`,
            startDate: `${l.date}T${l.startTime}+09:00`,
            eventStatus: 'https://schema.org/EventScheduled',
            eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
            location: place,
            organizer: { '@type': 'Organization', name: studio, url: pageBase },
            offers: {
              '@type': 'Offer',
              price: Number(l.price || 0),
              priceCurrency: 'JPY',
              availability: full ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
              url: `${pageBase}?date=${l.date}`,
            },
          };
          if (l.endTime) ev.endDate = `${l.date}T${l.endTime}+09:00`;
          if (l.teacherName) ev.performer = { '@type': 'Person', name: l.teacherName };
          if (l.description) ev.description = String(l.description).slice(0, 300);
          return ev;
        });
      let tag = document.getElementById('lesson-jsonld');
      if (!tag) {
        tag = document.createElement('script');
        tag.type = 'application/ld+json';
        tag.id = 'lesson-jsonld';
        document.head.appendChild(tag);
      }
      tag.textContent = JSON.stringify({ '@context': 'https://schema.org', '@graph': events });
    } catch (e) {
      // 目印が作れなくても、予約の画面はそのまま使える
    }
  }

  function renderCalendar() {
    const grid = document.getElementById("cal-grid");
    if(!grid) return;

    grid.innerHTML = "";
    const y = state.currYear;
    const m = state.currMonth;
    // ★「Oct 2026」ではなく「2026年10月」（2026-10-18）
    document.getElementById("month-label").textContent = `${y}年${m + 1}月`;

    const first = new Date(y, m, 1);
    const start = new Date(first);
    start.setDate(1 - start.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 41);

    let d = new Date(start);
    const todayStr = jstToday();

    while(d <= end) {
      const dateStr = formatDate(d);
      const isCurrMonth = d.getMonth() === m;
      const dayLessons = getLessons(dateStr);
      const cell = document.createElement("div");
      cell.className = `cell ${isCurrMonth?'':'dim'} ${dateStr===todayStr?'today':''}`;
      cell.dataset.date = dateStr;

      cell.onclick = () => openDrawer(dateStr);
      // ★読み上げ・キーボードでも押せる部品にする（2026-10-18）。ほかの月の日は、押せない（いまと同じ）
      if (isCurrMonth) {
        cell.setAttribute("role", "button");
        cell.tabIndex = 0;
        cell.setAttribute("aria-label", fmtDateJp(dateStr) + (dayLessons.length ? `　レッスン${dayLessons.length}件` : "　レッスンなし"));
        cell.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); openDrawer(dateStr); }
        });
      } else {
        cell.setAttribute("aria-hidden", "true");
      }
      const num = document.createElement("div");
      num.className = "day-num";
      num.textContent = d.getDate();
      cell.appendChild(num);

      // ★祝日は日付を赤くし、名前を小さく出す（スマホのふだんの表示では赤くするだけ）
      const holiday = window.TorajiroHolidays ? window.TorajiroHolidays.nameOf(dateStr) : "";
      if (holiday) {
        cell.classList.add("holiday");
        cell.title = holiday;
        const hol = document.createElement("div");
        hol.className = "day-hol";
        hol.textContent = holiday;
        cell.appendChild(hol);
      }

      if(dayLessons.length > 0) {
        dayLessons.forEach(l => {
          const evt = document.createElement("div");
          evt.className = "cal-event";

          const bg = (l.color && l.color !== '') ? l.color : '#e0e0e0';
          evt.style.backgroundColor = bg;

          if(isLightColor(bg)) {
            evt.style.color = '#4a403a';
            evt.style.textShadow = 'none';
            evt.style.border = '1px solid rgba(0,0,0,0.1)';
          } else {
            evt.style.color = '#fff';
          }

          const isFull = (l.capacity > 0 && l.reserved >= l.capacity);

          if(isFull) {
            evt.classList.add('full');
          }

          // ★残り1席のときだけ「残り1席」を出す（残りわずかの特別感で、埋まりやすくするため）
          //   2席以上では出さない。いつも出ていると特別に見えなくなる。
          //   ★終わった回・始まった回には出さない（押しても申し込めないため）
          const isLastSeat = (!state.offline && l.capacity > 0 && l.capacity - l.reserved === 1 && !hasStarted(l));
          if (isLastSeat) evt.classList.add('last-seat');

          // ★重要: CSSで各要素を個別に小さく制御できるようにdivで構造化
          const timeDisplay = isFull ? `(満)${l.startTime}` : l.startTime;

          evt.innerHTML = `
            ${isLastSeat ? '<div class="ce-last">残り1席</div>' : ''}
            <div class="ce-time">${esc(timeDisplay)}</div>
            <div class="ce-title" style="font-weight:bold;">${esc(l.className)}</div>
            <div class="ce-teacher">${esc(l.teacherName)}</div>
          `;

          cell.appendChild(evt);
       });
    }
      grid.appendChild(cell);
      d.setDate(d.getDate() + 1);
    }
  }

  /**
   * その回が「予約できるか・キャンセル待ちならできるか」（日の一覧と、いつものレッスンで同じ決め方を使う）
   */
  function availabilityOf(l) {
    const waitCount = l.waitlist || 0;
    const cap = Number(l.capacity);
    const res = Number(l.reserved);
    const isFull = (cap > 0 && res >= cap);
    // ★待ちの上限は、管理画面の設定と同じ数を使う（以前は画面側に5と書いてあった）
    const started = hasStarted(l);
    // ★キャンセル待ちの繰り上げを締め切ったあと（開始の○時間前を過ぎたあと）は、キャンセル待ちを出さない（2026-10-06）。
    //   その時間からは、席が空いても自動では繰り上がらない。裏側も、同じ決まりで断る。
    const hoursLeft = (Date.parse(`${l.date}T${l.startTime}:00+09:00`) - Date.now()) / 3600000;
    const waitOpen = !Number.isFinite(hoursLeft) || hoursLeft >= numSetting('promotionCutoffHours', 24);
    const isWaitlistAvail = !started && isFull && waitOpen && (waitCount < numSetting('waitlistLimit', 5));
    return { cap, res, isFull, started, isWaitlistAvail, bookable: !started && (!isFull || isWaitlistAvail) };
  }

  /**
   * ★先生からのお知らせ（2026-11-10。前はマイページにだけ出ていた）
   *   裏側（apiGetUserInit）が、書いた日から7日のあいだの物を、新しい順に3件まで渡す。中身は文字としてだけ出す（textContent）
   */
  function renderNotices(list) {
    const box = document.getElementById("studio-notices");
    if (!box) return;
    const items = Array.isArray(list) ? list.filter(n => n && String(n.body || '').trim()) : [];
    box.textContent = "";
    if (!items.length) { box.style.display = "none"; return; }
    const h = document.createElement("div");
    h.className = "tj-notices__h";
    h.textContent = "スタジオからのお知らせ";
    box.appendChild(h);
    items.forEach(n => {
      const row = document.createElement("div");
      row.className = "tj-notice";
      const d = document.createElement("div");
      d.className = "tj-notice__d";
      d.textContent = fmtDateJp(n.date) || '';
      const b = document.createElement("div");
      b.className = "tj-notice__b";
      b.textContent = String(n.body);
      row.appendChild(d); row.appendChild(b);
      box.appendChild(row);
    });
    box.style.display = "";
  }

  /**
   * ★あなたのご予約（2026-11-10。マイページの「お済みのご予約」と「キャンセル待ちの結果」を、ログインなしにした物）
   *   この端末の控え（上の MY_BOOKINGS_KEY）だけで出す。ほかの端末で予約した回は出ない（下に一言添える）。
   *   取り消しは、いつもの「予約の確認・キャンセル」の窓を、予約ID を入れた状態で開く（中身の確かめ・締切の決まりは、そのまま）。
   *   控えの状態（キャンセル待ちか・繰り上がったか・日時）は、下の refreshMineStatus が裏側に聞いて直す。
   */
  /** 繰り上げを締め切った時刻（開始の○時間前。ミリ秒） */
  function waitCutoffMs(b) {
    const startMs = Date.parse(`${b.date}T${String(b.startTime || '00:00').substring(0, 5)}:00+09:00`);
    return Number.isFinite(startMs) ? startMs - numSetting('promotionCutoffHours', 24) * 3600000 : NaN;
  }
  function renderMine() {
    const box = document.getElementById("my-bookings");
    const listEl = document.getElementById("my-bookings-list");
    if (!box || !listEl) return;
    // 取り消し済み（gone）の控えは、生きている予約のあとに並べる（近い3件の枠を取らない。5回目の点検の1）
    const list = readMyBookings().slice().sort((a, b) => ((a.gone ? 1 : 0) - (b.gone ? 1 : 0)) || (a.date + a.startTime).localeCompare(b.date + b.startTime));
    listEl.textContent = "";
    if (!list.length) { box.style.display = "none"; return; }
    // ★近い回から3件だけ出し、残りは「ほかに○件」で開く（4回目の点検の2。毎週予約する方は、カレンダーが何画面も下に行っていた）
    //   取り消し済み（gone）の札は、3件の枠に数えず、いつも出す（知らせが「ほかに○件」の奥に隠れないように。6回目の点検の1）
    const alive = list.filter(b => !b.gone);
    const aliveShown = mineShowAll ? alive : alive.slice(0, MINE_SHOW_MAX);
    const shown = aliveShown.concat(list.filter(b => b.gone));
    shown.forEach(b => {
      const row = document.createElement("div");
      row.className = "tj-mine__row";
      const info = document.createElement("div");
      info.className = "tj-mine__info";
      const when = document.createElement("div");
      when.className = "tj-mine__when";
      when.textContent = `${fmtDateJp(b.date)} ${b.startTime}${b.endTime ? '〜' + b.endTime : ''}`;
      const name = document.createElement("div");
      name.className = "tj-mine__name";
      name.textContent = b.name || '';
      info.appendChild(when); info.appendChild(name);
      // 状態の札：繰り上がって確定／空きが出なかった／キャンセル待ち
      // ★「空きが出ませんでした」は、締切のあとに裏側へ聞いて、まだ待ちだと分かった物（waitFinal）だけに出す（点検の1）。
      //   手元の控えだけで決めると、締切の少し前に繰り上がった方にも「空きが出ませんでした」と出てしまうため
      const cutoffMs = waitCutoffMs(b);
      const pastCutoff = Number.isFinite(cutoffMs) && Date.now() >= cutoffMs;
      let tag = '', tagClass = '';
      // ★取り消し済み（先生が取り消した・ほかの端末やメールのリンクで取り消した）は、黙って消さずに、回が終わるまで札で知らせる（4回目の点検の5）
      if (b.gone) { tag = 'このご予約は取り消されています'; tagClass = 'is-closed'; }
      else if (b.promoted) { tag = 'キャンセル待ちから繰り上がり、ご予約が確定しました'; tagClass = 'is-ok'; }
      else if (b.wait && b.waitFinal) { tag = '空きが出ませんでした（この回のキャンセル待ちは締め切りました）'; tagClass = 'is-closed'; }
      else if (b.wait && pastCutoff) { tag = 'キャンセル待ち（繰り上がりの受付は締め切りました。結果はメールでもお知らせしています）'; tagClass = 'is-wait'; }
      else if (b.wait) { tag = 'キャンセル待ち（空きが出たら、自動でご予約が確定します）'; tagClass = 'is-wait'; }
      if (tag) {
        const t = document.createElement("div");
        t.className = "tj-mine__tag " + tagClass;
        t.textContent = tag;
        info.appendChild(t);
      }
      // ★取り消しの締切を過ぎた回は、ボタンを出さずに一言（4回目の点検の4。押しても「画面からは取り消せません」と出るだけだった）。
      //   締切は、届いた一覧の cancelDeadlineAt（日本時間）を使い、無ければ設定の「開始の○時間前」で数える。キャンセル待ちは、始まるまで取り消せる
      const closed = !b.gone && !(b.wait && b.waitFinal) && mineCancelClosed(b);
      if (closed) {
        const t = document.createElement("div");
        t.className = "tj-mine__late";
        t.textContent = '取り消しの締切を過ぎています。取り消すときは、スタジオへご連絡ください。';
        info.appendChild(t);
      }
      row.appendChild(info);
      // 空きが出なかったと分かった回・取り消し済みの回・締切を過ぎた回は、ボタンを出さない（控えは、回が終われば消える）
      if (!(b.wait && b.waitFinal) && !b.gone && !closed) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tj-mine__btn";
        btn.textContent = b.wait ? "待ちを取り消す" : "取り消す";
        btn.addEventListener("click", () => openCancelFor(b.id));
        row.appendChild(btn);
      }
      listEl.appendChild(row);
    });
    if (alive.length > aliveShown.length) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "tj-mine__more";
      more.textContent = `ほかに ${alive.length - aliveShown.length}件のご予約を見る`;
      more.addEventListener("click", () => { mineShowAll = true; renderMine(); });
      listEl.appendChild(more);
    }
    box.style.display = "";
  }
  const MINE_SHOW_MAX = 3;
  let mineShowAll = false;
  /** 控えの回の、取り消しの締切を過ぎたか（キャンセル待ちは、始まったら） */
  function mineCancelClosed(b) {
    // 設定が届く前・つながらないとき（5回目の点検の5）：既定の12時間で決めつけない。ボタンを出し、押したときの確かめで裏側が決める
    if (!window.torajiroSettings || state.offline) return false;
    const startMs = Date.parse(`${b.date}T${String(b.startTime || '00:00').substring(0, 5)}:00+09:00`);
    if (!Number.isFinite(startMs)) return false;
    if (b.wait && !b.promoted) return Date.now() >= startMs;
    const l = (Array.isArray(state.lessons) && b.slotId) ? state.lessons.find(x => String(x.slotId) === String(b.slotId)) : null;
    const at = l && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(l.cancelDeadlineAt || ''))
      ? Date.parse(String(l.cancelDeadlineAt).replace(' ', 'T') + ':00+09:00') : NaN;
    if (Number.isFinite(at)) return Date.now() > at;
    return (startMs - Date.now()) / 3600000 < numSetting('cancelDeadlineHours', 12);
  }

  /**
   * 控えの予約ID を入れた状態で、取り消しの窓を開き、そのまま中身の確かめ（2段目）へ進む。
   * ★確かめに行く前に、人間かの確かめの札を最大4秒待つ（4回目の点検の7・6回目の点検の2）。
   *   すぐ確かめに行くと札が間に合わず、裏側に「人間と確かめられない回線」として数えられていた。
   *   ページを開いただけで外の確かめを読み込むことはしない（札をもらうのは、「取り消す」を押したときだけ。プライバシーポリシー8章のとおり）。
   *   待っているあいだに窓を閉じた・別の予約ID に変えたときは、進まない
   */
  async function openCancelFor(id) {
    const inp = document.getElementById("inp-cancel-id");
    if (!inp) return;
    const want = String(id || '');
    inp.value = want;
    syncCancelPhone4();
    openCancelModal();
    // 待っているあいだは、止まって見えないように「確かめています…」と出す（押せるまま。自分で「次へ」を押しても進める）
    const next = document.getElementById("btn-to-cancel-confirm");
    const label = next ? next.textContent : '';
    if (next && !next.disabled) next.textContent = "確かめています…";
    try { if (typeof tjHuman !== 'undefined' && tjHuman.ready) await tjHuman.ready(4000); } catch (e) { /* 札が無くても、確かめには進む */ }
    if (next && !next.disabled && next.textContent === "確かめています…") next.textContent = label;
    const modal = document.getElementById("cancel-modal");
    if (!modal || !Layers.isOpen(modal) || inp.value !== want) return;
    toCancelConfirm();
  }

  /**
   * ★控えを、今の本当の状態に合わせる（2026-11-10。点検の1〜4、2回目の点検の1・3〜9）
   *   1. 届いた一覧（state.lessons）と見比べる（通信しない）：先生が回の日時を変えていたら、控えの日時を直す。
   *   2. 次の控えだけ、裏側に聞く（apiCheckMyBooking。回線ごとに1時間6回まで。1回に開いたとき3件まで）：
   *      ・キャンセル待ち：締切の前は30分に1回。締切のあとは、まず1回（答えが「まだ待ち」なら waitFinal）。そのあとも、控えが消える（回が終わる）まで3時間に1回
   *        （締切のあとでも、ご本人が申し込めば待ちが予約に変わる作りなので。publicUser.js の claimSeatFromWaitlist）
   *      ・前の版で控えた物（キャンセル待ちの印が無い）：まず1回。そのあとは、ふつうの予約と同じ
   *      ・一覧に回が見つからない物（先生が消した・非公開にした）・ふつうの予約：12時間に1回
   *   3件のうち1件は、キャンセル待ち以外の分にとっておく（待ちが3件あっても、ほかの控えの番が来るように）。
   *   答えが「無い・取り消し済み」なら、控えを消す（その回は、いつものレッスンでも勧めない）。
   *   ★うまくいかなかったとき（回数の上限・つながらない・受付を止めている）は、確かめた時刻（checkedAt）ではなく、
   *     うまくいかなかった時刻（failedAt）を書き、30分だけ間を空ける（2回目の点検の1・3：checkedAt を書くと、締切のあとの1回や、
   *     前の版の控えの1回が、二度と来なくなっていた）。裏側がまだ古い（unknown_action）ときは、何も書かずにやめる（点検の4）。
   *   ★聞いているあいだに、ご本人が取り消した・同じ予約ID で予約し直した控えは、返事で上書きしない（点検の9）。
   */
  const MINE_CHECK_WAIT_MIN = 30;
  const MINE_CHECK_AFTER_CUTOFF_HOURS = 3;
  const MINE_CHECK_PLAIN_HOURS = 12;
  const MINE_RETRY_MIN = 30;
  // ★うまくいかなかったら、この端末からの確かめを、まとめて30分休む（3回目の点検の3・4。控え1件ごとの failedAt だけだと、
  //   控えが何件もある方は、開くたびに次の控えを聞いていた）
  const MINE_BACKOFF_KEY = 'torajiro_mine_backoff';
  function mineBackoff() { try { localStorage.setItem(MINE_BACKOFF_KEY, String(Date.now() + MINE_RETRY_MIN * 60000)); } catch (e) {} }
  function inMineBackoff() { try { return Number(localStorage.getItem(MINE_BACKOFF_KEY) || 0) > Date.now(); } catch (e) { return false; } }
  let mineChecking = false;
  function syncMineWithLessons() {
    if (!Array.isArray(state.lessons) || !state.lessons.length) return { changed: false, missing: new Set() };
    const bySlot = new Map(state.lessons.map(l => [String(l.slotId), l]));
    const missing = new Set();
    let changed = false;
    readMyBookings().forEach(b => {
      if (!b.slotId) return;
      const l = bySlot.get(String(b.slotId));
      if (!l) { missing.add(b.id); return; }
      const st = String(l.startTime || '').substring(0, 5), en = String(l.endTime || '').substring(0, 5);
      if (l.date !== b.date || st !== String(b.startTime || '').substring(0, 5) || en !== String(b.endTime || '').substring(0, 5)) {
        updateMyBooking(b.id, { date: l.date, startTime: st, endTime: en, name: l.className || b.name });
        changed = true;
      }
    });
    return { changed, missing };
  }
  async function refreshMineStatus() {
    if (mineChecking || state.offline) return;
    const sync = syncMineWithLessons();
    // 日時を直したら、いつものレッスンも描き直す（直した回を「予約する」で勧めないように。2回目の点検の7）
    if (sync.changed) { renderMine(); renderUsual(); }
    if (inMineBackoff()) return;
    const now = Date.now();
    const H = 3600000;
    // 何番目に聞くか（0 は聞かない。1 がキャンセル待ち、2・3 がそれ以外）
    const need = (b) => {
      if (b.gone) return 0;   // 取り消し済みと分かった控えは、もう聞かない（回が終われば消える）
      if (Number(b.failedAt) > 0 && now - Number(b.failedAt) < MINE_RETRY_MIN * 60000) return 0;
      const checked = Number(b.checkedAt) || 0;
      if (b.wait && !b.promoted) {
        const cutoffMs = waitCutoffMs(b);
        const pastCutoff = Number.isFinite(cutoffMs) && now >= cutoffMs;
        if (!pastCutoff) return now - checked >= MINE_CHECK_WAIT_MIN * 60000 ? 1 : 0;
        if (checked < cutoffMs) return 1;                                                        // 締切のあとの1回目
        return now - checked >= MINE_CHECK_AFTER_CUTOFF_HOURS * H ? 3 : 0;                      // そのあとは、ときどき
      }
      if (!('wait' in b) && !checked) return 2;                                                  // 前の版の控え（まず1回）
      if (sync.missing.has(b.id)) return now - checked >= MINE_CHECK_PLAIN_HOURS * H ? 2 : 0;
      return now - checked >= MINE_CHECK_PLAIN_HOURS * H ? 3 : 0;                               // ふつうの予約
    };
    const ranked = readMyBookings().map(b => ({ b, p: need(b) })).filter(x => x.p > 0).sort((x, y) => x.p - y.p);
    const waits = ranked.filter(x => x.p === 1), others = ranked.filter(x => x.p !== 1);
    const picked = [];
    for (const x of waits) { if (picked.length >= (others.length ? 2 : 3)) break; picked.push(x); }
    for (const x of others) { if (picked.length >= 3) break; picked.push(x); }
    const targets = picked.map(x => x.b);
    if (!targets.length) return;
    mineChecking = true;
    let changed = false;
    try {
      for (const b of targets) {
        const askedAt = Date.now();
        let res = null;
        try { res = JSON.parse(await gas("apiCheckMyBooking", { id: b.id })); } catch (e) { res = null; }
        // 聞いているあいだに、取り消した・予約し直した控えは、上書きしない
        const cur = findMyBooking(b.id);
        // （「控えた時刻が、聞き始めより後か」で見ていたが、時計が進んでいた端末の控えは、ずっと上書きされずに毎回聞き直していた。4回目の点検の9）
        if (!cur || Number(cur.savedAt || 0) !== Number(b.savedAt || 0)) continue;
        if (res && res.success && res.gone) {
          // 取り消し済み（先生が取り消した・ほかの端末やメールのリンクで取り消した）・見つからない控えは、もう出さない。
          // その回は、いつものレッスンでも勧めない（2回目の点検の8）
          updateMyBooking(b.id, { gone: true, checkedAt: Date.now(), failedAt: 0 }); addSkip(cur); changed = true;
        } else if (res && res.success && res.reservation) {
          const r = res.reservation;
          const isWait = !!r.isWaitlist;
          const patch = { checkedAt: Date.now(), failedAt: 0, wait: isWait,
            date: r.date || cur.date, startTime: r.startTime || cur.startTime, endTime: r.endTime || cur.endTime || '', name: r.lessonName || cur.name,
            slotId: r.slotId || cur.slotId || '' };
          if (cur.wait && !isWait) patch.promoted = true;
          if (isWait) {
            const cutoffMs = waitCutoffMs(patch);
            patch.waitFinal = Number.isFinite(cutoffMs) && Date.now() >= cutoffMs;
          } else {
            patch.waitFinal = false;
          }
          updateMyBooking(b.id, patch); changed = true;
        } else if (res && res.error_code === 'unknown_action') {
          // 裏側がまだ古い（窓口が無い）：控えには何も書かず、この端末の確かめを30分休む（裏側が新しくなったら、そのあと聞く）
          mineBackoff();
          break;
        } else if (res && res.error_code === 'bad_request') {
          // 形の違う予約ID の控え（いまの画面は作らないが、手で書き換えられた場合など）：聞いても答えは変わらないので、控えを消す
          forgetBooking(b.id); changed = true;
        } else {
          // 回数の上限・つながらない・受付を止めている：この控えに failedAt を書き、端末ぜんたいでも30分休む（確かめた時刻は書かない）
          updateMyBooking(b.id, { failedAt: Date.now() });
          mineBackoff();
          break;
        }
      }
    } finally { mineChecking = false; }
    if (changed) { renderMine(); renderUsual(); }
  }

  /**
   * ★いつものレッスン（2026-11-10）
   *   この端末で予約した回の「曜日・始まりの時刻」を数え、よく来ている順に、次に予約できる回を2つまで出す。
   *   押すと、いつもの予約の窓（中身の確かめ → 入力 → 確認）が開く。お名前・電話・メールは、この端末が覚えていれば最初から入っている。
   *   はじめての方・この端末で予約したことの無い方には、何も出ない。
   */
  function renderUsual() {
    const box = document.getElementById("usual-lessons");
    const listEl = document.getElementById("usual-lessons-list");
    if (!box || !listEl) return;
    listEl.textContent = "";
    box.style.display = "none";
    if (state.offline) return;
    const habits = readHabits();
    if (!habits.length) return;
    // 曜日×時刻ごとに数える（同じ数なら、最近の物を先に）
    const tally = {};
    habits.forEach(h => {
      const k = h.wd + '|' + h.t;
      if (!tally[k]) tally[k] = { wd: Number(h.wd), t: h.t, n: 0, at: 0 };
      tally[k].n += 1;
      tally[k].at = Math.max(tally[k].at, Number(h.at));
    });
    const ranked = Object.values(tally).sort((a, b) => (b.n - a.n) || (b.at - a.at));
    // 自分がもう入っている回と、取り消したばかりの回（上の SKIP_KEY）は勧めない
    const mine = new Set(readMyBookings().map(b => b.date + '|' + String(b.startTime || '').substring(0, 5)));
    readSkips().forEach(k => mine.add(k));
    const today = jstToday();
    const picks = [];
    for (const r of ranked) {
      if (picks.length >= 2) break;
      const next = state.lessons
        .filter(l => l.date >= today && String(l.startTime || '').substring(0, 5) === r.t)
        .filter(l => { const p = String(l.date).split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() === r.wd; })
        .filter(l => !mine.has(l.date + '|' + String(l.startTime || '').substring(0, 5)))
        .filter(l => availabilityOf(l).bookable)
        .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))[0];
      if (next && !picks.some(p => p.slotId === next.slotId)) picks.push(next);
    }
    if (!picks.length) return;
    // 出す順は、日付の早い順（選ぶのは「よく来ている順」、見せるのはカレンダーと同じ順）
    picks.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
    picks.forEach(l => {
      const a = availabilityOf(l);
      const row = document.createElement("div");
      row.className = "tj-mine__row";
      const info = document.createElement("div");
      info.className = "tj-mine__info";
      const when = document.createElement("div");
      when.className = "tj-mine__when";
      when.textContent = `${fmtDateJp(l.date)} ${l.startTime}${l.endTime ? '〜' + l.endTime : ''}`;
      const name = document.createElement("div");
      name.className = "tj-mine__name";
      name.textContent = l.className || '';
      info.appendChild(when); info.appendChild(name);
      if (!a.isFull && a.cap - a.res === 1) {
        const last = document.createElement("span");
        last.className = "li-last";
        last.textContent = "残り1席";
        name.appendChild(last);
      }
      row.appendChild(info);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tj-mine__btn is-gold";
      btn.textContent = a.isWaitlistAvail ? "キャンセル待ち" : "予約する";
      btn.addEventListener("click", () => openDetailModal(l, a.isWaitlistAvail));
      row.appendChild(btn);
      listEl.appendChild(row);
    });
    box.style.display = "";
  }

  function openDrawer(dateStr) {
    const drawer = document.getElementById("detail-drawer");
    const list = document.getElementById("detail-list");
    // ★new Date("2026-09-15") は世界標準時の0時として読まれ、端末の時間帯によって前日になる。
    //   文字のまま分けて使う。
    const dp = String(dateStr).split('-').map(Number);
    const holName = window.TorajiroHolidays ? window.TorajiroHolidays.nameOf(dateStr) : "";
    const dateEl = document.getElementById("selected-date-display");
    // 「10/21」ではなく「10月21日（水）」（曜日まで出す）
    dateEl.textContent = fmtDateJp(dateStr) || `${dp[1]}/${dp[2]}`;
    if (holName) {
      const small = document.createElement("span");
      small.className = "drawer-hol";
      small.textContent = holName;
      dateEl.appendChild(small);
    }

    const lessons = getLessons(dateStr);
    list.innerHTML = "";
    if(lessons.length === 0) {
      list.innerHTML = `<div style="text-align:center;padding:40px 10px;color:#666;">この日はレッスンがありません</div>`;
    } else {
      lessons.forEach(l => {
        const item = document.createElement("div");
        item.className = "lesson-item";
        const barColor = (l.color && l.color !== '') ? l.color : '#ddd';

        const { cap, res, isFull, started, isWaitlistAvail } = availabilityOf(l);

        let btnText = '予約';
        let btnDisabled = '';
        let btnStyle = '';

        if (state.offline) {
          // ★つながらないあいだは、最後に見た予定を出しているだけ。古い空き状況で申し込ませない
          btnText = '予約できません';
          btnDisabled = 'disabled';
        } else if (started) {
          // ★始まった回・終わった回には「予約」を出さない。
          //   以前は押せてしまい、入力を全部終えた最後に「終了しています」と言われた。
          btnText = '受付終了';
          btnDisabled = 'disabled';
        } else if(isFull) {
          if(isWaitlistAvail) {
             btnText = 'キャンセル待ち';
             btnStyle = 'border-color:#fbc02d; color:#f57f17; background:#fff;';
          } else {
             btnText = '満席';
             btnDisabled = 'disabled';
          }
        }

        item.innerHTML = `
          <div class="li-time"><div>${esc(l.startTime)}</div><div style="font-size:13px;color:#666;">${esc(l.endTime)}</div></div>
          <div class="li-bar" style="background:${barColor}"></div>
          <div class="li-info"><div class="li-title">${esc(l.className)}${(!state.offline && !started && !isFull && cap - res === 1) ? '<span class="li-last">残り1席</span>' : ''}</div><div class="li-sub">${esc(lessonSubLine(l))}</div></div>
          <button class="li-btn" style="${btnStyle}" ${btnDisabled}>${btnText}</button>
        `;

        if(!state.offline && !started && (!isFull || isWaitlistAvail)) {
          item.querySelector("button").onclick = () => openDetailModal(l, isWaitlistAvail);
        }
        list.appendChild(item);
      });
    }
    Layers.open(drawer);
  }

  function openDetailModal(lesson, isWaitlist = false) {
    state.selectedLesson = lesson;
    state.isWaitlistMode = isWaitlist;
    // 人間かの確かめの札を、先に1枚もらっておく（押したときに待たないため。api.js の tjHuman。キーが無ければ何もしない）
    if (typeof tjHuman !== 'undefined') tjHuman.prepare();

    const titlePrefix = isWaitlist ? "【キャンセル待ち】" : "";
    document.getElementById("detail-title").textContent = titlePrefix + lesson.className;

    document.getElementById("detail-date-time").textContent = fmtDateJp(lesson.date) + ' ' + lesson.startTime + (lesson.endTime ? '〜' + lesson.endTime : '');
    document.getElementById("detail-price").textContent = fmtYen(lesson.price);
    document.getElementById("detail-desc-text").textContent = lesson.description || '詳細情報はありません。';

    // 入力の窓にも、何を予約しているかを出す
    const formLine = document.getElementById("form-lesson-line");
    if (formLine) {
      // 1行目に日時、2行目にレッスン名（1行に詰めると、名前が中途半端な所で折れて読みにくかった）
      formLine.textContent = fmtDateJp(lesson.date) + ' ' + lesson.startTime + '〜' + String.fromCharCode(10) + titlePrefix + lesson.className;
    }

    const btnNext = document.getElementById("btn-to-form");
    if(btnNext) {
       btnNext.textContent = isWaitlist ? "キャンセル待ちへ進む" : "予約を進める";
    }

    switchStep("view-detail");
    Layers.open(document.getElementById("modal-overlay"));
  }

  function switchStep(stepId) {
    ["view-detail", "view-form", "view-confirm"].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.classList.add("hidden");
    });
    const target = document.getElementById(stepId);
    if(target) target.classList.remove("hidden");
    // 段を切り替えたら、窓の一番上から読めるように
    const card = document.getElementById("modal-card");
    if (card) card.scrollTop = 0;
  }

  function validateAndToConfirm() {
    document.querySelectorAll('.field input').forEach(el => el.classList.remove('error-border'));

    const name = document.getElementById("inp-name");
    const phone = document.getElementById("inp-phone");
    const email = document.getElementById("inp-email");

    let isValid = true;
    [name, phone, email].forEach(el => {
      if(!el.value.trim()) {
        el.classList.add('error-border');
        isValid = false;
      }
    });
    // ★断りの見出しは「入力エラー」ではなく「ご確認ください」（2026-10-18。責められているように読めないように）
    if(!isValid) {
      showMsg("ご確認ください", "赤枠の必須項目を入力してください。");
      return;
    }
    // ★最後の「確定」で弾かれる前に、ここで知らせる（全角の数字でも数える）
    const phoneDigits = String(phone.value).normalize ? phone.value.normalize('NFKC').replace(/\D/g, '') : phone.value.replace(/\D/g, '');
    if (phoneDigits.length < 10) {
      phone.classList.add('error-border');
      showMsg("ご確認ください", "お電話番号は、市外局番から数字で10けた以上ご記入ください。");
      return;
    }
    // 裏側と同じ決まり（送るときに使う決まり）で、先に確かめる。全角は、裏側が半角にそろえる
    if (!/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[A-Za-z]{2,}$/.test(String(email.value).normalize('NFKC').trim())) {
      email.classList.add('error-border');
      showMsg("ご確認ください", "メールアドレスの形が正しくないようです。\nもう一度ご確認ください（例：name@example.com）。");
      return;
    }
    // 打ち間違いかもしれない所（止めはしない。確認の画面に赤字で出す）
    const mailFix = mailSuggestion(email.value);
    const telNote = phoneHint(phone.value);

    state.bookingData = { name: name.value, phone: phone.value, email: email.value };

    const list = document.getElementById("confirm-list");
    const typeLabel = state.isWaitlistMode ?
      '<span style="color:#f57f17; font-weight:bold;">キャンセル待ち</span>' : '通常予約';

    // ★電話番号も出す（2026-10-05 の監査）。
    //   先生が電話で連絡する番号で、古い形の予約ID の取り消しは「電話番号の下4けた」で確かめる。ここで打ちまちがいに気づけるように。
    //   日付は「11月1日（日）」の形に。「通常予約」の行は、キャンセル待ちのときだけ出す（ふだんは要らない情報）
    const L = state.selectedLesson;
    // ★取り消しの締切を、もう過ぎている回か（2026-10-18）。
    //   締切を過ぎた回にも申し込めるのに、ここに「○時間前まで取り消せます」と出ていた。
    //   締切は、設定の「開始の何時間前まで」と開始時刻から、日本時間で数える（裏側の取り消しと同じ決まり）。
    // ★裏側が一覧に入れて返す締切（cancelDeadlineAt＝日本時間の「YYYY-MM-DD HH:mm」）を使う（2026-10-18。点検の低8）。
    //   一覧は覚えから返ることがあるので、cancelDeadlinePassed（作ったときの答え）より、締切の時刻と、いまの時刻を比べるほうが正しい。
    //   締切の時刻が無いときは cancelDeadlinePassed、それも無いときは、今までどおりここで数える。
    const deadlineH = numSetting('cancelDeadlineHours', 12);
    const startMs = Date.parse(`${L.date}T${L.startTime}:00+09:00`);
    const atMs = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(L.cancelDeadlineAt || ''))
      ? Date.parse(String(L.cancelDeadlineAt).replace(' ', 'T') + ':00+09:00') : NaN;
    const pastDeadline = !state.isWaitlistMode && (
      Number.isFinite(atMs) ? Date.now() > atMs
        : typeof L.cancelDeadlinePassed === 'boolean' ? L.cancelDeadlinePassed
          : Number.isFinite(startMs) && (startMs - Date.now()) / 3600000 < deadlineH);
    const cancelLine = state.isWaitlistMode
      ? 'キャンセル待ちは、レッスンが始まるまで、この予約ページ（または予約完了のメールのリンク）から取り消せます。キャンセル料はいただきません。'
      : pastDeadline
        ? '<span class="confirm-warn">この回は、お申し込みのあとは画面から取り消せません（スタジオへご連絡ください）。</span>'
          + `<br><small>画面から取り消せるのは、レッスン開始の${esc(deadlineH)}時間前までです。キャンセル料はいただきません。</small>`
        : `レッスン開始の${esc(deadlineH)}時間前まで、この予約ページ（または予約完了のメールのリンク）から取り消せます。キャンセル料はいただきません。`;
    list.innerHTML = `
      ${state.isWaitlistMode ? `<li><strong>お申し込み:</strong> ${typeLabel}</li>` : ''}
      <li><strong>レッスン:</strong> ${esc(L.className)}</li>
      <li><strong>日時:</strong> ${esc(fmtDateJp(L.date))} ${esc(L.startTime)}${L.endTime ? '〜' + esc(L.endTime) : ''}</li>
      ${Number(L.price) > 0 ? `<li><strong>料金:</strong> ${esc(fmtYen(L.price))}（税込。当日、スタジオで現金でお支払いください）</li>` : ''}
      <li><strong>お名前:</strong> ${esc(state.bookingData.name)}</li>
      <li><strong>電話番号:</strong> ${esc(state.bookingData.phone)}${telNote ? `<br><span class="confirm-warn">${esc(telNote)}</span>` : ''}</li>
      <li><strong>メール:</strong> ${esc(state.bookingData.email)}${mailFix ? `<br><span class="confirm-warn">「${esc(mailFix)}」ではありませんか？ 違っていたら「修正する」で直してください。</span>` : ''}</li>
      <li><strong>取り消し:</strong> ${cancelLine}</li>
    `;
    // ★料金・お支払い・キャンセルの決まりを、申し込む直前の画面にも出す（2026-10-06）。
    //   くわしい表記（特定商取引法に基づく表記）へのリンクも、ここに置く。
    const lawNote = document.getElementById('confirm-law-note');
    if (lawNote) lawNote.style.display = '';

    const authArea = document.querySelector(".auth-area");
    if(authArea) authArea.style.display = "none";

    const finalArea = document.getElementById("final-check-area");
    if(finalArea) {
      finalArea.classList.remove("hidden");
      finalArea.style.display = "block";
    }

    const chk = document.getElementById("chk-agree");
    if(chk) chk.checked = false;

    const btnFinal = document.getElementById("btn-finalize");
    if(btnFinal) {
      btnFinal.textContent = state.isWaitlistMode ? "キャンセル待ちを確定" : "予約を確定する";
      btnFinal.disabled = true;
    }

    switchStep("view-confirm");
  }

  function finalizeBooking() {
    const btn = document.getElementById("btn-finalize");
    // ★二度押し・連打で同じ申し込みを2回送らない。
    //   同意のチェックを付け直すとボタンが押せる状態に戻るため、ボタンだけでは防げない。
    if (state.submitting) return;
    state.submitting = true;
    btn.textContent = "処理中...";
    btn.disabled = true;

    const payload = Object.assign({ slotId: state.selectedLesson.slotId }, state.bookingData);

    gas("apiReserve", JSON.stringify(payload)).then(json => {
      state.submitting = false;
      const res = JSON.parse(json);
      if(res.success) {
        Layers.close(document.getElementById("modal-overlay"));
        // この端末に「予約ID・日時・レッスン名・キャンセル待ちか」だけを控える（上の「あなたのご予約」と、取り消しの確かめの窓に出すため）
        rememberBooking(res.bookingId, state.selectedLesson, !!res.isWaitlist);
        renderMine();
        renderUsual();
        // ★控えを送った宛先を、はっきり書く（2026-10-18。打ち間違いに、その場で気づけるように）
        const sentTo = String(state.bookingData.email || '').normalize('NFKC').trim();
        const sentLine = `控えは ${sentTo} にお送りしました。届かないときは、迷惑メールのフォルダもご覧ください。`;

        if(res.isWaitlist) {
            showMsg("受付完了", `キャンセル待ちを受け付けました。\n\n予約ID: ${res.bookingId}\n\n` + (res.mailSent ? "空きが出次第、自動で予約が確定しメールでお知らせします。\n" + sentLine : "空きが出次第、自動で予約が確定します。確定したかどうかは、この予約ページの上の「あなたのご予約」でも確かめられます（このスマホで開いたとき）。") + `\n(レッスン開始${numSetting('promotionCutoffHours', 24)}時間前まで有効)` + (res.mailSent ? "" : "\n\n確認のメールはお送りできませんでした。お手数ですが、上の予約IDを控えておいてください（この画面を写真に残しておくと安心です）。"), true);
        } else {
            showMsg("予約完了", `予約が確定しました！\n\n予約ID: ${res.bookingId}\n\n` + (res.mailSent ? sentLine : "確認のメールはお送りできませんでした。\nお手数ですが、上の予約IDを控えておいてください（この画面を写真に残しておくと安心です）。"), true);

            // ★2つの問いかけは、1つの画面にまとめて出す（続けて2回聞かない）
            //   キャンセル待ちのときは出さない。まだ席が決まっていないため。
            const extra = document.getElementById("msg-extra");
            const l = state.selectedLesson || {};
            if (extra && window.TorajiroShare) {
              extra.innerHTML = window.TorajiroShare.afterBookingHtml({
                slotId: l.slotId, date: l.date, startTime: l.startTime, endTime: l.endTime,
                lessonName: l.className || l.lessonName,
                address: (window.torajiroSettings && window.torajiroSettings.address) || '',
              });
            }
        }

      } else {
        showMsg("ご確認ください", res.error, null, { contact: needsContact(res) });
        btn.textContent = state.isWaitlistMode ? "キャンセル待ちを確定" : "予約を確定する";
        btn.disabled = false;
      }
    }).catch(() => {
      state.submitting = false;
      showMsg("ご確認ください", "通信がうまくいきませんでした。\n\n予約が入ったかどうか分からない場合は、同じ回をもう一度お申し込みください。二重には入りません。", null, { contact: true });
      btn.textContent = state.isWaitlistMode ? "キャンセル待ちを確定" : "予約を確定する";
      btn.disabled = false;
    });
  }

  /** 古い形（日付＋3けた）の予約IDか。そのときだけ、電話番号の下4けたの欄を出す（2026-10-18） */
  function isOldBookingId(v) {
    return /^\d{8}-\d{3}$/.test(String(v || '').normalize('NFKC').replace(/\s+/g, '').replace(/[ー―‐−]/g, '-'));
  }
  function syncCancelPhone4() {
    const wrap = document.getElementById("cancel-phone4-wrap");
    const inp = document.getElementById("inp-cancel-id");
    if (wrap && inp) wrap.style.display = isOldBookingId(inp.value) ? "" : "none";
  }
  document.addEventListener("DOMContentLoaded", () => {
    const inp = document.getElementById("inp-cancel-id");
    if (inp) { inp.addEventListener("input", syncCancelPhone4); syncCancelPhone4(); }
  });

  /** 予約の取り消しの窓を、1段目（予約IDを入れる）で開く */
  function openCancelModal() {
    if (typeof tjHuman !== 'undefined') tjHuman.prepare();   // 人間かの確かめの札を先にもらっておく（api.js）
    showCancelStep("input");
    Layers.open(document.getElementById("cancel-modal"));
  }
  function closeCancelModal() {
    Layers.close(document.getElementById("cancel-modal"));
    showCancelStep("input");
  }
  function showCancelStep(step) {
    const a = document.getElementById("cancel-step-input");
    const b = document.getElementById("cancel-step-confirm");
    if (a) a.style.display = step === "input" ? "" : "none";
    if (b) b.style.display = step === "confirm" ? "" : "none";
  }

  /** 打った予約IDと、古い形のときの下4けた。足りなければ知らせて null */
  function readCancelInput() {
    const id = normCancelId(document.getElementById("inp-cancel-id").value);
    if(!id) {
       showMsg("ご確認ください", "予約IDを入力してください");
       return null;
    }
    const p4el = document.getElementById("inp-cancel-phone4");
    const phone4 = p4el ? String(p4el.value || '').normalize('NFKC').replace(/\D/g, '') : '';
    if (isOldBookingId(id) && phone4.length !== 4) {
       syncCancelPhone4();
       showMsg("ご確認ください", "この予約IDは古い形のため、ご予約のときの電話番号の下4けたも入れてください。");
       return null;
    }
    return { id, phone4 };
  }

  /**
   * ★押す前に、何を取り消すかを見せる（2026-10-18）
   *   以前は「キャンセル実行」を押した瞬間に取り消され、どのレッスンかも出なかった（メールのリンクから来ると、ボタン1回だった）。
   *   日時とレッスン名は、予約ID から裏側に聞く（apiLookupReservation）。聞けないときは、この端末で予約した回の控えを使う。
   */
  async function toCancelConfirm() {
    const inp = readCancelInput();
    if (!inp) return;
    const next = document.getElementById("btn-to-cancel-confirm");
    if (next.disabled) return;
    next.disabled = true;
    // 「あなたのご予約」から開いて札を待っているあいだに押されたときは、元の文字に戻す（openCancelFor が「確かめています…」にしている）
    const nextLabel = next.textContent === "確かめています…" ? "次へ（内容の確かめ）" : next.textContent;
    next.textContent = "確かめています…";
    // ★予約IDから「どのレッスンか（日時・レッスン名）」を、裏側に聞く（apiLookupReservation。お名前や連絡先は返ってこない）
    let info = null;
    try {
      const res = JSON.parse(await gas("apiLookupReservation", { id: inp.id, phone4: inp.phone4 }));
      if (res.success && res.reservation) {
        info = res.reservation;
      } else if (res.error_code !== 'unknown_action') {
        // 見つからない・取り消し済み・下4けたが要る・つながらない など。理由をそのまま伝えて、1段目のまま
        next.disabled = false; next.textContent = nextLabel;
        if (res.error_code === 'need_phone4') syncCancelPhone4();
        // ★この端末の控えにある予約が、取り消し済み・見つからないだったときは、控えを消して「あなたのご予約」から外す（2026-11-10。点検の6）。
        //   残しておくと、押すたびに同じ断りが出て、見つからないときは「まちがい」も数えられてしまう
        const gone = (res.error_code === 'already_cancelled' || res.error_code === 'not_found') ? findMyBooking(inp.id) : null;
        if (gone) {
          addSkip(gone);   // その回は、いつものレッスンでも勧めない（4回目の点検の3）
          forgetBooking(inp.id);
          renderMine();
          renderUsual();
          closeCancelModal();
        }
        showMsg("ご確認ください", res.error || "予約IDが正しいかご確認ください。", null, { contact: needsContact(res) });
        return;
      }
      // unknown_action … 裏側がまだ古い（窓口が無い）。この端末の控えか、予約IDだけで確かめる
    } catch (e) { /* 読めなくても、予約IDだけで確かめる */ }
    next.disabled = false; next.textContent = nextLabel;

    const mine = findMyBooking(inp.id);
    const L = info
      ? { date: info.date, startTime: String(info.startTime || '').substring(0, 5), endTime: String(info.endTime || '').substring(0, 5), name: info.lessonName }
      : mine;
    state.cancelInfo = L ? Object.assign({ id: inp.id }, L) : null;
    const isWait = !!(info && info.isWaitlist);
    const t = document.getElementById("cancel-confirm-text");
    const exec = document.getElementById("btn-exec-cancel");
    const note = document.getElementById("cancel-confirm-note");
    let canCancel = true;
    let text;
    if (L) {
      text = `${fmtDateJp(L.date)} ${L.startTime}${L.endTime ? '〜' + L.endTime : ''}\n${L.name}${isWait ? '（キャンセル待ち）' : ''}\n（予約ID ${inp.id}）`;
    } else {
      text = `予約ID ${inp.id}`;
    }
    if (info && !info.cancellable) {
      canCancel = false;
      text += info.reason === 'lesson_started'
        ? '\n\nこのレッスンは、すでに始まっているか、終わっています。取り消しはできません。'
        : `\n\nこの回は、取り消しの締切（レッスン開始の${info.deadlineHours}時間前）を過ぎているため、画面からは取り消せません。お手数ですが、スタジオへご連絡ください。`;
    } else {
      text += L ? `\n\n${isWait ? 'このキャンセル待ちを取り消しますか？' : 'このご予約を取り消しますか？'}` : ' のご予約を取り消します。\nよろしいですか？';
    }
    if (t) t.textContent = text;
    if (exec) exec.style.display = canCancel ? '' : 'none';
    if (note) {
      note.textContent = '';
      if (canCancel) note.textContent = '取り消したあとは、元に戻せません。';
      else if (info.reason === 'past_deadline' && typeof studioContactLink === 'function') note.appendChild(studioContactLink());
    }
    const keep = document.getElementById("btn-cancel-keep");
    if (keep) keep.textContent = canCancel ? "取り消さない" : "閉じる";
    showCancelStep("confirm");
    if (keep) { try { keep.focus({ preventScroll: true }); } catch (e) {} }
  }

  function execCancel() {
    const inp = readCancelInput();
    if (!inp) { showCancelStep("input"); return; }
    const { id, phone4 } = inp;
    // 確かめの窓で出した中身（裏側から聞いた物か、この端末の控え）
    const mine = (state.cancelInfo && normCancelId(state.cancelInfo.id) === id) ? state.cancelInfo : findMyBooking(id);
    const btn = document.getElementById("btn-exec-cancel");
    btn.disabled = true; btn.textContent = "処理中...";

    gas("apiCancelReservation", { id: id, phone4: phone4 }).then(json => {
      const res = JSON.parse(json);
      btn.disabled = false; btn.textContent = "キャンセルする";

      if(res.success) {
        Layers.close(document.getElementById("cancel-modal"));
        showCancelStep("input");
        forgetBooking(id);
        // 取り消した回を、いつものレッスンで勧めない（上の forgetHabitOf。点検の7）
        if (mine) forgetHabitOf(mine);
        renderMine();
        renderUsual();
        // ★メールのリンク（?cancel_id=…）から来たとき、そのまま開き直すと
        //   キャンセルの画面がまた出てしまうので、予約IDを外したアドレスへ戻す。
        let back = window.location.href;
        try {
          const u = new URL(window.location.href);
          u.searchParams.delete('cancel_id');
          back = u.toString();
        } catch (e) {}
        // 何を取り消したかが分かる文にする
        const what = mine
          ? `${fmtDateJp(mine.date)} ${mine.startTime}\n${mine.name}\n（予約ID ${id}）\n\nのご予約を取り消しました。`
          : `予約ID ${id} のご予約を取り消しました。`;
        showMsg("キャンセル完了", what, back);
      } else {
        // ★理由（締切を過ぎた・始まっている・IDが違う など）をそのまま伝える。
        //   以前はどれでも「IDが正しいか確認して」と出て、何度も打ち直させていた。
        if (res.error_code === 'need_phone4') syncCancelPhone4();
        showCancelStep("input");
        showMsg("キャンセルできませんでした", res.error || "予約IDが正しいかご確認ください。", null, { contact: needsContact(res) });
      }
    }).catch(() => {
      btn.disabled = false; btn.textContent = "キャンセルする";
      showCancelStep("input");
      showMsg("キャンセルできませんでした", "通信がうまくいきませんでした。少し時間をおいてお試しください。", null, { contact: true });
    });
  }

  /** スタジオへの連絡の方法（Instagram）を添える断りか（api.js の CONTACT_CODES と同じ） */
  function needsContact(res) {
    return !!(res && typeof CONTACT_CODES === 'object' && CONTACT_CODES[res.error_code]);
  }

  function showMsg(title, body, redirectUrl = null, opts = {}) {
    document.getElementById("msg-title").textContent = title;
    document.getElementById("msg-body").innerText = body;
    const extra = document.getElementById("msg-extra");
    if (extra) {
      extra.innerHTML = "";
      // 「スタジオまでご連絡ください」のときは、連絡の方法をボタンで添える
      if (opts.contact && typeof studioContactLink === 'function') extra.appendChild(studioContactLink());
    }
    const modal = document.getElementById("msg-modal");

    if(redirectUrl === true) {
        modal.dataset.redirect = window.location.href;
    } else if(redirectUrl) {
        modal.dataset.redirect = redirectUrl;
    } else {
        delete modal.dataset.redirect;
    }

    modal.classList.add("open");
  }

  function moveMonth(step) {
    state.currMonth += step;
    if(state.currMonth > 11) { state.currMonth=0; state.currYear++; }
    if(state.currMonth < 0) { state.currMonth=11; state.currYear--; }
    renderCalendar();
  }
  function getLessons(d) { return state.lessons.filter(l=>l.date===d).sort((a,b)=>a.startTime.localeCompare(b.startTime)); }
  function formatDate(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

  function updateAboutInfo(s) {
    const setText = (id, val) => {
      const el = document.getElementById(id);
      if(el) el.textContent = val || '-';
    };
    setText('disp-studio-name', s.studioName);
    setText('disp-concept', s.concept);
    setText('disp-address', s.address);
    setText('disp-facilities', s.facilities);

    const mapFrame = document.getElementById('disp-map-frame');
    if(mapFrame && s.address){
       const q = encodeURIComponent(s.address);
       mapFrame.src = "https://maps.google.com/maps?q=" + q + "&t=m&z=15&output=embed&iwloc=near";
       mapFrame.style.display = 'block';
    }
  }

  function setupExtensions() {
    document.addEventListener('click', function(e){
      if(e.target && e.target.id === 'btn-open-contact-form'){
        try {
          const saved = localStorage.getItem("torajiro_user_info");
          if(saved){
            const u = JSON.parse(saved);
            if(u.name) document.getElementById('contact-name').value = u.name;
            if(u.phone) document.getElementById('contact-phone').value = u.phone;
            if(u.email) document.getElementById('contact-email').value = u.email;
          }
        } catch(e){}
        const cm = document.getElementById('contactModal');
        showContactErr('');
        if (typeof tjHuman !== 'undefined') tjHuman.prepare();   // 人間かの確かめの札を先にもらっておく（api.js）
        if(cm) Layers.open(cm);
      }
    });

    const contactModal = document.getElementById('contactModal');
    if(contactModal){
      const btnClose = document.getElementById('btn-close-contact');
      if(btnClose) btnClose.addEventListener('click', () => Layers.close(contactModal));
      contactModal.addEventListener('click', (e) => {
        if(e.target === contactModal) Layers.close(contactModal);
      });
    }

    /**
     * ★お問い合わせの断りは、窓の中に出す（2026-10-18）。
     *   以前はブラウザの白い警告で、「スタジオまで直接ご連絡ください」と言うのに、連絡の方法が無かった。
     *   送れないとき（メールが止まっている・つながらない）は、Instagram を開くボタンを添える。
     */
    function showContactErr(text, withContact) {
      const box = document.getElementById('contact-err');
      if (!box) return;
      box.textContent = '';
      if (!text) { box.style.display = 'none'; return; }
      const p = document.createElement('p');
      p.textContent = text;
      box.appendChild(p);
      if (withContact && typeof studioContactLink === 'function') box.appendChild(studioContactLink());
      box.style.display = '';
      try { box.scrollIntoView({ block: 'nearest' }); } catch (e) {}
    }

    const successModal = document.getElementById('contactSuccessModal');
    if(successModal){
      const btnOk = document.getElementById('btn-close-contact-success');
      if(btnOk) btnOk.addEventListener('click', () => successModal.classList.remove('open'));
      successModal.addEventListener('click', (e) => {
        if(e.target === successModal) successModal.classList.remove('open');
      });
    }

    const btnSendContact = document.getElementById('btn-send-contact');
    if(btnSendContact){
      btnSendContact.addEventListener('click', function(){
        const name = document.getElementById('contact-name').value.trim();
        const phone = document.getElementById('contact-phone').value.trim();
        const email = document.getElementById('contact-email').value.trim();
        const subject = document.getElementById('contact-subject').value;
        const body = document.getElementById('contact-body').value.trim();

        if(!name || !email || !subject || !body){
          showContactErr("必須項目（お名前・メール・ご用件・内容）を入力してください。");
          return;
        }
        showContactErr('');

        btnSendContact.disabled = true;
        btnSendContact.textContent = "送信中...";

        const payload = {
          name: name,
          phone: phone,
          email: email,
          subject: subject,
          body: body
        };

        gas("apiSendContact", JSON.stringify(payload)).then(res => {
          btnSendContact.disabled = false;
          btnSendContact.textContent = "送信する";
          const result = JSON.parse(res);

          if(result.success){
            Layers.close(contactModal);
            document.getElementById('contact-body').value = "";
            document.getElementById('contact-subject').value = "";
            if(successModal) successModal.classList.add('open');
          } else {
            showContactErr("送信できませんでした。\n" + (result.error || ""), needsContact(result));
          }
        }).catch(() => {
          btnSendContact.disabled = false;
          btnSendContact.textContent = "送信する";
          showContactErr("通信がうまくいきませんでした。少し時間をおいてお試しください。", true);
        });
      });
    }

    const aboutModal = document.getElementById('aboutModal');
    if(aboutModal){
      aboutModal.addEventListener('click', function(e){
        if(e.target === aboutModal){
          Layers.close(aboutModal);
        }
      });
    }

    const cancelModal = document.getElementById('cancel-modal');
    if(cancelModal){
      cancelModal.addEventListener('click', function(e){
        if(e.target === cancelModal){
          closeCancelModal();
        }
      });
    }

    const btnToForm = document.getElementById('btn-to-form');
    const btnBackForm = document.getElementById('btn-back-form');
    if(btnToForm) btnToForm.addEventListener('click', loadUserData);
    if(btnBackForm) btnBackForm.addEventListener('click', loadUserData);

    function loadUserData() {
      setTimeout(() => {
        try {
          const savedJson = localStorage.getItem("torajiro_user_info");
          if (!savedJson) return;
          const u = JSON.parse(savedJson);
          const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el && !el.value && val) el.value = val;
          };
          setVal("inp-name", u.name);
          setVal("inp-phone", u.phone);
          setVal("inp-email", u.email);
        } catch (e) {}
      }, 100);
    }

    const msgObserver = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const modal = document.getElementById('msg-modal');
          if(modal && modal.classList.contains('open')){
            const title = document.getElementById('msg-title');
            if(title && (title.textContent === '予約完了' || title.textContent === '受付完了')){
              saveUserData();
            }
          }
        }
      });
    });
    const msgModal = document.getElementById('msg-modal');
    if(msgModal){
      msgObserver.observe(msgModal, { attributes: true });
    }

    function saveUserData(){
      try {
        const info = {
          name: document.getElementById("inp-name").value,
          phone: document.getElementById("inp-phone").value,
          email: document.getElementById("inp-email").value,
        };
        if(info.name && info.phone){
          localStorage.setItem("torajiro_user_info", JSON.stringify(info));
        }
      } catch(e) {}
    }

    const calendarObserver = new MutationObserver(function(mutations) {
      const grid = document.getElementById('cal-grid');
      if(grid && grid.children.length > 0) {
        applyPastStamps();
      }
    });
    const calGrid = document.getElementById('cal-grid');
    if(calGrid){
      calendarObserver.observe(calGrid, { childList: true });
    }

    function applyPastStamps(){
      // ★月の見出しが「2026年10月」になったので、見出しの文字は読まない。マスに付けた日付（data-date）で比べる
      const todayStr = jstToday();

      const cells = document.querySelectorAll('.cell');
      cells.forEach(cell => {
        const dayNumEl = cell.querySelector('.day-num');
        if(!dayNumEl) return;
        if(cell.classList.contains('dim')) return;
        const ds = String(cell.dataset.date || '');
        if(!/^\d{4}-\d{2}-\d{2}$/.test(ds)) return;

        if(ds < todayStr) {
          // 過ぎた日は押せない（いまと同じ）。キーボードでも止まらないようにする
          cell.tabIndex = -1;
          cell.setAttribute('aria-disabled', 'true');
          if(cell.querySelector('.cal-event')) {
            if(!cell.querySelector('.stamp-past')) {
              const stamp = document.createElement('div');
              stamp.className = 'stamp-past';
              stamp.textContent = '済';
              cell.appendChild(stamp);
              cell.classList.add('is-past');
            }
          } else {
            cell.classList.add('is-past');
            }
        }
      });
    }
  }
})();