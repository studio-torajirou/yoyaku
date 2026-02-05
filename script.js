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
    // ★追加: キャンセル待ちモードかどうかを管理
    isWaitlistMode: false 
  };

  document.addEventListener("DOMContentLoaded", () => {
    // URLパラメータからキャンセルIDを取得 (メールリンクからの遷移用)
    const params = new URLSearchParams(window.location.search);
    const cancelId = params.get('cancel_id');
    if(cancelId) {
       const el = document.getElementById("url-cancel-id");
       if(el) el.value = cancelId;
    }

    renderCalendar();

    // 初期データ取得
    gas("apiGetInit").then(jsonStr => {
      const data = JSON.parse(jsonStr);
      state.lessons = data.lessons || [];
      
      const logText = (data.success ? "OK" : "Err") + 
                    (data.debug ? ("/" + data.debug) : "") + 
                      (data.error ? ("/" + data.error) : "");
      const dbg = document.getElementById("debug-log");
      if(dbg) {
        dbg.textContent = logText;
        dbg.style.color = data.success ? "#bbb" : "red";
      }

      renderCalendar();
      
      // Studio Infoの遅延ロード用データ処理
      if(data.success && data.settings){
          window.torajiroSettings = data.settings;
          updateAboutInfo(data.settings);
      }

    }).catch(e => {
      const dbg = document.getElementById("debug-log");
      if(dbg) dbg.textContent = "Net Err: " + e;
    });

    // キャンセルモーダル初期表示（URLパラメータがある場合）
    const cidVal = document.getElementById("url-cancel-id") ? document.getElementById("url-cancel-id").value : "";
    if (cidVal) {
      const inp = document.getElementById("inp-cancel-id");
      if(inp) inp.value = cidVal;
      document.getElementById("cancel-modal").classList.add("open");
    }

    // --- イベントリスナー設定 ---

    // カレンダー操作
    document.getElementById("btn-prev").addEventListener("click", () => moveMonth(-1));
    document.getElementById("btn-next").addEventListener("click", () => moveMonth(1));
    
    // ドロワー・モーダル閉じる系
    document.getElementById("close-drawer").addEventListener("click", () => document.getElementById("detail-drawer").classList.remove("open"));
    
    const closeModalFunc = () => document.getElementById("modal-overlay").classList.remove("open");
    document.getElementById("btn-close-detail").addEventListener("click", closeModalFunc);
    
    // ステップ遷移
    document.getElementById("btn-to-form").addEventListener("click", () => switchStep("view-form"));
    document.getElementById("btn-back-detail").addEventListener("click", () => switchStep("view-detail"));
    
    document.getElementById("btn-to-confirm").addEventListener("click", validateAndToConfirm);
    
    document.getElementById("btn-back-form").addEventListener("click", () => switchStep("view-form"));
    
    const chkAgree = document.getElementById("chk-agree");
    if(chkAgree) {
      chkAgree.addEventListener("change", (e) => {
        const btn = document.getElementById("btn-finalize");
        if(btn) btn.disabled = !e.target.checked;
      });
    }

    // 予約確定実行
    document.getElementById("btn-finalize").addEventListener("click", finalizeBooking);

    // キャンセル機能
    document.getElementById("btn-open-cancel").addEventListener("click", () => document.getElementById("cancel-modal").classList.add("open"));
    document.getElementById("btn-close-cancel").addEventListener("click", () => document.getElementById("cancel-modal").classList.remove("open"));
    document.getElementById("btn-exec-cancel").addEventListener("click", execCancel);

    // メッセージモーダル
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

    // Aboutモーダル制御
    const btnAbout = document.getElementById("btn-open-about");
    if(btnAbout) {
      btnAbout.addEventListener("click", () => {
        document.getElementById("aboutModal").classList.add("open");
      });
    }
    const btnCloseAboutX = document.getElementById("btn-close-about-x");
    if(btnCloseAboutX) {
      btnCloseAboutX.addEventListener("click", () => {
        document.getElementById("aboutModal").classList.remove("open");
      });
    }
    const btnCloseAboutFt = document.getElementById("btn-close-about-ft");
    if(btnCloseAboutFt) {
      btnCloseAboutFt.addEventListener("click", () => {
        document.getElementById("aboutModal").classList.remove("open");
      });
    }
    
    setupExtensions();
  });

  // --- ヘルパー関数群 ---

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

  function renderCalendar() {
    const grid = document.getElementById("cal-grid");
    if(!grid) return;
    
    grid.innerHTML = "";
    const y = state.currYear;
    const m = state.currMonth;
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    document.getElementById("month-label").textContent = `${months[m]} ${y}`;
    
    const first = new Date(y, m, 1);
    const start = new Date(first);
    start.setDate(1 - start.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 41);

    let d = new Date(start);
    const todayStr = formatDate(new Date());
    
    while(d <= end) {
      const dateStr = formatDate(d);
      const isCurrMonth = d.getMonth() === m;
      const dayLessons = getLessons(dateStr);
      const cell = document.createElement("div");
      cell.className = `cell ${isCurrMonth?'':'dim'} ${dateStr===todayStr?'today':''}`;
      
      cell.onclick = () => openDrawer(dateStr);
      const num = document.createElement("div");
      num.className = "day-num";
      num.textContent = d.getDate();
      cell.appendChild(num);

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

          // 満席表示ロジック
          const isFull = (l.capacity > 0 && l.reserved >= l.capacity);
          
          if(isFull) {
            evt.classList.add('full');
          }

          // ★修正箇所: divタグで構造化し、inline styleで文字サイズを小さく調整
          const timeDisplay = isFull ? `(満)${l.startTime}` : l.startTime;
          
          evt.innerHTML = `
            <div style="font-size:11px; line-height:1.2;">${timeDisplay}</div>
            <div style="font-size:12px; font-weight:bold; line-height:1.2; margin:1px 0;">${l.className}</div>
            <div style="font-size:11px; line-height:1.2;">${l.teacherName}</div>
          `;

          cell.appendChild(evt);
       });
    }
      grid.appendChild(cell);
      d.setDate(d.getDate() + 1);
    }
  }

  // ★重要: ドロワーでのボタン出し分け（予約/キャンセル待ち/満席）
  function openDrawer(dateStr) {
    const drawer = document.getElementById("detail-drawer");
    const list = document.getElementById("detail-list");
    const d = new Date(dateStr);
    document.getElementById("selected-date-display").textContent = `${d.getMonth()+1}/${d.getDate()}`;

    const lessons = getLessons(dateStr);
    list.innerHTML = "";
    if(lessons.length === 0) {
      list.innerHTML = `<div style="text-align:center;padding:40px;color:#999;">No classes.</div>`;
    } else {
      lessons.forEach(l => {
        const item = document.createElement("div");
        item.className = "lesson-item";
        const barColor = (l.color && l.color !== '') ? l.color : '#ddd';
        
        // --- 判定ロジック ---
        const waitCount = l.waitlist || 0;
        // 定員と予約数を数値化して比較
        const cap = Number(l.capacity);
        const res = Number(l.reserved);
        const isFull = (cap > 0 && res >= cap);
        
        // 満席だが、キャンセル待ち枠(5名)に空きがあるか判定
        const isWaitlistAvail = isFull && (waitCount < 5);

        let btnText = '予約';
        let btnDisabled = '';
        let btnStyle = ''; 

        if(isFull) {
          if(isWaitlistAvail) {
             btnText = 'キャンセル待ち';
             // オレンジ系の色で注意を促す (インラインスタイルで既存デザインを上書き)
             btnStyle = 'border-color:#fbc02d; color:#f57f17; background:#fff;';
          } else {
             btnText = '満席';
             btnDisabled = 'disabled';
          }
        }
        // --- 判定ロジック終了 ---

        item.innerHTML = `
          <div class="li-time"><div>${l.startTime}</div><div style="font-size:11px;opacity:0.6;">${l.endTime}</div></div>
          <div class="li-bar" style="background:${barColor}"></div>
          <div class="li-info"><div class="li-title">${l.className}</div><div class="li-sub">${l.teacherName} / ${l.price}</div></div>
          <button class="li-btn" style="${btnStyle}" ${btnDisabled}>${btnText}</button>
        `;
        
        // 満席でない、またはキャンセル待ち可能な場合のみクリックイベントを設定
        if(!isFull || isWaitlistAvail) {
          // 第二引数でキャンセル待ちモードかどうかを渡す
          item.querySelector("button").onclick = () => openDetailModal(l, isWaitlistAvail);
        }
        list.appendChild(item);
      });
    }
    drawer.classList.add("open");
  }

  // ★重要: キャンセル待ちモードを受け取る
  function openDetailModal(lesson, isWaitlist = false) {
    state.selectedLesson = lesson;
    state.isWaitlistMode = isWaitlist; // 状態を保存

    // タイトルやボタンの文言切り替え
    const titlePrefix = isWaitlist ? "【キャンセル待ち】" : "";
    document.getElementById("detail-title").textContent = titlePrefix + lesson.className;
    
    document.getElementById("detail-date-time").textContent = `${lesson.date} ${lesson.startTime}-${lesson.endTime}`;
    document.getElementById("detail-price").textContent = lesson.price || '';
    document.getElementById("detail-desc-text").textContent = lesson.description || '詳細情報はありません。';
    
    // 詳細画面のボタン文言変更
    const btnNext = document.getElementById("btn-to-form");
    if(btnNext) {
       btnNext.textContent = isWaitlist ? "キャンセル待ちへ進む" : "予約を進める";
    }

    switchStep("view-detail");
    document.getElementById("modal-overlay").classList.add("open");
  }

  function switchStep(stepId) {
    ["view-detail", "view-form", "view-confirm"].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.classList.add("hidden");
    });
    const target = document.getElementById(stepId);
    if(target) target.classList.remove("hidden");
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
    if(!isValid) { 
      showMsg("入力エラー", "赤枠の必須項目を入力してください。"); 
      return;
    }

    state.bookingData = { name: name.value, phone: phone.value, email: email.value };
    
    // ★重要: 確認リストに申込タイプ（通常/キャンセル待ち）を表示
    const list = document.getElementById("confirm-list");
    const typeLabel = state.isWaitlistMode ? 
      '<span style="color:#f57f17; font-weight:bold;">キャンセル待ち</span>' : '通常予約';

    list.innerHTML = `
      <li><strong>申込タイプ:</strong> ${typeLabel}</li>
      <li><strong>レッスン:</strong> ${state.selectedLesson.className}</li>
      <li><strong>日時:</strong> ${state.selectedLesson.date} ${state.selectedLesson.startTime}</li>
      <li><strong>お名前:</strong> ${state.bookingData.name}</li>
      <li><strong>Email:</strong> ${state.bookingData.email}</li>
    `;

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
      // ボタン文言も変更
      btnFinal.textContent = state.isWaitlistMode ? "キャンセル待ちを確定" : "予約を確定する";
      btnFinal.disabled = true;
    }

    switchStep("view-confirm");
  }

  // ★重要: 完了メッセージの分岐処理
  function finalizeBooking() {
    const btn = document.getElementById("btn-finalize");
    btn.textContent = "処理中...";
    btn.disabled = true;
    
    const payload = {
      slotId: state.selectedLesson.slotId,
      lessonName: state.selectedLesson.className,
      lessonDate: `${state.selectedLesson.date} ${state.selectedLesson.startTime}`,
      ...state.bookingData
    };

    gas("apiReserve", JSON.stringify(payload)).then(json => {
      const res = JSON.parse(json);
      if(res.success) {
        document.getElementById("modal-overlay").classList.remove("open");
        
        // レスポンスの isWaitlist フラグを見てメッセージを切り替え
        if(res.isWaitlist) {
            showMsg("受付完了", `キャンセル待ちを受け付けました。\n\n空きが出次第、自動で予約が確定しメールでお知らせします。\n(レッスン開始24時間前まで有効)`, true);
        } else {
            showMsg("予約完了", `予約が確定しました！\n\n予約ID: ${res.bookingId}\n\n詳細メールを送信しました。ご確認をお願いします。`, true);
        }

      } else {
        showMsg("予約エラー", res.error);
        // エラー時はボタンを元の状態に戻す
        btn.textContent = state.isWaitlistMode ? "キャンセル待ちを確定" : "予約を確定する";
        btn.disabled = false;
      }
    });
  }

  function execCancel() {
    const id = document.getElementById("inp-cancel-id").value;
    if(!id) {
       showMsg("入力エラー", "予約IDを入力してください");
       return;
    }
    const btn = document.getElementById("btn-exec-cancel");
    btn.disabled = true; btn.textContent = "処理中...";
    
    gas("apiCancelReservation", id).then(json => {
      const res = JSON.parse(json);
      document.getElementById("cancel-modal").classList.remove("open");
      btn.disabled = false; btn.textContent = "キャンセル実行";
      
      if(res.success) {
        showMsg("キャンセル完了", "予約をキャンセルしました。", true);
      } else {
        showMsg("エラー", "キャンセルに失敗しました。\nIDが正しいか確認してください。");
      }
    });
  }

  function showMsg(title, body, redirectUrl = null) {
    document.getElementById("msg-title").textContent = title;
    document.getElementById("msg-body").innerText = body;
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
    // Contact Form
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
        if(cm) cm.classList.add('open');
      }
    });

    const contactModal = document.getElementById('contactModal');
    if(contactModal){
      const btnClose = document.getElementById('btn-close-contact');
      if(btnClose) btnClose.addEventListener('click', () => contactModal.classList.remove('open'));
      contactModal.addEventListener('click', (e) => {
        if(e.target === contactModal) contactModal.classList.remove('open');
      });
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
          alert("必須項目（お名前・メール・ご用件・内容）を入力してください。");
          return;
        }

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
            contactModal.classList.remove('open');
            document.getElementById('contact-body').value = "";
            document.getElementById('contact-subject').value = "";
            if(successModal) successModal.classList.add('open');
          } else {
            alert("送信に失敗しました。\n" + (result.error || ""));
          }
        }).catch(() => {
          btnSendContact.disabled = false;
          btnSendContact.textContent = "送信する";
          alert("通信エラーが発生しました。");
        });
      });
    }

    const aboutModal = document.getElementById('aboutModal');
    if(aboutModal){
      aboutModal.addEventListener('click', function(e){
        if(e.target === aboutModal){
          aboutModal.classList.remove('open');
        }
      });
    }
    
    const cancelModal = document.getElementById('cancel-modal');
    if(cancelModal){
      cancelModal.addEventListener('click', function(e){
        if(e.target === cancelModal){
          cancelModal.classList.remove('open');
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
      const today = new Date();
      today.setHours(0,0,0,0);

      const monthLabel = document.getElementById('month-label');
      if(!monthLabel) return;
      const monthText = monthLabel.textContent.trim(); 
      const parts = monthText.split(' ');
      if(parts.length < 2) return;
      
      const monthName = parts[0];
      const yearStr = parts[1];
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const monthIndex = months.indexOf(monthName);
      if(monthIndex === -1) return;

      const cells = document.querySelectorAll('.cell');
      cells.forEach(cell => {
        const dayNumEl = cell.querySelector('.day-num');
        if(!dayNumEl) return;
        const day = parseInt(dayNumEl.textContent, 10);
        if(isNaN(day)) return;
        if(cell.classList.contains('dim')) return;

        const cellDate = new Date(parseInt(yearStr), monthIndex, day);
        if(cellDate < today) {
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
  } // setupExtensions
})();