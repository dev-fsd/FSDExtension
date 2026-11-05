// Lưới dữ liệu dùng chung (thay clsGrid / clsGridEx / clsGridInherits + frmFind + clsExport + GridColumnQuickFilter của 5.1).
// Đối chiếu tính năng: docs/v5.2/parity/grid.md. Cuộn ảo cả dọc lẫn ngang (chỉ vẽ ô đang thấy).
//
// createGrid(host, data, opts)
//   data: { columns: [{ name, header, width, format, type, clr, readOnly, notNull }], rows: [[...]] }
//     header = chữ tiêu đề (mặc định name); width ≤ 2 = ẩn; format như syslist 5.1 ('### ##0.00' số canh phải, 'd' ngày dd/MM/yyyy) — rows được sửa tại chỗ khi lưới sửa được.
//   opts: { title, editable, allowAdd, moveRows, quickFilter, onChange(row, colName, old, value),
//           onDeleteRows(rows) → true/Promise true thì xóa, onRowsMoved(from, to),
//           enterSendTab (mặc định true — 5.1 isEnterSendTab), onActivate(row) Enter / nhấp đúp khi lưới chỉ đọc, onKey(e) → true = đã xử lý,
//           menuItems() → mục thêm cuối menu chuột phải (cùng dạng menuAt) }
// Trả: { el, focusColumn(name), height(), refresh(), getChanges(), acceptChanges(), setRows(rows), setFilter(fn), current(), currentCell(), visibleRows(), selectRow(i), focus(), dispose() }
import { call, setClipboard } from '../bridge.js';
import { menuAt } from './dialog.js';
import { icon } from './icons.js';

const RH = 22;          // chiều cao dòng (px)
const NUM_W = 46;       // cột số thứ tự
const MAX_W = 300;      // SetColumnsWidth 5.1: tối đa 300
const findHistory = []; // lịch sử từ khóa Tìm, dùng chung mọi lưới (5.1: Shared lstFindData)

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const NUM_CLR = /^System\.(Int16|Int32|Int64|Byte|SByte|UInt16|UInt32|UInt64|Decimal|Double|Single)$/;
const kindOf = (c) => (c.clr === 'System.Boolean' ? 'bool' : NUM_CLR.test(c.clr || '') ? 'num' : c.clr === 'System.DateTime' ? 'date'
  : c.clr === 'System.Byte[]' ? 'bin' : 'str');
/** Chữ hiện trên ô / khi copy (5.1 hiện NULL là "null"). */
const cellText = (v) => (v === null || v === undefined ? 'null' : v === true ? 'True' : v === false ? 'False' : String(v));
/** Định dạng hiển thị theo format syslist 5.1: số ('### ##0.00' → nhóm 3 số bằng dấu cách, số lẻ theo phần sau dấu chấm), ngày ('d…' → dd/MM/yyyy). */
function formatted(col, v) {
  if (v === null || v === undefined || !col.format) return cellText(v);
  const f = col.format;
  if (/^d/i.test(f)) { const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v); }
  if (f.includes('#') || f.includes('0')) {
    const n = Number(v); if (!isFinite(n)) return String(v);
    const dec = (f.split('.')[1] || '').replace(/[^0#]/g, '').length;
    const [i, d] = Math.abs(n).toFixed(dec).split('.');
    return (n < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, f.includes(',') ? ',' : ' ') + (d ? '.' + d : '');
  }
  return cellText(v);
}

let measureCtx;
function textWidth(s, bold) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = `${bold ? '600 ' : ''}12px "Segoe UI", sans-serif`;
  return measureCtx.measureText(s).width;
}

export function createGrid(host, data, opts = {}) {
  const cols = data.columns.map((c) => ({ ...c, kind: kindOf(c) }));
  let rows = data.rows;
  let extFilter = null;                         // lọc từ ngoài (ucFilter của danh sách)
  const editable = !!opts.editable;
  const allowAdd = editable && opts.allowAdd !== false;
  const order = cols.map((_, i) => i);          // thứ tự hiển thị → chỉ số cột dữ liệu
  const title = (c) => c.header || c.name;
  // Độ rộng khai báo (syslist) không nhỏ hơn chữ tiêu đề — 5.1 DataGridView xuống dòng tiêu đề nên không mất chữ; ≤ 2 = cột ẩn.
  const widths = cols.map((c, i) => (c.width == null ? autoWidth(i, 0, 60) : c.width <= 2 ? 2 : Math.max(c.width, headWidth(c))));
  let frozen = 0;                               // số cột đầu (theo thứ tự hiển thị) đang ghim
  let view = [];                                // chỉ số dòng dữ liệu theo thứ tự đang hiện (sau lọc + sắp)
  const sort = { c: -1, dir: 1 };
  const filters = {};
  let showFilter = !!opts.quickFilter;
  // Vùng chọn: theo (dòng trong view, vị trí hiển thị). full = chọn nguyên dòng (bấm số dòng).
  let ranges = [];
  const cur = { r: -1, c: -1 }, anchor = { r: -1, c: -1 };
  const state = new Map();                      // dòng (mảng) → { kind: 'new' | 'mod', orig }
  const deleted = [];
  let editor = null, findBox = null;

  const el = document.createElement('div');
  el.className = 'grid';
  el.tabIndex = 0;
  host.appendChild(el);
  el.innerHTML = '<div class="g-head"></div><div class="g-flt"></div><div class="g-body"></div><div class="g-mark"></div>';
  const headEl = el.querySelector('.g-head'), fltEl = el.querySelector('.g-flt'), body = el.querySelector('.g-body'), mark = el.querySelector('.g-mark');

  /* ===== Bố cục ===== */
  // chữ + lề phải (mũi tên sắp xếp + nút ghim 22px) + lề trái (6px; canh giữa thì 22px cho cân) + viền
  function headWidth(col) { return Math.ceil(textWidth(title(col), true)) + (opts.headerCenter ? 46 : 30); }
  function autoWidth(c, from, count) {
    let w = headWidth(cols[c]);
    for (let r = from; r < Math.min(rows.length, from + count); r++) w = Math.max(w, textWidth(cellText(rows[r][c]).slice(0, 80)) + 14);
    return Math.max(40, Math.min(MAX_W, Math.ceil(w)));
  }
  const nRows = () => view.length + (allowAdd ? 1 : 0);   // dòng cuối "*" = dòng mới
  const isNewRow = (r) => allowAdd && r === view.length;
  const frozenW = () => order.slice(0, frozen).reduce((a, c) => a + widths[c], 0);
  const totalW = () => NUM_W + order.reduce((a, c) => a + widths[c], 0);
  function leftOf(p) { let x = NUM_W; for (let i = 0; i < p; i++) x += widths[order[i]]; return x; }
  /** Vị trí hiển thị đang thấy theo chiều ngang (ngoài vùng ghim). */
  function visibleCols() {
    const x0 = el.scrollLeft + NUM_W + frozenW(), x1 = el.scrollLeft + el.clientWidth;
    let x = NUM_W + frozenW(), first = -1, last = -1, pad = 0;
    for (let p = frozen; p < order.length; p++) {
      const w = widths[order[p]];
      if (x + w > x0 && x < x1) { if (first < 0) { first = p; pad = x - NUM_W - frozenW(); } last = p; }
      x += w;
    }
    return { first, last, pad };
  }

  /* ===== Dữ liệu: lọc + sắp ===== */
  function compare(a, b, c) {
    const x = rows[a][c], y = rows[b][c];
    if (x === null || x === undefined) return y === null || y === undefined ? 0 : -1;
    if (y === null || y === undefined) return 1;
    const k = cols[c].kind;
    if (k === 'num') return Number(x) - Number(y);
    if (k === 'bool') return (x ? 1 : 0) - (y ? 1 : 0);
    return String(x).localeCompare(String(y), 'vi', { sensitivity: 'accent' });
  }
  function rebuildView() {
    const keys = Object.keys(filters).filter((c) => filters[c]);
    view = [];
    for (let i = 0; i < rows.length; i++) {
      if (extFilter && !extFilter(rows[i])) continue;
      if (keys.length && !keys.every((c) => { const v = rows[i][c]; return v !== null && v !== undefined && cellText(v).toLowerCase().includes(filters[c].toLowerCase()); })) continue;
      view.push(i);
    }
    if (sort.c >= 0) view.sort((a, b) => compare(a, b, sort.c) * sort.dir || a - b);
  }

  /* ===== Vẽ ===== */
  const isSel = (r, p) => ranges.some((g) => r >= g.r1 && r <= g.r2 && p >= g.c1 && p <= g.c2);
  const rowFull = (r) => ranges.some((g) => g.full && r >= g.r1 && r <= g.r2);

  function cellHtml(r, p, value, isHead) {
    const c = order[p];
    const fz = p < frozen ? ` fz" style="width:${widths[c]}px;left:${leftOf(p)}px` : `" style="width:${widths[c]}px`;
    const last = p === frozen - 1 ? ' fz-last' : '';
    if (isHead) {
      const arrow = sort.c === c ? `<span class="g-sort">${icon(sort.dir > 0 ? 'chevronUp' : 'chevronDown', 12)}</span>` : '';
      return `<div class="g-cell g-hc${opts.headerCenter ? ' center' : ''}${last}${fz}" data-p="${p}" title="${esc(cols[c].name + (cols[c].type ? ' · ' + cols[c].type : ''))}">` +
        `<span class="g-ht">${esc(title(cols[c]))}</span>${arrow}<span class="g-pin${p < frozen ? ' on' : ''}" data-pin="${p}" title="${p < frozen ? 'Bỏ ghim cột' : 'Ghim cột'}">${icon('pin', 12)}</span><span class="g-rs" data-c="${c}"></span></div>`;
    }
    let cls = 'g-cell' + last;
    if (value === null || value === undefined) cls += ' null';
    const isBool = cols[c].kind === 'bool';
    if (isBool) cls += ' bool'; else if (cols[c].kind === 'num' || cols[c].format) cls += ' num';   // 5.1: ô tick giữa cột, số canh phải
    if (isSel(r, p)) cls += ' sel';
    if (cur.r === r && cur.c === p) cls += ' on';
    // Ô bool có giá trị vẽ ô tick (chỉ hiển thị; dữ liệu và copy vẫn là True / False). NULL hiện chữ mờ như các kiểu khác.
    const inner = isNewRow(r) ? ''
      : isBool && value !== null && value !== undefined ? `<span class="g-bool${value ? ' on' : ''}">${value ? icon('check', 12) : ''}</span>`
        : esc(formatted(cols[c], value));
    return `<div class="${cls}${fz}" data-r="${r}" data-p="${p}">${inner}</div>`;
  }

  function rowHtml(r, vis, isHead) {
    const ri = isHead ? -1 : view[r];
    const data = isHead || isNewRow(r) ? null : rows[ri];
    let h = '';
    for (let p = 0; p < frozen; p++) h += cellHtml(r, p, data ? data[order[p]] : null, isHead);
    if (vis.first >= 0) {
      h += `<div class="g-pad" style="width:${vis.pad}px"></div>`;
      for (let p = vis.first; p <= vis.last; p++) h += cellHtml(r, p, data ? data[order[p]] : null, isHead);
    }
    return h;
  }

  function drawHead(vis) {
    headEl.style.width = totalW() + 'px';
    headEl.innerHTML = `<div class="g-cell g-num g-corner" title="Chọn hết (Ctrl+A)">#</div>` + rowHtml(-1, vis, true);
    if (!showFilter) { fltEl.style.display = 'none'; return; }
    fltEl.style.display = 'flex'; fltEl.style.width = totalW() + 'px';
    const box = (p) => { const c = order[p]; return `<div class="g-cell${p < frozen ? ' fz' : ''}${p === frozen - 1 ? ' fz-last' : ''}" style="width:${widths[c]}px${p < frozen ? `;left:${leftOf(p)}px` : ''}"><input data-f="${c}" value="${esc(filters[c] || '')}" placeholder="lọc…"></div>`; };
    let h = `<div class="g-cell g-num" title="Số dòng sau lọc">${view.length}</div>`;
    for (let p = 0; p < frozen; p++) h += box(p);
    if (vis.first >= 0) { h += `<div class="g-pad" style="width:${vis.pad}px"></div>`; for (let p = vis.first; p <= vis.last; p++) h += box(p); }
    const focused = document.activeElement && fltEl.contains(document.activeElement) ? document.activeElement.dataset.f : null;
    const caret = focused != null ? document.activeElement.selectionStart : 0;
    fltEl.innerHTML = h;
    if (focused != null) { const i = fltEl.querySelector(`input[data-f="${focused}"]`); if (i) { i.focus(); i.setSelectionRange(caret, caret); } }
  }

  let raf = 0;
  function draw() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawNow(); }); }
  // opts.fill: cột rộng nhất giãn thêm cho lưới phủ hết bề ngang khi còn chỗ (danh sách ít cột không để trống nửa màn).
  // Cột đã kéo tay / tự giãn thì thôi giãn.
  let fillCol = -1, fillExtra = 0;
  function fitFill() {
    if (!opts.fill || fillCol === -2) return;
    if (fillCol < 0) { let best = -1; order.forEach((c) => { if (widths[c] > 3 && (best < 0 || widths[c] > widths[best])) best = c; }); if (best < 0) return; fillCol = best; }
    widths[fillCol] -= fillExtra; fillExtra = 0;
    const room = el.clientWidth - totalW() - 2;
    if (room > 0) { fillExtra = room; widths[fillCol] += room; }
  }
  function drawNow() {
    fitFill();
    const vis = visibleCols();
    drawHead(vis);
    const headH = headEl.offsetHeight + (showFilter ? fltEl.offsetHeight : 0);
    body.style.height = nRows() * RH + 'px'; body.style.width = totalW() + 'px';
    const top = Math.max(0, Math.floor((el.scrollTop - headH) / RH) - 3);
    const end = Math.min(nRows(), top + Math.ceil(el.clientHeight / RH) + 6);
    let h = '';
    for (let r = top; r < end; r++) {
      const full = rowFull(r), st = !isNewRow(r) && state.get(rows[view[r]]);
      h += `<div class="g-row${r % 2 ? ' odd' : ''}${full ? ' full' : ''}" style="top:${r * RH}px;width:${totalW()}px">` +
        `<div class="g-cell g-num${full ? ' sel' : ''}" data-num="${r}">${isNewRow(r) ? '*' : (st ? (st.kind === 'new' ? '+' : '✎') + ' ' : '') + (r + 1)}</div>` + rowHtml(r, vis, false) + '</div>';
    }
    body.innerHTML = h;
    if (editor) placeEditor();
  }
  el.addEventListener('scroll', draw);
  const ro = new ResizeObserver(draw); ro.observe(el);

  /* ===== Trạng thái ô hiện tại (5.1: "Col: i (tên)" ở thanh trạng thái) ===== */
  function emitStatus() {
    let text = `${view.length.toLocaleString('vi-VN')} dòng`;
    if (cur.r >= 0 && cur.c >= 0 && order[cur.c] !== undefined) {
      const c = order[cur.c];
      text = `Col: ${c} (${cols[c].name}) · Dòng ${isNewRow(cur.r) ? '*' : (cur.r + 1).toLocaleString('vi-VN')}/${view.length.toLocaleString('vi-VN')}`;
    }
    el.dispatchEvent(new CustomEvent('grid-status', { bubbles: true, detail: { text } }));
  }

  /* ===== Chọn ô ===== */
  function setCur(r, p, extend, add) {
    r = Math.max(0, Math.min(nRows() - 1, r)); p = Math.max(0, Math.min(order.length - 1, p));
    if (nRows() === 0 || !order.length) return;
    if (extend && anchor.r >= 0) {
      const g = ranges[ranges.length - 1] || {};
      ranges[Math.max(0, ranges.length - 1)] = g.full
        ? { r1: Math.min(anchor.r, r), r2: Math.max(anchor.r, r), c1: 0, c2: order.length - 1, full: true }
        : { r1: Math.min(anchor.r, r), r2: Math.max(anchor.r, r), c1: Math.min(anchor.c, p), c2: Math.max(anchor.c, p) };
    } else {
      const g = { r1: r, r2: r, c1: p, c2: p };
      ranges = add ? ranges.concat([g]) : [g];
      anchor.r = r; anchor.c = p;
    }
    cur.r = r; cur.c = p;
    ensureVisible(); draw(); emitStatus();
  }
  function selectRows(r, extend, add) {
    if (extend && anchor.r >= 0) ranges[Math.max(0, ranges.length - 1)] = { r1: Math.min(anchor.r, r), r2: Math.max(anchor.r, r), c1: 0, c2: order.length - 1, full: true };
    else { const g = { r1: r, r2: r, c1: 0, c2: order.length - 1, full: true }; ranges = add ? ranges.concat([g]) : [g]; anchor.r = r; anchor.c = 0; }
    cur.r = r; if (cur.c < 0) cur.c = 0;
    ensureVisible(); draw(); emitStatus();
  }
  function selectAll() {
    if (!nRows() || !order.length) return;
    ranges = [{ r1: 0, r2: nRows() - 1, c1: 0, c2: order.length - 1, full: true }];
    if (cur.r < 0) { cur.r = 0; cur.c = 0; }
    draw(); emitStatus();
  }
  function ensureVisible() {
    const headH = headEl.offsetHeight + (showFilter ? fltEl.offsetHeight : 0);
    const y = cur.r * RH;
    if (y < el.scrollTop) el.scrollTop = y;
    if (y + RH + headH > el.scrollTop + el.clientHeight) el.scrollTop = y + RH + headH - el.clientHeight;
    if (cur.c >= frozen) {
      const x = leftOf(cur.c), w = widths[order[cur.c]], fx = NUM_W + frozenW();
      if (x - fx < el.scrollLeft) el.scrollLeft = x - fx;
      if (x + w > el.scrollLeft + el.clientWidth) el.scrollLeft = x + w - el.clientWidth;
    }
  }

  /* ===== Chuột ===== */
  function cellAt(e) { const t = e.target.closest('.g-cell[data-r]'); return t ? { r: +t.dataset.r, p: +t.dataset.p } : null; }
  el.addEventListener('mousedown', (e) => {
    if (e.target.closest('.g-flt input') || e.target.closest('.g-edit') || e.target.closest('.g-find')) return;
    if (editor) commitEdit();
    if (e.button === 2) { const at = cellAt(e); if (at && !isSel(at.r, at.p)) setCur(at.r, at.p); return; }
    const rs = e.target.closest('.g-rs');
    if (rs) { startResize(e, +rs.dataset.c); return; }
    const pin = e.target.closest('.g-pin');
    if (pin) { e.preventDefault(); toggleFreeze(+pin.dataset.pin); return; }
    if (e.target.closest('.g-corner')) { e.preventDefault(); el.focus(); selectAll(); return; }
    const hc = e.target.closest('.g-hc');
    if (hc) { startHeadDrag(e, +hc.dataset.p); return; }
    const num = e.target.closest('[data-num]');
    if (num) {
      e.preventDefault(); el.focus();
      const r = +num.dataset.num;
      if (opts.moveRows && editable && rowFull(r) && !isNewRow(r) && !e.shiftKey && !e.ctrlKey) { startRowDrag(e, r); return; }
      selectRows(r, e.shiftKey, e.ctrlKey); dragSelect(true); return;
    }
    const at = cellAt(e);
    if (!at) return;
    e.preventDefault(); el.focus();
    setCur(at.r, at.p, e.shiftKey, e.ctrlKey);
    dragSelect(false);
  });
  function dragSelect(full) {
    const move = (ev) => {
      const t = document.elementFromPoint(ev.clientX, ev.clientY);
      if (!t || !el.contains(t)) return;
      const n = t.closest('[data-num]'), c = t.closest('.g-cell[data-r]');
      if (full && (n || c)) selectRows(+(n || c).dataset[n ? 'num' : 'r'], true);
      else if (!full && c) setCur(+c.dataset.r, +c.dataset.p, true);
    };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  }
  el.addEventListener('dblclick', (e) => {
    const rs = e.target.closest('.g-rs');
    if (rs) { const c = +rs.dataset.c; widths[c] = autoWidth(c, view.length ? view[0] : 0, 1000); draw(); return; }
    if (cellAt(e) && editable) startEdit();
    else if (cellAt(e) && opts.onActivate && cur.r >= 0 && !isNewRow(cur.r)) opts.onActivate(rows[view[cur.r]]);
  });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const hc = e.target.closest('.g-hc');
    const p = hc ? +hc.dataset.p : cur.c;
    const items = [
      ['Copy', () => writeClip(copyText(false)), 'Ctrl+C'],
      ['Copy kèm tiêu đề', () => writeClip(copyText(true))],
      '-',
      ['Tìm…', openFind, 'Ctrl+F'],
      ['Xuất Excel', exportExcel, 'Ctrl+E'],
      '-'
    ];
    if (p >= 0) {
      items.push([p < frozen ? 'Bỏ ghim cột' : 'Ghim cột', () => toggleFreeze(p)]);
      items.push(['Tự giãn cột', () => { const c = order[p]; widths[c] = autoWidth(c, 0, 1000); draw(); }]);
    }
    items.push(['Tự giãn mọi cột', () => { order.forEach((c) => { widths[c] = autoWidth(c, 0, 1000); }); draw(); }]);
    items.push([showFilter ? 'Ẩn lọc nhanh' : 'Lọc nhanh theo cột', () => { showFilter = !showFilter; draw(); }]);
    if (sort.c >= 0) items.push(['Bỏ sắp xếp', () => { sort.c = -1; rebuildView(); draw(); }]);
    if (editable && ranges.some((g) => g.full)) items.push('-', ['Xóa dòng đang chọn', deleteRows, 'Delete']);
    const extra = opts.menuItems ? opts.menuItems() : [];
    if (extra.length) items.push('-', ...extra);
    menuAt(e.clientX, e.clientY, items);
  });

  function startResize(e, c) {
    e.preventDefault(); e.stopPropagation();
    if (c === fillCol) { fillCol = -2; fillExtra = 0; }
    const x0 = e.clientX, w0 = widths[c];
    const move = (ev) => { widths[c] = Math.max(24, w0 + ev.clientX - x0); drawNow(); };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  }

  /** Bấm tiêu đề = sắp xếp; kéo = đổi thứ tự cột (cột ghim không kéo được, không thả vào vùng ghim). */
  function startHeadDrag(e, p) {
    e.preventDefault();
    const x0 = e.clientX;
    let dragging = false, moved = false, target = -1;
    const move = (ev) => {
      if (Math.abs(ev.clientX - x0) > 4) moved = true;
      if (!dragging && moved && p >= frozen) dragging = true;
      if (!dragging) return;
      const t = document.elementFromPoint(ev.clientX, headEl.getBoundingClientRect().top + 4);
      const hc = t && t.closest('.g-hc');
      if (!hc) return;
      const q = +hc.dataset.p, rc = hc.getBoundingClientRect();
      const right = ev.clientX > rc.left + rc.width / 2;
      target = Math.max(frozen, right ? q + 1 : q);
      const xLine = (right ? rc.right : rc.left) - el.getBoundingClientRect().left + el.scrollLeft;
      mark.style.cssText = `display:block;left:${xLine - 1}px;top:${el.scrollTop}px;width:3px;height:${headEl.offsetHeight}px;background:var(--bad)`;
    };
    const up = () => {
      removeEventListener('mousemove', move); removeEventListener('mouseup', up);
      mark.style.display = 'none';
      if (!dragging && moved) return;              // kéo cột ghim: không đổi chỗ, cũng không tính là bấm
      if (!dragging) {
        const c = order[p];
        if (sort.c === c) sort.dir = -sort.dir; else { sort.c = c; sort.dir = 1; }
        const keep = cur.r >= 0 && !isNewRow(cur.r) ? view[cur.r] : -1;
        rebuildView();
        if (keep >= 0) cur.r = view.indexOf(keep);
        ranges = cur.r >= 0 ? [{ r1: cur.r, r2: cur.r, c1: cur.c, c2: cur.c }] : [];
        draw(); return;
      }
      if (target < 0 || target === p || target === p + 1) return;
      const c = order.splice(p, 1)[0];
      const to = target > p ? target - 1 : target;
      order.splice(to, 0, c);
      if (cur.c === p) cur.c = to;
      ranges = []; draw();
    };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  }

  /** 5.1 MouseClickInPin: ghim → dồn về cuối vùng ghim; bỏ ghim → về đầu vùng không ghim. */
  function toggleFreeze(p) {
    const c = order.splice(p, 1)[0];
    if (p < frozen) { frozen--; order.splice(frozen, 0, c); } else { order.splice(frozen, 0, c); frozen++; }
    ranges = []; cur.c = -1; draw();
  }

  /** Kéo số dòng đang chọn để đổi chỗ (5.1 AllowUserToMoveRows; không dùng khi đang sắp xếp / lọc). */
  function startRowDrag(e, r) {
    if (sort.c >= 0 || Object.values(filters).some(Boolean)) { selectRows(r); return; }
    let target = -1;
    const move = (ev) => {
      const t = document.elementFromPoint(ev.clientX, ev.clientY), n = t && t.closest('[data-num]');
      if (!n) return;
      const q = +n.dataset.num, rc = n.getBoundingClientRect(), bottom = ev.clientY > rc.top + rc.height / 2;
      if (isNewRow(q)) return;
      target = q < r ? (bottom ? q + 1 : q) : (bottom ? q : q - 1);
      const y = (bottom ? rc.bottom : rc.top) - el.getBoundingClientRect().top + el.scrollTop;
      mark.style.cssText = `display:${target === r ? 'none' : 'block'};left:${el.scrollLeft}px;top:${y - 1}px;height:2px;width:${el.clientWidth}px;background:var(--fg)`;
    };
    const up = () => {
      removeEventListener('mousemove', move); removeEventListener('mouseup', up);
      mark.style.display = 'none';
      if (target < 0 || target === r) return;
      const row = rows.splice(view[r], 1)[0];
      rows.splice(view[target], 0, row);
      rebuildView();
      if (opts.onRowsMoved) opts.onRowsMoved(r, target);
      cur.r = target; selectRows(target);
    };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  }

  /* ===== Phím ===== */
  el.addEventListener('keydown', (e) => {
    if (e.target.closest('.g-flt') || e.target.closest('.g-find')) return;
    if (editor) return;
    if (opts.onKey && opts.onKey(e)) { e.preventDefault(); return; }
    const k = e.key, ctrl = e.ctrlKey || e.metaKey, page = Math.max(1, Math.floor(el.clientHeight / RH) - 2);
    const last = order.length - 1;
    const go = (r, p) => { setCur(r, p, e.shiftKey && !['Tab', 'Enter'].includes(k)); e.preventDefault(); };
    if (ctrl && k.toLowerCase() === 'a') { selectAll(); e.preventDefault(); return; }
    if (ctrl && k.toLowerCase() === 'f') { openFind(); e.preventDefault(); e.stopPropagation(); return; }
    if (ctrl && k.toLowerCase() === 'e') { exportExcel(); e.preventDefault(); e.stopPropagation(); return; }
    if (ctrl && k.toLowerCase() === 'c') { writeClip(copyText(false)); e.preventDefault(); return; }
    if (ctrl && k.toLowerCase() === 'v') return;              // xử lý ở sự kiện paste (document)
    if (cur.r < 0) { if (['ArrowDown', 'ArrowRight', 'Home', 'PageDown', 'Tab'].includes(k)) go(0, 0); return; }
    switch (k) {
      case 'ArrowUp': return go(cur.r - 1, cur.c);
      case 'ArrowDown': return go(cur.r + 1, cur.c);
      case 'ArrowLeft': return go(cur.r, cur.c - 1);
      case 'ArrowRight': return go(cur.r, cur.c + 1);
      case 'PageUp': return go(cur.r - page, cur.c);
      case 'PageDown': return go(cur.r + page, cur.c);
      case 'Home': return ctrl ? go(0, 0) : go(cur.r, 0);
      case 'End': return ctrl ? go(nRows() - 1, last) : go(cur.r, last);
      case 'Enter':
        // isEnterSendTab = False (5.1): lưới chỉ đọc có onActivate → chọn; còn lại như DataGridView → xuống dòng cùng cột.
        if (opts.enterSendTab === false) {
          if (opts.onActivate) { if (cur.r >= 0 && !isNewRow(cur.r)) opts.onActivate(rows[view[cur.r]]); e.preventDefault(); return; }
          return go(cur.r + 1, cur.c);
        }
      // fall through
      case 'Tab':
        if (e.shiftKey && k === 'Tab') return cur.c > 0 ? go(cur.r, cur.c - 1) : go(cur.r - 1, last);
        return cur.c < last ? go(cur.r, cur.c + 1) : (cur.r < nRows() - 1 ? go(cur.r + 1, 0) : e.preventDefault());
      case 'F2': if (editable) { startEdit(); e.preventDefault(); } return;
      case 'Delete': if (editable && ranges.some((g) => g.full)) { deleteRows(); e.preventDefault(); } return;
    }
    if (editable && k.length === 1 && !ctrl && !e.altKey) { startEdit(k); e.preventDefault(); }
  });
  // Ctrl+V trên div không sửa được: Chromium bắn paste ở body / phần tử đang focus → nghe ở document.
  const onPaste = (e) => {
    if (!editable || editor || document.activeElement !== el) return;
    e.preventDefault(); pasteText(e.clipboardData.getData('text/plain'));
  };
  document.addEventListener('paste', onPaste);
  fltEl.addEventListener('input', (e) => {
    const c = e.target.dataset.f; if (c == null) return;
    filters[c] = e.target.value; rebuildView(); ranges = []; cur.r = -1; draw(); emitStatus();
  });

  /* ===== Copy (5.1 DataGridView ClipboardCopyMode = EnableWithAutoHeaderText) ===== */
  function copyText(withHeader) {
    if (!ranges.length) return '';
    const r1 = Math.min(...ranges.map((g) => g.r1)), r2 = Math.min(view.length - 1, Math.max(...ranges.map((g) => g.r2)));
    const c1 = Math.min(...ranges.map((g) => g.c1)), c2 = Math.max(...ranges.map((g) => g.c2));
    const lines = [];
    if (withHeader || ranges.some((g) => g.full)) lines.push(order.slice(c1, c2 + 1).map((c) => cols[c].name).join('\t'));
    for (let r = r1; r <= r2; r++) {
      const row = rows[view[r]], parts = [];
      for (let p = c1; p <= c2; p++) parts.push(isSel(r, p) ? (cols[order[p]].format ? formatted(cols[order[p]], row[order[p]]) : cellText(row[order[p]])).replace(/\t/g, ' ') : '');
      lines.push(parts.join('\t'));
    }
    return lines.join('\r\n');
  }
  const writeClip = (t) => setClipboard(t);

  /* ===== Tìm (5.1 frmFind) ===== */
  function openFind() {
    if (findBox) { findBox.querySelector('input').focus(); findBox.querySelector('input').select(); return; }
    findBox = document.createElement('div');
    findBox.className = 'g-find';
    findBox.innerHTML = `<div class="gf-title">Tìm kiếm</div>
      <div class="gf-row"><label>Từ cần tìm</label><input list="gfHist" autocomplete="off"><datalist id="gfHist"></datalist></div>
      <div class="gf-cols"><fieldset><legend>Lựa chọn</legend>
        <label><input type="checkbox" data-o="case"> Phân biệt chữ</label><label><input type="checkbox" data-o="whole"> Đúng từ</label>
        <label><input type="checkbox" data-o="wrap" checked> Tìm quanh</label><label><input type="checkbox" data-o="back"> Tìm ngược</label>
        <label><input type="checkbox" data-o="like"> Ký tự đại diện</label></fieldset>
      <fieldset><legend>Phạm vi</legend><label><input type="radio" name="gfS" value="all" checked> Tất cả</label>
        <label><input type="radio" name="gfS" value="row"> Dòng hiện thời</label><label><input type="radio" name="gfS" value="col"> Cột hiện thời</label></fieldset></div>
      <div class="gf-foot"><span class="gf-msg"></span><button class="btn primary" data-x="find">Tìm tiếp</button><button class="btn" data-x="close">Hủy</button></div>`;
    document.body.appendChild(findBox);
    const rc = el.getBoundingClientRect();
    findBox.style.left = Math.max(8, rc.right - 380) + 'px'; findBox.style.top = (rc.top + 30) + 'px';
    const input = findBox.querySelector('input');
    findBox.querySelector('datalist').innerHTML = findHistory.map((k) => `<option value="${esc(k)}">`).join('');
    if (findHistory.length) input.value = findHistory[0];
    findBox.querySelector('[data-x="find"]').onclick = doFind;
    findBox.querySelector('[data-x="close"]').onclick = closeFind;
    findBox.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doFind(); }
      if (e.key === 'Escape') { e.preventDefault(); closeFind(); el.focus(); }
      e.stopPropagation();
    });
    input.focus(); input.select();
  }
  function closeFind() { if (findBox) { findBox.remove(); findBox = null; } }
  function doFind() {
    const input = findBox.querySelector('input'), msg = findBox.querySelector('.gf-msg'), title = findBox.querySelector('.gf-title');
    const key = input.value.trim();
    if (!key) { msg.textContent = 'Vui lòng nhập từ cần tìm'; input.focus(); return; }
    const i = findHistory.indexOf(key); if (i >= 0) findHistory.splice(i, 1);
    findHistory.unshift(key); if (findHistory.length > 20) findHistory.pop();
    findBox.querySelector('datalist').innerHTML = findHistory.map((k) => `<option value="${esc(k)}">`).join('');
    const o = {}; findBox.querySelectorAll('[data-o]').forEach((x) => { o[x.dataset.o] = x.checked; });
    const scope = findBox.querySelector('input[name="gfS"]:checked').value;
    if (!view.length) { title.textContent = 'Không có dữ liệu để tìm'; return; }
    const nc = order.length, r0 = Math.max(0, Math.min(cur.r, view.length - 1)), c0 = Math.max(0, cur.c);
    // Dãy ô theo phạm vi (như 5.1: k = dòng * số cột + cột).
    const cells = scope === 'row' ? order.map((_, p) => [r0, p]) : scope === 'col' ? view.map((_, r) => [r, c0]) : null;
    const count = cells ? cells.length : view.length * nc;
    const at = (k) => (cells ? cells[k] : [Math.floor(k / nc), k % nc]);
    let k = cells ? cells.findIndex((x) => x[0] === r0 && x[1] === c0) : r0 * nc + c0;
    if (k < 0) k = 0;
    const needle = o.case ? key : key.toUpperCase();
    const step = o.back ? -1 : 1;
    for (let n = 0; n < count; n++) {
      k += step;
      if (k < 0 || k >= count) { if (!o.wrap) break; k = k < 0 ? count - 1 : 0; }
      const [r, p] = at(k), v = rows[view[r]][order[p]];
      if (v === null || v === undefined) continue;
      const s = o.case ? cellText(v).trim() : cellText(v).trim().toUpperCase();
      const ok = o.whole ? s === needle : o.like ? s.includes(needle) : s.startsWith(needle);
      if (ok) {
        setCur(r, p);
        title.textContent = `Tìm kiếm - Tìm thấy tại [${r + 1}, ${cols[order[p]].name}]`; msg.textContent = '';
        input.focus(); input.select(); return;
      }
    }
    title.textContent = `Không tìm thấy '${key}'`; msg.textContent = `Không tìm thấy '${key}' trong lưới`;
  }

  /* ===== Xuất Excel (5.1 clsExport: SpreadsheetML, mở bằng Excel) ===== */
  async function exportExcel() {
    if (!order.length) return;
    const shown = order.filter((c) => widths[c] > 3);
    try {
      await call('grid.exportExcel', {
        title: (opts.title || document.title || '').toUpperCase(),
        columns: shown.map((c) => ({ name: cols[c].name, clr: cols[c].clr || '', width: widths[c] })),
        rows: view.map((ri) => shown.map((c) => rows[ri][c]))
      });
    } catch (err) { el.dispatchEvent(new CustomEvent('grid-error', { bubbles: true, detail: err.message })); }
  }

  /* ===== Sửa ô ===== */
  function defaults() {
    return cols.map((c) => (c.kind === 'str' ? '' : c.kind === 'num' ? (c.clr === 'System.Decimal' ? '0' : 0) : c.kind === 'bool' ? false : null));
  }
  /** Chuỗi gõ → giá trị theo kiểu cột (5.1 OnCellParsingForNullValues). undefined = không hợp lệ (giữ giá trị cũ). */
  function parse(c, s) {
    const col = cols[c], t = String(s).trim();
    if (t.toLowerCase() === 'null') {
      if (col.kind === 'str' || col.kind === 'date' || col.kind === 'bin' || !col.notNull) return null;
      return col.kind === 'bool' ? false : col.clr === 'System.Decimal' ? '0' : 0;
    }
    switch (col.kind) {
      case 'str': return s;
      case 'bool': if (t === '') return false; if (/^(1|true|☑)$/i.test(t)) return true; if (/^(0|false|☐)$/i.test(t)) return false; return undefined;
      case 'num': { if (t === '') return col.clr === 'System.Decimal' ? '0' : 0; const n = Number(t.replace(/\s/g, '')); if (!isFinite(n)) return undefined; return col.clr === 'System.Decimal' ? t.replace(/\s/g, '') : n; }
      case 'date': { if (t === '') return null; const d = new Date(t.replace(' ', 'T')); return isNaN(d) ? undefined : t; }
      default: return t === '' ? null : t;
    }
  }
  function setValue(r, c, v, fire) {
    let row;
    if (isNewRow(r)) {
      row = defaults(); rows.push(row); state.set(row, { kind: 'new' }); view.push(rows.length - 1);
    } else row = rows[view[r]];
    const old = row[c];
    if (old === v) return;
    if (!state.has(row)) state.set(row, { kind: 'mod', orig: row.slice() });
    row[c] = v;
    if (fire && opts.onChange) opts.onChange(row, cols[c].name, old, v);
  }
  function startEdit(ch) {
    if (cur.r < 0 || cur.c < 0) return;
    const c = order[cur.c];
    if (cols[c].readOnly || cols[c].kind === 'bin') return;
    if (cols[c].kind === 'bool' && ch === undefined) {        // ô tick: F2 / nhấp đúp = đảo giá trị
      const v = isNewRow(cur.r) ? false : rows[view[cur.r]][c];
      setValue(cur.r, c, !v, true); draw(); return;
    }
    const v = isNewRow(cur.r) ? '' : cellText(rows[view[cur.r]][c]);
    editor = { r: cur.r, p: cur.c, old: v, input: document.createElement('input') };
    editor.input.className = 'g-edit';
    editor.input.value = ch !== undefined ? ch : v;
    el.appendChild(editor.input);
    placeEditor();
    editor.input.focus();
    if (ch === undefined) editor.input.select();
    editor.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
      else if (e.key === 'Enter' && opts.enterSendTab === false) {
        // DataGridView (isEnterSendTab = False): nhận ô rồi xuống dòng cùng cột (Shift+Enter: lên).
        e.preventDefault(); commitEdit(); setCur(cur.r + (e.shiftKey ? -1 : 1), cur.c);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault(); commitEdit();
        const last = order.length - 1;
        if (e.shiftKey) setCur(cur.c > 0 ? cur.r : cur.r - 1, cur.c > 0 ? cur.c - 1 : last);
        else setCur(cur.c < last ? cur.r : cur.r + 1, cur.c < last ? cur.c + 1 : 0);
      } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey) {
        e.preventDefault(); commitEdit(); setCur(cur.r + (e.key === 'ArrowUp' ? -1 : 1), cur.c);
      }
    });
  }
  function placeEditor() {
    const p = editor.p, x = p < frozen ? el.scrollLeft + leftOf(p) : leftOf(p);
    const headH = headEl.offsetHeight + (showFilter ? fltEl.offsetHeight : 0);
    Object.assign(editor.input.style, { left: x + 'px', top: headH + editor.r * RH + 'px', width: widths[order[p]] + 'px', height: RH + 'px' });
  }
  function commitEdit() {
    if (!editor) return;
    const ed = editor; editor = null; ed.input.remove();
    if (ed.input.value !== ed.old) {
      const c = order[ed.p], v = parse(c, ed.input.value);
      if (v !== undefined) setValue(ed.r, c, v, true);
    }
    draw(); el.focus();
  }
  function cancelEdit() { if (!editor) return; editor.input.remove(); editor = null; draw(); el.focus(); }

  async function deleteRows() {
    const picked = new Set();
    ranges.filter((g) => g.full).forEach((g) => { for (let r = g.r1; r <= Math.min(g.r2, view.length - 1); r++) picked.add(view[r]); });
    if (!picked.size) return;
    const list = [...picked].sort((a, b) => a - b).map((i) => rows[i]);
    if (opts.onDeleteRows && !(await opts.onDeleteRows(list))) return;
    list.forEach((row) => {
      const s = state.get(row);
      if (!s || s.kind !== 'new') deleted.push(s && s.orig ? s.orig : row);
      state.delete(row);
      rows.splice(rows.indexOf(row), 1);
    });
    rebuildView(); ranges = []; cur.r = Math.min(cur.r, nRows() - 1); draw(); emitStatus();
  }

  /** 5.1 PasteRowFromClipboard (chọn nguyên dòng → chèn dòng) / CopyCellAndCheck (nhiều ô → dán vào vùng). */
  function pasteText(text) {
    const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim() !== '');
    if (!lines.length || cur.r < 0) return;
    if (rowFull(cur.r)) {
      let at = isNewRow(cur.r) ? rows.length : view[cur.r];
      lines.forEach((line) => {
        let parts = line.split('\t');
        if (parts.length > order.length && parts[0].trim() === '') parts = parts.slice(1);   // cột tiêu đề dòng trống
        const row = defaults();
        order.forEach((c, j) => { if (j < parts.length && !cols[c].readOnly) { const v = parse(c, parts[j]); if (v !== undefined) row[c] = v; } });
        rows.splice(at++, 0, row); state.set(row, { kind: 'new' });
        if (opts.onChange) opts.onChange(row, null, undefined, undefined);
      });
      rebuildView(); draw(); return;
    }
    const r1 = Math.min(...ranges.map((g) => g.r1)), c1 = Math.min(...ranges.map((g) => g.c1));
    const many = ranges.length > 1 || ranges[0].r1 !== ranges[0].r2 || ranges[0].c1 !== ranges[0].c2;
    lines.forEach((line, i) => line.split('\t').forEach((s, j) => {
      const r = r1 + i, p = c1 + j;
      if (r >= view.length || p >= order.length || (many && !isSel(r, p))) return;
      const c = order[p]; if (cols[c].readOnly) return;
      const v = parse(c, s); if (v !== undefined) setValue(r, c, v, true);
    }));
    draw();
  }

  /* ===== API ===== */
  /** Cuộn ngang tới cột tên name (không phân biệt hoa thường), chọn ô dòng đang chọn / dòng đầu. */
  function focusColumn(name) {
    const c = cols.findIndex((x) => x.name.toLowerCase() === String(name).toLowerCase());
    if (c < 0) return false;
    el.focus(); setCur(cur.r < 0 ? 0 : cur.r, order.indexOf(c));
    return true;
  }
  function getChanges() {
    const added = [], updated = [];
    state.forEach((s, row) => { if (s.kind === 'new') added.push(row); else updated.push({ row, orig: s.orig }); });
    return { added, updated, deleted: deleted.slice() };
  }
  function acceptChanges() { state.clear(); deleted.length = 0; draw(); }

  rebuildView();
  drawNow();
  return {
    el, focusColumn, getChanges, acceptChanges,
    refresh: () => { rebuildView(); draw(); },
    setRows: (list) => { rows = list; state.clear(); deleted.length = 0; rebuildView(); ranges = []; cur.r = Math.min(cur.r, nRows() - 1); if (cur.r >= 0) ranges = [{ r1: cur.r, r2: cur.r, c1: 0, c2: order.length - 1, full: true }]; draw(); emitStatus(); },
    setFilter: (fn) => { extFilter = fn; rebuildView(); ranges = []; cur.r = view.length ? 0 : -1; if (cur.r === 0) { cur.c = Math.max(0, cur.c); ranges = [{ r1: 0, r2: 0, c1: 0, c2: order.length - 1, full: true }]; } draw(); emitStatus(); },
    current: () => (cur.r >= 0 && !isNewRow(cur.r) ? rows[view[cur.r]] : null),
    /** Ô đang chọn: { row (mảng), col (tên cột), value } hoặc null. */
    currentCell: () => (cur.r >= 0 && cur.c >= 0 && !isNewRow(cur.r) ? { row: rows[view[cur.r]], col: cols[order[cur.c]].name, value: rows[view[cur.r]][order[cur.c]] } : null),
    /** Thêm dòng mới (đánh dấu "new" cho getChanges) cuối lưới và chọn dòng đó — 5.1 Duplicate Current Row. */
    addRow: (values) => {
      const row = values.slice(); rows.push(row); state.set(row, { kind: 'new' });
      if (opts.onChange) opts.onChange(row, null, undefined, undefined);
      rebuildView(); const r = view.indexOf(rows.length - 1); if (r >= 0) { if (cur.c < 0) cur.c = 0; selectRows(r); } draw(); emitStatus(); return row;
    },
    /** Gán cả dòng từ chữ (5.1 frmEditRowGrid): texts[i] = chữ của cột i (null = NULL), cột chỉ đọc / chữ không hợp lệ giữ nguyên. */
    updateRow: (row, texts) => {
      const r = view.indexOf(rows.indexOf(row)); if (r < 0) return;
      cols.forEach((col, c) => {
        if (col.readOnly || texts[c] === undefined) return;
        const v = texts[c] === null ? null : parse(c, texts[c]);
        if (v !== undefined) setValue(r, c, v, true);
      });
      draw();
    },
    /** Xóa các dòng đang chọn nguyên dòng (qua onDeleteRows như phím Delete). */
    deleteSelected: () => deleteRows(),
    selectRow: (i) => { const r = view.indexOf(i); if (r < 0) return false; if (cur.c < 0) cur.c = 0; selectRows(r); return true; },
    visibleRows: () => view.map((i) => rows[i]),
    currentColumn: () => (cur.c >= 0 ? cols[order[cur.c]].name : null),
    focus: () => el.focus(),
    height: () => RH * (nRows() + 1) + 6 + (showFilter ? RH + 4 : 0),
    dispose: () => { closeFind(); ro.disconnect(); document.removeEventListener('paste', onPaste); el.remove(); }
  };
}
