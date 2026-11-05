// Màn Multi Search (thay ucMultiSearch 5.1) — phần xem / sửa file bên phải, rộng hết cỡ: xem / sửa file đang chọn (Monaco): Lưu (UTF-8 BOM, không ghi .f),
// Lưu thành, Mở bằng IDE (editor của IDE), Định dạng, ô Tìm tô mọi chỗ khớp, Xuống dòng. Đối chiếu: docs/v5.2/parity/multi-search.md.
// Cột trái 5.1 (File Explorer + SQL Content Declare) đã dời ra view "Cây màn" ở sidebar trái (web/js/sidebar/search-panel.js): bấm một file ở đó
// thì extension gửi sự kiện ms.view tới tab này; ms.find (tô chuỗi tìm theo nội dung), ms.cmd (Lưu / Lưu thành từ menu của cây) cũng đi đường đó.
// Check Voucher, Clone, Tự tìm khi đổi menu, copy file nằm ở view; tab gọi sang view bằng side.send.
// Bản extension (chép từ FSDStudio52\Web\js\screens\multi-search.js): "Mở IDE" mở file ở editor của VS Code / Cursor (ms.openIde / file.openIde);
// mở thư mục / chọn file trong Explorer dùng ms.openDefault / file.reveal; View XML (entity-view) nạp khi có file đó trong web/js/ui.
import { showDialog, menuAt } from '../ui/dialog.js';
import { setClipboard } from '../bridge.js';
import { createEditor } from '../ui/editor.js';
import { esc } from '../ui/explorer.js';
import { ic } from '../sidebar/icons.js';

const WRAP_KEY = 'fsd52.multiSearch.wrap';
const SCREEN = 'multi-search';

/** Nạp web/js/ui/<tên>.js nếu có (View XML do gói khác làm); chưa có thì null. */
const optional = (name) => import('../ui/' + name + '.js').catch(() => null);

/** Nút icon (tooltip thay nhãn chữ). */
const ib = (a, icon, title, color, cls = '') => `<button class="icon-btn${cls ? ' ' + cls : ''}" data-a="${a}" title="${title}">${ic(icon, color, 14)}</button>`;

export function mount(root, ctx) {
  const st = { path: '', saved: '', editor: null, findDecos: [] };
  root.innerHTML = `
    <div class="scr-bar">
      <a class="ms-path mono" data-a="path" title="Bấm: copy đường dẫn · chuột phải: thao tác file">(chưa chọn file)</a>
      <span class="sp"></span>
      <input class="ms-find" data-a="find" spellcheck="false" placeholder="Tìm trong file (≥ 2 ký tự)">
      <label class="chk" title="Xuống dòng dòng dài (nhớ theo máy)"><input type="checkbox" data-a="wrap">${ic('wrap', 'muted', 14)}</label>
      <span class="sep"></span>
      ${ib('beauty', 'format', 'Định dạng SQL / JSON / XML (phần bôi đen hoặc cả file)', 'purple')}${ib('ide', 'ide', 'Mở file ở editor của IDE', 'blue')}
      ${ib('saveAs', 'saveAs', 'Lưu thành file khác · Ctrl+Shift+S', 'green')}${ib('clone', 'clone', 'Save As All: nhân bản các file tick ở cây, đổi chuỗi From → To (From = ô tìm file)', 'orange')}
      ${ib('focusTree', 'panel', 'Mở cây Tìm file ở sidebar trái (File · Dữ liệu khai báo)', 'orange')}
      <button class="btn primary" data-a="save" title="Lưu file đang xem (UTF-8 BOM) · Ctrl+S">${ic('save', '', 14)}Lưu</button>
    </div>
    <div class="ms-body">
      <div class="ms-main">
        <div class="ms-edit" data-a="editor"><div class="empty">Bấm một file ở cây Tìm file (sidebar trái) để xem / sửa · double click ở cây mở ở editor của IDE.</div></div>
      </div>
    </div>`;
  const q = (a) => root.querySelector(`[data-a="${a}"]`);
  ctx.setTitle('Multi Search');
  const toastErr = (e) => ctx.toast('⚠ ' + esc(e.message || e));
  const reveal = (full) => ctx.call('file.reveal', { path: full }).catch(toastErr);
  /** Việc của cây ở sidebar (Check Voucher, Clone): gửi sang view, chưa mở thì extension giữ / bỏ tin. */
  const toTree = (event, data) => ctx.call('side.send', { screen: SCREEN, event, data })
    .then((r) => { if (r && !r.delivered && event !== 'menu') ctx.toast('⚠ Cây Tìm file ở sidebar trái chưa mở — bấm nút cạnh Lưu để mở'); })
    .catch(toastErr);

  /** Menu chuột phải đường dẫn (5.1 mnStrip): thao tác trên file đang xem. */
  function fileMenu(full) {
    return [
      ['Check Voucher', () => toTree('checkVoucher')], '-',
      ['Copy tên file', () => { const nm = full.split('\\').pop().replace(/\.[^.]*$/, ''); setClipboard(nm); ctx.toast('Đã copy tên file: ' + esc(nm)); }],
      ['Copy file vào clipboard\tCtrl+Shift+C', () => copyFile(full)],
      ['Copy đường dẫn', () => { setClipboard(full); ctx.toast('Đã copy đường dẫn: ' + esc(full)); }], '-',
      ['Mở bằng ứng dụng mặc định', () => ctx.call('ms.openDefault', { path: full }).catch(toastErr)],
      ['Mở ở editor của IDE', () => openIde([full])],
      ['Mở thư mục chứa\tCtrl+L', () => reveal(full)], '-',
      ['Lưu\tCtrl+S', save], ['Lưu thành…\tCtrl+Shift+S', saveAs], ['Clone File (Save As All)…', () => toTree('clone')], '-',
      ['View XML (bung entity)\tShift+F12', () => ctx.open('DtdEntityViewer', { path: full })],
      ['Thêm vào Update', () => ctx.call('upd.addFile', { paths: [full] }).then((r) => ctx.toast(r && r.message ? esc(r.message) : '⇪ Đã thêm vào Update')).catch(toastErr)]
    ];
  }

  /* ===== Xem / sửa file ===== */
  const dirty = () => st.editor && st.path && st.editor.getValue() !== st.saved;
  /** Đường dẫn: thư mục mờ, tên file đậm; ● đầu dòng = chưa lưu. */
  function showPath() {
    const el = q('path');
    if (!st.path) { el.textContent = '(chưa chọn file)'; el.title = ''; return; }
    const i = st.path.lastIndexOf('\\');
    el.innerHTML = (dirty() ? `<span class="ms-dirty">●</span> ` : '') + `<span class="faint">${esc(st.path.slice(0, i + 1))}</span><b>${esc(st.path.slice(i + 1))}</b>`;
    el.title = st.path + '\nBấm: copy đường dẫn · chuột phải: thao tác file';
  }
  async function view(full) {
    if (full === st.path) return;
    if (dirty() && !await showDialog({ title: 'File chưa lưu', note: 'Bỏ phần sửa ở <span class="mono">' + esc(st.path.split('\\').pop()) + '</span> để xem file khác?', ok: 'Bỏ sửa' })) return;
    let f;
    try { f = await ctx.call('file.read', { path: full }); } catch (e) { toastErr(e); return; }
    st.path = f.path; st.saved = f.text;
    if (!st.editor) {
      q('editor').innerHTML = '';
      st.editor = await createEditor(q('editor'), { value: f.text, language: f.language, wordWrap: q('wrap').checked ? 'on' : 'off' });
      st.editor.onDidChangeModelContent(() => showPath());
      st.editor.addCommand(window.monaco.KeyMod.CtrlCmd | window.monaco.KeyCode.KeyS, save);
      st.editor.addCommand(window.monaco.KeyMod.CtrlCmd | window.monaco.KeyMod.Shift | window.monaco.KeyCode.KeyS, saveAs);
      // ENTITY (5.1 mnGotoEntityDef / mnViewEntity / mnViewAllEntities): thay Go to Definition / Peek mặc định của Monaco — chỉ khi có ui/entity-view.js.
      const ev = await optional('entity-view');
      if (ev && ev.entityFromEditor) {
        const K = window.monaco.KeyCode, M = window.monaco.KeyMod;
        const ent = (kind) => () => ev.entityFromEditor(ctx, st.editor, st.path, kind).catch(toastErr);
        [['ent.def', 'Go to Definition ENTITY — Ctrl+Click', [], 'definition'], ['ent.flat', 'Chi tiết ENTITY — F12', [K.F12], 'flat'], ['ent.sel', 'Giải vùng chọn ENTITY — Ctrl+F12', [M.CtrlCmd | K.F12], 'selection']]
          .forEach(([id, label, keys, kind], i) => st.editor.addAction({ id, label, keybindings: keys, contextMenuGroupId: '0_entity', contextMenuOrder: i, run: ent(kind) }));
        st.editor.onMouseDown((e) => { if (e.event.ctrlKey && e.target.position) setTimeout(ent('definition'), 0); });
      }
    } else {
      st.editor.setValue(f.text);
      window.monaco.editor.setModelLanguage(st.editor.getModel(), f.language);
    }
    st.findDecos = [];
    showPath(); highlight();
  }
  /** Ô Tìm: ≥ 2 ký tự → tô mọi chỗ khớp (nguyên văn, không phân biệt hoa thường) và nhảy tới chỗ đầu (5.1 findText / _findAll). */
  function highlight() {
    if (!st.editor) return;
    const text = q('find').value.trim();
    const matches = text.length <= 1 ? [] : st.editor.getModel().findMatches(text, false, false, false, null, false);
    st.findDecos = st.editor.deltaDecorations(st.findDecos, matches.map((m) => ({ range: m.range, options: { inlineClassName: 'q-findhit', overviewRuler: { color: '#e5a50a', position: 4 } } })));
    if (matches.length) st.editor.revealRangeInCenterIfOutsideViewport(matches[0].range);
  }
  q('find').oninput = highlight;
  q('find').onkeydown = (e) => {
    if (e.key !== 'Enter' || !st.editor) return;
    e.preventDefault();
    const m = st.editor.getModel().findNextMatch(q('find').value.trim(), st.editor.getPosition(), false, false, null, false);
    if (m) { st.editor.setSelection(m.range); st.editor.revealRangeInCenter(m.range); }
  };
  try { q('wrap').checked = localStorage.getItem(WRAP_KEY) === '1'; } catch { /* storage bị chặn: mặc định tắt */ }
  q('wrap').onchange = () => {
    try { localStorage.setItem(WRAP_KEY, q('wrap').checked ? '1' : '0'); } catch { /* như trên */ }
    if (st.editor) st.editor.updateOptions({ wordWrap: q('wrap').checked ? 'on' : 'off' });
  };
  q('path').onclick = (e) => { e.preventDefault(); if (st.path) { setClipboard(st.path); ctx.toast('Đã copy đường dẫn'); } };
  q('path').oncontextmenu = (e) => { e.preventDefault(); if (st.path) menuAt(e.clientX, e.clientY, fileMenu(st.path)); };

  async function save() {
    if (!st.path || !st.editor) { ctx.toast('Chưa mở file nào'); return; }
    try { await ctx.call('ms.save', { path: st.path, text: st.editor.getValue() }); st.saved = st.editor.getValue(); showPath(); ctx.toast('Đã lưu'); } catch (e) { toastErr(e); }
  }
  async function saveAs() {
    if (!st.path || !st.editor) { ctx.toast('Chưa mở file nào'); return; }
    const ext = (st.path.match(/\.([^.\\]+)$/) || [])[1] || '';
    const f = await ctx.call('file.pick', { save: true, filter: ext, path: st.path });
    if (!f) return;
    try {
      await ctx.call('ms.save', { path: f.path, text: st.editor.getValue() });
      st.path = f.path; st.saved = st.editor.getValue(); showPath(); ctx.toast('Đã lưu <span class="mono">' + esc(f.path) + '</span>');
    } catch (e) { toastErr(e); }
  }
  q('save').onclick = save;
  q('saveAs').onclick = saveAs;
  q('clone').onclick = () => toTree('clone');
  q('focusTree').onclick = () => ctx.call('side.focus').catch(toastErr);
  q('ide').onclick = () => { if (!st.path) { ctx.toast('Chưa mở file nào'); return; } openIde([st.path]); };
  const openIde = (paths) => ctx.call('ms.openIde', { paths }).then((m) => m && ctx.toast(esc(m))).catch(toastErr);
  const copyFile = (full) => ctx.call('ms.copyFiles', { paths: [full] }).then((m) => ctx.toast(esc(m))).catch(toastErr);
  q('beauty').onclick = () => {
    const r = q('beauty').getBoundingClientRect();
    menuAt(r.left, r.bottom + 2, [['Định dạng SQL', () => beauty('sql')], ['Định dạng JSON', () => beauty('json')], ['Định dạng XML', () => beauty('xml')]]);
  };
  async function beauty(mode) {
    if (!st.editor) { ctx.toast('Chưa mở file nào'); return; }
    const s = st.editor.getSelection(), model = st.editor.getModel();
    const range = s && !s.isEmpty() ? s : model.getFullModelRange();
    try { st.editor.executeEdits('beauty', [{ range, text: await ctx.call('format.text', { mode, text: model.getValueInRange(range) }) }]); } catch (e) { toastErr(e); }
  }

  /* ===== Sự kiện từ cây ở sidebar (sideTreeView.ts → ScreenHost.emit) ===== */
  ctx.on('ms.view', (d) => { if (d && d.path) view(String(d.path)); });
  ctx.on('ms.find', (d) => { q('find').value = String((d && d.text) || ''); highlight(); });
  ctx.on('ms.cmd', (d) => {
    const name = d && d.name;
    if (name === 'save') save(); else if (name === 'saveAs') saveAs();
  });

  /* ===== Phím trong editor (5.1 ProcessCmdKey; phím trong cây file xử lý ở sidebar) ===== */
  root.addEventListener('keydown', (e) => {
    if (!st.path || !e.target.closest('[data-a="editor"]')) return;
    // Shift+F12: View XML (bung entity) file đang xem.
    if (e.shiftKey && !e.ctrlKey && e.key === 'F12') { e.preventDefault(); ctx.open('DtdEntityViewer', { path: st.path }); return; }
    if (!e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (e.shiftKey && k === 'c' && !(st.editor && !st.editor.getSelection().isEmpty())) { e.preventDefault(); copyFile(st.path); }
    else if (!e.shiftKey && k === 'l') { e.preventDefault(); reveal(st.path); }
    else if (!e.shiftKey && k === 'o') { e.preventDefault(); openIde([st.path]); }
  });

  /* ===== Khởi động ===== */
  // Mở kèm menu (ctx.open('MultiSearch', { menu })) → chuyển sang cây ở sidebar điền sẵn ô tìm file như 5.1; mở kèm file → xem luôn.
  const m = ctx.opts && ctx.opts.menu;
  if (m && m.id) toTree('menu', { kind: m.kind || 'fbo', n: m });
  if (ctx.opts && ctx.opts.file) view(String(ctx.opts.file));
  return {
    focus: () => q('find').focus(),
    dispose: () => { if (st.editor) st.editor.dispose(); }
  };
}
