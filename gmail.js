// ブラウザから直接 Gmail API を呼ぶ（Google Identity Services のトークンモデル、読み取り専用）
// アクセストークンはメモリ上だけに持ち、保存しない（約1時間で失効 → 次の「更新」で再ログイン）
const Gmail = (() => {
  "use strict";
  const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
  const API = "https://gmail.googleapis.com/gmail/v1/users/me";
  const QUERY = 'subject:"Woven City Pay"'; // 件名が【Woven City Pay】で始まるかは parser.js で再確認
  const PARALLEL = 5;

  let client = null;
  let token = null;
  let expiresAt = 0;
  let pending = null;

  const configured = () => Boolean(window.CONFIG && CONFIG.GOOGLE_CLIENT_ID);

  function settle(fn, value) {
    const p = pending;
    pending = null;
    if (p) p[fn](value);
  }

  function init() {
    if (client) return true;
    if (!configured() || !(window.google && google.accounts && google.accounts.oauth2)) return false;
    client = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) return settle("reject", new Error("ログインできませんでした（" + resp.error + "）"));
        // 同意画面で Gmail の読み取りのチェックを外された場合
        if (!google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) {
          return settle("reject", new Error("Gmail の読み取りが許可されませんでした。もう一度ログインし、許可にチェックを入れてください"));
        }
        token = resp.access_token;
        expiresAt = Date.now() + Number(resp.expires_in || 3600) * 1000;
        settle("resolve", token);
      },
      error_callback: (err) => {
        const messages = {
          popup_closed: "ログインがキャンセルされました",
          popup_failed_to_open: "ログイン画面を開けませんでした。ポップアップのブロックを解除してください",
        };
        settle("reject", new Error(messages[err.type] || "ログインできませんでした（" + err.type + "）"));
      },
    });
    return true;
  }

  // ボタンのクリック処理の中で、await より前に呼ぶこと（ポップアップがブロックされないように）
  function authorize({ selectAccount = false, hint = "" } = {}) {
    if (token && Date.now() < expiresAt - 60_000 && !selectAccount) return Promise.resolve(token);
    if (!configured()) return Promise.reject(new Error("クライアント ID が設定されていません（config.js）"));
    if (!init()) return Promise.reject(new Error("Google のログイン部品を読み込めませんでした。通信状態を確認して再読み込みしてください"));
    if (pending) pending.reject(new Error("ログインがやり直されました"));
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      const opts = { prompt: selectAccount ? "select_account" : "" };
      if (hint && !selectAccount) opts.login_hint = hint;
      client.requestAccessToken(opts);
    });
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Gmail API の上限は 1ユーザー 15,000 単位/分（messages.get は 1回 5単位 ＝ 毎秒50回まで）。
  // 余裕を見てリクエストの開始間隔を空け、毎秒約16回（上限の約1/3）に抑える
  const MIN_INTERVAL = 60;
  let nextSlot = 0;
  async function throttle() {
    const now = Date.now();
    const wait = Math.max(0, nextSlot - now);
    nextSlot = Math.max(now, nextSlot) + MIN_INTERVAL;
    if (wait) await sleep(wait);
  }

  // 403 でも、利用量の上限（rateLimitExceeded / Quota exceeded）なら待てば回復する
  function isRateLimit(status, data) {
    if (status === 429) return true;
    if (status !== 403 || !data.error) return false;
    const reasons = (data.error.errors || []).map((e) => e.reason);
    return reasons.some((r) => /rateLimit|quota/i.test(r || "")) || /quota|rate limit/i.test(data.error.message || "");
  }

  let onWait = null; // 上限待ちのときに画面へ知らせる

  async function call(path, params = {}) {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
    for (let attempt = 0; ; attempt++) {
      if (!token) throw new Error("ログインしてください");
      await throttle();
      const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
      if (res.status === 401) {
        token = null;
        throw new Error("ログインの有効期限が切れました。もう一度「更新」を押してください");
      }
      if (res.ok) return res.json();
      const data = await res.json().catch(() => ({}));
      // 上限に達したら 1分の枠が空くまで待って再試行（最大4回）。サーバー側の一時的な不調も再試行
      if (isRateLimit(res.status, data) && attempt < 4) {
        const sec = Number(res.headers.get("Retry-After")) || 15 * (attempt + 1);
        nextSlot = Math.max(nextSlot, Date.now() + sec * 1000); // 他の並列処理もまとめて待たせる
        if (onWait) onWait(sec);
        await sleep(sec * 1000);
        continue;
      }
      if (res.status >= 500 && attempt < 3) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new Error(`Gmail の読み取りに失敗しました（${res.status}: ${(data.error && data.error.message) || res.statusText}）`);
    }
  }

  async function profileEmail() {
    return (await call("/profile")).emailAddress;
  }

  // knownIds にない「Woven City Pay」メールを取得して取引に変換する。
  // 途中で失敗したときは、それまでに読めた取引を err.partial に入れて投げる
  async function fetchNew(knownIds, onProgress, onWaiting) {
    onWait = onWaiting || null;
    try {
      return await fetchNewInner(knownIds, onProgress);
    } finally {
      onWait = null;
    }
  }

  async function fetchNewInner(knownIds, onProgress) {
    const ids = [];
    let pageToken;
    do {
      const r = await call("/messages", { q: QUERY, maxResults: 500, pageToken });
      for (const m of r.messages || []) ids.push(m.id);
      pageToken = r.nextPageToken;
    } while (pageToken);

    const todo = ids.filter((id) => !knownIds.has(id));
    const txs = [];
    let next = 0, done = 0, failure = null;
    const worker = async () => {
      while (!failure && next < todo.length) {
        const id = todo[next++];
        try {
          const msg = await call("/messages/" + encodeURIComponent(id), { format: "full" });
          // 取引として読めなかったメールは記録しない → 解析ルール改善後の「更新」で再度読む
          const tx = WCPParser.parseGmailMessage(msg);
          if (tx) txs.push(tx);
        } catch (e) {
          failure = failure || e;
          return;
        }
        if (onProgress) onProgress(++done, todo.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, worker));
    if (failure) {
      failure.partial = txs;
      throw failure;
    }
    return txs;
  }

  // アクセス権の取り消し（トークンがあるときのみ。なければ Google アカウントの画面から外してもらう）
  function revoke() {
    return new Promise((resolve) => {
      if (!token || !(window.google && google.accounts && google.accounts.oauth2)) return resolve(false);
      google.accounts.oauth2.revoke(token, () => resolve(true));
      token = null;
    });
  }

  return { configured, authorize, profileEmail, fetchNew, revoke };
})();
