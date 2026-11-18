/**
 * api.js — バックエンド（Cloudflare Workers）との通信
 *
 * 旧システムでは Google Apps Script を呼んでいた。
 * 呼び出しの形（gas関数・引数・戻り値がJSON文字列）はそのまま残してあるので、
 * script.js 側は一切変えていない。
 *
 * ★オーナーのアカウントへ移すときは、この API_URL だけ書き換える。
 */
/**
 * ★ほかのサイトの枠（iframe）の中で開かれたら、自分を一番上に出し直す（2026-11-02）
 *   お客様の画面の本番は github.io で、そこでは「枠に入れさせない」見出し（X-Frame-Options・frame-ancestors）を付けられない。
 *   付けられないまま、ほかのサイトが予約の画面を透明な枠に入れて、別の物に見せかけて押させる手（クリックジャッキング）を防ぐ。
 *   ふつうに開いたとき（枠に入っていないとき）は、何もしない。KB PARK は自分のドメインの見出しで防いでいる（守りの基礎 5章）
 */
(function () {
  try {
    if (window.top !== window.self) {
      // 見えなくするのは display（visibility だと、中の部品が visible を持っていると透けて見える。2026-11-02 監査の指摘）
      document.documentElement.style.display = 'none';
      window.top.location.href = window.self.location.href;
    }
  } catch (e) {
    // 一番上へ出し直せない（ほかのサイトが止めている）ときは、画面を見せないままにする
    document.documentElement.style.display = 'none';
  }
})();

const API_URL = "https://torajiro-backend.studio-torajiro.workers.dev";

/**
 * ★予約システムにつながらないときの連絡先（2026-10-17）
 * 裏側に聞けないときにも出せるよう、ページの中に持つ。お店のページに出ている Instagram と同じ。
 * つながらない・受付を止めている・混み合っているときの案内に、必ずこの1行を添える。
 */
const STUDIO_INSTAGRAM = 'torajiro_yoga';
const STUDIO_CONTACT_LINE = 'お急ぎの方は、スタジオの Instagram（@' + STUDIO_INSTAGRAM + '）へメッセージをお送りください。';
/**
 * 断りのうち、連絡先を添えるもの（予約システムそのものが使えないとき）。
 * ★2026-10-18：「スタジオまで直接ご連絡ください」と言うのに、連絡の方法が無かった断りを足した。
 *   past_deadline … 取り消しの締切を過ぎた（予約IDでの取り消し）
 *   contact_unavailable … お問い合わせを、先生あてに届けられなかった
 *   （code_unavailable・contact_studio＝マイページの断りは、2026-11-10 にマイページごとやめた）
 *   seat_limit … 同じ回線（Wi-Fi など）から、1つの回・1日に取れる席を超えた（2026-10-18）
 *   locked … 予約ID のまちがいが続いて、取り消しの受付を止めている（2026-10-18）
 *   reserve_probe … 同じメールアドレスで、電話番号の違う申しこみだった・それが続いて止めている（2026-10-18）
 */
const CONTACT_CODES = { offline: 1, paused: 1, too_many: 1, server_error: 1, past_deadline: 1, contact_unavailable: 1, seat_limit: 1, locked: 1, reserve_probe: 1 };

/** スタジオの Instagram を開くボタン（部品で返す。画面のあちこちで同じ物を使う） */
function studioContactLink(label) {
  const a = document.createElement('a');
  a.className = 'contact-insta';
  a.href = 'https://www.instagram.com/' + encodeURIComponent(STUDIO_INSTAGRAM) + '/';
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = label || 'スタジオの Instagram を開く（@' + STUDIO_INSTAGRAM + '）';
  return a;
}
function withStudioContact(json) {
  if (json && json.success === false && CONTACT_CODES[json.error_code] && String(json.error || '').indexOf(STUDIO_CONTACT_LINE) < 0) {
    json.error = String(json.error || '') + '\n\n' + STUDIO_CONTACT_LINE;
  }
  return json;
}

/**
 * ★人間かの確かめ（Cloudflare Turnstile・見えない形）（2026-10-26。KB PARK の user/main.js と同じ考え方）
 *   画面には何も出ない。お客様は何も押さない。ログインの要らない窓口（予約・キャンセル・キャンセル待ち・お問い合わせ）だけで使う。
 *   使い心地を変えないため、窓を開いたときに札を先に1枚もらっておき、押したときは待たずにそれを使う（札は1回きり・数分で切れる）。
 *   読み込めない・返事が来ないときは、札なしで送る（裏側は断らずに、回数を少し絞るだけ。worker/src/lib/turnstile.js）。
 *   裏側にキー（公開してよい値）が入っていないあいだは、何もしない（Turnstile を読み込まない・今までと同じ）。
 */
const tjHuman = (function () {
  var SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  var FRESH_MS = 4 * 60 * 1000;       // 札は5分で切れるので、4分を過ぎた物は使わない
  var WAIT_ON_SUBMIT_MS = 1500;       // 押したときに待つのは1.5秒まで（遅れて届いた札は、取り置きに入れて次に使う）
  var RENDER_LIMIT_MS = 20000;
  var KEY_RE = /^[0-3]x[0-9A-Za-z_-]{16,100}$/;
  var key = '';
  var loading = null, widgetId = null, fetching = null, stock = null;

  function setKey(k) { if (typeof k === 'string' && KEY_RE.test(k)) key = k; }
  /** 裏側の返事からキーを受け取る（予約の一覧の settings・トップの返事） */
  function learn(json) {
    try {
      if (!json || typeof json !== 'object') return;
      setKey(json.turnstileSiteKey || (json.settings && json.settings.turnstileSiteKey) || '');
    } catch (e) {}
  }
  function load() {
    if (!key) return Promise.resolve(false);
    if (window.turnstile) return Promise.resolve(true);
    if (loading) return loading;
    loading = new Promise(function (resolve) {
      var sc = document.createElement('script');
      sc.src = SCRIPT_URL;
      sc.async = true;
      var timer = setTimeout(function () { done(false); }, 6000);
      function done(okv) { clearTimeout(timer); resolve(!!(okv && window.turnstile)); }
      sc.onload = function () { done(true); };
      sc.onerror = function () { loading = null; done(false); };   // 次に窓を開いたとき、もう一度試す
      document.head.appendChild(sc);
    });
    return loading;
  }
  /** 札を1枚もらって、取り置きに入れる（もらっている途中なら、それを返す）。裏で最大20秒まで続ける */
  function fetchOne() {
    if (fetching) return fetching;
    fetching = (async function () {
      try {
        if (!(await load()) || !window.turnstile) return;
        var tok = await new Promise(function (resolve) {
          var settled = false;
          var timer = setTimeout(function () { finish(''); }, RENDER_LIMIT_MS);
          function finish(v) { if (!settled) { settled = true; clearTimeout(timer); resolve(typeof v === 'string' ? v : ''); } }
          try {
            if (widgetId !== null) { try { window.turnstile.remove(widgetId); } catch (e) {} widgetId = null; }
            var box = document.getElementById('tj-human-box');
            if (!box) { box = document.createElement('div'); box.id = 'tj-human-box'; document.body.appendChild(box); }
            widgetId = window.turnstile.render(box, {
              sitekey: key,
              action: 'torajiro',
              retry: 'never',
              'refresh-expired': 'never',
              callback: function (t) { finish(t); },
              'error-callback': function () { finish(''); return true; },
              'unsupported-callback': function () { finish(''); },
              'timeout-callback': function () { finish(''); },
            });
          } catch (e) { finish(''); }
        });
        if (tok) stock = { tok: tok, at: Date.now() };
      } catch (e) {
        // 確かめが使えなくても、予約はできる（札なしで送る）
      } finally {
        fetching = null;
      }
    })();
    return fetching;
  }
  function takeStock() {
    var s = stock;
    stock = null;
    return (s && Date.now() - s.at < FRESH_MS) ? s.tok : '';
  }
  /** 窓を開いたときに呼ぶ：部品を読み込み、札を先に1枚もらっておく（押したときに待たないため） */
  function prepare() {
    if (!key) return;
    if (stock && Date.now() - stock.at < FRESH_MS) return;
    fetchOne();
  }
  /** 送る直前に呼ぶ：札を1枚渡す。もらえなければ空文字（そのまま送ってよい） */
  async function token() {
    try {
      if (!key) return '';
      var tok = takeStock();
      if (!tok) {
        await Promise.race([fetchOne(), new Promise(function (r) { setTimeout(r, WAIT_ON_SUBMIT_MS); })]);
        tok = takeStock();
      }
      if (tok) fetchOne();   // 次の1枚を先にもらっておく（確かめのあとの取り消し・番号の入力など、続けて使うときに待たない）
      return tok;
    } catch (e) {
      return '';
    }
  }
  /**
   * 札が手元に来るまで、最大 ms ミリ秒待つ（2026-11-10。「あなたのご予約」の「取り消す」で、確かめに行く前に使う）。
   *   札が使えない・時間切れでも、ふつうに終わる（そのまま札なしで送ってよい）
   */
  function ready(ms) {
    try {
      if (!key) return Promise.resolve();
      if (stock && Date.now() - stock.at < FRESH_MS) return Promise.resolve();
      return Promise.race([fetchOne(), new Promise(function (r) { setTimeout(r, ms); })]);
    } catch (e) {
      return Promise.resolve();
    }
  }
  return { setKey: setKey, learn: learn, prepare: prepare, token: token, ready: ready };
})();
/** 人間かの確かめの札を付けて送る窓口（裏側の worker/src/lib/turnstile.js を使う窓口と同じ） */
const TJ_HUMAN_ACTIONS = { apiReserve: 1, apiCancelReservation: 1, apiLookupReservation: 1, apiSendContact: 1 };

/** 旧システムの関数名 → 新しいバックエンドのaction名 */
const ACTION_MAP = {
  apiGetInit:           'apiGetUserInit',
  apiReserve:           'apiReserve',
  apiCancelReservation: 'apiCancelReservation',
  apiSendContact:       'apiSendContact',
};

/**
 * バックエンドを呼ぶ。
 * 戻り値は「JSON文字列」。旧システムと同じ形にしてあるので、
 * 呼び出す側は今まで通り JSON.parse() して使える。
 */
async function gas(fnName, ...args) {
  let payload = { action: ACTION_MAP[fnName] || fnName };

  if (args.length > 0) {
    const arg = args[0];
    if (fnName === 'apiCancelReservation' && typeof arg === 'string') {
      payload.id = arg;
    } else if (typeof arg === 'string') {
      try {
        Object.assign(payload, JSON.parse(arg));
      } catch (e) {
        payload.data = arg;
      }
    } else if (arg && typeof arg === 'object') {
      Object.assign(payload, arg);
    }
  }

  // ★人間かの確かめの札を付ける（上の tjHuman。もらえなければ付けずに送る＝今までどおり）
  if (TJ_HUMAN_ACTIONS[payload.action]) {
    try { const t = await tjHuman.token(); if (t) payload.turnstile_token = t; } catch (e) {}
  }

  // ★電波の弱い場所で応答が返らないと、「処理中...」のまま止まって見えた。
  //   30秒で打ち切り、案内を出す（打ち切りの仕組みが無い古い端末では素通し）。
  const ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 30000) : null;

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      // text/plain で送ると、ブラウザが事前の問い合わせ（プリフライト）を省くため速い
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: ctrl ? ctrl.signal : undefined,
    });
    const json = await response.json();
    tjHuman.learn(json);
    if (timer) clearTimeout(timer);
    return JSON.stringify(withStudioContact(json));
  } catch (err) {
    if (timer) clearTimeout(timer);
    console.error('API Error:', err);
    // ★「電波が悪い」以外の原因が実際にあった。
    //   公共のWi-Fiなどに入っている見張りの仕組みが、
    //   このシステムの通信先（workers.dev）を丸ごと遮断することがある。
    //   ページは開けるのに、押しても何も起きない、という形になるので、
    //   お客様が原因にたどり着けるよう、切り替えを案内する。
    // ★1日に使える回数を使い切った日も、ここに来る（Cloudflare が、こちらの返事の代わりに断りのページを返すため）。
    //   error_code の offline を見て、予約ページは「最後に見た予定」を出す（script.js）。
    return JSON.stringify({ success: false, error_code: 'offline', error:
      '通信できませんでした。\n\n'
      + 'お店やホテルの無料Wi-Fiをお使いの場合、そちらが原因のことがあります。\n'
      + 'Wi-Fiを切って、携帯の回線でお試しください。\n\n'
      + 'それでも変わらないときは、予約システムが混み合っているか、止まっています。\n'
      + STUDIO_CONTACT_LINE });
  }
}

/**
 * ★画面で起きた不具合を、保守用の記録に送る
 *
 * 画面の文字が1つ崩れただけで、見た目は普通なのにボタンが一切効かなくなる。
 * お客様は「押しても何も起きない」と感じて去るだけで、誰も気づけない。
 * そこで、ブラウザが出した不具合の知らせを、サーバーの記録に残す。
 *
 * ・1回の表示で送るのは5件まで（同じ不具合がくり返し出ても送り続けない）
 * ・送るのは「どの画面で・何が」だけ。入力された内容やお名前は送らない
 * ・送れなくても何もしない（不具合の知らせで、さらに不具合を起こさない）
 */
(function () {
  var sent = 0;
  function report(message, where) {
    try {
      if (sent >= 5 || typeof API_URL === 'undefined') return;
      sent++;
      var page = (location.pathname || '/').split('/').pop() || 'index';
      fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'apiLogClientError',
          page: page,
          message: String(message || '').slice(0, 300) + (where ? ' @' + where : ''),
        }),
        keepalive: true,
      }).catch(function () {});
    } catch (e) {}
  }
  window.addEventListener('error', function (ev) {
    // よそのサイト（拡張機能など）の不具合は拾わない
    var file = String(ev.filename || '');
    if (file && file.indexOf(location.origin) !== 0) return;
    report(ev.message, (file.split('/').pop() || '') + ':' + (ev.lineno || ''));
  });
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev.reason;
    report('処理の途中で止まりました: ' + (r && r.message ? r.message : String(r)), '');
  });
})();
