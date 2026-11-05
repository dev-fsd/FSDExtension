// Cây "trái" của màn Update Script đặt ở sidebar: Đối tượng SQL · File · Dữ liệu khai báo (tick → "＋" thêm vào Update).
// Danh sách Update nằm ở host (lệnh upd.*) nên thêm từ đây là tab Update thấy ngay (sự kiện upd.changed). Logic chép từ web/js/screens/update-script.js
// bản trước khi dời cột trái; thư mục chương trình đang chọn được chia sẻ sang tab (env.share) để Thêm file / Tạo Update dùng cùng gốc.
import { showColumns, menuAt } from '../ui/dialog.js';
import { esc, splitTokens, countText, exactBtn, makeTree, sec, iconBtn, declSection, fileSection, bindLayout, pasteList, listEditor, createDeclExplorer, createFileExplorer } from '../ui/explorer.js';
import { ic, sqlKind } from './icons.js';

export function mountUpdatePanel(root, env) {
  const { ctx } = env;
  const st = { state: null, sqlAll: null, sqlExact: false, sqlTotal: 0, menuSeq: 0, menu: null };
  root.innerHTML = `
    <div class="sb-ctx" data-a="menu" hidden></div>
    ${sec('sql', 'Đối tượng SQL', `<span class="cnt" data-a="sqlCount">( 0 dòng )</span><span class="sp"></span>
        ${iconBtn('sqlExpand', 'expand', 'Mở hết cây / chọn nút')}${iconBtn('sqlRefresh', 'refresh', 'Làm tươi dữ liệu', 'blue')}${iconBtn('sqlAdd', 'plus', 'Thêm mục đã tick vào Update', '', 'add')}`,
      `<div class="ux-s"><input data-a="sqlText" spellcheck="false" placeholder="Tên đối tượng (phẩy = nhiều, *x = chứa x) · Enter"><button class="icon-btn" data-a="sqlExact">*</button>${iconBtn('sqlList', 'list', 'Nhập danh sách đối tượng (mỗi dòng 1 object)')}</div>
      <div class="ut" data-a="sqlTree"></div>`)}
    ${fileSection()}
    ${declSection()}`;
  const q = (a) => root.querySelector(`[data-a="${a}"]`);
  const lay = bindLayout(root, q, 'fsd.sidebar.update.layout');
  const toastErr = (e) => ctx.toast('⚠ ' + esc(e.message || e));
  const sysDb = () => (ctx.project() || {}).sysDb, appDb = () => (ctx.project() || {}).db;

  /** Gọi lệnh thêm vào Update: báo "Đã thêm" (kèm số mục hiện có) hoặc câu của server. */
  async function add(cmd, args) {
    try {
      const r = await ctx.call(cmd, args || {});
      if (r && r.message) ctx.toast(esc(r.message).replace(/\n/g, '<br>'));
      else ctx.toast(`Đã thêm vào Update${r && r.state ? ` — <b>${r.state.rows.length}</b> mục` : ''}`);
      return true;
    } catch (e) { toastErr(e); return false; }
  }

  /* ===== Đối tượng SQL ===== */
  const sqlTree = makeTree(q('sqlTree'), {
    // Tổng = số đối tượng khớp lọc (mỗi nhóm chỉ vẽ tối đa 200).
    onCount: (c) => { q('sqlCount').textContent = countText(c, st.sqlTotal || 0); },
    iconOf: (n) => n.icon || '',
    onOpen: (n) => viewSql(n.data),
    onMenu: (n, e) => { if (!n.children && n.data) menuAt(e.clientX, e.clientY, [['Xem', () => viewSql(n.data)]]); }
  });
  /** Bảng → danh sách cột; store / view / function / trigger → mã ở tab Query (view này không có editor). */
  async function viewSql(d) {
    if (!d) return;
    const db = d.db === 'Sys' ? sysDb() : appDb();
    try {
      if (d.type === 'U') showColumns({ title: d.name, columns: await ctx.call('sql.columns', { db, name: d.name }) });
      else ctx.open('Query', { sql: await ctx.call('sql.script', { db, name: d.name, alter: true }), title: d.name, db: db || undefined });
    } catch (e) { toastErr(e); }
  }
  /** 5.1 searchSQL: token → tên% (gần đúng) hoặc = tên (nút "="); "*x" → %x%. Rỗng = tất cả; null = xóa cây (đổi menu). */
  function sqlMatcher(text) {
    const parts = splitTokens(text).map((s) => s.replace(/['\s]/g, '')).filter(Boolean);
    if (!parts.length) return () => true;
    const tests = parts.map((t) => {
      const star = t.includes('*');
      if (st.sqlExact && !star) return (n) => n.toLowerCase() === t.toLowerCase();
      const body = t.replace(/^[*%]+/, '').replace(/[*%]+$/, '');
      if (/[*%]/.test(body)) throw new Error('Từ khóa không hợp lệ — dấu * chỉ dùng ở đầu tên (vd. *vattu)');
      return star ? (n) => n.toLowerCase().includes(body.toLowerCase()) : (n) => n.toLowerCase().startsWith(body.toLowerCase());
    });
    return (n) => tests.some((f) => f(n));
  }
  function renderSql(clear) {
    if (!st.sqlAll) return;
    let m;
    try { m = clear ? () => false : sqlMatcher(q('sqlText').value); } catch (e) { toastErr(e); return; }
    const nodes = [], open = [];
    let total = 0;
    for (const [db, list] of [['App', st.sqlAll.app], ['Sys', st.sqlAll.sys]]) {
      const groups = new Map();
      for (const o of list) if (m(o.name)) { if (!groups.has(o.tp)) groups.set(o.tp, []); groups.get(o.tp).push(o); }
      if (!groups.size) continue;
      let n = 0;
      const kids = [...groups].map(([tp, objs]) => {
        n += objs.length;
        const [kn, kc] = sqlKind(objs[0].type);
        const leaves = objs.slice(0, 200).map((o) => ({ key: `${db}|${o.name}`, label: o.name, bold: true, icon: ic(sqlKind(o.type)[0], sqlKind(o.type)[1]), data: { ...o, db } }));
        if (objs.length > 200) leaves.push({ key: `${db}|${tp}|…`, label: '...', check: false });
        return { key: `${db}|${tp}`, label: tp, badge: objs.length, icon: ic(kn, kc), children: leaves };
      });
      total += n;
      nodes.push({ key: db, label: db, badge: n, icon: ic('db', db === 'Sys' ? 'orange' : 'blue'), children: kids, cls: 'db-' + db.toLowerCase() });
    }
    st.sqlTotal = total;
    if (total <= 50) nodes.forEach((d) => { open.push(d.key); d.children.forEach((c) => open.push(c.key)); });
    sqlTree.set(nodes, open);
  }
  async function loadSql() {
    try { st.sqlAll = await ctx.call('upd.sqlObjects'); renderSql(false); } catch (e) { toastErr(e); }
  }
  q('sqlText').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); renderSql(false); } };
  q('sqlText').onpaste = (e) => pasteList(e, q('sqlText'), null, () => {});
  q('sqlRefresh').onclick = loadSql;
  q('sqlExpand').onclick = () => sqlTree.toggleAll();
  q('sqlExact').onclick = async () => { st.sqlExact = await ctx.call('upd.option', { name: 'sqlsearch_exact', value: !st.sqlExact }); exactBtn(q('sqlExact'), st.sqlExact, false); renderSql(false); };
  q('sqlList').onclick = () => listEditor('Danh sách đối tượng SQL', 'Mỗi dòng 1 đối tượng', q('sqlText'), null, () => renderSql(false));
  q('sqlAdd').onclick = async () => {
    const items = sqlTree.checkedLeaves().filter((n) => n.data).map((n) => ({ name: n.data.name, type: n.data.type, db: n.data.db }));
    if (!items.length) { ctx.toast('⚠ Vui lòng chọn thông tin SQL cần gen update'); q('sqlTree').focus(); return; }
    if (await add('upd.addObjects', { items })) sqlTree.uncheck();
  };

  /* ===== SQL Content Declare + File Explorer (ui/explorer.js) ===== */
  const decl = createDeclExplorer({ q, ctx, add: (items) => add('upd.addDeclare', { items }) });
  const fx = createFileExplorer({
    q, ctx, project: ctx.project, state: () => st.state,
    add: (files, program) => add('upd.addExplorerFiles', { root: program, files }),
    onOpen: (full) => ctx.openFile(full),
    onProgram: (program, mode) => env.share('update-script', program, mode)
  });

  /* ===== Theo menu ===== */
  function showMenu() {
    const m = st.menu, el = q('menu');
    el.hidden = !m;
    if (m) { el.innerHTML = `${ic('pkg', 'orange')}<b>${esc(m.id)}</b><span class="t">${esc(m.t)}</span>`; el.title = `Menu của tab Update: ${m.id} - ${m.t} (Save / Load Update theo menu này)`; }
  }
  /**
   * Menu mở kèm tab Update (hoặc đổi menu): điền sẵn 3 ô tìm như 5.1. FBO / Mobile: File Explorer hiện đúng các file dò theo cấu trúc sysid
   * (Dir / Grid / Filter / Report, Grid con, Lookup, showForm, Import, mẫu in, Include riêng — .f trước, không có .f mới .xml) + Main\link; FB giữ cách điền của 5.1.
   */
  async function menuChanged(kind, n) {
    st.menu = { kind, id: n.id, t: n.t || n.id };
    showMenu();
    const seq = ++st.menuSeq;
    await ready; // menu có thể tới trước khi upd.state / thư mục chương trình nạp xong
    if (seq !== st.menuSeq) return;
    decl.clear(); q('sqlText').value = ''; renderSql(true);
    try {
      const r = await fx.menuChanged(kind, n);
      if (!r || seq !== st.menuSeq) return;
      if (r.sql) { q('sqlText').value = r.sql; renderSql(false); }
      if (r.other) decl.setText(r.other);
    } catch (e) { toastErr(e); }
  }

  /* ===== Khởi động ===== */
  const ready = (async () => {
    try { st.state = await ctx.call('upd.state'); } catch (e) { toastErr(e); return; }
    await fx.init();
    st.sqlExact = await ctx.call('upd.option', { name: 'sqlsearch_exact' }); exactBtn(q('sqlExact'), st.sqlExact, false);
    lay.apply();
    loadSql();
  })();

  return {
    menuChanged,
    event: () => {},
    focus: () => q('fileText').focus(),
    dispose: () => clearTimeout(fx.st.timer)
  };
}
