// Khung "trái" dùng chung của Update Script và Multi Search: SQL Content Declare (bảng cấu hình theo mã CT / controller)
// và File Explorer (thư mục chương trình theo mode, lọc loại, tìm tên / nội dung, cây kết quả). Cùng cây có ô tick (makeTree),
// vùng thu / mở (bindLayout). Chép từ FSDStudio52\Web\js\ui\explorer.js.
// Bản extension: hai khung này chạy ở sidebar trái (web/js/sidebar/*), không còn nằm trong tab màn; tab chỉ giữ phần làm việc bên phải
// (vẫn dùng makeTree / sec / bindLayout cho cây Update vừa tạo và các vùng thu / mở).
import { showDialog, menuAt } from './dialog.js';
import { setClipboard } from '../bridge.js';
import { ic, fileIcon } from '../sidebar/icons.js';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const FILE_TYPES = [['form', '.f'], ['xml', '.xml'], ['dir', 'Dir'], ['filter', 'Filter'], ['grid', 'Grid'], ['report', 'Report'], ['upload', 'Upload']];
const AUTO_EXPAND_FILES = 20;
const HISTORY_MAX = 10;

/** Tách danh sách (xuống dòng, tab, phẩy, chấm phẩy), bỏ trùng — 5.1 SplitSearchTokens. */
export function splitTokens(raw) {
  const seen = new Set(), out = [];
  for (const p of String(raw || '').split(/[\r\n\t,;]+/)) { const v = p.trim(); if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); } }
  return out;
}

/** Nhãn đếm khung (5.1 countTreeSelect): "( N dòng )", có tick → "( c / N )". */
export const countText = (c, n) => (n <= 0 ? '( 0 dòng )' : c <= 0 ? `( ${n} dòng )` : `( ${c} / ${n} )`);

/** Nút đúng tên / gần đúng: file "=" / "≈", SQL "=" / "*". */
export function exactBtn(btn, on, file) {
  btn.textContent = file ? (on ? '=' : '≈') : (on ? '=' : '*');
  btn.classList.toggle('on', on);
  btn.title = file ? (on ? 'Đúng tên: chỉ file trùng tên (đuôi tùy chọn). Bấm để tìm gần đúng.' : 'Gần đúng: lấy cả tên chứa chuỗi gõ. Bấm để chỉ lấy đúng tên.')
    : (on ? 'Đúng tên: chỉ object trùng tên. Bấm để tìm gần đúng.' : 'Gần đúng: lấy tên bắt đầu bằng chuỗi gõ. Bấm để chỉ lấy đúng tên.');
}

/**
 * Cây có ô tick: node {key, label, children?, data?, check?: false (không tick được), title?, extra?, badge?, cls?, bold?}.
 * badge = số lượng hiện thành viên nhỏ sau tên; extra = chữ phụ mờ ở cuối dòng; bold = tên đậm (thông tin chính).
 * iconOf(n) → HTML icon đầu dòng (nhóm: folder; lá: theo đuôi file / loại đối tượng).
 * Tick cha = tick hết con (5.1 CheckAllChildNodes); onCount(checked, total) đếm lá tick được.
 * onSelect(n) = bấm một lần vào lá (Multi Search: xem file); onNode(n) = bấm vào nút bất kỳ (F1: hiện thuộc tính);
 * onOpen(n) = double click / Enter; onEnter(n) thay Enter nếu có.
 */
export function makeTree(host, { onOpen, onSelect, onNode, onEnter, onMenu, onCount, iconOf, checks = true } = {}) {
  const t = { nodes: [], checked: new Set(), open: new Set(), cur: null };
  const leaves = (n) => (n.children ? n.children.flatMap(leaves) : n.check === false ? [] : [n]);
  const all = (list) => list.flatMap((n) => [n, ...(n.children ? all(n.children) : [])]);
  const byKey = () => new Map(all(t.nodes).map((n) => [n.key, n]));
  const count = () => { if (onCount) onCount(t.nodes.flatMap(leaves).filter((n) => t.checked.has(n.key)).length, t.nodes.flatMap(leaves).length); };
  function html(list, depth) {
    return list.map((n) => {
      const kids = n.children && n.children.length, open = t.open.has(n.key);
      const on = kids ? leaves(n).length && leaves(n).every((l) => t.checked.has(l.key)) : t.checked.has(n.key);
      const icon = iconOf ? iconOf(n, open) : '';
      return `<div class="ut-n${t.cur === n.key ? ' cur' : ''}${kids ? ' grp' : ''}${open ? ' open' : ''}${n.cls ? ' ' + n.cls : ''}" data-k="${esc(n.key)}" style="--d:${depth}"${n.title ? ` title="${esc(n.title)}"` : ''}>` +
        `<span class="ut-tw${open ? ' open' : ''}">${kids ? ic('chevron', '', 12) : ''}</span>` +
        (checks && n.check !== false ? `<input type="checkbox"${on ? ' checked' : ''}>` : '') +
        (icon ? `<span class="ut-ic">${icon}</span>` : '') +
        `<span class="ut-l${n.bold || kids ? ' b' : ''}">${esc(n.label)}</span>${n.badge != null ? `<span class="ut-b">${esc(n.badge)}</span>` : ''}${n.extra ? `<span class="ut-x">${esc(n.extra)}</span>` : ''}</div>` +
        (kids && open ? html(n.children, depth + 1) : '');
    }).join('');
  }
  function draw() { host.innerHTML = t.nodes.length ? html(t.nodes, 0) : '<div class="ut-empty">—</div>'; count(); }
  host.tabIndex = 0;
  host.onclick = (e) => {
    const el = e.target.closest('.ut-n'); if (!el) return;
    const n = byKey().get(el.dataset.k); t.cur = n.key;
    if (e.target.tagName === 'INPUT') {
      const v = e.target.checked;
      for (const l of leaves(n)) v ? t.checked.add(l.key) : t.checked.delete(l.key);
      if (!n.children) v ? t.checked.add(n.key) : t.checked.delete(n.key);
    } else if (n.children) {
      t.open.has(n.key) ? t.open.delete(n.key) : t.open.add(n.key);
    }
    draw();
    if (e.target.tagName !== 'INPUT' && !n.children && onSelect) onSelect(n);
    if (e.target.tagName !== 'INPUT' && onNode) onNode(n);
  };
  host.ondblclick = (e) => {
    const el = e.target.closest('.ut-n'); if (!el || e.target.tagName === 'INPUT') return;
    const n = byKey().get(el.dataset.k);
    if (!n.children && onOpen) onOpen(n); // nhóm: bấm một lần là thu / mở (xử lý ở onclick)
  };
  host.oncontextmenu = (e) => {
    const el = e.target.closest('.ut-n'); if (!el || !onMenu) return;
    e.preventDefault(); t.cur = el.dataset.k; draw(); onMenu(byKey().get(el.dataset.k), e);
  };
  host.onkeydown = (e) => {
    if (e.key === ' ' && t.cur) { e.preventDefault(); const n = byKey().get(t.cur); if (!n) return; const v = !leaves(n).every((l) => t.checked.has(l.key)); for (const l of leaves(n)) v ? t.checked.add(l.key) : t.checked.delete(l.key); draw(); }
    if (e.key === 'Enter') {
      const n = t.cur ? byKey().get(t.cur) : null;
      if (onEnter) { e.preventDefault(); onEnter(n); } else if (n && !n.children && onOpen) onOpen(n);
    }
  };
  const api = {
    set(nodes, openKeys) { t.nodes = nodes; t.checked.clear(); t.cur = null; t.open = new Set(openKeys || []); draw(); },
    /** Thay nút nhưng giữ nút đang chọn / đang mở (F1: vẽ lại sau mỗi lần sửa). */
    update(nodes) { t.nodes = nodes; draw(); },
    checkedLeaves: () => t.nodes.flatMap(leaves).filter((n) => t.checked.has(n.key)),
    uncheck() { t.checked.clear(); draw(); },
    current: () => (t.cur ? byKey().get(t.cur) : null),
    /** Mở hết / thu hết (5.1 tree_ExpandAll); có node đang chọn thì chỉ node đó. */
    toggleAll() {
      const cur = t.cur && byKey().get(t.cur);
      const scope = cur && cur.children ? all([cur]) : all(t.nodes);
      const anyClosed = scope.some((n) => n.children && !t.open.has(n.key));
      for (const n of scope) if (n.children) anyClosed ? t.open.add(n.key) : t.open.delete(n.key);
      draw();
    },
    /** Chọn node theo key, mở các cha, cuộn tới (5.1 ExpandFromRootToNode). */
    select(key) {
      const path = (list, trail) => { for (const n of list) { if (n.key === key) return trail; if (n.children) { const r = path(n.children, [...trail, n.key]); if (r) return r; } } return null; };
      const trail = path(t.nodes, []); if (!trail) return;
      trail.forEach((k) => t.open.add(k)); t.cur = key; draw();
      const el = [...host.querySelectorAll('.ut-n')].find((x) => x.dataset.k === key);
      if (el) el.scrollIntoView({ block: 'nearest' });
    },
    /** Lá theo thứ tự hiện trên cây (Enter nhảy file khớp kế tiếp). */
    orderedLeaves: () => all(t.nodes).filter((n) => !n.children),
    keys: (pred) => all(t.nodes).filter(pred).map((n) => n.key),
    get nodes() { return t.nodes; }
  };
  return api;
}

/** Một vùng thu / mở được bằng thanh tiêu đề (dùng với bindLayout). */
export const sec = (x, title, extra, body, cls = '') => `<section class="ux${cls}" data-x="${x}"><div class="ux-h" data-tg="${x}"><span class="ux-tg">${ic('chevron', '', 12)}</span><b>${title}</b>${extra}</div><div class="ux-b">${body}</div></section>`;

/** Nút icon trên thanh tiêu đề vùng: tooltip thay nhãn chữ; cls 'add' = nút thêm vào Update (tô màu nhấn). */
export const iconBtn = (a, icon, title, color, cls = '') => `<button class="icon-btn${cls ? ' ' + cls : ''}" data-a="${a}" title="${title}">${ic(icon, color, 14)}</button>`;
const ib = iconBtn;

/** HTML khung SQL Content Declare; add = có nút ＋ (thêm vào Update). */
export function declSection(add = true) {
  return sec('decl', 'Khai báo', `<span class="cnt" data-a="declCount">( 0 dòng )</span><span class="sp"></span>
      ${ib('declRows', 'zero', 'Chỉ hiện bảng có dữ liệu', 'orange')}${ib('declExpand', 'expand', 'Mở hết cây / chọn nút')}${ib('declRefresh', 'refresh', 'Làm tươi dữ liệu', 'blue')}${add ? ib('declAdd', 'plus', 'Thêm mục đã tick vào Update', '', 'add') : ''}`,
    `<div class="ux-s"><input data-a="declText" spellcheck="false" placeholder="Mã CT / controller (phẩy = nhiều) · Enter"></div>
    <div class="ut" data-a="declTree"></div>`);
}

/** HTML khung File Explorer; extraHead = nút thêm trên thanh tiêu đề (vd Tự tìm), history = có nút lịch sử ô tìm. */
export function fileSection({ add = true, extraHead = '', history = false } = {}) {
  return sec('file', 'File', `<span class="cnt" data-a="fileCount">( 0 dòng )</span><span class="sp"></span>${extraHead}
      ${ib('fileExpand', 'expand', 'Mở hết cây / chọn nút')}${ib('fileRefresh', 'refresh', 'Tìm lại', 'blue')}${add ? ib('fileAdd', 'plus', 'Thêm mục đã tick vào Update', '', 'add') : ''}`,
    `<div class="ux-s"><select data-a="program" title="Đường dẫn chương trình (Web / Mobile / Other / FB) — chọn hoặc …"></select>${ib('programPick', 'folder', 'Chọn thư mục khác', 'yellow')}${ib('programOpen', 'open', 'Mở thư mục', 'yellow')}</div>
    <div class="ux-t" data-a="types"></div>
    <div class="ux-s"><input data-a="fileText" spellcheck="false" placeholder="Tên file (phẩy, *, Dir\\X, đuôi) — tự tìm khi gõ">${history ? ib('fileHistory', 'history', 'Chuỗi đã tìm gần đây (↓ trong ô tìm)') : ''}<button class="icon-btn" data-a="fileExact"></button><button class="icon-btn" data-a="fileSort"></button>${ib('fileList', 'list', 'Nhập danh sách file hàng loạt (mỗi dòng 1 file)')}</div>
    <div class="ut" data-a="fileTree"></div>`, ' grow');
}

/**
 * Vùng thu / mở (nhớ theo máy). Khi màn còn cột trái ([data-a=left], [data-a=split], [data-a=toggleLeft]) thì thêm ẩn cột + kéo bề rộng;
 * màn đã dời cột trái ra sidebar (Update, Multi Search) không cần các phần tử đó. Trả {layout, apply, save}.
 */
export function bindLayout(root, q, storageKey, defaults) {
  let layout = { closed: {}, leftHidden: false, leftWidth: 360, ...defaults };
  try { layout = { ...layout, ...JSON.parse(localStorage.getItem(storageKey) || '{}') }; } catch { /* storage bị chặn: dùng mặc định */ }
  const save = () => { try { localStorage.setItem(storageKey, JSON.stringify(layout)); } catch { /* như trên */ } };
  const left = q('left'), split = q('split'), toggle = q('toggleLeft');
  function apply() {
    root.querySelectorAll('section.ux').forEach((s) => { s.classList.toggle('closed', !!layout.closed[s.dataset.x]); });
    if (left) { left.hidden = layout.leftHidden; left.style.width = layout.leftWidth + 'px'; }
    if (split) split.hidden = layout.leftHidden;
    if (toggle) toggle.classList.toggle('on', !layout.leftHidden);
  }
  root.querySelectorAll('.ux-h[data-tg]').forEach((h) => {
    h.onclick = (e) => {
      if (e.target.closest('button,a,input,select')) return;
      const x = h.dataset.tg; layout.closed[x] = !layout.closed[x]; save(); apply();
    };
  });
  if (toggle) toggle.onclick = () => { layout.leftHidden = !layout.leftHidden; save(); apply(); };
  if (split && left) {
    split.onmousedown = (e) => {
      e.preventDefault();
      const x0 = e.clientX, w0 = left.offsetWidth;
      const move = (ev) => { layout.leftWidth = Math.max(240, Math.min(900, w0 + ev.clientX - x0)); left.style.width = layout.leftWidth + 'px'; };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); save(); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    };
  }
  apply();
  return { layout, apply, save };
}

/** Ctrl+V danh sách nhiều dòng → "a, b, c" (5.1 PasteAsCommaList); normalize(list) đổi từng mục (vd file). */
export function pasteList(e, box, normalize, after) {
  const text = (e.clipboardData || window.clipboardData).getData('text');
  if (!/[\r\n\t;,]/.test(text)) return;
  e.preventDefault();
  const list = normalize ? normalize(splitTokens(text)) : splitTokens(text);
  const s = box.selectionStart, en = box.selectionEnd, joined = list.join(', ');
  box.value = box.value.slice(0, s) + joined + box.value.slice(en);
  box.selectionStart = box.selectionEnd = s + joined.length;
  after();
}

/** Hộp nhập danh sách mỗi dòng 1 mục (5.1 ShowFileListEditor / ShowListEditor). */
export async function listEditor(title, label, box, normalize, after) {
  const v = await showDialog({ title, width: 560, ok: 'Áp dụng', fields: [{ id: 'list', label, type: 'textarea', rows: 14, value: splitTokens(box.value).join('\n') }] });
  if (!v) return;
  const list = normalize ? normalize(splitTokens(v.list)) : splitTokens(v.list);
  box.value = list.join(', ');
  after();
}

/** Lịch sử chuỗi (localStorage, tối đa 10, mới nhất trước — 5.1 My.Settings MultiSearchQueryHis / TextSearchHis). */
export function history(key) {
  const read = () => { try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
  const write = (list) => { try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* storage bị chặn: chỉ mất lịch sử */ } };
  return {
    list: read,
    add(v) { v = String(v || '').trim(); if (!v) return; write([v, ...read().filter((x) => x !== v)].slice(0, HISTORY_MAX)); },
    remove(v) { write(read().filter((x) => x !== v)); }
  };
}

/**
 * Hộp lịch sử thả xuống dưới ô nhập: bấm dòng = chọn, × = xóa dòng (5.1 Delete trên dòng đang bôi đen), ↑↓ Enter Esc.
 * onPick(value).
 */
export function historyDrop(anchor, hist, onPick) {
  const items = hist.list();
  if (!items.length) return;
  document.querySelectorAll('.hist-drop').forEach((x) => x.remove());
  const box = document.createElement('div');
  box.className = 'hist-drop'; box.tabIndex = 0;
  const r = anchor.getBoundingClientRect();
  Object.assign(box.style, { left: r.left + 'px', top: r.bottom + 2 + 'px', width: Math.max(r.width, 260) + 'px' });
  let cur = 0;
  const draw = () => {
    const list = hist.list();
    if (!list.length) { close(); return; }
    cur = Math.min(cur, list.length - 1);
    box.innerHTML = list.map((v, i) => `<div class="hd-row${i === cur ? ' on' : ''}" data-i="${i}"><span class="mono">${esc(v)}</span><button class="icon-btn" data-x="${i}" title="Xóa khỏi lịch sử (Delete)">×</button></div>`).join('');
  };
  const close = () => { box.remove(); document.removeEventListener('mousedown', outside, true); };
  const outside = (e) => { if (!box.contains(e.target) && e.target !== anchor) close(); };
  box.onclick = (e) => {
    const x = e.target.closest('[data-x]');
    if (x) { hist.remove(hist.list()[+x.dataset.x]); draw(); return; }
    const row = e.target.closest('.hd-row'); if (!row) return;
    const v = hist.list()[+row.dataset.i]; close(); onPick(v);
  };
  box.onkeydown = (e) => {
    const list = hist.list();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); cur = Math.max(0, Math.min(list.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1))); draw(); }
    else if (e.key === 'Delete') { e.preventDefault(); hist.remove(list[cur]); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); const v = list[cur]; close(); onPick(v); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); anchor.focus(); }
  };
  document.body.appendChild(box);
  document.addEventListener('mousedown', outside, true);
  draw(); box.focus();
}

/**
 * SQL Content Declare (5.1 treeOtherSQL / getOtherSqlInfo): ô mã → bảng cấu hình App / Sys theo mã, ≠0 chỉ bảng có dữ liệu.
 * add(items) → Promise<bool> (null = không có nút thêm). Trả {load, setText, clear}.
 */
export function createDeclExplorer({ q, ctx, add }) {
  const st = { rows: [], hasRows: true };
  // Nhóm DB: App xanh dương, Sys cam; bảng có dữ liệu đậm + số dòng, bảng 0 dòng mờ.
  const tree = makeTree(q('declTree'), {
    checks: !!add,
    onCount: (c, n) => { q('declCount').textContent = countText(c, n); },
    iconOf: (n, open) => (n.children ? ic(open ? 'folderOpen' : 'folder', n.key === 'Sys' ? 'orange' : 'blue') : ic('table', n.data && n.data.tong > 0 ? 'blue' : 'muted'))
  });
  function render() {
    const nodes = [];
    for (const db of ['App', 'Sys']) {
      const rows = st.rows.filter((r) => r.db === db && (!st.hasRows || r.tong > 0));
      if (rows.length) {
        nodes.push({
          key: db, label: db, badge: rows.length, cls: 'db-' + db.toLowerCase(),
          children: rows.map((r, i) => ({ key: `${db}|${i}|${r.tb}`, label: r.tb, badge: r.tong > 0 ? r.tong + ' dòng' : '0', bold: r.tong > 0, cls: r.tong > 0 ? '' : 'zero', extra: r.wh, title: `${r.tb} ( ${r.tong} dòng) -- ${r.wh}`, data: r }))
        });
      }
    }
    tree.set(nodes, nodes.map((n) => n.key));
  }
  async function load() {
    const text = q('declText').value.trim();
    if (!text) { st.rows = []; render(); return; }
    try { st.rows = await ctx.call('upd.declare', { text }); render(); } catch (e) { ctx.toast('⚠ ' + esc(e.message)); }
  }
  function rowsBtn() {
    q('declRows').classList.toggle('on', st.hasRows);
    q('declRows').title = st.hasRows ? 'Đang chỉ hiện bảng có dữ liệu. Bấm để hiện tất cả.' : 'Đang hiện tất cả bảng. Bấm để chỉ hiện bảng có dữ liệu.';
  }
  q('declText').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); load(); } };
  q('declRefresh').onclick = load;
  q('declExpand').onclick = () => tree.toggleAll();
  q('declRows').onclick = () => { st.hasRows = !st.hasRows; rowsBtn(); if (q('declText').value.trim()) render(); };
  if (add) {
    q('declAdd').onclick = async () => {
      const items = tree.checkedLeaves().map((n) => n.data).filter((r) => r.tong > 0).map((r) => ({ db: r.db, tb: r.tb, wh: r.wh }));
      if (!items.length) { ctx.toast('⚠ Vui lòng chọn thông tin SQL cần gen update'); q('declTree').focus(); return; }
      if (await add(items)) tree.uncheck();
    };
  }
  rowsBtn();
  return {
    load,
    setText(v) { q('declText').value = v || ''; if (v) load(); else { st.rows = []; render(); } },
    clear() { q('declText').value = ''; st.rows = []; render(); }
  };
}

/**
 * File Explorer (5.1 treeFile + typeChecklist + txtFolderPath): opts
 *   project() → dự án ({kind}), state() → upd.state (webRoot / mobileRoot / otherRoot / fbRoot),
 *   add(files) → Promise<bool> (null = không có ＋), onSelect(full, n) bấm 1 lần, onOpen(full, n) double click / Enter,
 *   menuItems(n, full) → mục menu chuột phải, onSearch(text, content) trước khi tìm, onProgram(path) đổi thư mục,
 *   queryHistory / pathHistory = key localStorage (có thì nhớ chuỗi tìm / thư mục khác), enterNext = Enter nhảy file khớp kế.
 */
export function createFileExplorer(opts) {
  const { q, ctx } = opts;
  const pj = () => (opts.project && opts.project()) || {};
  const st = {
    program: '', override: false, mode: pj().kind === '1' ? 'fb' : 'fbo', mobile: false, mobileAvail: false, modeBeforeMobile: '',
    types: {}, content: false, exact: true, sortTime: false, files: [], seq: 0, menuSeq: 0, timer: 0
  };
  const qHist = opts.queryHistory ? history(opts.queryHistory) : null;
  const pHist = opts.pathHistory ? history(opts.pathHistory) : null;
  const s = () => (opts.state && opts.state()) || {};
  const toastErr = (e) => ctx.toast('⚠ ' + esc(e.message || e));

  /** 5.1 GetDefaultProgramPathForMode: Mobile → MobileApp; có Web → Web root; không → thư mục FB. */
  function defaultProgram() { return st.mode === 'mob' ? s().mobileRoot || s().webRoot : s().webRoot || s().fbRoot; }
  function programOptions() {
    const list = [];
    const addOpt = (p, label) => { if (p && !list.some((x) => x.p.toLowerCase() === p.toLowerCase())) list.push({ p, label }); };
    addOpt(s().webRoot, 'Web'); if (s().mobileRoot && st.mobileAvail) addOpt(s().mobileRoot, 'Mobile'); addOpt(s().otherRoot, 'Other');
    if (pj().kind === '1') addOpt(s().fbRoot, 'FB');
    addOpt(st.program, 'Khác');
    if (pHist) pHist.list().forEach((p) => addOpt(p, 'Khác'));
    q('program').innerHTML = list.map((x) => `<option value="${esc(x.p)}"${x.p === st.program ? ' selected' : ''}>${esc(x.label)} — ${esc(x.p)}</option>`).join('');
  }
  /** Đổi Program path → tìm lại (5.1 RefreshFileExplorerAfterPathChange). */
  function setProgram(p, override) {
    if (!p) return;
    st.program = p.replace(/[\\/]?$/, '\\');
    if (override !== undefined) st.override = override;
    if (override && pHist && ![s().webRoot, s().mobileRoot, s().otherRoot, s().fbRoot].some((x) => x && x.toLowerCase() === st.program.toLowerCase())) pHist.add(st.program);
    programOptions();
    if (opts.onProgram) opts.onProgram(st.program, st.mode);
    if (q('fileText').value.trim()) search();
  }
  q('program').onchange = () => setProgram(q('program').value, q('program').value.toLowerCase() !== (defaultProgram() || '').toLowerCase());
  q('programPick').onclick = async () => { const f = await ctx.call('folder.pick', { path: st.program }); if (f) setProgram(f.path, true); };
  q('programOpen').onclick = () => ctx.call('shell.explore', { path: st.program }).catch(toastErr);

  /** 5.1 typeChecklist: loại file, Nội dung (bỏ * đầu từ khóa), Mobile (đổi gốc + Report → Dash); đổi → tìm lại. */
  function renderTypes() {
    q('types').innerHTML = FILE_TYPES.map(([k, l]) => `<button class="${st.types[k] ? 'on' : ''}" data-t="${k}">${l === 'Report' && st.mobile ? 'Dash' : l}</button>`).join('') +
      `<span class="sep"></span><button class="${st.content ? 'on' : ''}" data-t="content" title="Tìm trong nội dung file">Nội dung</button>` +
      (st.mobileAvail ? `<button class="${st.mobile ? 'on' : ''}" data-t="mobile" title="Đổi sang MobileApp (Controllers\\Mobile)">Mobile</button>` : '');
    q('types').querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.t;
        if (k === 'content') {
          st.content = !st.content;
          if (st.content) q('fileText').value = q('fileText').value.split(',').map((x) => x.trim().replace(/^\*+/, '').trim()).filter(Boolean).join(', ');
        } else if (k === 'mobile') {
          // 5.1 OnMobileModeChanged: bật → mode Mobile (nhớ mode trước); tắt → mode trước (Mobile thì về FBO).
          if (!st.mobile) { if (st.mode !== 'mob') st.modeBeforeMobile = st.mode; st.mobile = true; st.mode = 'mob'; } else { st.mobile = false; st.mode = st.modeBeforeMobile && st.modeBeforeMobile !== 'mob' ? st.modeBeforeMobile : 'fbo'; }
          setProgram(defaultProgram(), false);
        } else st.types[k] = !st.types[k];
        renderTypes();
        if (q('fileText').value.trim()) search();
      };
    });
  }

  const full = (n) => st.program + n.data.full;
  const tree = makeTree(q('fileTree'), {
    checks: true,
    iconOf: (n, open) => (n.children ? ic(open ? 'folderOpen' : 'folder', 'yellow') : fileIcon(n.label)),
    onCount: (c, n) => { q('fileCount').textContent = countText(c, n); },
    onSelect: opts.onSelect ? (n) => opts.onSelect(full(n), n) : null,
    onOpen: (n) => opts.onOpen(full(n), n),
    onEnter: opts.enterNext ? () => nextMatch() : null,
    onMenu: (n, e) => {
      if (n.children) {
        if (opts.folderMenu) menuAt(e.clientX, e.clientY, opts.folderMenu(st.program + n.key.slice(2)));
        return;
      }
      menuAt(e.clientX, e.clientY, opts.menuItems ? opts.menuItems(n, full(n)) : [
        ['Xem', () => opts.onOpen(full(n), n)], '-',
        ['Copy tên file', () => setClipboard(n.data.name)],
        ['Copy file', () => ctx.call('shell.copyFile', { path: full(n) }).then(() => ctx.toast('Đã copy file')).catch(toastErr)],
        ['Copy đường dẫn', () => setClipboard(full(n))], '-',
        ['Mở thư mục chứa', () => ctx.call('shell.explore', { path: full(n), select: true }).catch(toastErr)]]);
    }
  });
  function render() {
    // Thư mục theo tên, trong thư mục: theo tên (hoặc mới sửa trước khi bật ↓T).
    const cmp = (x, y) => x.localeCompare(y, undefined, { sensitivity: 'base' });
    const rows = st.files.slice().sort((a, b) => cmp(a.folder || '', b.folder || '') || (st.sortTime ? (b.mtime || '').localeCompare(a.mtime || '') : cmp(a.name, b.name)));
    const rootNodes = [], map = new Map();
    const folderNode = (path) => {
      if (map.has(path)) return map.get(path);
      const i = path.lastIndexOf('\\'), n = { key: 'd:' + path, label: i >= 0 ? path.slice(i + 1) : path, children: [], folder: true };
      map.set(path, n);
      (i >= 0 ? folderNode(path.slice(0, i)).children : rootNodes).push(n);
      return n;
    };
    for (const r of rows) {
      const leaf = { key: 'f:' + r.full, label: r.name, bold: true, data: r, extra: st.sortTime ? r.mtime : '', title: r.name + (r.mtime ? ' — sửa: ' + r.mtime : '') };
      (r.folder ? folderNode(r.folder.replace(/\\$/, '')).children : rootNodes).push(leaf);
    }
    // Nhãn thư mục kèm số file (5.1 setCountTreeToParent).
    const countUp = (n) => (n.children ? n.children.reduce((sum, c) => sum + countUp(c), 0) : 1);
    for (const n of map.values()) n.badge = countUp(n);
    const open = rows.length < AUTO_EXPAND_FILES ? [...map.values()].map((n) => n.key)
      : [...map.values()].filter((n) => /^(App_Data|Controllers|Dir|Filter|Grid)\b/i.test(n.label)).map((n) => n.key);
    tree.set(rootNodes, open);
  }
  /** 5.1 searchFileByFilter: chạy nền, chỉ nhận kết quả lần tìm mới nhất; nhớ chuỗi vào lịch sử. */
  async function search() {
    clearTimeout(st.timer);
    let text = q('fileText').value.trim();
    if (!text) { st.files = []; render(); return; }
    if (st.content) text = q('fileText').value = text.split(',').map((x) => x.trim().replace(/^\*+/, '').trim()).filter(Boolean).join(', ');
    if (opts.onSearch) opts.onSearch(text, st.content);
    if (qHist) qHist.add(text);
    const seq = ++st.seq;
    q('fileRefresh').disabled = true;
    try {
      const files = await ctx.call('upd.searchFiles', { root: st.program, text, mode: st.mode, mobile: st.mobile, content: st.content, exact: st.exact, types: st.types });
      if (seq === st.seq) { st.files = files; render(); }
    } catch (e) { if (seq === st.seq) toastErr(e); } finally { if (seq === st.seq) q('fileRefresh').disabled = false; }
  }
  /** Enter trên cây: nhảy tới file kế tiếp có tên chứa một từ khóa của ô tìm (5.1 GoToNextTreeFileNameMatch). */
  function nextMatch() {
    const tokens = q('fileText').value.split(',').map((x) => x.trim().replace(/\*/g, '').toLowerCase()).filter(Boolean)
      .map((x) => x.slice(x.lastIndexOf('\\') + 1));
    const leaves = tree.orderedLeaves().filter((n) => !tokens.length || tokens.some((t) => n.label.toLowerCase().includes(t)));
    if (!leaves.length) return;
    const cur = tree.current();
    const i = cur ? leaves.findIndex((n) => n.key === cur.key) : -1;
    const n = leaves[(i + 1) % leaves.length];
    tree.select(n.key);
    if (opts.onSelect) opts.onSelect(full(n), n);
  }

  /** Chuẩn hóa 1 dòng danh sách file (5.1 NormalizeFileSearchToken): đúng gốc Program → phần tương đối; path tuyệt đối khác gốc → sau "Controllers" hoặc cha gần nhất + tên. */
  function fileToken(raw) {
    const v = raw.trim().replace(/^"+|"+$/g, '').trim().replace(/\//g, '\\');
    const segs = v.split('\\').filter((x) => x.trim());
    if (segs.length <= 1) return (segs[0] || '').trim();
    if (st.program && v.toLowerCase().startsWith(st.program.toLowerCase())) return v.slice(st.program.length).replace(/^\\+|\\+$/g, '') || segs[segs.length - 1];
    if (/^([a-z]:|\\\\)/i.test(v)) {
      let i = -1; segs.forEach((x, k) => { if (x.toLowerCase() === 'controllers') i = k; });
      if (i >= 0 && i < segs.length - 1) return segs.slice(i + 1).join('\\');
      return segs[segs.length - 2] + '\\' + segs[segs.length - 1];
    }
    return segs.join('\\');
  }
  /** Danh sách file: .xml → tên trơn để engine áp quy tắc .f. */
  const normalizeFiles = (list) => [...new Set(list.map(fileToken).filter(Boolean).map((t) => t.replace(/\.xml$/i, '')))];

  /** Tự tìm khi gõ (5.1 ScheduleAutoFileSearch) — bỏ qua chuỗi chỉ có * / ký tự trống. */
  q('fileText').oninput = () => {
    clearTimeout(st.timer);
    if (!q('fileText').value.replace(/[*,\s]/g, '')) return;
    st.timer = setTimeout(search, 600);
  };
  const pickHistory = () => qHist && historyDrop(q('fileText'), qHist, (v) => { q('fileText').value = v; search(); q('fileText').focus(); });
  q('fileText').onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); search(); }
    if (e.key === 'ArrowDown' && qHist && !e.altKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); pickHistory(); }
  };
  if (q('fileHistory')) q('fileHistory').onclick = pickHistory;
  q('fileText').onpaste = (e) => pasteList(e, q('fileText'), normalizeFiles, () => q('fileText').oninput());
  q('fileRefresh').onclick = () => (q('fileText').value.trim() ? search() : (ctx.toast('Vui lòng nhập từ khóa!'), q('fileText').focus()));
  q('fileExpand').onclick = () => tree.toggleAll();
  q('fileExact').onclick = async () => { st.exact = await ctx.call('upd.option', { name: 'filesearch_exact', value: !st.exact }); exactBtn(q('fileExact'), st.exact, true); if (q('fileText').value.trim()) search(); };
  function sortBtn() {
    q('fileSort').innerHTML = ic('clock', 'purple', 14); q('fileSort').classList.toggle('on', st.sortTime);
    q('fileSort').title = st.sortTime ? 'Đang sort theo thời gian sửa (mới → cũ). Bấm để về sort theo tên.' : 'Sort theo thời gian thay đổi (mới nhất trước)';
  }
  q('fileSort').onclick = () => { st.sortTime = !st.sortTime; sortBtn(); render(); };
  q('fileList').onclick = () => listEditor('Danh sách file', 'Mỗi dòng 1 file (đường dẫn đầy đủ / Dir\\Ten / tên)', q('fileText'), normalizeFiles, search);
  if (opts.add) {
    q('fileAdd').onclick = async () => {
      const files = tree.checkedLeaves().map((n) => n.data.full);
      if (!files.length) { ctx.toast('⚠ Vui lòng chọn thông tin File cần gen update'); q('fileTree').focus(); return; }
      if (await opts.add(files, st.program)) tree.uncheck();
    };
  }

  return {
    st, tree, defaultProgram, setProgram, renderTypes, search, render,
    /** Lá đã tick (đường dẫn đầy đủ); không tick thì lá đang chọn (5.1 GetFileMenuTargetRels). */
    targets(fallbackCurrent = true) {
      const list = tree.checkedLeaves().map(full);
      if (list.length || !fallbackCurrent) return list;
      const c = tree.current(); return c && !c.children ? [full(c)] : [];
    },
    /** Khởi động sau khi có upd.state: Mobile có không, thư mục mặc định, nút =, ↓T. */
    async init() {
      st.mobileAvail = !!s().mobileRoot && await ctx.call('search.roots').then((l) => l.some((x) => x.id === 'mobile')).catch(() => false);
      setProgram(defaultProgram(), false);
      renderTypes(); sortBtn();
      st.exact = await ctx.call('upd.option', { name: 'filesearch_exact' }); exactBtn(q('fileExact'), st.exact, true);
    },
    /** Hiện sẵn danh sách file (vd Check Voucher, file dò theo menu): [{full, folder, name, mtime}]. */
    showFiles(files, text) { if (text !== undefined) q('fileText').value = text; st.files = files; render(); },
    /**
     * Chọn menu ở thanh trái (5.1 _MenuChangeW / _MenuChangeMob / _MenuChange): đổi mode + thư mục, gọi upd.menuContext.
     * FBO / Mobile: file dò theo cấu trúc sysid hiện thẳng; FB: điền ô tìm, autoFind = tìm luôn. Trả kết quả (sql, other…) hoặc null khi lượt cũ.
     */
    async menuChanged(kind, n, { autoFind = true } = {}) {
      const mode = kind === 'mob' ? 'mob' : kind === 'fb' ? 'fb' : 'fbo';
      st.mode = mode; st.mobile = mode === 'mob'; st.content = false;
      q('fileText').value = ''; st.files = []; render();
      setProgram(defaultProgram(), false);
      renderTypes();
      const seq = ++st.menuSeq;
      const r = await ctx.call('upd.menuContext', { kind, sysid: n.sys, syscode: n.code, xtype: n.type, link: kind === 'fb' ? n.exe : n.link, root: st.program, mode });
      if (seq !== st.menuSeq) return null;
      if (r.files) {
        q('fileText').value = r.file; st.files = r.files; render();
        if (r.fellBack && r.fellBack.length) ctx.toast('⚠ .f giải không trọn (thiếu khóa) — đã dò theo .xml: ' + esc(r.fellBack.map((f) => f.split(/[\\/]/).pop()).join(', ')));
      } else if (r.file) { q('fileText').value = r.file; if (autoFind) search(); }
      return r;
    }
  };
}
