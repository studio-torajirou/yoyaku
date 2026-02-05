// GASのウェブアプリURL
const API_URL = "https://script.google.com/macros/s/AKfycbyGvbEEBepD9gEZ6em0iYs9TrnauctUo67OjohW7BmVNR7ByaxdXaLvg1p6CilwXbo/exec";

/**
 * google.script.run の代わりになる通信関数
 */
async function gas(fnName, ...args) {
  // アクション名のマッピング
  const actionMap = {
    'apiGetInit': 'apiGetUserInit',           // 初期化
    'apiReserve': 'apiReserve',               // 予約
    'apiCancelReservation': 'apiCancelReservation', // キャンセル
    'apiSendContact': 'apiSendContact'        // お問い合わせ
  };

  let payload = { action: actionMap[fnName] || fnName };
  
  // 引数処理
  if (args.length > 0) {
    const arg = args[0];
    if (fnName === 'apiCancelReservation') {
      payload.id = arg;
    } else if (typeof arg === 'string') {
      try {
        const obj = JSON.parse(arg);
        payload = { ...payload, ...obj };
      } catch (e) {
        payload.data = arg;
      }
    } else if (typeof arg === 'object') {
      payload = { ...payload, ...arg };
    }
  }

  // 強制POST送信 (キャッシュ回避)
  const method = 'POST';
  let options = { 
    method: method,
    body: JSON.stringify(payload),
    headers: { "Content-Type": "text/plain;charset=utf-8" }
  };

  try {
    const response = await fetch(API_URL, options);
    const json = await response.json();
    return JSON.stringify(json);
  } catch (err) {
    console.error("API Error:", err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}