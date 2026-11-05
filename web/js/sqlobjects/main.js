// Panel "Đối tượng SQL" (WebviewView) — ES module, chạy trong webview của extension (CSP nonce, không CDN).
// Port panels/sql.js của FSD Studio 5.2 + menu chuột phải của danh sách đối tượng 5.1 (frmMain InitDBObject / RunDBObject):
// bảng / view / store / function / trigger của DB chọn; lọc ("a b" = AND, "a, b" = OR), loại, sắp theo ngày sửa (mặc định) hoặc tên;
// chấm "mới" khi sửa < 7 ngày; ↑ ↓ PgUp PgDn Enter Ctrl+C ở ô lọc; Ctrl+R làm mới, Ctrl+U đổi DB.
// Danh sách vẽ bằng cuộn ảo (dòng cao cố định, chỉ dựng DOM các dòng trong khung nhìn) nên không còn giới hạn số dòng.
// Bấm = mở mã ALTER (Ctrl+bấm hoặc nhấp đúp = DROP + CREATE + QUOTED OFF; bảng = Select Table) — phần mở tab do extension làm (sqlObjectsView.ts).
// Chế độ "Tìm cột" / "Tìm nội dung": gõ rồi Enter mới tìm (lệnh sql.search), đồng thời điền ô Tìm của tab Query để tô chỗ khớp.
// Logic lọc / sắp / đếm / cuộn ảo thuần ở listModel.js (có test).
import { ROW_H, buildView, countText, indexOfKey, mapRows, rangeLabel, scrollForIndex, sortRows, windowRange } from './listModel.js';

const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const post = (m) => vscode.postMessage(m);
const toast = (text, warn) => post({ t: 'toast', text, warn: !!warn });

const TYPES = [['', 'Tất cả'], ['P', 'Store'], ['FN', 'Function'], ['V', 'View'], ['U', 'Bảng'], ['TR', 'Trigger'], ['COL', 'Tìm cột'], ['CONTENT', 'Tìm nội dung']];
const ICON = { U: ['tbl', 'TB'], V: ['v', 'VW'], P: ['sql', 'SP'], FN: ['js', 'FN'], IF: ['js', 'FN'], TF: ['js', 'FN'], TR: ['ent', 'TR'] };
const SEARCH = { COL: 'Tên cột rồi Enter (bảng có cột chứa chuỗi)', CONTENT: 'Từ khóa rồi Enter (mã store / view / function chứa chuỗi)' };
const DEBOUNCE_MS = 50;

const saved = vscode.getState() || {};
/**
 * Trạng thái của panel. type / sort / dbBy (DB đã chọn theo dự án) giữ qua lần mở lại webview; còn lại tính lại.
 * list = toàn bộ đối tượng của DB; custom = {label, list} khi đang lọc "đã sửa" (5.1 Filter / Get All Object Customize); found = kết quả Tìm cột / nội dung.
 */
const st = {
  mode: null, machineCode: '', project: null,
  db: '', dbs: [], dbBy: saved.dbBy || {},
  type: saved.type || 'P', sort: saved.sort || 'date',
  filter: '', list: [], custom: null, found: null, sel: 0, rows: [], view: { rows: [], count: 0, all: 0 },
  loading: false, error: '', token: 0, week: ''
};
const persist = () => vscode.setState({ type: st.type, sort: st.sort, dbBy: st.dbBy });
const searching = () => !!SEARCH[st.type];

/* ===== Gọi dịch vụ ở extension ===== */
const pending = new Map();
let seq = 0;
const call = (cmd, args) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  post({ t: 'call', id, cmd, args: args || {} });
});

/* ===== Icon (SVG nét, viewBox 16) ===== */
const svg = (body) => `<svg viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;
const I = {
  clock: svg('<circle cx="8" cy="8" r="5.8"/><path d="M8 4.6V8l2.4 1.5"/>'),
  az: svg('<text x="8" y="11.2" text-anchor="middle" font-size="8.5" font-weight="700" fill="currentColor" stroke="none">AZ</text>'),
  more: svg('<circle cx="3.5" cy="8" r="0.9" fill="currentColor"/><circle cx="8" cy="8" r="0.9" fill="currentColor"/><circle cx="12.5" cy="8" r="0.9" fill="currentColor"/>'),
  x: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
  db: svg('<ellipse cx="8" cy="3.5" rx="5" ry="2"/><path d="M3 3.5v9c0 1.1 2.2 2 5 2s5-.9 5-2v-9M3 8c0 1.1 2.2 2 5 2s5-.9 5-2"/>'),
  folder: svg('<path d="M1.5 3.5h4l1.5 1.5h7v8h-12.5z"/>'),
  lock: svg('<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2M8 10v1.5"/>')
};

/* ===== Khung (dựng một lần; chỉ #types / #chip / #rows / #count vẽ lại, ô lọc không mất focus) ===== */
$('app').innerHTML =
  '<div id="empty" hidden></div>' +
  '<div id="main" hidden>' +
  '<div class="flt"><input id="q" spellcheck="false" autocomplete="off">' +
  '<button id="sortb" class="ibtn" type="button"></button>' +
  `<button id="more" class="ibtn" type="button" title="Menu: làm mới, lọc object đã sửa, Custom Gen… (cũng mở bằng chuột phải vào danh sách)">${I.more}</button></div>` +
  '<div id="types" class="types"></div>' +
  `<div id="chip" class="chip" hidden><span id="chipt" class="ell"></span><button id="chipx" class="ibtn sm" type="button" title="Bỏ lọc, về danh sách đầy đủ">${I.x}</button></div>` +
  '<div id="list" class="list" tabindex="0"><div id="rows"><div id="win"></div><div id="msg" class="empty" hidden></div></div></div>' +
  `<div class="status"><span class="dbic" title="Đối tượng SQL của DB này">${I.db}</span><select id="db" title="Đổi DB của panel (Ctrl+U) — DB App trước, DB Sys sau"></select><span id="count" class="dim"></span></div>` +
  '</div>';
const q = $('q');
const list = $('list');
const rowsEl = $('rows');
const win = $('win');
const msg = $('msg');

/* ===== Nhận từ extension ===== */
window.addEventListener('message', (e) => {
  const m = e.data;
  if (!m || typeof m !== 'object') return;
  if (m.t === 'reply') {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.ok ? p.resolve(m.result) : p.reject(new Error(m.error || 'Lỗi không rõ'));
  } else if (m.t === 'state') onState(m);
  else if (m.t === 'reload') refreshList();
  else if (m.t === 'newQuery') post({ t: 'newQuery', db: st.db });
});

async function onState(m) {
  const code = m.project ? m.project.code : '';
  const changed = code !== (st.project ? st.project.code : '');
  st.mode = m.mode; st.machineCode = m.machineCode || ''; st.project = m.project || null;
  drawShell();
  if (!st.project) { st.list = []; st.custom = null; st.found = null; st.dbs = []; st.db = ''; st.token++; return; }
  if (!changed) return;
  // Dự án khác: bỏ danh sách cũ, hỏi lại DB của dự án (DB App đầu tiên làm mặc định, nhớ DB đã chọn lần trước).
  st.list = []; st.custom = null; st.found = null; st.filter = ''; q.value = ''; st.sel = 0; st.error = ''; st.dbs = []; st.db = '';
  const token = ++st.token;
  st.loading = true; drawAll('top');
  try {
    const dbs = (await call('project.databases')) || [];
    if (token !== st.token) return;
    st.dbs = dbs;
    const want = st.dbBy[code];
    st.db = (dbs.find((d) => d.name === want) || dbs.find((d) => d.kind === 'app') || dbs[0] || { name: '' }).name;
  } catch (e) {
    if (token !== st.token) return;
    st.loading = false; st.error = e.message; drawAll('top');
    return;
  }
  await load(false, 'top');
}

/** Đọc danh sách đối tượng của DB đang chọn (refresh = bỏ cache, đọc lại từ server). Giữ dòng chọn và vị trí cuộn nếu danh sách đã có. */
async function load(refresh, scroll) {
  const token = ++st.token;
  const key = selectedKey();
  st.loading = true; st.error = ''; st.found = null; drawAll(null);
  try {
    const rows = (await call('sql.objects', { db: st.db, refresh: !!refresh })) || [];
    if (token !== st.token) return;
    st.list = mapRows(rows);
  } catch (e) {
    if (token !== st.token) return;
    st.list = []; st.error = e.message;
  }
  st.loading = false; drawAll(scroll || 'keep', key);
}

/** Menu "Làm mới" / Ctrl+R / nút ⟳: đọc lại từ server, bỏ lọc "đã sửa" (5.1 ReloadDbObjects). */
function refreshList() {
  if (!st.project || !st.db) return;
  st.custom = null;
  load(true, 'keep');
}

/* ===== Danh sách đã sắp + dòng hiển thị ===== */
let sortedFrom = null;
let sortedBy = '';
let sorted = [];
/** Danh sách nguồn đã sắp: chỉ sắp lại khi nguồn hoặc cách sắp đổi (không sắp lại theo từng phím gõ). */
function sortedBase() {
  const base = st.custom ? st.custom.list : st.list;
  if (sortedFrom !== base || sortedBy !== st.sort) {
    sortedFrom = base;
    sortedBy = st.sort;
    sorted = sortRows(base, st.sort);
  }
  return sorted;
}
const selectedKey = () => { const o = st.rows[st.sel]; return o ? { name: o.name, type: o.type } : null; };

/* ===== Vẽ ===== */
/** scroll: 'top' | 'keep' | 'center' (đưa dòng chọn vào giữa khung) | null (không đụng vị trí cuộn). key: dòng cần giữ chọn. */
function drawAll(scroll, key) {
  drawShell();
  if (st.mode !== 'project' || !st.project) return;
  drawTypes();
  drawChip();
  drawDb();
  drawRows(scroll, key);
}

/** Trạng thái rỗng (chưa key / chưa chọn dự án) thay cho vùng chính. */
function drawShell() {
  const empty = $('empty');
  const main = $('main');
  const inProject = st.mode === 'project' && !!st.project;
  main.hidden = !inProject;
  empty.hidden = inProject;
  if (inProject) return;
  empty.innerHTML = st.mode === 'locked'
    ? `<div class="es"><div class="es-ic">${I.lock}</div><div class="es-t">Cần key để dùng</div>` +
      `<div class="es-d">Mã máy: <span class="mono">${esc(st.machineCode)}</span></div>` +
      '<div class="btns"><button class="btn primary" data-cmd="fsd.enterKey">Nhập key</button><button class="btn" data-cmd="fsd.copyMachineCode">Copy mã máy</button></div></div>'
    : `<div class="es"><div class="es-ic">${I.folder}</div><div class="es-t">Chưa mở dự án</div>` +
      '<div class="es-d">Chọn dự án để xem bảng, view, store, function của DB.</div>' +
      '<div class="btns"><button class="btn primary" data-cmd="fsd.changeProject">Chọn dự án…</button></div></div>';
}

function drawTypes() {
  $('types').innerHTML = TYPES.map(([t, n]) => `<button class="${st.type === t ? 'on' : ''}" data-t="${t}">${n}</button>`).join('');
  const ph = SEARCH[st.type] || 'Lọc tên: a b = có cả hai · a, b = một trong hai';
  q.placeholder = ph;
  q.title = ph + ' · ↑ ↓ chọn · Enter mở · Ctrl+Enter mở DROP + CREATE · Ctrl+C copy script · Ctrl+R làm mới · Ctrl+U đổi DB';
  drawSortBtn();
}

/** Nút sắp xếp: kích thước cố định, luôn ở cuối hàng ô lọc; icon đổi (đồng hồ = ngày sửa, AZ = tên); mờ khi Tìm cột / nội dung. */
function drawSortBtn() {
  const b = $('sortb');
  const date = st.sort === 'date';
  b.innerHTML = date ? I.clock : I.az;
  b.disabled = searching();
  b.title = searching() ? 'Kết quả tìm cột / nội dung xếp theo tên máy chủ trả về — không đổi được cách sắp'
    : `Sắp theo: ${date ? 'Ngày sửa' : 'Tên'} — bấm để đổi sang ${date ? 'Tên' : 'Ngày sửa'}`;
}

function drawChip() {
  const on = !!st.custom && !searching();
  $('chip').hidden = !on;
  if (on) $('chipt').textContent = 'Đang lọc: ' + st.custom.label + ' · ' + st.custom.list.length;
}

function drawDb() {
  const sel = $('db');
  const html = st.dbs.map((d) => `<option value="${esc(d.name)}"${d.name === st.db ? ' selected' : ''}>${esc(d.name)}${d.kind === 'sys' ? ' (Sys)' : ''}</option>`).join('');
  if (sel.__html !== html) { sel.__html = html; sel.innerHTML = html; }
  sel.value = st.db;
}

function showMsg(html) {
  msg.hidden = false; win.hidden = true;
  msg.innerHTML = html;
  rowsEl.style.height = 'auto';
}

function drawRows(scroll, key) {
  const prevTop = list.scrollTop;
  const view = buildView({ base: sortedBase(), found: st.found, searching: searching(), type: st.type, filter: st.filter });
  st.view = view; st.rows = view.rows;
  st.week = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  st.sel = key !== undefined ? indexOfKey(view.rows, key) : Math.max(0, Math.min(st.sel, view.rows.length - 1));
  const blocking = st.loading && !st.list.length;
  $('count').textContent = st.loading ? 'Đang đọc…' : st.error ? '' : searching() && !st.found ? '' : countText({ count: view.count, all: view.all, searching: searching() });
  if (blocking) { showMsg('Đang đọc…'); return; }
  if (st.error) { showMsg(`<span class="err">${esc(st.error)}</span>`); return; }
  if (!view.rows.length) {
    showMsg(searching() ? (st.found ? 'Không tìm thấy.' : esc(SEARCH[st.type])) : 'Không có đối tượng khớp.');
    return;
  }
  msg.hidden = true; win.hidden = false;
  rowsEl.style.height = view.rows.length * ROW_H + 'px';
  const h = list.clientHeight || 400;
  if (scroll === 'top') list.scrollTop = 0;
  else if (scroll === 'center') list.scrollTop = Math.max(0, st.sel * ROW_H - Math.floor((h - ROW_H) / 2));
  else if (scroll === 'keep') list.scrollTop = prevTop;
  renderWindow(true);
}

let winKey = '';
/** Dựng DOM chỉ các dòng trong khung nhìn (cuộn ảo). force = dựng lại dù khoảng dòng không đổi (đổi chọn / dữ liệu). */
function renderWindow(force) {
  const n = st.rows.length;
  if (!n || win.hidden) return;
  const [s, e] = windowRange(list.scrollTop, list.clientHeight || 400, n);
  const k = s + ':' + e;
  if (!force && k === winKey) return;
  winKey = k;
  let html = '';
  for (let i = s; i < e; i++) {
    const o = st.rows[i];
    const ic = ICON[o.type] || ['ent', o.type];
    const isNew = o.modified.slice(0, 10) >= st.week;
    html += `<div class="row${i === st.sel ? ' sel' : ''}" data-i="${i}" title="${esc(o.name)} · sửa ${esc(o.modified)}">` +
      `<span class="fi ${ic[0]}">${ic[1]}</span><span class="nm ell">${esc(o.name)}</span>` +
      (isNew ? '<i class="dot" title="Sửa trong 7 ngày"></i>' : '') +
      `<span class="dt${isNew ? ' new' : ''}">${esc(o.modified.slice(0, 10))}</span></div>`;
  }
  win.style.top = s * ROW_H + 'px';
  win.innerHTML = html;
}

/** Đổi dòng chọn tại chỗ (không dựng lại DOM để nhấp đúp vẫn nhận được). scrollTo = cuộn cho dòng nằm trong khung nhìn. */
function setSel(i, scrollTo) {
  if (!st.rows.length) return;
  st.sel = Math.max(0, Math.min(st.rows.length - 1, i));
  if (scrollTo) {
    const top = scrollForIndex(st.sel, list.scrollTop, list.clientHeight || 400);
    if (top !== list.scrollTop) list.scrollTop = top;
    renderWindow(true);
  } else {
    win.querySelectorAll('.row.sel').forEach((el) => el.classList.remove('sel'));
    const el = win.querySelector(`.row[data-i="${st.sel}"]`);
    if (el) el.classList.add('sel');
  }
}

let rafScroll = 0;
list.addEventListener('scroll', () => {
  closePop();
  if (rafScroll) return;
  rafScroll = requestAnimationFrame(() => { rafScroll = 0; renderWindow(false); });
});
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => renderWindow(true)).observe(list);

/* ===== Thao tác ===== */
const objOf = (el) => { const row = el && el.closest && el.closest('.row'); return row ? st.rows[+row.dataset.i] : null; };
const openObject = (o, ctrl) => post({ t: 'open', name: o.name, type: o.type, db: st.db, ctrl: !!ctrl });
const copyScript = (o) => post({ t: 'copyScript', name: o.name, type: o.type, db: st.db });

async function addToUpdate(o, opts) {
  try {
    const r = await call('upd.addObject', Object.assign({ name: o.name, type: o.type, db: st.db }, opts));
    toast(r && r.message ? r.message : 'Đã thêm ' + o.name + ' vào Update', !!(r && r.message));
  } catch (e) { toast(e.message, true); }
}

/** Tìm cột / nội dung: chỉ chạy khi Enter (5.1 PerformSearchColumn / PerformSearchContent). Chỉ giữ loại panel liệt kê được. */
async function runSearch(text) {
  const col = st.type === 'COL';
  toast((col ? 'Đang tìm cột: ' : 'Đang tìm nội dung: ') + text + '…');
  const token = ++st.token;
  try {
    const found = (await call('sql.search', { db: st.db, mode: col ? 'col' : 'content', text })) || [];
    if (token !== st.token) return;
    st.found = mapRows(found).filter((o) => ICON[o.type]);
  } catch (e) { toast('Lỗi khi tìm kiếm: ' + e.message, true); return; }
  st.sel = 0; drawRows('top');
  toast(st.found.length ? `Tìm thấy ${st.found.length} ${col ? 'bảng có chứa cột' : 'object có chứa'} '${text}'` : (col ? 'Không tìm thấy bảng nào có cột: ' : 'Không tìm thấy object nào có chứa: ') + text);
  post({ t: 'setFind', text });
}

function setType(t) {
  if (t === st.type) return;
  // 5.1 cboFilterBy: đổi chế độ tìm → xóa ô Tìm của tab Query, bỏ kết quả tìm cũ.
  if (searching() || SEARCH[t]) { post({ t: 'setFind', text: '' }); st.found = null; }
  st.type = t; st.sel = 0; persist();
  drawTypes(); drawChip(); drawRows('top'); q.focus();
}

function toggleSort() {
  if (searching()) return;
  const key = selectedKey();
  st.sort = st.sort === 'date' ? 'name' : 'date';
  persist(); drawSortBtn();
  drawRows('center', key); // giữ dòng đang chọn; đưa vào giữa khung nhìn
}

/** Phím ở ô lọc và danh sách (5.1 txtFilterDBObjects_KeyDown). inInput = đang ở ô lọc (Home / End dành cho con trỏ chữ). */
function keyNav(e, inInput) {
  const page = Math.max(1, Math.floor((list.clientHeight || 400) / ROW_H) - 1);
  const step = { ArrowUp: -1, ArrowDown: 1, PageUp: -page, PageDown: page }[e.key];
  if (step !== undefined) { e.preventDefault(); setSel(st.sel + step, true); return true; }
  if (!inInput && (e.key === 'Home' || e.key === 'End')) { e.preventDefault(); setSel(e.key === 'Home' ? 0 : st.rows.length - 1, true); return true; }
  return false;
}
q.addEventListener('keydown', (e) => {
  if (keyNav(e, true)) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    const text = q.value.trim();
    if (searching() && text) { runSearch(text); return; }
    const o = st.rows[st.sel];
    if (o) openObject(o, e.ctrlKey || e.metaKey);
    return;
  }
  // Ctrl+C không bôi chữ = copy script dòng chọn (bảng: CREATE đủ cột; khác: ALTER).
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'c' && q.selectionStart === q.selectionEnd) {
    const o = st.rows[st.sel];
    if (o) { e.preventDefault(); copyScript(o); }
  }
});
list.addEventListener('keydown', (e) => {
  if (keyNav(e, false)) return;
  if (e.key === 'Enter') { e.preventDefault(); const o = st.rows[st.sel]; if (o) openObject(o, e.ctrlKey || e.metaKey); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { const o = st.rows[st.sel]; if (o) { e.preventDefault(); copyScript(o); } }
});
// 5.1 phím tắt menu danh sách: Ctrl+R làm mới, Ctrl+U đổi DB.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closePop(); return; }
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || mdl) return;
  const k = e.key.toLowerCase();
  if (k === 'r') { e.preventDefault(); refreshList(); }
  else if (k === 'u') { e.preventDefault(); focusDb(); }
});
function focusDb() {
  const s = $('db');
  s.focus();
  try { s.showPicker(); } catch { /* webview không hỗ trợ showPicker: chỉ focus */ }
}

let timer = 0;
q.addEventListener('input', () => {
  st.filter = q.value; st.sel = 0;
  if (searching()) return; // chế độ tìm: chờ Enter
  clearTimeout(timer);
  timer = setTimeout(() => drawRows('top'), DEBOUNCE_MS);
});

$('types').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && b.dataset.t !== undefined) setType(b.dataset.t);
});
// Hàng loại hẹp: cuộn ngang bằng con lăn.
$('types').addEventListener('wheel', (e) => {
  const t = $('types');
  if (t.scrollWidth > t.clientWidth && e.deltaY && !e.deltaX) { t.scrollLeft += e.deltaY; e.preventDefault(); }
}, { passive: false });
$('sortb').addEventListener('click', toggleSort);
$('more').addEventListener('click', () => {
  const r = $('more').getBoundingClientRect();
  popup(r.right, r.bottom + 2, generalItems(), true);
});
$('chipx').addEventListener('click', () => {
  st.custom = null; drawChip(); drawRows('top');
});

$('db').addEventListener('change', (e) => {
  st.db = e.target.value;
  if (st.project) { st.dbBy[st.project.code] = st.db; persist(); }
  st.list = []; st.custom = null; st.found = null; st.sel = 0;
  load(false, 'top');
});

rowsEl.addEventListener('click', (e) => {
  const o = objOf(e.target);
  if (!o) return;
  setSel(+e.target.closest('.row').dataset.i, false);
  openObject(o, e.ctrlKey || e.metaKey);
});
rowsEl.addEventListener('dblclick', (e) => { const o = objOf(e.target); if (o) openObject(o, true); });
list.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const o = objOf(e.target);
  let items = generalItems();
  if (o) {
    setSel(+e.target.closest('.row').dataset.i, false);
    const add = (opts) => addToUpdate(o, opts);
    items = (o.type === 'U'
      ? [['→ Update: script tạo bảng', () => add({})], ['Mở Select Table', () => openObject(o, false)], ['Copy script (CREATE)', () => copyScript(o)]]
      : [['→ Update: CREATE', () => add({})], ['→ Update: ALTER', () => add({ alter: true })], ['→ Update: ALTER, QUOTED OFF', () => add({ alter: true, quotedOff: true })], '-',
        ['Xem mã', () => openObject(o, false)], ['Copy script (ALTER)', () => copyScript(o)]]).concat(['-'], items);
  }
  popup(e.clientX, e.clientY, items);
});

$('empty').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (b) post({ t: 'cmd', id: b.dataset.cmd });
});

/* ===== Menu chung của danh sách (5.1 InitDBObject) ===== */
function generalItems() {
  const ready = !!st.project && !!st.db;
  const has = st.rows.length > 0;
  return [
    ['Làm mới', ready ? refreshList : null, 'Ctrl+R'], '-',
    ['Lọc object đã sửa theo ngày…', ready ? filterByDate : null],
    ['Lấy tất cả object customize', ready ? getAllCustomize : null], '-',
    ['Custom Gen…', ready ? () => customGen(false) : null],
    ['Custom Gen danh sách đang hiện…', ready && has ? () => customGen(true) : null], '-',
    ['Thêm danh sách đang hiện vào Update…', ready && has ? addListToUpdate : null], '-',
    ['Đổi DB', ready ? focusDb : null, 'Ctrl+U']
  ];
}

const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

/** 5.1 FilterStoreCustomize (frmDate: Từ = hôm qua, Đến = hôm nay): đối tượng sửa trong khoảng ngày. */
async function filterByDate() {
  const now = new Date();
  const r = await ask({
    title: 'Lọc object đã sửa theo ngày',
    body: `<label>Từ ngày<input type="date" id="d1" value="${ymd(new Date(now.getTime() - 864e5))}"></label><label>Đến ngày<input type="date" id="d2" value="${ymd(now)}"></label>`,
    ok: 'Lọc',
    read: (root) => {
      const from = root.querySelector('#d1').value;
      const to = root.querySelector('#d2').value;
      if (!from || !to) return { error: 'Chọn đủ Từ ngày và Đến ngày.' };
      if (from > to) return { error: 'Từ ngày phải trước hoặc bằng Đến ngày.' };
      return { value: { from, to } };
    }
  });
  if (!r) return;
  await applyModified({ from: r.from.replace(/-/g, ''), to: r.to.replace(/-/g, '') }, 'đã sửa ' + rangeLabel(r.from, r.to));
}

/** 5.1 GetAllCustomize: mọi object sửa sau ngày tạo DB. */
const getAllCustomize = () => applyModified({ all: true }, 'tất cả object customize');

async function applyModified(args, label) {
  const token = ++st.token;
  toast('Đang lấy object customize…');
  let rows;
  try {
    rows = (await call('sql.objectsModified', Object.assign({ db: st.db }, args))) || [];
  } catch (e) { toast('Lỗi khi lọc object đã sửa: ' + e.message, true); return; }
  if (token !== st.token) return;
  // 5.1: về "All", giữ chữ trong ô lọc.
  if (searching()) { post({ t: 'setFind', text: '' }); st.found = null; }
  st.type = ''; st.sel = 0; persist();
  st.custom = { label, list: mapRows(rows) };
  drawTypes(); drawChip(); drawRows('top');
  toast(rows.length ? `Có ${rows.length} object ${label}` : `Không có object nào ${label}`);
  q.focus();
}

/** 5.1 CustomGen / CustomGenCurrentList (frmCustomGen: danh sách tên + Alter / Create): sinh script nạp vào tab Query. */
async function customGen(current) {
  const names = current ? st.rows.map((o) => o.name).join('\n') : '';
  const r = await ask({
    title: current ? `Custom Gen — ${st.rows.length} đối tượng đang hiện` : 'Custom Gen',
    body: '<label>Tên đối tượng (cách nhau bằng xuống dòng hoặc dấu phẩy)<textarea id="names" rows="9" spellcheck="false"></textarea></label>' +
      '<div class="radios"><label><input type="radio" name="k" value="alter" checked> Alter</label><label><input type="radio" name="k" value="create"> Create (DROP + CREATE)</label></div>',
    ok: 'Sinh script',
    init: (root) => { root.querySelector('#names').value = names; },
    read: (root) => {
      const text = root.querySelector('#names').value;
      if (!text.trim()) return { error: 'Chưa nhập tên đối tượng.' };
      return { value: { names: text, alter: root.querySelector('input[name="k"]:checked').value === 'alter' } };
    }
  });
  if (!r) return;
  toast('Đang sinh script…');
  post({ t: 'customGen', db: st.db, names: r.names, alter: r.alter });
}

/** Thêm mọi đối tượng đang hiện vào Update (một lần); chọn dạng script như CREATE / ALTER / ALTER, QUOTED OFF. */
async function addListToUpdate() {
  const items = st.rows.map((o) => ({ name: o.name, type: o.type }));
  const r = await ask({
    title: `Thêm ${items.length} đối tượng vào Update`,
    body: '<label>Dạng script<select id="mode"><option value="alter">ALTER</option><option value="create">CREATE (DROP + CREATE)</option><option value="qoff">ALTER, QUOTED OFF</option></select></label>',
    ok: 'Thêm',
    read: (root) => ({ value: root.querySelector('#mode').value })
  });
  if (!r) return;
  try {
    const res = await call('upd.addObjectList', { items, db: st.db, alter: r !== 'create', quotedOff: r === 'qoff' });
    toast(res && res.message ? res.message : `Đã thêm ${items.length} đối tượng vào Update`, !!(res && res.message));
  } catch (e) { toast(e.message, true); }
}

/* ===== Hộp thoại nhỏ (panel không nạp dialog.js / ui.css nên tự có) ===== */
let mdl = null;
/** ask({title, body, ok, init, read}) → Promise giá trị read() trả { value } hoặc null khi Hủy / Esc. read trả { error } thì giữ hộp mở. */
function ask({ title, body, ok, init, read }) {
  return new Promise((resolve) => {
    closePop();
    const back = document.createElement('div');
    back.className = 'mdl-back';
    back.innerHTML = `<div class="mdl" role="dialog" aria-modal="true"><div class="mdl-t">${esc(title)}</div><div class="mdl-b">${body}</div>` +
      `<div class="mdl-f"><span class="mdl-err"></span><button class="btn" data-x="no" type="button">Hủy</button><button class="btn primary" data-x="ok" type="button">${esc(ok)}</button></div></div>`;
    document.body.appendChild(back);
    mdl = back;
    if (init) init(back);
    const prev = document.activeElement;
    const close = (v) => {
      back.remove(); mdl = null;
      if (prev && prev.isConnected && prev.focus) prev.focus();
      resolve(v);
    };
    const submit = () => {
      const r = read(back);
      if (r.error) { back.querySelector('.mdl-err').textContent = r.error; return; }
      close(r.value);
    };
    back.querySelector('[data-x="ok"]').onclick = submit;
    back.querySelector('[data-x="no"]').onclick = () => close(null);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(null); });
    back.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
      else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { e.preventDefault(); submit(); }
    });
    (back.querySelector('textarea,input,select') || back.querySelector('[data-x="ok"]')).focus();
  });
}

/* ===== Menu chuột phải ===== */
let pop = null;
function closePop() {
  if (!pop) return;
  pop.remove(); pop = null;
  document.removeEventListener('mousedown', onDown, true);
  window.removeEventListener('blur', closePop);
}
function onDown(e) { if (pop && !pop.contains(e.target)) closePop(); }
/** items: '-' | [chữ, hàm | null (mờ), phím]. alignRight = x là mép phải của nút (menu mở lệch sang trái). */
function popup(x, y, items, alignRight) {
  closePop();
  pop = document.createElement('div');
  pop.className = 'pop';
  pop.innerHTML = items.map((it, i) => (it === '-' ? '<div class="sep"></div>'
    : `<div class="it${it[1] ? '' : ' off'}" data-i="${i}"><span class="ell">${esc(it[0])}</span>${it[2] ? `<span class="k">${esc(it[2])}</span>` : ''}</div>`)).join('');
  pop.addEventListener('click', (e) => {
    const el = e.target.closest('.it');
    if (!el || el.classList.contains('off')) return;
    const fn = items[+el.dataset.i][1];
    closePop();
    fn();
  });
  document.body.appendChild(pop);
  const b = pop.getBoundingClientRect();
  const left = alignRight ? x - b.width : x;
  pop.style.left = Math.max(4, Math.min(left, innerWidth - b.width - 4)) + 'px';
  pop.style.top = Math.max(4, Math.min(y, innerHeight - b.height - 4)) + 'px';
  document.addEventListener('mousedown', onDown, true);
  window.addEventListener('blur', closePop);
}

post({ t: 'ready' });
