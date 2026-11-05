// Màn thử nền webview (lệnh ẩn fsd.screenDemo): thanh công cụ + Monaco + lưới 1.000 dòng giả + hộp thoại / menu.
// Dùng để kiểm Monaco (worker blob, theme theo IDE), lưới ảo, CSS và cầu nối trước khi chép màn Query / Select Table.
import { createEditor } from '../ui/editor.js';
import { createGrid } from '../ui/grid.js';
import { showDialog, showText, menuAt } from '../ui/dialog.js';
import { attachSqlSense } from '../ui/sqlsense.js';

const ROWS = 1000;

function fakeData() {
  const columns = [
    { name: 'stt', header: 'stt', clr: 'System.Int32' },
    { name: 'ma_kh', header: 'ma_kh', clr: 'System.String' },
    { name: 'ten_kh', header: 'ten_kh', clr: 'System.String' },
    { name: 'ngay_ct', header: 'ngay_ct', clr: 'System.DateTime', format: 'd' },
    { name: 'so_du', header: 'so_du', clr: 'System.Decimal', format: '### ##0.00' },
    { name: 'hoat_dong', header: 'hoat_dong', clr: 'System.Boolean' }
  ];
  const rows = [];
  for (let i = 1; i <= ROWS; i++) {
    rows.push([i, 'KH' + String(i).padStart(4, '0'), i % 17 === 0 ? null : 'Công ty ' + i, `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`, i * 1234.5, i % 3 === 0]);
  }
  return { columns, rows };
}

export function mount(root, ctx) {
  const project = ctx.project() || {};
  root.innerHTML = `
    <div class="scr-bar">
      <button class="btn primary" data-a="run" title="Giả lập chạy">▶ Chạy</button>
      <button class="btn" data-a="dlg" title="Thử hộp thoại">Hộp thoại</button>
      <button class="btn" data-a="menu" title="Thử menu thả">Menu ▾</button>
      <button class="btn" data-a="text" title="Thử xem văn bản">Xem chữ</button>
      <button class="btn" data-a="db" title="QuickPick DB của tab">DB…</button>
      <span class="sp"></span>
      <span class="muted" data-a="status">${project.code || ''} · ${project.db || ''}</span>
    </div>
    <div class="q-edit" data-a="editor"></div>
    <div class="q-split" data-a="split"></div>
    <div class="q-res"><div class="rtabs"><button class="on">Kết quả (${ROWS})</button></div><div class="q-out" data-a="out"></div></div>`;
  const q = (a) => root.querySelector(`[data-a="${a}"]`);
  let editor = null;

  createEditor(q('editor'), { value: 'SELECT TOP 100 a.ma_kh, a.ten_kh\nFROM dmkh a\nWHERE a.ma_kh LIKE \'KH%\'\n' }).then((ed) => {
    editor = ed;
    attachSqlSense(ed, () => ({ call: ctx.call, db: project.db }));
    ed.focus();
  }).catch((e) => { q('editor').innerHTML = `<div class="empty">${e.message}</div>`; });

  const grid = createGrid(q('out'), fakeData(), { title: 'Demo', quickFilter: true });

  // Kéo thanh chia đổi chiều cao editor.
  q('split').onmousedown = (ev) => {
    ev.preventDefault();
    const top = q('editor').getBoundingClientRect().top;
    const move = (e) => { q('editor').style.flex = 'none'; q('editor').style.height = Math.max(80, e.clientY - top) + 'px'; };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  q('run').onclick = () => ctx.toast('Đã chạy giả lập <b>' + ROWS + '</b> dòng');
  q('dlg').onclick = async () => {
    const v = await showDialog({ title: 'Thử hộp thoại', fields: [{ id: 'name', label: 'Tên', value: project.code || '', required: true }, { id: 'ok', label: 'Chọn', type: 'check', value: true }] });
    if (v) ctx.toast('Đã nhập: ' + v.name);
  };
  q('menu').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    menuAt(r.left, r.bottom + 2, [['Mục 1', () => ctx.toast('Mục 1')], ['Mục 2', () => ctx.toast('Mục 2'), 'Ctrl+2'], '-', ['Không bấm được', null]]);
  };
  q('text').onclick = () => showText({ title: 'Văn bản', text: editor ? editor.getValue() : '' });
  q('db').onclick = () => ctx.open('SetDatabaseTab');

  return {
    focus: () => editor && editor.focus(),
    isDirty: () => false,
    db: () => project.db,
    setDb: (name) => { project.db = name; q('status').textContent = `${project.code} · ${name}`; ctx.toast('Đổi DB: <b>' + name + '</b>'); },
    dispose: () => { grid.dispose(); if (editor) editor.dispose(); }
  };
}
