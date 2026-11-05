// Hộp thoại HTML dùng chung (thay các form nhỏ 5.1: frmInputText, frmXSD…).
// showDialog({ title, fields: [{ id, label, value, type: 'text'|'select'|'textarea'|'check', options, list, browse }], ok, width })
//   list: gợi ý cho ô chữ (gõ tự do, như ComboBox DropDown của 5.1).
//   → Promise giá trị {id: value} hoặc null khi Hủy / Esc. browse: async () => chuỗi (vd chọn file) gắn nút "…" cạnh ô.
// showText({ title, text, language }) — xem văn bản dài (chỉ đọc, có nút Copy).
import { setClipboard } from '../bridge.js';
import { icon, cicon } from './icons.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fieldHtml(f) {
  const id = `dlg_${f.id}`;
  const dis = f.readOnly ? ' disabled' : '';
  if (f.type === 'check') return `<label class="chk dlg-row"><input type="checkbox" id="${id}"${f.value ? ' checked' : ''}${dis}> ${esc(f.label)}</label>`;
  let input;
  if (f.type === 'select') input = `<select id="${id}">${(f.options || []).map((o) => { const v = typeof o === 'object' ? o.value : o, t = typeof o === 'object' ? o.text : o; return `<option value="${esc(v)}"${v === f.value ? ' selected' : ''}>${esc(t)}</option>`; }).join('')}</select>`;
  else if (f.type === 'textarea') input = `<textarea id="${id}" rows="${f.rows || 6}" class="mono">${esc(f.value)}</textarea>`;
  else input = `<input id="${id}" value="${esc(f.value)}"${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''}${f.list ? ` list="${id}_l"` : ''}${dis}>` +
    (f.list ? `<datalist id="${id}_l">${f.list.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>` : '');
  return `<div class="dlg-row"><label for="${id}">${esc(f.label)}</label><div class="dlg-in">${input}${f.browse ? `<button class="btn" data-browse="${f.id}">…</button>` : ''}</div></div>`;
}

export function showDialog({ title, fields = [], ok = 'Đồng ý', width = 460, note = '' }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'dlg-back';
    back.innerHTML = `<div class="dlg" style="width:${width}px"><div class="dlg-title">${esc(title)}</div>` +
      (note ? `<div class="dlg-note">${note}</div>` : '') +
      `<div class="dlg-body">${fields.map(fieldHtml).join('')}</div>` +
      `<div class="dlg-foot"><span class="dlg-err"></span><button class="btn" data-x="cancel">Hủy</button><button class="btn primary" data-x="ok">${esc(ok)}</button></div></div>`;
    document.body.appendChild(back);
    const get = (f) => { const el = back.querySelector('#dlg_' + f.id); return f.type === 'check' ? el.checked : el.value; };
    // Đóng → trả focus về chỗ cũ (lưới / editor) để phím tắt của màn chạy tiếp như form 5.1.
    const prev = document.activeElement;
    const close = (v) => { back.remove(); if (prev && prev.isConnected && prev.focus) prev.focus(); resolve(v); };
    const submit = () => {
      const v = {}; fields.forEach((f) => { v[f.id] = get(f); });
      const missing = fields.find((f) => f.required && !String(v[f.id]).trim());
      if (missing) { back.querySelector('.dlg-err').textContent = 'Chưa nhập ' + missing.label; return; }
      close(v);
    };
    back.querySelector('[data-x="ok"]').onclick = submit;
    back.querySelector('[data-x="cancel"]').onclick = () => close(null);
    // onChange(value, set): ô đổi giá trị → điền ô khác (vd chọn cột → kiểu field), set(id, value).
    const set = (id, v) => { const el = back.querySelector('#dlg_' + id); if (!el) return; if (el.type === 'checkbox') el.checked = !!v; else el.value = v; };
    fields.filter((f) => f.onChange).forEach((f) => { back.querySelector('#dlg_' + f.id).addEventListener('change', () => f.onChange(get(f), set)); });
    back.querySelectorAll('[data-browse]').forEach((b) => {
      const f = fields.find((x) => x.id === b.dataset.browse);
      b.onclick = async () => { const r = await f.browse(get(f)); if (r) back.querySelector('#dlg_' + f.id).value = r; };
    });
    back.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); submit(); }
    });
    // Hộp chỉ hỏi (không có ô nhập): focus nút đồng ý để Enter / Esc thuộc hộp thoại, không rơi xuống trang phía sau.
    const first = back.querySelector('input:not([disabled]),select,textarea') || back.querySelector('[data-x="ok"]');
    first.focus();
  });
}

export function showText({ title, text }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'dlg-back';
    back.innerHTML = `<div class="dlg" style="width:min(900px,90vw)"><div class="dlg-title">${esc(title)}</div>` +
      `<pre class="dlg-pre mono">${esc(text)}</pre><div class="dlg-foot"><span class="dlg-err"></span><button class="btn" data-x="copy">${cicon('copy', 14)}<span>Copy</span></button><button class="btn primary" data-x="ok">Đóng</button></div></div>`;
    document.body.appendChild(back);
    const close = () => { back.remove(); resolve(); };
    back.querySelector('[data-x="ok"]').onclick = close;
    back.querySelector('[data-x="copy"]').onclick = () => setClipboard(text);
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    back.querySelector('[data-x="ok"]').focus();
  });
}

/**
 * Danh sách cột của bảng (5.1 frmColumnViewer): [PK] trước tên khóa chính, lọc theo tên / kiểu, nhấp đúp hoặc Ctrl+C = copy tên cột,
 * Esc đóng. columns: [{name, type, pk}].
 */
export function showColumns({ title, columns }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'dlg-back';
    back.innerHTML = `<div class="dlg" style="width:min(560px,90vw)"><div class="dlg-title">Cột: ${esc(title)}</div>` +
      '<div class="dlg-body"><input data-x="q" placeholder="Lọc tên / kiểu cột…"><div class="col-list" tabindex="0"></div></div>' +
      '<div class="dlg-foot"><span class="muted" data-x="n"></span><span class="sp" style="flex:1"></span><button class="btn primary" data-x="ok">Đóng</button></div></div>';
    document.body.appendChild(back);
    const list = back.querySelector('.col-list'), info = back.querySelector('[data-x="n"]'), box = back.querySelector('[data-x="q"]');
    let shown = [], cur = 0;
    const draw = () => {
      const f = box.value.trim().toLowerCase();
      shown = columns.filter((c) => !f || c.name.toLowerCase().includes(f) || c.type.toLowerCase().includes(f));
      cur = Math.min(cur, Math.max(0, shown.length - 1));
      list.innerHTML = shown.map((c, i) => `<div class="col-row${i === cur ? ' on' : ''}" data-i="${i}"><span>${c.pk ? `<span class="pk-ic" title="Khóa chính">${cicon('key', 13)}</span><b>` : ''}${esc(c.name)}${c.pk ? '</b>' : ''}</span><span class="muted">${esc(c.type)}</span></div>`).join('');
      info.textContent = f ? `${shown.length} / ${columns.length} cột` : `${columns.length} cột`;
    };
    const copy = () => { const c = shown[cur]; if (!c) return; setClipboard(c.name); info.innerHTML = '<span class="t-ok">' + icon('check', 13) + '</span> Đã copy: ' + esc(c.name); };
    const close = () => { back.remove(); resolve(); };
    list.onclick = (e) => { const r = e.target.closest('.col-row'); if (r) { cur = +r.dataset.i; draw(); } };
    list.ondblclick = (e) => { const r = e.target.closest('.col-row'); if (r) { cur = +r.dataset.i; copy(); } };
    box.oninput = () => { cur = 0; draw(); };
    back.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); cur = Math.max(0, Math.min(shown.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1))); draw(); list.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }
      if (e.ctrlKey && e.key.toLowerCase() === 'c' && !(e.target === box && box.selectionStart !== box.selectionEnd)) { e.preventDefault(); copy(); }
      if (e.key === 'Enter') { e.preventDefault(); copy(); }
    });
    back.querySelector('[data-x="ok"]').onclick = close;
    draw();
    box.focus();
  });
}

/**
 * Xem mã store / view / function (5.1 frmObjectCodeViewer): editor chỉ đọc (Ctrl+F tìm, F3 tìm tiếp), Copy, Esc đóng.
 * onCtrlSpace(editor): Ctrl+Space trên tên trong mã → xem tiếp đối tượng đó.
 * editable: sửa được (5.1 frmViewScript — Other SQL của gói) → nút Lưu trả văn bản mới, Đóng / Esc trả null.
 */
export async function showCode({ title, text, onCtrlSpace, editable, language = 'sql' }) {
  const { createEditor } = await import('./editor.js');
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'dlg-back';
    back.innerHTML = `<div class="dlg code-dlg"><div class="dlg-title">${esc(title)}</div><div class="code-ed"></div>` +
      `<div class="dlg-foot"><span class="muted" data-x="n">Ctrl+F tìm · F3 tìm tiếp${editable ? '' : ' · Ctrl+Space xem tên tại con trỏ'}</span><span style="flex:1"></span><button class="btn" data-x="copy">${cicon('copy', 14)}<span>Copy</span></button>` +
      (editable ? '<button class="btn" data-x="ok">Đóng</button><button class="btn primary" data-x="save">Lưu</button>' : '<button class="btn primary" data-x="ok">Đóng</button>') + '</div></div>';
    document.body.appendChild(back);
    let ed = null;
    const close = (v) => { if (ed) ed.dispose(); back.remove(); resolve(v === undefined ? null : v); };
    back.querySelector('[data-x="ok"]').onclick = () => close(null);
    if (editable) back.querySelector('[data-x="save"]').onclick = () => close(ed ? ed.getValue() : text);
    back.querySelector('[data-x="copy"]').onclick = () => { setClipboard(ed ? ed.getValue() : text); back.querySelector('[data-x="n"]').innerHTML = '<span class="t-ok">' + icon('check', 13) + '</span> Đã copy mã'; };
    back.addEventListener('keydown', (e) => {
      // Esc trong hộp tìm của editor chỉ đóng hộp tìm.
      if (e.key === 'Escape' && !(e.target.closest && e.target.closest('.find-widget'))) { e.stopPropagation(); close(null); }
    });
    createEditor(back.querySelector('.code-ed'), { value: text, readOnly: !editable, language }).then((e) => {
      ed = e;
      const m = window.monaco;
      if (onCtrlSpace) ed.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.Space, () => onCtrlSpace(ed));
      ed.focus();
    });
  });
}

/** Menu nhỏ thả xuống dưới phần tử anchor: items [[text, fn]]. */
export function dropMenu(anchor, items) {
  const r = anchor.getBoundingClientRect();
  menuAt(r.left, r.bottom + 2, items);
}

/**
 * Menu nổi tại điểm (x, y) — menu chuột phải của lưới, cây menu…; tự dời vào trong cửa sổ.
 * items: '-' | [text, fn | items con (menu ▸), phím]. fn null = mục mờ (không bấm được).
 */
export function menuAt(x, y, items) {
  document.querySelectorAll('.dd-menu').forEach((o) => o.remove());
  const root = openLevel(x, y, items, null);
  setTimeout(() => document.addEventListener('mousedown', function off(e) {
    if (!e.target.closest('.dd-menu')) { closeAll(); document.removeEventListener('mousedown', off); }
  }), 0);
  return root;
}
function closeAll() { document.querySelectorAll('.dd-menu').forEach((o) => o.remove()); }
function openLevel(x, y, items, parent) {
  const m = document.createElement('div');
  m.className = 'ctx dd-menu';
  m.style.display = 'block'; m.style.left = x + 'px'; m.style.top = y + 'px';
  m.innerHTML = items.map((it, i) => {
    if (it === '-') return '<div class="ms"></div>';
    const sub = Array.isArray(it[1]), off = !sub && !it[1];
    return `<div class="mi${off ? ' off' : ''}" data-i="${i}"><span>${esc(it[0])}</span><span class="k">${sub ? icon('chevronRight', 12) : esc(it[2] || '')}</span></div>`;
  }).join('');
  document.body.appendChild(m);
  const b = m.getBoundingClientRect();
  if (b.right > innerWidth - 4) m.style.left = Math.max(4, (parent ? parent.getBoundingClientRect().left - b.width : innerWidth - b.width - 4)) + 'px';
  if (b.bottom > innerHeight - 4) m.style.top = Math.max(4, innerHeight - b.height - 4) + 'px';
  let child = null;
  m.querySelectorAll('.mi').forEach((el) => {
    const it = items[+el.dataset.i];
    el.onmouseenter = () => {
      if (child) { child.remove(); child = null; }
      if (Array.isArray(it[1])) { const r = el.getBoundingClientRect(); child = openLevel(r.right - 2, r.top - 4, it[1], m); }
    };
    if (!Array.isArray(it[1]) && it[1]) el.onclick = () => { closeAll(); it[1](); };
  });
  return m;
}
