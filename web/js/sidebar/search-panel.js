// Cây "trái" của màn Multi Search đặt ở sidebar: File Explorer (tìm tên / nội dung) + Dữ liệu khai báo. Bấm một file → tab Multi Search xem / sửa file đó
// (extension chuyển sự kiện ms.view tới tab; chưa có tab thì mở tab kèm file). Lưu · Lưu thành · ô Tìm trong file nằm ở tab; Check Voucher, Tự tìm khi đổi
// menu, Clone, mở IDE / thư mục, copy file nằm ở đây. Logic chép từ web/js/screens/multi-search.js bản trước khi dời cột trái.
import { setClipboard } from '../bridge.js';
import { menuAt } from '../ui/dialog.js';
import { esc, sec, iconBtn, declSection, fileSection, bindLayout, createDeclExplorer, createFileExplorer } from '../ui/explorer.js';
import { ic } from './icons.js';

const AUTO_KEY = 'multisearch_autofind';

/** Nạp web/js/ui/<tên>.js nếu có (Clone do gói khác làm); chưa có thì null. */
const optional = (name) => import('../ui/' + name + '.js').catch(() => null);

export function mountSearchPanel(root, env) {
  const { ctx } = env;
  const st = { state: null, menuSeq: 0, autoFind: true, menu: null };
  const head = iconBtn('auto', 'auto', 'Tự tìm khi đổi menu', 'yellow') + iconBtn('checkVoucher', 'voucher', 'Check Voucher: trùng controller giữa các Voucher.Controller.xxx', 'red');
  root.innerHTML = `
    <div class="sb-ctx" data-a="menu" hidden></div>
    ${fileSection({ history: true, extraHead: head })}
    ${sec('info', 'Check Voucher', `<span class="cnt" data-a="infoCount"></span><span class="sp"></span>${iconBtn('infoClose', 'close', 'Đóng kết quả')}`,
      '<div class="sb-info mono" data-a="infoBody"></div>', ' info')}
    ${declSection()}`;
  const q = (a) => root.querySelector(`[data-a="${a}"]`);
  const lay = bindLayout(root, q, 'fsd.sidebar.multiSearch.layout');
  const toastErr = (e) => ctx.toast('⚠ ' + esc(e.message || e));
  const info = root.querySelector('section[data-x="info"]');
  info.hidden = true;
  const reveal = (full) => ctx.call('file.reveal', { path: full }).catch(toastErr);
  const openFolder = (dir) => ctx.call('ms.openDefault', { path: dir }).catch(toastErr);

  const add = async (cmd, args) => {
    try { const r = await ctx.call(cmd, args); ctx.toast(r && r.message ? esc(r.message) : '⇪ Đã thêm vào Update'); return true; } catch (e) { toastErr(e); return false; }
  };
  const decl = createDeclExplorer({ q, ctx, add: (items) => add('upd.addDeclare', { items }) });
  const fx = createFileExplorer({
    q, ctx, project: ctx.project, state: () => st.state,
    queryHistory: 'fsd52.multiSearch.queries', pathHistory: 'fsd52.multiSearch.paths', enterNext: true,
    add: (files, program) => add('upd.addExplorerFiles', { root: program, files }),
    onSelect: (full) => view(full),
    onOpen: (full) => ctx.call('ms.openDefault', { path: full }).catch(toastErr),
    // Tìm theo nội dung → ô Tìm của editor (ở tab) lấy cùng chuỗi để tô chỗ khớp khi mở file (5.1 _syncingFindTextFromFileSearch).
    onSearch: (text, content) => { if (content) env.toTab('ms.find', { text: text.split(',')[0].trim() }); },
    onProgram: (program, mode) => env.share('multi-search', program, mode),
    menuItems: (n, full) => fileMenu(full, n),
    folderMenu: (dir) => [['Mở thư mục', () => openFolder(dir)], ['Copy đường dẫn', () => setClipboard(dir)]]
  });

  /** Bấm file → tab Multi Search xem (chưa có tab: mở tab kèm file). */
  function view(full) { env.toTab('ms.view', { path: full }, { reveal: true, open: { file: full } }); }

  /** Menu chuột phải cây file (5.1 mnStrip). Lưu / Lưu thành thao tác trên file đang xem ở tab. */
  function fileMenu(full, n) {
    return [
      ['Check Voucher', checkVoucher], '-',
      ['Copy tên file', () => { const nm = full.split('\\').pop().replace(/\.[^.]*$/, ''); setClipboard(nm); ctx.toast('Đã copy tên file: ' + esc(nm)); }],
      ['Copy file vào clipboard\tCtrl+Shift+C', copyFiles],
      ['Copy đường dẫn', () => { const list = n ? fx.targets() : [full]; setClipboard(list.join('\r\n')); ctx.toast('Đã copy đường dẫn: ' + esc(list[0])); }], '-',
      ['Mở (double click)', () => ctx.call('ms.openDefault', { path: full }).catch(toastErr)],
      ['Mở thư mục chứa\tCtrl+L', () => reveal(full)],
      ['Mở các file đã tick ở editor\tCtrl+O', openChecked], '-',
      ['Lưu file đang xem ở tab\tCtrl+S', () => env.toTab('ms.cmd', { name: 'save' })],
      ['Lưu thành… (file đang xem)\tCtrl+Shift+S', () => env.toTab('ms.cmd', { name: 'saveAs' })],
      ['Clone File (Save As All)…', cloneFiles], '-',
      ['View XML (bung entity)\tShift+F12', () => ctx.open('DtdEntityViewer', { path: full })],
      ['Thêm vào Update', () => add('upd.addFile', { paths: n ? fx.targets() : [full] })]
    ];
  }

  function openChecked() {
    const list = fx.targets(false);
    if (!list.length) { ctx.toast('⚠ Tick chọn file trên cây'); q('fileTree').focus(); return; }
    ctx.call('ms.openIde', { paths: list, root: fx.st.program }).then((m) => m && ctx.toast(esc(m))).catch(toastErr);
  }
  /** Clone File / Save As All (5.1 btnSaveAsAll): file tick (không tick → file đang chọn), From = ô tìm file. */
  async function cloneFiles() {
    const prog = fx.st.program;
    const list = fx.targets().filter((p) => p.toLowerCase().startsWith(prog.toLowerCase())).map((p) => p.slice(prog.length));
    if (!list.length) { ctx.toast('⚠ Tick chọn file trên cây'); q('fileTree').focus(); return; }
    const m = await optional('save-as-all');
    if (!m || !m.saveAsAll) { ctx.toast('⚠ Clone File (Save As All) chưa có trong extension'); return; }
    m.saveAsAll(ctx, { source: prog, files: list, from: q('fileText').value });
  }
  function copyFiles() {
    const list = fx.targets();
    if (!list.length) { ctx.toast('⚠ Tick chọn file trên cây'); q('fileTree').focus(); return; }
    ctx.call('ms.copyFiles', { paths: list }).then((m) => ctx.toast(esc(m))).catch(toastErr);
  }

  /* ===== Check Voucher ===== */
  async function checkVoucher() {
    let r;
    try { r = await ctx.call('ms.checkVoucher', { root: fx.st.program }); } catch (e) { toastErr(e); return; }
    if (!r.errors.length) { ctx.toast('Các file Voucher.Controller.* không thấy lỗi'); info.hidden = true; return; }
    q('infoCount').textContent = `( ${r.errors.length} )`;
    q('infoBody').innerHTML = r.errors.map((x) => `<div><span class="ms-a">${esc(x.a)} &lt;=&gt; ${esc(x.b)}</span> : <span class="ms-e">${esc(x.name)}</span></div>`).join('');
    info.hidden = false;
    lay.layout.closed.info = false; lay.save(); lay.apply();
    fx.showFiles(r.files.map((rel) => ({ full: rel, folder: rel.slice(0, rel.lastIndexOf('\\')), name: rel.split('\\').pop(), mtime: '' })));
  }
  q('checkVoucher').onclick = checkVoucher;
  q('infoClose').onclick = () => { info.hidden = true; };

  /* ===== Tự tìm khi đổi menu (registry multisearch_autofind, chung 5.1) ===== */
  function autoBtn() { q('auto').classList.toggle('on', st.autoFind); q('auto').title = st.autoFind ? 'Đang tự tìm khi đổi menu — bấm để tắt' : 'Không tự tìm khi đổi menu — bấm để bật'; }
  q('auto').onclick = async () => { st.autoFind = await ctx.call('upd.option', { name: AUTO_KEY, value: !st.autoFind }).catch(() => !st.autoFind); autoBtn(); };

  function showMenu() {
    const m = st.menu, el = q('menu');
    el.hidden = !m;
    if (m) { el.innerHTML = `${ic('search', 'blue')}<b>${esc(m.id)}</b><span class="t">${esc(m.t)}</span>`; el.title = `Menu mở kèm tab Multi Search: ${m.id} - ${m.t}`; }
  }
  /** Chọn menu (5.1 _MenuChangeW / _MenuChangeMob / _MenuChange): điền ô tìm file theo menu, tự tìm nếu bật. */
  async function menuChanged(kind, n) {
    st.menu = { kind, id: n.id, t: n.t || n.id };
    showMenu();
    const seq = ++st.menuSeq;
    await ready; // menu có thể tới trước khi upd.state / thư mục chương trình nạp xong
    if (seq !== st.menuSeq) return;
    decl.clear();
    try {
      const r = await fx.menuChanged(kind, n, { autoFind: st.autoFind });
      if (!r || seq !== st.menuSeq) return;
      if (r.other) decl.setText(r.other);
      if (!st.autoFind) ctx.toast(esc(n.id + ' - ' + n.t));
    } catch (e) { toastErr(e); }
  }

  /* ===== Phím (5.1 ProcessCmdKey: cây file) ===== */
  root.addEventListener('keydown', (e) => {
    // Shift+F12: View XML (bung entity) file đang chọn.
    if (e.shiftKey && !e.ctrlKey && e.key === 'F12') { const c = fx.tree.current(); if (c && !c.children) { e.preventDefault(); ctx.open('DtdEntityViewer', { path: fx.st.program + c.data.full }); } return; }
    if (!e.ctrlKey || e.altKey || !e.target.closest('[data-a="fileTree"]')) return;
    const k = e.key.toLowerCase();
    if (e.shiftKey && k === 'c') { e.preventDefault(); copyFiles(); }
    else if (!e.shiftKey && k === 'l') { e.preventDefault(); const c = fx.tree.current(); if (c && !c.children) reveal(fx.st.program + c.data.full); }
    else if (!e.shiftKey && k === 'o') { e.preventDefault(); openChecked(); }
    else if (k === 's') { e.preventDefault(); env.toTab('ms.cmd', { name: e.shiftKey ? 'saveAs' : 'save' }); }
  });

  /* ===== Khởi động ===== */
  const ready = (async () => {
    try { st.state = await ctx.call('upd.state'); } catch (e) { toastErr(e); return; }
    await fx.init();
    st.autoFind = await ctx.call('upd.option', { name: AUTO_KEY }).catch(() => true); autoBtn();
    lay.apply();
  })();

  return {
    menuChanged,
    event: (name) => {
      if (name === 'checkVoucher') ready.then(checkVoucher);
      else if (name === 'clone') ready.then(cloneFiles);
    },
    focus: () => q('fileText').focus(),
    dispose: () => clearTimeout(fx.st.timer)
  };
}
