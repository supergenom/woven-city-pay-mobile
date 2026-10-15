"use strict";

const APP_VERSION = "0.1.0";

// ---------------------------------------------------------------- state
const state = {
  txs: [],                 // {id, type: "payment"|"charge", datetime, amount, store, store_raw, date}
  storeColors: new Map(),
  calMonth: startOfMonth(new Date()),
  listMode: "all",         // "all" | "month" | "week" | "store"
  listMonth: startOfMonth(new Date()),
  listWeek: startOfWeek(new Date()),
  expandedStores: new Set(), // ストア別で展開中のストア名
};

// 黒背景で見分けやすい色。店舗は初出順に割り当て（新しい店舗が増えても既存の色は変わらない）
const PALETTE = [
  "#4fc3f7", "#ffb74d", "#81c784", "#f06292", "#ba68c8", "#fff176",
  "#4db6ac", "#ff8a65", "#9fa8da", "#aed581", "#e57373", "#90a4ae",
];

const $ = (id) => document.getElementById(id);
const yen = (n) => "¥" + n.toLocaleString("ja-JP");
const pad = (n) => String(n).padStart(2, "0");

// ---------------------------------------------------------------- dates
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday start
  return x;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
function dayKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseDT(s) { return new Date(s); }
function isoNow() {
  const d = new Date();
  return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function fmtDT(d) {
  const w = "日月火水木金土"[d.getDay()];
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}(${w}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtDate(d) { return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`; }

// ---------------------------------------------------------------- data
// ステータスは「見出し」と「日時など」の2行で表示
function setStatus(line1, line2 = "") {
  const status = $("status");
  status.replaceChildren();
  for (const text of [line1, line2]) {
    if (!text) continue;
    const div = document.createElement("div");
    div.textContent = text;
    status.append(div);
  }
}

function showLastFetched(head = "") {
  const updated = Store.get("updatedAt");
  head = (Store.demo ? "[デモ] " : "") + head;
  if (updated) setStatus(head + "最終取得", fmtDT(parseDT(updated)));
  else setStatus(head + "未取得", "（更新を押してください）");
}

// {元のストア名: まとめた名前}
function storeMap() {
  const map = new Map();
  for (const g of Store.get("storeGroups", [])) for (const m of g.members) map.set(m, g.name);
  return map;
}

// 保存済みの取引を読み込み、ストア名のまとめを適用して表示用にする
function loadTransactions() {
  const map = storeMap();
  state.txs = Store.get("transactions", [])
    .map((t) => ({ ...t, store_raw: t.store, store: map.get(t.store) ?? t.store, date: parseDT(t.datetime) }))
    .sort((a, b) => a.date - b.date);
  state.storeColors = new Map();
  for (const t of state.txs) {
    if (t.type !== "payment") continue;
    const name = t.store || "(不明)";
    if (!state.storeColors.has(name)) {
      const i = state.storeColors.size;
      state.storeColors.set(name, i < PALETTE.length ? PALETTE[i] : `hsl(${(i * 137.5) % 360} 70% 65%)`);
    }
  }
}

function saveTransactions(list) {
  Store.set("transactions", [...list].sort((a, b) => a.datetime.localeCompare(b.datetime)));
}

// Gmail から新しいメールを取り込む。ボタンのクリック処理から直接呼ぶこと（ログインのポップアップのため）
async function refresh({ selectAccount = false, msgEl = null } = {}) {
  if (Store.demo) {
    showLastFetched("新規 0 件・");
    return 0;
  }
  // await より前にログインを開始する（ポップアップがブロックされないように）
  const auth = Gmail.authorize({ selectAccount, hint: Store.get("account", "") });
  const say = (a, b = "") => {
    setStatus(a, b);
    if (msgEl) msgEl.textContent = b ? `${a} ${b}` : a;
  };
  const buttons = [$("refreshBtn"), $("loginBtn")];
  buttons.forEach((b) => (b.disabled = true));
  try {
    say("Google にログイン中…");
    await auth;
    say("Gmail から取得中…");
    const email = await Gmail.profileEmail();
    const prev = Store.get("account");
    if (prev && prev !== email) {
      // 別アカウントに切り替えたら、前のアカウントの取引データは消す
      Store.remove("transactions");
      Store.remove("updatedAt");
    }
    Store.set("account", email);

    const saved = Store.get("transactions", []);
    let added = [], error = null;
    try {
      added = await Gmail.fetchNew(new Set(saved.map((t) => t.id)),
        (done, total) => say("Gmail から取得中…", `${done} / ${total} 通`));
    } catch (e) {
      added = e.partial || [];
      error = e;
    }
    // 途中で失敗しても、読めた分は保存する（次回はその続きから）
    saveTransactions(saved.concat(added));
    if (error) throw error;
    Store.set("updatedAt", isoNow());
    showLastFetched(`新規 ${added.length} 件・`);
    if (msgEl) msgEl.textContent = `取り込みが完了しました（新規 ${added.length} 件）`;
    return added.length;
  } catch (e) {
    const message = e.name === "QuotaExceededError" ? "スマホの保存領域が不足しています" : e.message;
    setStatus("エラー", message);
    if (msgEl) msgEl.textContent = "エラー: " + message;
    return null;
  } finally {
    buttons.forEach((b) => (b.disabled = false));
    loadTransactions();
    render();
  }
}

function storeColor(t) { return state.storeColors.get(t.store || "(不明)") || "#fff"; }

function inRange(from, to) {
  return state.txs.filter((t) => t.date >= from && t.date < to);
}

function totals(txs) {
  let pay = 0, charge = 0;
  for (const t of txs) t.type === "payment" ? (pay += t.amount) : (charge += t.amount);
  return `<span>支払合計 <b>${yen(pay)}</b></span><span>チャージ合計 <b>${yen(charge)}</b></span>`;
}

// ---------------------------------------------------------------- amount elements
function amountEl(t) {
  if (t.type === "charge") {
    const s = document.createElement("span");
    s.className = "amt charge";
    s.textContent = "+" + yen(t.amount);
    s.title = "チャージ " + fmtDT(t.date);
    return s;
  }
  const b = document.createElement("button");
  b.type = "button";
  b.className = "amt";
  b.style.color = storeColor(t);
  b.textContent = yen(t.amount);
  b.title = t.store;
  b.addEventListener("click", () => openDetail(t));
  return b;
}

function openDetail(t) {
  $("dDate").textContent = fmtDT(t.date);
  $("dStore").textContent = t.store || "(不明)";
  $("dAmount").textContent = yen(t.amount);
  $("dAmount").style.color = storeColor(t);
  $("detail").style.setProperty("--store", storeColor(t));
  $("detail").showModal();
}

// ---------------------------------------------------------------- calendar
function renderCalendar() {
  const m = state.calMonth;
  $("calLabel").textContent = `${m.getFullYear()}年 ${m.getMonth() + 1}月`;
  $("calSummary").innerHTML = totals(inRange(m, addMonths(m, 1)));

  const byDay = new Map();
  for (const t of state.txs) {
    const k = dayKey(t.date);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(t);
  }

  const grid = $("calGrid");
  grid.replaceChildren();
  const first = startOfWeek(m);
  const last = addDays(startOfWeek(addDays(addMonths(m, 1), -1)), 7);
  const todayKey = dayKey(new Date());
  for (let d = first; d < last; d = addDays(d, 1)) {
    const cell = document.createElement("div");
    cell.className = "day";
    if (d.getMonth() !== m.getMonth()) cell.classList.add("out");
    if (d.getDay() === 6) cell.classList.add("sat");
    if (d.getDay() === 0) cell.classList.add("sun");
    if (dayKey(d) === todayKey) cell.classList.add("today");
    const num = document.createElement("div");
    num.className = "num";
    num.textContent = d.getDate();
    cell.append(num);
    // 支払い → チャージ の順に表示
    const items = byDay.get(dayKey(d)) || [];
    for (const t of items.filter((t) => t.type === "payment")) cell.append(amountEl(t));
    for (const t of items.filter((t) => t.type === "charge")) cell.append(amountEl(t));
    grid.append(cell);
  }

  const legend = $("legend");
  legend.replaceChildren();
  for (const [name, color] of state.storeColors) {
    const s = document.createElement("span");
    s.innerHTML = `<i style="background:${color}"></i>`;
    s.append(name);
    legend.append(s);
  }
  const ck = document.createElement("span");
  ck.innerHTML = `<span class="charge charge-key">+¥</span> チャージ`;
  legend.append(ck);
}

// ---------------------------------------------------------------- list
function listRange() {
  if (state.listMode === "month") {
    const m = state.listMonth;
    return { from: m, to: addMonths(m, 1), label: `${m.getFullYear()}年 ${m.getMonth() + 1}月` };
  }
  if (state.listMode === "week") {
    const w = state.listWeek;
    const end = addDays(w, 6);
    return { from: w, to: addDays(w, 7), label: `${fmtDate(w)} – ${fmtDate(end).slice(5)}` };
  }
  return { from: new Date(0), to: new Date(8.64e15), label: state.listMode === "store" ? "ストア別（全期間）" : "全期間" };
}

// 見出し行。total を渡すと右端に合計額を表示
function groupRow(label, { color, total, count } = {}) {
  const g = document.createElement("tr");
  g.className = "group";
  const td = document.createElement("td");
  td.colSpan = 4;
  // 名前と合計を1つのセル内で左右に配置（スマホで列が減っても合計が見える）
  const line = document.createElement("div");
  line.className = "group-line";
  const name = document.createElement("span");
  if (color) name.innerHTML = `<span class="swatch" style="background:${color}"></span>`;
  name.append(label);
  if (count !== undefined) {
    const c = document.createElement("span");
    c.className = "count";
    c.textContent = `${count}件`;
    name.append(c);
  }
  line.append(name);
  if (total !== undefined) {
    const t = document.createElement("span");
    t.className = "total";
    t.textContent = "合計 " + yen(total);
    if (color) t.style.color = color;
    line.append(t);
  }
  td.append(line);
  g.append(td);
  return g;
}

// ストア別：合計額の大きい順にストアを並べ、最後にチャージ
function storeGroups(txs) {
  const groups = new Map();
  for (const t of txs.filter((t) => t.type === "payment")) {
    const name = t.store || "(不明)";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(t);
  }
  const sum = (list) => list.reduce((s, t) => s + t.amount, 0);
  const result = [...groups].map(([name, list]) => ({ label: name, color: storeColor(list[0]), list, total: sum(list) }))
    .sort((a, b) => b.total - a.total);
  const charges = txs.filter((t) => t.type === "charge");
  if (charges.length) result.push({ label: "チャージ", list: charges, total: sum(charges) });
  return result;
}

function renderList() {
  const { from, to, label } = listRange();
  const showArrows = state.listMode === "month" || state.listMode === "week";
  $("listPrev").hidden = !showArrows;
  $("listNext").hidden = !showArrows;
  $("listLabel").textContent = label;

  const txs = inRange(from, to);
  $("listSummary").innerHTML = totals(txs);
  $("listEmpty").hidden = txs.length > 0;

  const body = $("listBody");
  body.replaceChildren();
  if (state.listMode === "store") {
    // 初期表示はストア名・件数・合計のみ。見出し行のクリック（タップ）で明細を展開／収縮
    for (const g of storeGroups(txs)) {
      const head = groupRow(g.label, { color: g.color, total: g.total, count: g.list.length });
      const rows = g.list.map(txRow);
      const setOpen = (open) => {
        head.classList.toggle("open", open);
        head.setAttribute("aria-expanded", String(open));
        rows.forEach((r) => (r.hidden = !open));
      };
      head.classList.add("toggle");
      head.tabIndex = 0;
      head.addEventListener("click", () => {
        const open = !state.expandedStores.has(g.label);
        open ? state.expandedStores.add(g.label) : state.expandedStores.delete(g.label);
        setOpen(open);
      });
      head.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); head.click(); }
      });
      setOpen(state.expandedStores.has(g.label));
      body.append(head, ...rows);
    }
    return;
  }
  let lastMonth = null;
  for (const t of txs) {
    // 全表示では月ごとに見出し行を入れる
    if (state.listMode === "all") {
      const mk = `${t.date.getFullYear()}年 ${t.date.getMonth() + 1}月`;
      if (mk !== lastMonth) {
        lastMonth = mk;
        body.append(groupRow(mk));
      }
    }
    body.append(txRow(t));
  }
}

function txRow(t) {
  const tr = document.createElement("tr");
  const tdDate = document.createElement("td");
  tdDate.textContent = fmtDT(t.date);
  const tdType = document.createElement("td");
  tdType.textContent = t.type === "payment" ? "支払い" : "チャージ";
  const tdStore = document.createElement("td");
  if (t.type === "payment") {
    tdStore.innerHTML = `<span class="swatch" style="background:${storeColor(t)}"></span>`;
    tdStore.append(t.store || "(不明)");
  }
  const tdAmt = document.createElement("td");
  tdAmt.className = "num";
  tdAmt.append(amountEl(t));
  tr.append(tdDate, tdType, tdStore, tdAmt);
  return tr;
}

// ---------------------------------------------------------------- view switching
function render() {
  if (!$("calendarView").hidden) renderCalendar();
  if (!$("listView").hidden) renderList();
  const listing = !$("listView").hidden;
  document.querySelectorAll("#listMenu button").forEach((b) =>
    b.classList.toggle("active", listing && b.dataset.mode === state.listMode));
}

function showList(mode) {
  state.listMode = mode;
  // 月・週表示はカレンダーで見ていた月から開始
  state.listMonth = state.calMonth;
  const now = new Date();
  state.listWeek = startOfWeek(
    now.getFullYear() === state.calMonth.getFullYear() && now.getMonth() === state.calMonth.getMonth()
      ? now : state.calMonth);
  showView("listView");
}

function showCalendar() {
  if (!$("listView").hidden) {
    if (state.listMode === "month") state.calMonth = state.listMonth;
    if (state.listMode === "week") state.calMonth = startOfMonth(state.listWeek);
  }
  showView("calendarView");
}

function showView(id) {
  for (const v of ["calendarView", "listView", "settingsView"]) $(v).hidden = v !== id;
  window.scrollTo(0, 0);
  render();
}

function stepList(dir) {
  if (state.listMode === "month") state.listMonth = addMonths(state.listMonth, dir);
  if (state.listMode === "week") state.listWeek = addDays(state.listWeek, 7 * dir);
  render();
}

// ---------------------------------------------------------------- settings
const isSetUp = () => Store.demo || Boolean(Store.get("account"));

// 初回（未ログイン）は設定画面だけを表示し、他のボタンは隠す
function applySetupMode() {
  const setup = !isSetUp();
  $("actions").hidden = setup;
  $("settingsBtn").hidden = setup;
  $("setupIntro").hidden = !setup;
  $("settingsBack").hidden = setup;
  $("logoutCard").hidden = setup || Store.demo;
}

function showSettings() {
  const account = Store.get("account");
  $("accountState").textContent = Store.demo ? "デモ表示中です（Gmail には接続しません）"
    : account ? `ログイン中のアカウント: ${account}` : "まだログインしていません";
  $("loginBtn").textContent = account ? "別の Google アカウントに切り替える" : "Google でログインしてメールを取り込む";
  $("loginBtn").hidden = Store.demo;
  $("noClientId").hidden = Store.demo || Gmail.configured();
  $("accountMsg").textContent = "";
  $("groupMsg").textContent = "";
  $("appVersion").textContent = "v" + APP_VERSION;
  renderGroups();
  applySetupMode();
  showView("settingsView");
}

// 元のストア名ごとの件数（まとめる前の名前）
function rawStores() {
  const counts = new Map();
  for (const t of state.txs) {
    if (t.type === "payment" && t.store_raw) counts.set(t.store_raw, (counts.get(t.store_raw) || 0) + 1);
  }
  return [...counts].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
}

function renderGroups() {
  const groups = Store.get("storeGroups", []);
  const stores = rawStores();
  $("groupCard").hidden = stores.length === 0;
  const list = $("groupList");
  list.replaceChildren();
  groups.forEach((g, i) => {
    const li = document.createElement("li");
    const text = document.createElement("span");
    const b = document.createElement("b");
    b.textContent = g.name;
    text.append(b, " ← " + g.members.join("、"));
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn small";
    del.textContent = "解除";
    del.addEventListener("click", () => saveGroups(groups.filter((_, j) => j !== i)));
    li.append(text, del);
    list.append(li);
  });
  if (!groups.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "まとめはまだありません";
    list.append(li);
  }
  // まだどのまとめにも入っていないストアだけを選択肢にする
  const grouped = new Set(groups.flatMap((g) => g.members));
  const box = $("storeChecks");
  box.replaceChildren();
  for (const st of stores.filter((st) => !grouped.has(st.name))) {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = st.name;
    label.append(cb, ` ${st.name} `);
    const n = document.createElement("span");
    n.className = "count";
    n.textContent = `${st.count}件`;
    label.append(n);
    box.append(label);
  }
}

function saveGroups(groups) {
  // 名前が空・メンバーなし・重複したメンバーは除く
  const used = new Set();
  const clean = [];
  for (const g of groups) {
    const name = String(g.name || "").trim();
    const members = g.members.map(String).filter((m) => !used.has(m));
    if (!name || !members.length) continue;
    members.forEach((m) => used.add(m));
    clean.push({ name, members });
  }
  try {
    Store.set("storeGroups", clean);
    $("groupMsg").textContent = "保存しました";
  } catch (e) {
    $("groupMsg").textContent = "エラー: " + e.message;
  }
  loadTransactions();
  renderGroups();
}

$("groupForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("groupName").value.trim();
  const members = [...$("storeChecks").querySelectorAll("input:checked")].map((cb) => cb.value);
  if (!members.length) { $("groupMsg").textContent = "まとめるストアを選択してください"; return; }
  // 同じ名前のまとめがあれば、そこに追加する
  const groups = Store.get("storeGroups", []);
  const same = groups.find((g) => g.name === name);
  if (same) same.members.push(...members);
  else groups.push({ name, members });
  $("groupName").value = "";
  saveGroups(groups);
});

$("loginBtn").addEventListener("click", async () => {
  const wasSetup = !isSetUp();
  const count = await refresh({ selectAccount: !wasSetup, msgEl: $("accountMsg") });
  if (wasSetup && isSetUp()) applySetupMode(); // ログインはできたが取り込みが途中で失敗した場合も、画面は使えるようにする
  if (count === null) return;
  if (wasSetup) {
    applySetupMode();
    showCalendar();
  } else {
    $("accountState").textContent = `ログイン中のアカウント: ${Store.get("account")}`;
    renderGroups();
  }
});

$("logoutBtn").addEventListener("click", async () => {
  if (!confirm("ログアウトして、このスマホに保存した取引データと設定をすべて消去しますか？")) return;
  const revoked = await Gmail.revoke();
  Store.clearAll();
  if (!revoked) {
    alert("データを消去しました。Gmail へのアクセス許可は、Google アカウントの「サードパーティ製のアプリとサービス」から削除できます。");
  }
  location.reload();
});

// ---------------------------------------------------------------- CSV
function exportCSV() {
  const esc = (v) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const rows = [["支払いorチャージ", "日付", "金額", "ストア名"]];
  for (const t of state.txs) {
    rows.push([
      t.type === "payment" ? "支払い" : "チャージ",
      fmtDate(t.date),
      String(t.amount),
      t.type === "payment" ? (t.store || "") : "",
    ]);
  }
  const csv = "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n"; // BOM: Excelで文字化けしない
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `woven_city_pay_${dayKey(new Date()).replace(/-/g, "")}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- demo data
// ../WovenCityPay/server.py の demo_cache() と同じ考え方のサンプル
function demoTransactions() {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const stores = ["Woven Cafe", "City Market", "Mobility Station", "Bakery Kakehashi", "Book Lounge", "Weave Kitchen"];
  const iso = (d) => `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  const txs = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let i = 0;
  for (let day = addDays(today, -120); day <= today; day = addDays(day, 1)) {
    if (day.getDate() === 1 || day.getDate() === 15) {
      const d = new Date(day); d.setHours(9);
      txs.push({ id: `demo-${i++}`, type: "charge", amount: pick([3000, 5000, 10000]), datetime: iso(d), store: "", subject: "demo" });
    }
    for (let n = pick([0, 0, 1, 1, 2, 3]); n > 0; n--) {
      const d = new Date(day); d.setHours(8 + Math.floor(rnd() * 13), Math.floor(rnd() * 60));
      txs.push({ id: `demo-${i++}`, type: "payment", amount: 200 + Math.floor(rnd() * 280) * 10,
                 datetime: iso(d), store: pick(stores), subject: "demo" });
    }
  }
  return txs;
}

// ---------------------------------------------------------------- events
function toggleMenu(open) {
  const menu = $("listMenu");
  menu.hidden = !(open ?? menu.hidden);
  $("listBtn").setAttribute("aria-expanded", String(!menu.hidden));
}

$("calPrev").addEventListener("click", () => { state.calMonth = addMonths(state.calMonth, -1); render(); });
$("calNext").addEventListener("click", () => { state.calMonth = addMonths(state.calMonth, 1); render(); });
$("listPrev").addEventListener("click", () => stepList(-1));
$("listNext").addEventListener("click", () => stepList(1));
document.querySelectorAll(".back-btn").forEach((b) => b.addEventListener("click", showCalendar));
$("refreshBtn").addEventListener("click", () => refresh());
$("csvBtn").addEventListener("click", exportCSV);
$("listBtn").addEventListener("click", (e) => { e.stopPropagation(); toggleMenu(); });
$("listMenu").addEventListener("click", (e) => {
  const mode = e.target.dataset.mode;
  if (!mode) return;
  toggleMenu(false);
  showList(mode);
});
document.addEventListener("click", () => toggleMenu(false));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") toggleMenu(false); });
$("detail").addEventListener("click", (e) => { if (e.target === $("detail")) $("detail").close(); }); // 外側クリックで閉じる
$("settingsBtn").addEventListener("click", showSettings);

// ---------------------------------------------------------------- start
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

if (Store.demo) {
  Store.set("transactions", demoTransactions());
  Store.set("updatedAt", isoNow());
}
loadTransactions();
if (isSetUp()) {
  showLastFetched();
  showCalendar();
} else {
  showSettings(); // 初回はログインから
}
