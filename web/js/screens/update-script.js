// Màn Update Script (thay ucUpdateScript 5.1) — phần làm việc bên phải: thêm theo loại + mã / file theo loại / dữ liệu bảng (Other Gen) /
// Other SQL App · Sys; danh sách gen (Update); tạo Update (Working path, Save To + Memo, thư mục con) + Load / Save Update theo menu
// (cặp .upd + folder) và cây Update vừa tạo. Rộng hết cỡ: cột trái 5.1 (Đối tượng SQL · File · Dữ liệu khai báo) đã dời ra view "Cây màn"
// ở sidebar trái (web/js/sidebar/update-panel.js), tick ở đó rồi "＋" thì danh sách ở đây tự cập nhật (sự kiện upd.changed).
// Danh sách Update giữ ở host (lệnh upd.*) nên thêm từ màn khác (panel SQL, Select Table, menu) cũng hiện ở đây.
// Bản extension: menu nằm ở panel MENU của IDE, không có cây menu trong tab → menu cho Save / Load Update lấy từ ctx.opts.menu
// ({ kind, id, t, sys, code, type, link, exe }) do nơi mở màn truyền vào (ctx.open('UpdateScript', { menu })); tab chuyển menu đó sang view
// "Cây màn" để điền sẵn 3 ô tìm. Thư mục chương trình (Program path) do view chọn, tab đọc qua side.get / side.program.
import { showDialog, showCode, menuAt } from '../ui/dialog.js';
import { setClipboard } from '../bridge.js';
import { esc, makeTree, sec, bindLayout } from '../ui/explorer.js';
import { ic, fileIcon } from '../sidebar/icons.js';

const TYPE_LABEL = { R: 'BC', L: 'DM', V: 'CT', M: 'TB', S: 'SQL', T: 'Bảng', O: 'Data', E: 'Exe', P: 'Rpt', X: 'File' };
const SCREEN = 'update-script';

/** Nút icon (tooltip thay nhãn chữ). */
const ib = (a, icon, title, color, cls = '') => `<button class="icon-btn${cls ? ' ' + cls : ''}" data-a="${a}" title="${title}">${ic(icon, color, 14)}</button>`;

export function mount(root, ctx) {
  const st = {
    state: null, sel: new Set(), menu: null,
    seq: 0, created: null, codes: [], fileTypes: [],
    // Thư mục chương trình + chế độ (fbo | mob | fb) do view "Cây màn" đang chọn; chưa nhận thì dùng mặc định theo mode như 5.1.
    program: '', mode: ((ctx.opts && ctx.opts.menu && ctx.opts.menu.kind) || ((ctx.project() || {}).kind === '1' ? 'fb' : 'fbo'))
  };
  // Vùng nào cũng thu / mở được bằng thanh tiêu đề (nhớ theo máy).
  root.innerHTML = `
    <div class="scr-bar">
      ${ib('open', 'open', 'Mở tệp .upd (thay danh sách)', 'yellow')}${ib('recent', 'history', 'Recent Load — nạp lại .upd vừa mở / lưu', 'blue')}${ib('merge', 'merge', 'Gộp thêm .upd vào danh sách, bỏ dòng trùng', 'purple')}
      ${ib('save', 'save', 'Lưu danh sách ra tệp .upd', 'green')}${ib('saveas', 'saveAs', 'Lưu thành… (chọn tệp .upd khác)', 'green')}
      <span class="sep"></span>
      <a class="up-file" data-a="file" title="Bấm: mở thư mục · chuột phải: copy">Tệp Update: </a>
      <span class="sp"></span><span class="up-menu mono" data-a="menu" title="Menu đang chọn (Save / Load Update theo menu)"></span>
      ${ib('focusTree', 'panel', 'Mở cây Update ở sidebar trái (Đối tượng SQL · File · Dữ liệu khai báo)', 'orange')}
    </div>
    <div class="up-body">
      <div class="up-main">
        ${sec('add', 'Thêm vào Update', '<span class="muted">loại + mã · file · dữ liệu bảng · SQL thêm</span>', `<div class="form up-add2">
          <div class="frow"><span class="lb">Loại</span><select data-a="cat" class="up-sel"></select><input data-a="code" class="mono grow" spellcheck="false" list="upCodes" placeholder="Mã"><datalist id="upCodes"></datalist>
            <span class="acts"><label class="chk" data-a="alterBox"><input type="checkbox" data-a="alter">ALTER</label><label class="chk" data-a="quotedBox"><input type="checkbox" data-a="quoted">QUOTED OFF</label>
            <button class="btn primary" data-a="addCat" title="Thêm vào Update · phím 1 / 2 trên nút: bật tắt ALTER / QUOTED OFF">${ic('plus', '', 14)}</button></span></div>
          <div class="frow"><span class="lb">File</span><select data-a="ftype" class="up-sel"></select><input data-a="fname" class="mono grow" spellcheck="false" list="upFiles" placeholder="Tên file trong thư mục của loại"><datalist id="upFiles"></datalist>
            <span class="acts">${ib('pickFiles', 'open', 'Chọn file trên đĩa (nhiều file)', 'yellow')}<button class="btn primary" data-a="addTyped" title="Thêm file vào Update">${ic('plus', '', 14)}</button></span></div>
          <div class="frow"><span class="lb">Dữ liệu</span><select data-a="odb" class="up-sel"><option value="Sys">Sys</option><option value="App" selected>App</option></select>
            <input data-a="table" class="mono grow" spellcheck="false" list="upTables" placeholder="Bảng"><datalist id="upTables"></datalist><input data-a="key" class="mono grow" spellcheck="false" placeholder="Điều kiện (rỗng = 1=1)">
            <span class="acts"><button class="btn primary" data-a="addData" title="Thêm dữ liệu bảng vào Update">${ic('plus', '', 14)}</button></span></div>
          <div class="frow"><span class="lb">SQL thêm</span><span class="muted grow">Script tự viết chạy kèm Update (00.OtherSQL_app / 00.OtherSQL_sys)</span>
            <span class="acts"><button class="btn" data-a="otherApp" title="SQL thêm chạy trên DB App">App</button><button class="btn" data-a="otherSys" title="SQL thêm chạy trên DB Sys">Sys</button></span></div>
        </div>`)}
        ${sec('list', 'Danh sách gen', `<span class="cnt" data-a="listCount"></span><span class="sp"></span>
            ${ib('remove', 'trash', 'Xóa dòng tick (không tick: dòng đang chọn) · phím Delete', 'red')}${ib('clear', 'clearAll', 'Xóa hết danh sách', 'red')}`,
          '<div class="up-list" data-a="list" tabindex="0"></div>', ' grow')}
        ${sec('create', 'Tạo Update', '<span class="muted mono up-hint" data-a="createHint"></span>', `<div class="form up-create">
          <div class="frow"><span class="lb">Thư mục</span><input data-a="working" class="mono grow" spellcheck="false"><span class="acts">${ib('pickWorking', 'folder', 'Chọn thư mục', 'yellow')}${ib('openWorking', 'open', 'Mở thư mục', 'yellow')}</span></div>
          <div class="frow"><span class="lb">Tên Update</span><input data-a="saveTo" class="mono grow" spellcheck="false"><span class="acts"></span></div>
          <div class="frow"><span class="lb">Mô tả</span><input data-a="memo" class="mono grow" spellcheck="false" placeholder="Mã yc / mô tả"><span class="acts"></span></div>
          <div class="frow"><span class="sp"></span><span class="acts"><button class="btn" data-a="create" title="Tạo thư mục Update dưới Thư mục (Tên Update + Mô tả)">${ic('pkg', 'orange', 14)}Tạo Update</button>
            <button class="btn" data-a="loadMenu" title="Danh sách Update (.upd) của menu đang chọn">${ic('open', 'yellow', 14)}Mở theo menu</button><button class="btn primary" data-a="saveMenu" title="Lưu cặp .upd + thư mục Update theo menu đang chọn">${ic('save', '', 14)}Lưu theo menu</button></span></div>
        </div>`)}
        ${sec('pkg', 'Thư mục Update', `<a class="up-path mono" data-a="pkgPath" title="Bấm: mở thư mục · chuột phải: Copy Working Path"></a><span class="sp"></span>
            ${ib('delPkg', 'trash', 'Xóa thư mục Update', 'red')}`, '<div class="ut up-pkg" data-a="pkgTree"></div>', ' pkg')}
      </div>
    </div>`;
  const q = (a) => root.querySelector(`[data-a="${a}"]`);
  ctx.setTitle('Update');

  /* ===== Bố cục: thu / mở từng vùng — nhớ theo máy (localStorage, lỗi thì bỏ qua) ===== */
  const lay = bindLayout(root, q, 'fsd.updateScript.layout');
  const toastErr = (e) => ctx.toast('⚠ ' + esc(e.message || e));
  const sysDb = () => (ctx.project() || {}).sysDb, appDb = () => (ctx.project() || {}).db;

  /* ===== Thư mục chương trình: view "Cây màn" chọn, tab dùng làm gốc khi thêm file / tạo Update ===== */
  /** 5.1 GetDefaultProgramPathForMode: Mobile → MobileApp; có Web → Web root; không → thư mục FB. */
  function defaultProgram() { const s = st.state || {}; return st.mode === 'mob' ? s.mobileRoot || s.webRoot : s.webRoot || s.fbRoot; }
  const program = () => { const p = st.program || defaultProgram() || ''; return p ? p.replace(/[\\/]?$/, '\\') : ''; };
  /** Nhận thư mục / chế độ mới từ view (hoặc đọc lần đầu). */
  function setProgram(d) {
    if (!d || !d.program) return;
    st.program = d.program; st.mode = d.mode || st.mode;
    loadTypedFiles();
  }
  ctx.on('side.program', setProgram);


  /* ===== Danh sách gen (Update) ===== */
  function render(s) {
    st.state = s; if (!s) return;
    const catSel = q('cat');
    if (!catSel.options.length) {
      catSel.innerHTML = s.categories.map((c) => `<option value="${esc(c.text)}">${esc(c.text)}</option>`).join('');
      catSel.value = (s.categories.find((c) => c.text.toUpperCase() === 'STORE') || s.categories[0] || {}).text || '';
      loadCodes();
    }
    if (!q('working').value) q('working').value = s.workingDir;
    if (!q('saveTo').value) q('saveTo').value = s.saveTo;
    if (document.activeElement !== q('list')) st.sel.clear();
    const f = q('file');
    f.textContent = 'Tệp Update: ' + (s.file || '(chưa lưu)');
    f.title = s.file || 'Bấm: mở thư mục Update của dự án';
    // Other SQL App / Sys (Script\App\00.OtherSQL_app.sql, Script\Sys\00.OtherSQL_sys.sql): dòng riêng đầu danh sách, bấm để sửa.
    const others = [['app', 'App', s.otherApp], ['sys', 'Sys', s.otherSys]].filter((o) => o[2].trim());
    const lines = (t) => t.split(/\r?\n/).filter((x) => x.trim()).length;
    const preview = (t) => t.trim().split(/\r?\n/).find((x) => x.trim() && !/^go$/i.test(x.trim())) || '';
    const list = q('list');
    const otherHtml = others.map(([k, db, t]) => `<div class="up-item up-other" data-o="${k}" title="Bấm để xem / sửa · chuột phải: xóa"><span class="up-cb"></span><span class="up-badge t-Q">SQL</span>` +
      `<span class="nm"><b>SQL thêm ${db}</b> <span class="faint mono">${esc(preview(t).slice(0, 120))}</span></span><span class="faint">${lines(t)} dòng · ${db}</span></div>`).join('');
    list.innerHTML = s.rows.length || others.length ? otherHtml + s.rows.map((r) => `<label class="up-item${st.sel.has(r.i) ? ' on' : ''}${st.cur === r.i ? ' cur' : ''}" data-i="${r.i}" title="${esc(r.url ? r.url + r.value : r.view)}"><input type="checkbox" data-i="${r.i}"${st.sel.has(r.i) ? ' checked' : ''}>` +
      `<span class="up-badge t-${esc(r.type.charAt(0))}">${esc(TYPE_LABEL[r.type.charAt(0)] || r.type)}</span><span class="nm"><b>${esc(r.view)}</b></span><span class="faint">${esc(r.db)}</span></label>`).join('')
      : '<div class="empty">Danh sách trống — tick ở cây Update (sidebar trái) rồi bấm thêm, dùng vùng "Thêm vào Update", hoặc từ panel SQL / Select Table / menu (→ Update).</div>';
    q('listCount').innerHTML = `<b>${s.rows.length}</b> mục` + (others.length ? ` + SQL thêm <b>${others.map((o) => o[1]).join(', ')}</b>` : '');
    q('otherApp').classList.toggle('has', !!s.otherApp.trim()); q('otherApp').textContent = s.otherApp.trim() ? 'App ●' : 'App';
    q('otherSys').classList.toggle('has', !!s.otherSys.trim()); q('otherSys').textContent = s.otherSys.trim() ? 'Sys ●' : 'Sys';
    createHint();
  }
  /** Tên folder sẽ tạo (Save To + Memo) hiện trên thanh tiêu đề vùng Tạo Update — thấy khi vùng đang thu. */
  function createHint() { q('createHint').textContent = (q('saveTo').value.trim() + q('memo').value.trim()) || ''; }
  async function refresh() { render(await ctx.call('upd.state')); }
  async function act(cmd, args) {
    try {
      const r = await ctx.call(cmd, args || {});
      render(r.state);
      if (r.message) ctx.toast(esc(r.message).replace(/\n/g, '<br>'));
      return r;
    } catch (e) { toastErr(e); return null; }
  }
  q('list').onclick = (e) => {
    const o = e.target.closest('.up-other'); if (o) { editOther(o.dataset.o === 'sys'); return; }
    const it = e.target.closest('.up-item[data-i]'); if (!it) return;
    const i = +it.dataset.i;
    if (e.target.tagName === 'INPUT') { e.target.checked ? st.sel.add(i) : st.sel.delete(i); } else { st.cur = i; }
    q('list').querySelectorAll('.up-item').forEach((x) => x.classList.toggle('cur', +x.dataset.i === st.cur));
  };
  q('list').oncontextmenu = (e) => {
    const o = e.target.closest('.up-other'); if (!o) return;
    e.preventDefault();
    const isSys = o.dataset.o === 'sys';
    menuAt(e.clientX, e.clientY, [['Xem / sửa', () => editOther(isSys)], ['Copy', () => setClipboard(isSys ? st.state.otherSys : st.state.otherApp)], '-',
      ['Xóa SQL thêm ' + (isSys ? 'Sys' : 'App'), async () => { if (await showDialog({ title: 'Xóa SQL thêm', note: 'Xóa toàn bộ SQL thêm ' + (isSys ? 'Sys' : 'App') + ' của Update?', ok: 'Xóa' })) act('upd.setOtherSql', isSys ? { sys: '' } : { app: '' }); }]]);
  };
  q('list').onkeydown = (e) => { if (e.key === 'Delete') { e.preventDefault(); removeRows(); } };
  function removeRows() {
    const idx = st.sel.size ? [...st.sel] : st.cur != null ? [st.cur] : [];
    if (!idx.length) { ctx.toast('Tick dòng cần xóa'); return; }
    st.sel.clear(); st.cur = null; act('upd.remove', { indexes: idx });
  }
  q('remove').onclick = removeRows;
  q('clear').onclick = async () => { if (await showDialog({ title: 'Xóa hết', note: 'Xóa hết các mục trong danh sách?', ok: 'Xóa hết' })) act('upd.clear'); };

  /* ===== .upd: Load / Recent / Gộp / Save / Save As ===== */
  /** setMemo: Load Update theo menu — Memo lấy từ tên Update (5.1 LoadOneUpdateFileIntoUi); Load thường giữ Memo. */
  async function loadPaths(paths, merge, remember, setMemo) {
    const r = await act('upd.load', { paths, merge, remember });
    if (r && setMemo && paths.length === 1) { q('memo').value = r.state.lastMemo || ''; createHint(); }
    // Nạp 1 Update: hiện folder Update cùng tên cạnh .upd (cặp {name}.upd + {name}\, 5.1 BindLoadedPackageFolder).
    if (r && paths.length === 1 && !merge) {
      const pkg = await ctx.call('upd.packageOf', { path: paths[0] }).catch(() => null);
      if (pkg) { showCreated(pkg); lay.layout.closed.pkg = false; lay.save(); lay.apply(); }
      else { st.created = null; showPkg(false); ctx.toast('Chưa có folder Update cạnh <span class="mono">' + esc(paths[0].split(/[\\/]/).pop()) + '</span> — bấm Create / Save Update để tạo.'); }
    }
    return r;
  }
  q('open').onclick = async () => {
    const f = await ctx.call('file.pick', { filter: 'upd', path: q('working').value });
    if (f && await loadPaths([f.path], false, true)) ctx.toast('Đã nạp <span class="mono">' + esc(f.path) + '</span>');
  };
  q('recent').onclick = async () => {
    const f = await ctx.call('upd.recent');
    if (!f) { q('open').click(); return; }
    if (await loadPaths([f], false, false)) ctx.toast('Đã mở <span class="mono">' + esc(f) + '</span>');
  };
  q('merge').onclick = async () => {
    const f = await ctx.call('file.pick', { filter: 'upd', multi: true, path: q('working').value });
    if (f) await loadPaths(f.paths || [f.path], true, false);
  };
  const isEmpty = () => !st.state.rows.length && !st.state.otherApp.trim() && !st.state.otherSys.trim();
  async function save(as) {
    if (isEmpty()) { ctx.toast('⚠ Danh sách trống — không có gì để lưu.'); return; }
    let path = st.state.file;
    if (!path || as) {
      const f = await ctx.call('file.pick', { filter: 'upd', save: true, path: q('working').value });
      if (!f) return;
      path = /\.upd$/i.test(f.path) ? f.path : f.path + '.upd';
    }
    try { render(await ctx.call('upd.save', { path, remember: as || !st.state.file })); ctx.toast('Đã lưu <span class="mono">' + esc(path) + '</span>'); } catch (e) { toastErr(e); }
  }
  q('save').onclick = () => save(false);
  q('saveas').onclick = () => save(true);
  q('file').onclick = (e) => { e.preventDefault(); const f = st.state && st.state.file; ctx.call('shell.explore', f ? { path: f, select: true } : { path: st.state.updateRoot }).catch(toastErr); };
  q('file').oncontextmenu = (e) => {
    e.preventDefault(); const f = st.state && st.state.file; if (!f) return;
    menuAt(e.clientX, e.clientY, [['Copy tên file', () => setClipboard(f.split(/[\\/]/).pop())], ['Copy đường dẫn', () => setClipboard(f)]]);
  };

  /* ===== Thêm theo loại + mã ===== */
  const curCat = () => (st.state ? st.state.categories.find((c) => c.text === q('cat').value) : null);
  async function loadCodes() {
    const c = curCat(); if (!c) return;
    q('alterBox').hidden = q('quotedBox').hidden = c.type !== 'S';
    q('alter').checked = q('quoted').checked = false;
    q('code').value = '';
    const seq = ++st.seq;
    try { st.codes = await ctx.call('upd.categoryCodes', { category: c.text }); } catch { st.codes = []; }
    if (seq !== st.seq) return;
    root.querySelector('#upCodes').innerHTML = st.codes.slice(0, 5000).map((x) => `<option value="${esc(x.val)}">`).join('');
  }
  q('cat').onchange = loadCodes;
  async function addCat() {
    const text = q('code').value.trim();
    if (!text) { q('code').focus(); return; }
    // Dòng gợi ý có cột value (vd Command: "menu_id bar") → mã là value (5.1 lấy value làm name).
    const hit = st.codes.find((x) => x.val.toLowerCase() === text.toLowerCase());
    const code = hit && hit.value ? hit.value : text;
    if (st.state.rows.some((r) => r.value === code)) { ctx.toast('Đã có <b>' + esc(code) + '</b> trong danh sách'); return; }
    if (await act('upd.addCategory', { category: q('cat').value, code, alter: q('alter').checked, quotedOff: q('quoted').checked, name: hit ? (hit.value || hit.val) : code, type: hit ? hit.type : '' })) { q('code').value = ''; q('code').focus(); }
  }
  q('addCat').onclick = addCat;
  q('code').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addCat(); } };
  q('addCat').onkeydown = (e) => { if (e.key === '1') q('alter').checked = !q('alter').checked; if (e.key === '2') q('quoted').checked = !q('quoted').checked; };

  /* ===== File theo loại / chọn file ===== */
  ctx.call('upd.fileTypes').then((list) => {
    st.fileTypes = list;
    q('ftype').innerHTML = list.map((t) => `<option value="${esc(t.text)}">${esc(t.text)} (${esc(t.ext)})</option>`).join('');
    const dir = list.find((t) => t.text.toUpperCase() === 'DIR');
    if (dir && st.mode !== 'fb') q('ftype').value = dir.text;
    loadTypedFiles();
  });
  async function loadTypedFiles() {
    if (!q('ftype').value || !program()) return;
    q('fname').value = '';
    try { root.querySelector('#upFiles').innerHTML = (await ctx.call('upd.typedFiles', { type: q('ftype').value, root: program() })).map((n) => `<option value="${esc(n)}">`).join(''); } catch { root.querySelector('#upFiles').innerHTML = ''; }
  }
  q('ftype').onchange = loadTypedFiles;
  q('addTyped').onclick = async () => {
    if (!q('fname').value.trim()) { q('fname').focus(); return; }
    if (await act('upd.addTypedFile', { type: q('ftype').value, root: program(), name: q('fname').value.trim() })) { q('fname').value = ''; q('fname').focus(); }
  };
  q('fname').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); q('addTyped').click(); } };
  q('pickFiles').onclick = async () => {
    const f = await ctx.call('file.pick', { multi: true, path: program() });
    if (f) act('upd.addFile', { paths: f.paths || [f.path] });
  };

  /* ===== Other Gen (dữ liệu bảng) + Other SQL ===== */
  async function loadTables() {
    try { root.querySelector('#upTables').innerHTML = (await ctx.call('upd.tables', { sys: q('odb').value === 'Sys' })).map((n) => `<option value="${esc(n)}">`).join(''); } catch { root.querySelector('#upTables').innerHTML = ''; }
  }
  q('odb').onchange = loadTables;
  q('addData').onclick = async () => {
    if (!q('table').value.trim()) { q('table').focus(); return; }
    const r = await act('upd.addData', { table: q('table').value.trim(), key: q('key').value, db: q('odb').value === 'Sys' ? sysDb() : appDb() });
    if (r && !r.message) q('table').focus(); else q('key').focus();
  };
  q('table').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); q('key').focus(); } };
  q('key').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); q('addData').click(); } };
  async function editOther(isSys) {
    const v = await showCode({ title: isSys ? 'SQL thêm — DB Sys' : 'SQL thêm — DB App', text: isSys ? st.state.otherSys : st.state.otherApp, editable: true });
    if (v !== null) act('upd.setOtherSql', isSys ? { sys: v } : { app: v });
  }
  q('otherApp').onclick = () => editOther(false);
  q('otherSys').onclick = () => editOther(true);

  /* ===== Theo menu ===== */
  function showMenu() {
    const m = st.menu, el = q('menu');
    el.innerHTML = m ? `${ic('pkg', 'orange')} <b>${esc(m.id)}</b> <span class="faint">${esc(m.t)}</span>` : '';
  }
  /**
   * Gọi khi mở màn với ctx.opts.menu (hoặc host báo chọn menu khác): ghi nhớ menu cho Save / Load Update và chuyển menu sang view "Cây màn"
   * (sidebar) để điền sẵn 3 ô tìm — FBO / Mobile: File Explorer hiện đúng các file dò theo cấu trúc sysid; FB giữ cách điền của 5.1.
   */
  function menuChanged(kind, n) {
    st.menu = { kind, id: n.id, t: n.t || n.id };
    st.mode = kind === 'mob' ? 'mob' : kind === 'fb' ? 'fb' : 'fbo';
    showMenu();
    ctx.call('side.send', { screen: SCREEN, event: 'menu', data: { kind, n } }).catch(() => { /* view chưa mở: extension giữ tin chờ */ });
  }
  /** Menu cho Save / Load Update: menu đã truyền khi mở màn (5.1 lấy từ node đang chọn trên cây menu). */
  function menuForPackage() {
    const sel = ctx.menu && ctx.menu.selected();
    return sel ? { id: sel.id, t: sel.t } : st.menu;
  }
  q('saveMenu').onclick = async () => {
    if (isEmpty()) { ctx.toast('⚠ Danh sách trống — không có gì để lưu.'); return; }
    const memo = q('memo').value.trim();
    if (!memo) { ctx.toast('⚠ Nhập mô tả cho Update.'); q('memo').focus(); return; }
    const m = menuForPackage();
    if (!m || !m.id) { ctx.toast('⚠ Chọn menu trước khi lưu (mở màn này từ panel MENU)'); return; }
    const args = { menuId: m.id, memo, programPath: program() };
    try {
      const plan = await ctx.call('upd.saveMenu', args);
      if (plan.root && !await showDialog({ title: 'Lưu update', note: 'Menu đang chọn là gốc 01.00.00 — lưu thành Update chung (chỉ thấy khi Load menu gốc)?', ok: 'Lưu' })) return;
      let decision = 'new';
      if (plan.ask === 'confirm') {
        if (!await showDialog({ title: 'Lưu Update theo menu', note: `Lưu Update vào<br>Menu: <b>${esc(m.t || m.id)}</b><br>Người dùng: ${esc(plan.user)}`, ok: 'Lưu' })) return;
      } else {
        const msg = plan.ask === 'exists' ? `Update đã tồn tại:<br><b>${esc(plan.proposed)}</b>`
          : `Đang sửa từ update đã lưu:<br><b>${esc(plan.old)}</b><br>(sửa lúc ${esc(plan.oldTime)})` + (plan.ask === 'memo' ? `<br><br>Mô tả (Memo) đã đổi → tên mới:<br><b>${esc(plan.proposed)}</b>` : '');
        const yes = plan.ask === 'memo' ? 'Ghi đè cặp cũ (giữ tên cũ)' : 'Ghi đè cả file .upd và folder Update';
        const v = await showDialog({ title: 'Lưu update', note: msg, ok: 'Xong', fields: [{ id: 'd', label: 'Chọn', type: 'select', value: 'overwrite', options: [{ value: 'overwrite', text: 'Yes — ' + yes }, { value: 'new', text: 'No — Giữ nguyên cũ, tạo cặp mới' + (plan.ask === 'memo' ? ' theo Memo hiện tại' : '') }] }] });
        if (!v) return;
        decision = v.d;
      }
      q('saveMenu').disabled = true;
      const r = await ctx.call('upd.saveMenu', { ...args, decision });
      render(r.state);
      showCreated(r.result);
      ctx.toast(r.result.missing.length ? '⚠ Thiếu file nguồn (đã bỏ qua): ' + esc(r.result.missing.join(', ')) : `Đã lưu Update vào menu "${esc(m.t || m.id)}"`);
    } catch (e) { toastErr(e); } finally { q('saveMenu').disabled = false; }
  };
  q('loadMenu').onclick = async () => {
    const m = menuForPackage();
    if (!m || !m.id) { ctx.toast('⚠ Chọn menu trước khi mở (mở màn này từ panel MENU)'); return; }
    let files;
    try { files = await ctx.call('upd.menuFiles', { menuId: m.id }); } catch (e) { toastErr(e); return; }
    if (!files.length) { ctx.toast('Menu này chưa có Update.'); return; }
    const chosen = await pickUpdFiles(m, files);
    if (!chosen || !chosen.length) return;
    // Update của menu khác (vd menu gốc 01.00.00 gộp mọi Update) → đổi menu hiện hành sang menu của Update để Save sau đó lấy đúng menu;
    // không có cây menu trong tab nên chỉ đổi mã, giữ nguyên Program path user đã chọn.
    const ids = [...new Set(chosen.map((f) => f.name.split('_')[0]))];
    if (ids.length === 1 && ids[0] && ids[0] !== m.id) { st.menu = { kind: st.menu ? st.menu.kind : 'fbo', id: ids[0], t: ids[0] }; showMenu(); }
    const r = await loadPaths(chosen.map((f) => f.path), chosen.length > 1, false, true);
    if (r && chosen.length > 1) {
      const memos = q('memo').value.split('_').filter(Boolean);
      for (const f of chosen) if (f.memo && !memos.includes(f.memo)) memos.push(f.memo);
      q('memo').value = memos.join('_'); createHint();
    }
  };
  /** 5.1 frmLookupDialog "List Update File For Menu": mới nhất trước, chọn nhiều = gộp; nút xóa → .delele. */
  function pickUpdFiles(m, files) {
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'dlg-back';
      back.innerHTML = `<div class="dlg" style="width:min(900px,92vw)"><div class="dlg-title">Update của menu "${esc(m.id === '01.00.00' ? 'Tất cả menu' : m.t || m.id)}" (Ctrl / Shift để chọn nhiều — gộp)</div>` +
        '<div class="dlg-body"><input data-x="q" placeholder="Lọc tên file…"><div class="col-list" tabindex="0"></div></div>' +
        '<div class="dlg-foot"><button class="btn" data-x="del" title="Xóa tệp Update">Xóa tệp</button><span class="dlg-err"></span><span style="flex:1"></span><button class="btn" data-x="cancel">Hủy</button><button class="btn primary" data-x="ok">Nạp</button></div></div>';
      document.body.appendChild(back);
      const list = back.querySelector('.col-list'), box = back.querySelector('[data-x="q"]');
      const sel = new Set(); let cur = 0, shown = files;
      const draw = () => {
        const f = box.value.trim().toLowerCase();
        shown = files.filter((x) => !f || x.name.toLowerCase().includes(f));
        cur = Math.min(cur, Math.max(0, shown.length - 1));
        list.innerHTML = shown.map((x, i) => `<div class="col-row${sel.has(x.path) || (!sel.size && i === cur) ? ' on' : ''}" data-i="${i}"><span class="mono">${esc(x.name)}</span><span class="muted">${esc(x.modified)}</span></div>`).join('');
      };
      const close = (v) => { back.remove(); resolve(v); };
      const done = () => close(sel.size ? files.filter((x) => sel.has(x.path)) : shown[cur] ? [shown[cur]] : null);
      list.onclick = (e) => {
        const r = e.target.closest('.col-row'); if (!r) return;
        const i = +r.dataset.i;
        if (e.ctrlKey) { const p = shown[i].path; sel.has(p) ? sel.delete(p) : sel.add(p); if (!sel.size) cur = i; }
        else if (e.shiftKey) { if (!sel.size) sel.add(shown[cur].path); const [a, b] = [Math.min(cur, i), Math.max(cur, i)]; for (let k = a; k <= b; k++) sel.add(shown[k].path); }
        else { sel.clear(); cur = i; }
        draw();
      };
      list.ondblclick = (e) => { const r = e.target.closest('.col-row'); if (r) { sel.clear(); cur = +r.dataset.i; done(); } };
      box.oninput = () => { cur = 0; draw(); };
      back.querySelector('[data-x="ok"]').onclick = done;
      back.querySelector('[data-x="cancel"]').onclick = () => close(null);
      back.querySelector('[data-x="del"]').onclick = async () => {
        const x = shown[cur]; if (!x) return;
        if (!await showDialog({ title: 'Xóa tệp Update', note: 'Xóa tệp Update <b>' + esc(x.name) + '</b>?', ok: 'Xóa' })) return;
        try { await ctx.call('upd.deleteUpdFile', { path: x.path }); files = files.filter((f) => f.path !== x.path); sel.delete(x.path); draw(); } catch (e) { back.querySelector('.dlg-err').textContent = e.message; }
      };
      back.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); close(null); }
        if (e.key === 'Enter') { e.preventDefault(); done(); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel.clear(); cur = Math.max(0, Math.min(shown.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1))); draw(); list.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }
      });
      draw(); box.focus();
    });
  }

  /* ===== Tạo Update ===== */
  q('pickWorking').onclick = async () => { const f = await ctx.call('folder.pick', { path: q('working').value }); if (f) q('working').value = f.path.replace(/[\\/]?$/, '\\'); };
  q('openWorking').onclick = () => ctx.call('shell.explore', { path: q('working').value }).catch(toastErr);
  q('create').onclick = async () => {
    if (!st.state.rows.length) { ctx.toast('⚠ Danh sách trống — thêm mục trước khi tạo Update.'); return; }
    const working = q('working').value.trim().replace(/[\\/]?$/, '\\');
    q('working').value = working;
    q('create').disabled = true; q('createHint').textContent = 'Đang tạo Update…';
    try {
      showCreated(await ctx.call('upd.create', { workingDir: working, folderName: q('saveTo').value.trim() + q('memo').value.trim(), programPath: program() }));
      ctx.toast(st.created.missing.length ? '⚠ Thiếu file nguồn (đã bỏ qua): ' + esc(st.created.missing.join(', ')) : 'Đã tạo Update');
    } catch (e) { toastErr({ message: 'Lỗi tạo Update: ' + e.message }); } finally { q('create').disabled = false; createHint(); }
  };
  function showPkg(on) { root.querySelector('section[data-x="pkg"]').hidden = !on; }
  function showCreated(r) {
    st.created = r; showPkg(true);
    q('pkgPath').textContent = r.folder + '\\';
    const rootNodes = [], map = new Map();
    const dirNode = (path) => {
      if (map.has(path)) return map.get(path);
      const i = path.lastIndexOf('\\'), n = { key: r.folder + '\\' + path, label: i >= 0 ? path.slice(i + 1) : path, children: [] };
      map.set(path, n); (i >= 0 ? dirNode(path.slice(0, i)).children : rootNodes).push(n);
      return n;
    };
    for (const f of r.files) {
      const i = f.lastIndexOf('\\'), leaf = { key: r.folder + '\\' + f, label: i >= 0 ? f.slice(i + 1) : f, rel: f };
      (i >= 0 ? dirNode(f.slice(0, i)).children : rootNodes).push(leaf);
    }
    pkgTree.set(rootNodes, [...map.values()].map((n) => n.key));
    if (r.missing.length) q('pkgPath').title = 'Không tìm thấy (đã bỏ qua): ' + r.missing.join(', ');
  }
  const pkgTree = makeTree(q('pkgTree'), {
    checks: false,
    iconOf: (n, open) => (n.children ? ic(open ? 'folderOpen' : 'folder', 'yellow') : fileIcon(n.label)),
    onOpen: (n) => ctx.call('upd.fileOp', { op: 'open', path: n.key }).catch(toastErr),
    onMenu: (n, e) => menuAt(e.clientX, e.clientY, [
      ['Mở', () => ctx.call('upd.fileOp', { op: 'open', path: n.key }).catch(toastErr)],
      ['Mở bản trong chương trình', () => n.rel && ctx.call('upd.fileOp', { op: 'program', path: program() + n.rel.replace(/^(Web|MobileApp|Other)\\/i, '') }).catch(toastErr)],
      ['Đổi tên', async () => {
        if (n.children) { ctx.toast('Chỉ đổi tên được file'); return; }
        const v = await showDialog({ title: 'Đổi tên', fields: [{ id: 'n', label: 'Tên mới', value: n.label, required: true }] });
        if (v) try { await ctx.call('upd.fileOp', { op: 'rename', path: n.key, name: v.n }); st.created.files = st.created.files.map((f) => (f === n.rel ? n.rel.replace(/[^\\]+$/, v.n.trim()) : f)); showCreated(st.created); } catch (e2) { toastErr(e2); }
      }],
      ['Xóa', async () => {
        if (!await showDialog({ title: 'Xóa', note: 'Xóa mục đang chọn?', ok: 'Xóa' })) return;
        try { await ctx.call('upd.fileOp', { op: 'delete', path: n.key }); const rel = n.key.slice(st.created.folder.length + 1); st.created.files = st.created.files.filter((f) => f !== rel && !f.startsWith(rel + '\\')); showCreated(st.created); } catch (e2) { toastErr(e2); }
      }], '-',
      ['Mở rộng tất cả', () => pkgTree.set(pkgTree.nodes, pkgTree.keys((x) => x.children))],
      ['Thu gọn tất cả', () => pkgTree.set(pkgTree.nodes, [])]])
  });
  q('pkgPath').onclick = (e) => { e.preventDefault(); ctx.call('shell.explore', { path: st.created ? st.created.folder : q('working').value }).catch(toastErr); };
  q('pkgPath').oncontextmenu = (e) => { e.preventDefault(); menuAt(e.clientX, e.clientY, [['Copy đường dẫn', () => { setClipboard(q('pkgPath').textContent || q('working').value); ctx.toast('Đã copy đường dẫn'); }]]); };
  q('delPkg').onclick = async () => {
    if (!st.created) return;
    try { await ctx.call('upd.deletePackage', { folder: st.created.folder }); st.created = null; pkgTree.set([]); showPkg(false); ctx.toast('Đã xóa thư mục'); } catch (e) { toastErr(e); }
  };

  /* ===== Khởi động ===== */
  ctx.on('upd.changed', () => { if (root.isConnected) refresh(); });
  q('focusTree').onclick = () => ctx.call('side.focus').catch(toastErr);
  (async () => {
    // Mở kèm menu (ctx.open('UpdateScript', { menu })) → chuyển sang view "Cây màn" điền sẵn 3 ô tìm như 5.1; gửi ngay, không chờ phần dưới.
    const m = ctx.opts && ctx.opts.menu;
    if (m && m.id) menuChanged(m.kind || 'fbo', m);
    showPkg(false);
    q('saveTo').oninput = createHint; q('memo').oninput = createHint;
    loadTables();
    await refresh();
    // Thư mục chương trình view đang chọn (nếu view đã chạy); không có thì mặc định theo mode (xem program()).
    const shared = await ctx.call('side.get', { screen: SCREEN }).catch(() => null);
    if (shared && shared.program) { st.program = shared.program; st.mode = shared.mode || st.mode; }
    loadTypedFiles();
  })();
  return { focus: () => q('code').focus(), menuChanged, dispose: () => {} };
}
