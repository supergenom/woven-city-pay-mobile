// 「【Woven City Pay】」メールの解析（../WovenCityPay/server.py の parse_message 等を移植）
// ブラウザでは window.WCPParser、Node（テスト）では module.exports で使う
(function (root) {
  "use strict";

  const SUBJECT_PREFIX = "【Woven City Pay】";

  // ---------------------------------------------------------------- body extraction (Gmail API)
  function base64UrlToBytes(data) {
    const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function decodeBytes(bytes, charset) {
    try {
      return new TextDecoder(charset || "utf-8").decode(bytes);
    } catch {
      return new TextDecoder("utf-8").decode(bytes); // 未知の文字コード
    }
  }

  function header(part, name) {
    const h = (part.headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
    return h ? h.value : "";
  }

  // RFC 2047（=?UTF-8?B?...?=）が残っていた場合の復号。Gmail API は通常復号済みの件名を返す
  function decodeHeader(value) {
    if (!value || !value.includes("=?")) return value || "";
    return value
      .replace(/(\?=)\s+(=\?)/g, "$1$2")
      .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (all, charset, enc, text) => {
        let bytes;
        if (enc.toUpperCase() === "B") {
          bytes = base64UrlToBytes(text.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
        } else {
          const s = text.replace(/_/g, " ");
          const arr = [];
          for (let i = 0; i < s.length; i++) {
            if (s[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
              arr.push(parseInt(s.slice(i + 1, i + 3), 16));
              i += 2;
            } else arr.push(s.charCodeAt(i));
          }
          bytes = new Uint8Array(arr);
        }
        return decodeBytes(bytes, charset);
      });
  }

  // Gmail API（format=full）の payload から本文を取り出す。text/plain を優先し、なければ HTML をテキスト化
  function extractBody(payload) {
    let plain = null, html = null;
    const walk = (part) => {
      const type = (part.mimeType || "").toLowerCase();
      if (type.startsWith("multipart/")) {
        (part.parts || []).forEach(walk);
        return;
      }
      if (part.filename || /^attachment/i.test(header(part, "Content-Disposition"))) return;
      if (!part.body || !part.body.data) return;
      const charset = (/charset\s*=\s*"?([^";\s]+)/i.exec(header(part, "Content-Type")) || [])[1];
      const text = decodeBytes(base64UrlToBytes(part.body.data), charset);
      if (type === "text/plain" && plain === null) plain = text;
      else if (type === "text/html" && html === null) html = text;
    };
    walk(payload);
    if (plain && plain.trim()) return plain;
    if (html) return htmlToText(html);
    return "";
  }

  const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", yen: "¥" };
  function htmlUnescape(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : all;
      }
      return ENTITIES[e.toLowerCase()] ?? all;
    });
  }

  function htmlToText(raw) {
    raw = raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
    raw = raw.replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table)>/gi, "\n");
    raw = raw.replace(/<\/t[dh]>/gi, "\t");
    raw = raw.replace(/<[^>]+>/g, "");
    return htmlUnescape(raw);
  }

  // ---------------------------------------------------------------- parsing
  function normalize(text) {
    // NFKC: 全角の数字・コロン・円記号 → 半角
    text = text.normalize("NFKC").replace(/\r\n?/g, "\n");
    return text.split("\n")
      .map((ln) => ln.replace(/[ \t　]+/g, " ").trim())
      .filter((ln) => ln)
      .join("\n");
  }

  const SEP = String.raw`\s*[:：]?\s*`;
  const DT_RE = new RegExp(
    String.raw`(\d{4})\s*[/年.-]\s*(\d{1,2})\s*[/月.-]\s*(\d{1,2})\s*日?` +
    String.raw`(?:\s*\([^)]*\))?\s*(?:(\d{1,2})\s*[:時]\s*(\d{2})(?:\s*[:分]\s*(\d{2}))?)?`
  );
  const DT_LABEL_RE = new RegExp("(?:取引日時|利用日時|決済日時|支払日時|お支払い日時|チャージ日時|日時)" + SEP);
  const STORE_RE = new RegExp(
    "(?:ストア名|店舗名|加盟店名|利用店舗|ご利用店舗|お店|ストア|店舗|加盟店|支払先)" + SEP + String.raw`([^\n\t]+)`
  );
  const AMOUNT_LABEL = "(?:利用金額|ご利用金額|支払金額|お支払い金額|お支払金額|支払い金額|決済金額|" +
    "チャージ金額|チャージ額|金額)";
  const AMOUNT_RE = new RegExp(AMOUNT_LABEL + SEP + String.raw`[¥\\]?\s*(-?[\d,]+)\s*円?`);
  const YEN_RE = /[¥\\]\s*([\d,]+)|([\d,]+)\s*円/;

  const pad = (n) => String(n).padStart(2, "0");
  function isoLocal(y, mo, d, h, mi, s) {
    return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}`;
  }

  // 本文中の日時を "YYYY-MM-DDTHH:MM:SS"（ローカル時刻）で返す。見つからなければ fallback
  function parseDatetime(text, fallback) {
    const m = DT_LABEL_RE.exec(text);
    const candidates = m ? [text.slice(m.index + m[0].length), text] : [text];
    for (const chunk of candidates) {
      const d = DT_RE.exec(chunk);
      if (!d) continue;
      const [y, mo, da, h, mi, s] = d.slice(1).map((v) => parseInt(v || "0", 10));
      const dt = new Date(y, mo - 1, da, h, mi, s);
      // 存在しない日付（2月30日など）は採用しない
      if (dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === da && h < 24 && mi < 60 && s < 60) {
        return isoLocal(y, mo, da, h, mi, s);
      }
    }
    return fallback;
  }

  function parseAmount(text) {
    let m = AMOUNT_RE.exec(text);
    if (m) return Math.abs(parseInt(m[1].replace(/,/g, ""), 10));
    m = YEN_RE.exec(text);
    if (m) return parseInt((m[1] || m[2]).replace(/,/g, ""), 10);
    return null;
  }

  function parseStore(text) {
    const m = STORE_RE.exec(text);
    return m ? m[1].trim() : "";
  }

  function classify(subject) {
    if (subject.includes("チャージ")) return "charge";
    // 「ご利用のお知らせ」も本文は支払い完了と同じ書式（旧形式の件名）
    if (["支払", "決済", "購入", "ご利用"].some((w) => subject.includes(w))) return "payment";
    return null;
  }

  function dateToIso(d) {
    return isoLocal(d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
  }

  // Gmail API のメッセージ（format=full）→ 取引。取り込まないメール・読めないメールは null
  function parseGmailMessage(msg) {
    const subject = decodeHeader(header(msg.payload || {}, "Subject"));
    if (!subject.trim().startsWith(SUBJECT_PREFIX)) return null;
    const type = classify(subject);
    if (type === null) return null;
    const body = normalize(extractBody(msg.payload));
    const amount = parseAmount(body);
    if (amount === null) return null;
    const fallback = dateToIso(msg.internalDate ? new Date(Number(msg.internalDate)) : new Date());
    return {
      id: msg.id,
      type,
      datetime: parseDatetime(body, fallback),
      amount,
      store: type === "payment" ? parseStore(body) : "",
      subject,
    };
  }

  const api = {
    SUBJECT_PREFIX, base64UrlToBytes, decodeHeader, extractBody, htmlToText, normalize,
    parseDatetime, parseAmount, parseStore, classify, parseGmailMessage,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WCPParser = api;
})(typeof self !== "undefined" ? self : this);
