// 端末内の保存（localStorage）。取引データは外部に送らない
// ?demo のときはメモリ上だけで扱い、実データには触れない
const Store = (() => {
  "use strict";
  const demo = new URLSearchParams(location.search).has("demo");
  const PREFIX = "wcp.";
  const KEYS = ["transactions", "account", "updatedAt", "storeGroups"];
  const mem = new Map();

  function get(key, fallback) {
    try {
      const raw = demo ? mem.get(key) : localStorage.getItem(PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  // 容量オーバー等の例外は呼び出し元に伝える（黙って失うと取り込み済みと誤解されるため）
  function set(key, value) {
    const raw = JSON.stringify(value);
    if (demo) mem.set(key, raw);
    else localStorage.setItem(PREFIX + key, raw);
  }

  function remove(key) {
    if (demo) mem.delete(key);
    else try { localStorage.removeItem(PREFIX + key); } catch { /* 保存領域が使えない */ }
  }

  function clearAll() { KEYS.forEach(remove); }

  // ブラウザが空き容量不足で消さないよう依頼（対応ブラウザのみ）
  if (!demo && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  return { demo, get, set, remove, clearAll };
})();
