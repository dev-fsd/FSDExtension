// Panel MENU (WebviewView) — ES module, chạy trong webview của extension (CSP nonce, không CDN).
// Nhận từ extension (menuView.ts) các mảnh state đã đổi { t: 'patch', d: { khóa: giá trị } } và chỉ vẽ lại đúng vùng liên quan;
// ô lọc nằm ngoài vùng vẽ lại nên không mất chữ / focus. Thao tác của người dùng gửi lại bằng postMessage.
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);

const saved = vscode.getState() || {};
/** ui: trạng thái chỉ thuộc giao diện. collapsed giữ qua lần mở lại webview; fq (ô lọc tên file) xóa khi đổi menu. */
const ui = { collapsed: saved.collapsed || {}, open: saved.open || {}, tools: saved.tools !== false, fq: '' };
/** S: state mới nhất ghép từ các patch. */
const S = { mode: null };
let pop = null;

const persist = () => vscode.setState({ collapsed: ui.collapsed, open: ui.open, tools: ui.tools });
const post = (m) => vscode.postMessage(m);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const fmt = (n) => Number(n).toLocaleString('vi-VN');

/* ===== Icon (SVG viewBox 16 — CSP chặn nguồn ngoài) =====
 * Icon 2 tông: lớp nền nhạt (.bg) + nét đậm cùng màu; màu do CSS đặt qua --ic (nút) / --c (nhóm file), không dùng nét trắng-đen. */
const svg = (body) => `<svg viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;
const duo = (bg, body) => svg(`<g class="bg">${bg}</g>${body}`);
const I = {
  search: duo('<circle cx="6.5" cy="6.5" r="4.2"/>', '<circle cx="6.5" cy="6.5" r="4.2"/><path d="M10 10l4 4"/>'),
  mobile: duo('<rect x="4.5" y="1.5" width="7" height="13" rx="1.5"/>', '<rect x="4.5" y="1.5" width="7" height="13" rx="1.5"/><path d="M7 12.5h2"/>'),
  sql: duo('<rect x="1.5" y="2.5" width="13" height="11" rx="2"/>', '<path d="M6 5.5L3.5 8 6 10.5M10 5.5L12.5 8 10 10.5M8.8 4.5l-1.6 7"/>'),
  query: duo('<path d="M3 3.5v9c0 1.1 2.2 2 5 2s5-.9 5-2v-9c0 1.1-2.2 2-5 2s-5-.9-5-2z"/>', '<ellipse cx="8" cy="3.5" rx="5" ry="2"/><path d="M3 3.5v9c0 1.1 2.2 2 5 2s5-.9 5-2v-9M3 8c0 1.1 2.2 2 5 2s5-.9 5-2"/>'),
  table: duo('<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/>', '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M1.5 6.5h13M1.5 10h13M6 6.5v7"/>'),
  files: duo('<rect x="5.5" y="1.5" width="8" height="10" rx="1"/>', '<rect x="5.5" y="1.5" width="8" height="10" rx="1"/><path d="M3.5 4.5v9h7"/>'),
  globe: duo('<circle cx="8" cy="8" r="6.2"/>', '<circle cx="8" cy="8" r="6.2"/><path d="M1.8 8h12.4M8 1.8c2 2 2 10.4 0 12.4M8 1.8c-2 2-2 10.4 0 12.4"/>'),
  folder: duo('<path d="M1.5 3.5h4l1.5 1.5h7v8h-12.5z"/>', '<path d="M1.5 3.5h4l1.5 1.5h7v8h-12.5z"/>'),
  script: duo('<path d="M3.5 1.5h6l3 3v10h-9z"/>', '<path d="M3.5 1.5h6l3 3v10h-9z"/><path d="M9.5 1.5v3h3M5.5 8h5M5.5 10.5h5"/>'),
  ai: duo('<path d="M8 1.5l1.4 3.6 3.6 1.4-3.6 1.4L8 11.5 6.6 7.9 3 6.5l3.6-1.4z"/>', '<path d="M8 1.5l1.4 3.6 3.6 1.4-3.6 1.4L8 11.5 6.6 7.9 3 6.5l3.6-1.4zM12.5 10.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/>'),
  cog: duo('<circle cx="8" cy="8" r="5.2"/>', '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4"/>'),
  prog: duo('<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/>', '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M1.5 5.5h13M3.8 4h.01M5.8 4h.01"/>'),
  more: svg('<circle class="fill" cx="3.5" cy="8" r="1.2"/><circle class="fill" cx="8" cy="8" r="1.2"/><circle class="fill" cx="12.5" cy="8" r="1.2"/>'),
  pin: svg('<path d="M10 2l4 4-1.5 1-2 2 .5 3-1 1-3.5-3.5L3 14.5 1.5 13l4-3.5L2 6l1-1 3 .5 2-2z"/>'),
  close: svg('<path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/>'),
  copy: svg('<rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>'),
  collapse: svg('<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M5 8h6"/>'),
  chev: svg('<path d="M6 3.5L10.5 8 6 12.5"/>'),
  play: duo('<path d="M5 3l8 5-8 5z"/>', '<path d="M5 3l8 5-8 5z"/>'),
  file: svg('<path d="M3.5 1.5h6l3 3v10h-9z"/><path d="M9.5 1.5v3h3"/>'),
  lock: svg('<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2M8 10v1.5"/>'),
  warn: svg('<path d="M8 2l6.5 11.5h-13z"/><path d="M8 6.5v3.2M8 11.6v.1"/>'),
  alert: svg('<circle cx="8" cy="8" r="6.2"/><path d="M8 4.8v3.8M8 11v.1"/>'),
  clock: svg('<circle cx="8" cy="8" r="6.2"/><path d="M8 4.5V8l2.5 1.5"/>'),
  refresh: svg('<path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v2.8h-2.8"/>'),
  pkg: duo('<path d="M2 5l6-3 6 3v6l-6 3-6-3z"/>', '<path d="M2 5l6-3 6 3v6l-6 3-6-3zM2 5l6 3 6-3M8 8v6"/>'),
  trash: svg('<path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v5M9.5 6.5v5"/>'),
  expand: svg('<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M5 8h6M8 5v6"/>'),
  plus: svg('<path d="M8 3v10M3 8h10"/>'),
  filter: duo('<path d="M2 3h12l-4.5 5.5V13l-3 1.5V8.5z"/>', '<path d="M2 3h12l-4.5 5.5V13l-3 1.5V8.5z"/>'),
  chart: duo('<rect x="2.5" y="3" width="11" height="10.5" rx="1"/>', '<path d="M3 13V8M7 13V4M11 13V6M2 13.5h12"/>'),
  upload: duo('<rect x="2.5" y="11" width="11" height="2.5"/>', '<path d="M8 11V2.5M4.5 6L8 2.5 11.5 6M2.5 13.5h11"/>'),
  printer: duo('<rect x="2.5" y="5.5" width="11" height="6"/>', '<path d="M4.5 5.5v-3h7v3M4.5 11.5h-2v-6h11v6h-2M4.5 9.5h7v4h-7z"/>'),
  link: svg('<path d="M6.5 9.5l3-3M5 8l-1.5 1.5a2.1 2.1 0 0 0 3 3L8 11M11 8l1.5-1.5a2.1 2.1 0 0 0-3-3L8 5"/>'),
  form: duo('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/>', '<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 5.5h12M4.5 8.5h3M4.5 11h5"/>')
};
/** Icon theo nhóm file (dòng file và tiêu đề nhóm dùng chung, màu theo nhóm bằng --c). */
const GICON = { dir: I.form, grid: I.table, filter: I.filter, lookup: I.search, report: I.chart, import: I.upload, template: I.printer, include: I.link, store: I.play, table: I.table };

/** Nhãn chữ của loại file cuối dòng (loại do extension gửi sang trong f.ft; '' = icon chung). */
const FT_LABEL = { xml: 'XML', f: 'F', ent: 'ENT', txt: 'TXT', rpt: 'RPT', frx: 'FRX', rldc: 'RLDC', xlsx: 'XLS' };

/** Nút để sẵn trên thẻ menu (khớp setting fsd.menuButtons). */
const BTN = {
  openAll: { ic: 'files', c: 'yellow', tip: 'Mở tất cả file của menu' },
  web2: { ic: 'globe', c: 'blue', tip: 'Mở trang web của menu (web host 2) — nhấp đúp tên menu cũng mở' },
  search: { ic: 'search', c: 'orange', tool: 'search', tip: 'Tìm file của menu — mở Multi Search điền sẵn menu này' },
  update: { ic: 'pkg', c: 'green', tool: 'update', tip: 'Update của menu — mở Update Script điền sẵn menu này' },
  script: { ic: 'script', c: 'purple', tip: 'Xem script menu (F12)' },
  ai: { ic: 'ai', c: 'pink', tip: 'Copy menu cho AI' }
};

const inProject = () => S.mode === 'project';
const hosts = () => S.hosts || { h1: false, h2: false };
/** Nút web chỉ có với menu FBO (Mobile không mở bằng trang web); web 1 / 2 chỉ khi dự án khai host tương ứng. */
function buttonAvailable(id, kind) {
  if (id === 'web2') return kind === 'fbo' && hosts().h2;
  if (id === 'web1') return kind === 'fbo' && hosts().h1;
  return true;
}
const selKey = () => (S.sel ? S.sel.kind + ':' + S.sel.id : '');

/* ===== Khung (dựng một lần; các vùng vẽ lại riêng, ô lọc không bị vẽ lại) ===== */
document.getElementById('app').innerHTML =
  '<div id="util" class="util" hidden></div>' +
  '<div id="tools" class="tools" hidden></div>' +
  '<div id="tabs" class="tabs" hidden></div>' +
  '<div id="prog" class="prog" hidden><i></i></div>' +
  '<div id="scan" class="scan" hidden></div>' +
  '<div id="empty"></div>' +
  '<div id="card" hidden></div>' +
  '<div id="quick"></div>' +
  '<div id="tree" hidden><div class="flt"><input id="tq" placeholder="Tìm menu: tên, mã, sysid, #link…  (↓ chọn, Enter mở)" spellcheck="false" autocomplete="off">' +
  '<button class="ib" data-a="collapseTree" title="Thu gọn cây menu">' + I.collapse + '</button></div><div id="tres"></div><div id="tnodes"></div></div>' +
  '<div id="flt" class="flt" hidden><input id="fq" placeholder="Lọc file của menu…" spellcheck="false" autocomplete="off">' +
  '<button class="ib" id="expandAll" data-a="expandAll" title="Mở tất cả nhóm">' + I.expand + '</button>' +
  '<button class="ib" id="collapseAll" data-a="collapseAll" title="Thu gọn tất cả nhóm">' + I.collapse + '</button></div>' +
  '<div id="groups"></div>';
const fq = $('fq');
const tq = $('tq');

/* ===== Nhận dữ liệu ===== */
window.addEventListener('message', (e) => {
  const m = e.data;
  if (m && m.t === 'tree') {
    setTree(m);
    return;
  }
  if (!m || m.t !== 'patch' || !m.d) return;
  const before = selKey();
  Object.assign(S, m.d);
  if (selKey() !== before) {
    ui.fq = '';
    fq.value = '';
  }
  draw(m.d);
});

/** Chỉ đụng DOM khi nội dung thật sự đổi (tránh dựng lại cả danh sách, mất hover / nháy hình). */
function setHtml(el, html) {
  if (el.__html === html) return;
  el.__html = html;
  el.innerHTML = html;
}

function draw(d) {
  const t0 = performance.now();
  drawParts(d);
  const ms = Math.round(performance.now() - t0);
  if (ms > 40) post({ t: 'perf', what: Object.keys(d).join(','), ms });
}

function drawParts(d) {
  const has = (...keys) => keys.some((k) => k in d);
  // Menu nổi chỉ đóng khi nội dung nó đang chỉ vào đổi (tiến độ quét, giờ file… không làm mất menu).
  if (has('mode', 'sel', 'quick')) closePop();
  if (has('mode', 'kind', 'hasMobile', 'project')) {
    drawUtil();
    drawTools();
  }
  if (has('mode', 'screens')) drawTabs();
  if (has('mode', 'scan', 'err', 'loading')) drawScan();
  if (has('mode', 'machineCode', 'noProjects', 'loading', 'recents', 'err')) drawEmpty();
  if (has('mode', 'sel', 'hosts', 'buttons')) drawCard();
  if (has('mode', 'quick', 'sel', 'hosts')) drawQuick();
  if (has('mode', 'sel', 'kind', 'quick', 'pinIds')) drawTree();
  if (has('mode', 'sel', 'groups', 'kind')) {
    drawFilterBar();
    drawGroups();
  }
  fixTab();
}

/* ===== Hàng 1: [FBO] [MOBILE] [SQL] luôn cùng một dòng (chia đều chiều ngang; hẹp thì chỉ còn icon màu + tooltip) ===== */
function drawUtil() {
  const el = $('util');
  el.hidden = !inProject();
  if (!inProject()) return;
  const find = (kind, label, ic, color) =>
    `<button class="kbtn i-${color}${S.kind === kind ? ' act' : ''}" data-a="kind" data-kind="${kind}" title="Cây menu ${label} (Ctrl+Alt+P: tìm nhanh)">${ic}<span class="kt">${label}</span></button>`;
  const sql = `<button class="kbtn i-purple" data-cmd="fsd.pickSqlObject" title="Đối tượng SQL — chọn bảng / store / view… của DB dự án (Ctrl+Alt+O)">${I.sql}<span class="kt">SQL</span></button>`;
  setHtml(el, find('fbo', 'FBO', I.search, 'blue') + (S.hasMobile ? find('mob', 'MOBILE', I.mobile, 'green') : '') + sql);
}

/* ===== Khối "Công cụ" (việc chung của dự án, hiện cả khi chưa chọn menu): chỉ icon màu + tooltip, tự xuống dòng theo bề rộng; thu / mở được (nhớ trạng thái) ===== */
const TOOLS = [
  ['fsd.openQuery', 'query', 'purple', 'Query — mở tab Query'],
  ['fsd.selectTable', 'table', 'blue', 'Select Table — mở tab Select Table'],
  ['fsd.openMultiSearch', 'search', 'orange', 'Tìm file — mở tab Multi Search, tìm file / nội dung (Ctrl+Alt+F)'],
  ['fsd.openUpdateScript', 'pkg', 'green', 'Update — mở tab Update Script, tạo Update'],
  ['fsd.openWebConfig', 'cog', 'yellow', 'Web.config — mở Web.config của dự án (theo FBO / MOBILE đang xem)'],
  ['fsd.openControllers', 'folder', 'cyan', 'Thư mục nguồn — mở thư mục Controllers của dự án (theo FBO / MOBILE đang xem)']
];

function drawTools() {
  const el = $('tools');
  el.hidden = !inProject();
  if (!inProject()) return;
  const tool = ([cmd, ic, color, tip]) => `<button class="tbtn i-${color}" data-cmd="${cmd}" title="${esc(tip)}" aria-label="${esc(tip)}">${I[ic]}</button>`;
  setHtml(
    el,
    '<div class="tools-in">' +
      `<button class="tools-h" data-a="toggleTools" aria-expanded="${ui.tools}" title="${ui.tools ? 'Thu gọn' : 'Mở'} khối công cụ"><i class="chev${ui.tools ? ' open' : ''}">${I.chev}</i><span>Công cụ</span></button>` +
      (ui.tools ? '<div class="tools-grid">' + TOOLS.map(tool).join('') + '</div>' : '') +
      '</div>'
  );
}

/* ===== Dải tab đang mở (Query / Select Table): thấy ngay đang mở mấy tab, bấm để chuyển, × để đóng ===== */
function drawTabs() {
  const el = $('tabs');
  const list = inProject() ? S.screens || [] : [];
  el.hidden = list.length === 0;
  setHtml(el, list.length
    ? '<span class="tabs-h">Đang mở · ' + list.length + '</span>' +
      list
        .map(
          (s) =>
            `<span class="tab${s.active ? ' on' : ''}" data-a="screenFocus" data-id="${esc(s.id)}" title="${esc(s.title)}">` +
            `<span class="tab-k">${s.screen === 'query' ? 'Q' : 'S'}</span><span class="ell">${esc(s.title)}</span>` +
            `<button class="ib sm" data-a="screenClose" data-id="${esc(s.id)}" title="Đóng tab">${I.close}</button></span>`
        )
        .join('')
    : '');
}

/* ===== Đang quét: thanh 2px + "Đang quét x/y menu" ===== */
function drawScan() {
  const prog = $('prog');
  const text = $('scan');
  // Đang nạp danh sách dự án: chỉ thanh mảnh chạy, không chữ.
  const loadingProjects = S.mode === 'projects' && !!S.loading;
  const sc = loadingProjects ? { done: 0, total: 0 } : inProject() ? S.scan : null;
  prog.hidden = !sc;
  text.hidden = !sc || loadingProjects;
  if (!sc) return;
  const bar = prog.firstElementChild;
  const indet = !sc.total;
  prog.classList.toggle('indet', indet);
  prog.classList.toggle('run', !indet);
  bar.style.transform = indet ? '' : 'scaleX(' + Math.min(1, sc.done / sc.total).toFixed(3) + ')';
  text.textContent = indet ? 'Đang nạp menu…' : `Đang lập chỉ mục nền ${fmt(sc.done)}/${fmt(sc.total)} (vẫn dùng được)`;
}

/* ===== Trạng thái rỗng: chưa key / chưa có dự án / chưa chọn dự án / lỗi ===== */
function drawEmpty() {
  const el = $('empty');
  if (S.mode === 'locked') {
    el.innerHTML =
      `<div class="es"><div class="es-ic">${I.lock}</div><div class="es-t">Cần key để dùng</div>` +
      `<div class="es-d">Mã máy: <span class="mono">${esc(S.machineCode)}</span></div>` +
      '<div class="btns"><button class="btn primary" data-cmd="fsd.enterKey">Nhập key</button><button class="btn" data-cmd="fsd.copyMachineCode">Copy mã máy</button></div></div>';
  } else if (S.mode === 'projects' && S.loading) {
    el.innerHTML = '';
  } else if (S.mode === 'projects' && S.noProjects) {
    el.innerHTML =
      `<div class="es"><div class="es-ic">${I.folder}</div><div class="es-t">Chưa có dự án nào</div>` +
      '<div class="es-d">Nhập từ config.db của FSD Studio hoặc đồng bộ dự án.</div>' +
      '<div class="btns"><button class="btn primary" data-cmd="fsd.importProjects">Nhập dự án từ config.db</button><button class="btn" data-cmd="fsd.syncProjects">Đồng bộ dự án</button></div></div>';
  } else if (S.mode === 'projects') {
    const recents = S.recents || [];
    el.innerHTML =
      `<div class="es"><div class="es-ic">${I.folder}</div><div class="es-t">Chưa chọn dự án</div>` +
      '<div class="btns"><button class="btn primary" data-cmd="fsd.changeProject">Chọn dự án…</button></div></div>' +
      (recents.length
        ? secHead('Gần đây', I.clock, recents.length, 'projects') +
          recents
            .map(
              (p) =>
                `<div class="row" data-nav tabindex="-1" data-a="pickProject" data-ctx="precent" data-code="${esc(p.code)}" title="${esc(p.name)}"><span class="id">${esc(p.code)}</span><span class="ell grow dim small">${esc(p.name)}</span>` +
                `<button class="ib sm rx" data-a="removeRecent" data-what="project" data-code="${esc(p.code)}" title="Xóa khỏi gần đây">${I.close}</button></div>`
            )
            .join('')
        : '');
  } else if (S.mode === 'project' && S.err) {
    el.innerHTML = `<div class="errline">${I.alert}<span class="msg ell" title="${esc(S.err)}">Không đọc được menu.</span><button class="btn" data-cmd="fsd.rebuildIndex">${I.refresh}<span>Thử lại</span></button></div>`;
  } else {
    el.innerHTML = '';
  }
}

/* ===== Thẻ menu đang chọn ===== */
function drawCard() {
  const el = $('card');
  const s = inProject() ? S.sel : null;
  el.hidden = !s;
  if (!s) {
    el.innerHTML = '';
    return;
  }
  // Giá trị bấm-là-copy (class cp + data-copy): tooltip nói rõ "Bấm: copy …".
  const cp = (cls, what, value, inner, extra) =>
    `<span class="cp ${cls}" data-copy="${esc(value)}" data-what="${esc(what)}"${extra || ''} title="Bấm: copy ${esc(what)}\n${esc(value)}">${inner}</span>`;
  const web = s.kind === 'fbo' && hosts().h2;
  const meta = s.trail ? cp('c-meta ell', 'đường dẫn menu', s.fullPath, esc(s.trail)) : '';
  const chips =
    '<div class="c-chips">' +
    (s.sysId ? cp('chip k-blue', 'sysid', s.sysId, `<b class="t">${esc(s.sysId)}</b>`) : '') +
    (s.aspx ? cp('chip k-green', 'tên file aspx', s.aspx, `<span class="t">${esc(s.aspx)}</span>`) : '') +
    (s.srcDir ? cp('chip ico k-cyan', 'thư mục nguồn', s.srcDir, I.folder) : '') +
    (s.progPath ? cp('chip ico k-orange', 'đường dẫn chương trình', s.progPath, I.prog) : '') +
    '</div>';
  const also = s.also.length
    ? '<div class="c-also ell">Cũng dùng ở: ' +
      s.also
        .map((a) => `<a data-a="selectMenu" data-kind="${a.kind}" data-id="${esc(a.id)}" data-dbl="1" title="Bấm: đổi sang menu này · nhấp đúp: mở web host 2">${esc(a.id)} ${esc(a.bar)}</a>`)
        .join(', ') +
      '</div>'
    : '';
  const shown = (S.buttons || []).filter((id) => BTN[id] && buttonAvailable(id, s.kind));
  const btns = shown
    .map((id) => {
      const b = BTN[id];
      const attr = b.tool ? `data-a="tool" data-tool="${b.tool}"` : `data-a="act" data-act="${id}"`;
      return `<button class="cbtn i-${b.c}" ${attr} title="${esc(b.tip)}" aria-label="${esc(b.tip)}">${I[b.ic]}</button>`;
    })
    .join('');
  // Tên menu: bấm = copy, nhấp đúp = mở web (data-dbl; copy chờ ~300ms để nhấp đúp không copy nhầm — xem copyEl).
  const nameTip = `Bấm: copy tên menu${web ? ' · nhấp đúp: mở web host 2' : ''}\n${s.bar}`;
  el.innerHTML =
    '<div class="card" data-ctx="card">' +
    `<div class="c-title"><span class="cp nm ell" data-copy="${esc(s.bar)}" data-what="tên menu"${web ? ' data-dbl="1"' : ''} title="${esc(nameTip)}">${esc(s.bar)}</span>` +
    `<span class="cp id" data-copy="${esc(s.id)}" data-what="mã menu" title="Bấm: copy mã menu\n${esc(s.id)}">${esc(s.id)}</span>` +
    `<button class="ib${s.pinned ? ' on' : ''}" data-a="pinCard" title="${s.pinned ? 'Bỏ ghim' : 'Ghim menu'}">${I.pin}</button>` +
    `<button class="ib" data-a="deselect" title="Bỏ chọn menu">${I.close}</button></div>` +
    `${meta}${chips}${also}` +
    `<div class="c-btnwrap"><div class="c-btns">${btns}<button class="cbtn more" data-a="cardMore" title="Thêm…" aria-label="Thêm…">${I.more}</button></div></div></div>`;
}

/* ===== Cây menu: mở từ nhánh lớn đi dần vào trong; gõ tìm thì hiện danh sách kết quả, ↓ rồi Enter để mở ===== */
const T = { kind: '', byId: new Map(), kids: new Map() };

function setTree(m) {
  T.kind = m.kind;
  T.byId = new Map(m.nodes.map((n) => [n.id, n]));
  T.kids = new Map();
  for (const n of m.nodes) {
    const list = T.kids.get(n.p) || [];
    list.push(n);
    T.kids.set(n.p, list);
  }
  drawTree();
}

const nodeKey = (id) => S.kind + ':' + id;
const pinnedSet = () => new Set(S.pinIds || []);

function trailOf(n) {
  const out = [];
  for (let p = T.byId.get(n.p); p; p = T.byId.get(p.p)) out.unshift(p.b);
  return out.join(' › ');
}

function nodeRow(n, depth, pins) {
  const open = !!ui.open[nodeKey(n.id)];
  const chev = n.n
    ? `<button class="ib sm chv${open ? ' open' : ''}" data-a="toggleNode" data-id="${esc(n.id)}" tabindex="-1" title="${open ? 'Thu gọn' : 'Mở'}">${I.chev}</button>`
    : '<span class="chv"></span>';
  const style = `style="--d:${depth}"`;
  if (!n.o) {
    return `<div class="row tn folder${open ? ' open' : ''}" ${style} data-nav tabindex="-1" data-node data-a="toggleNode" data-ctx="folder" data-id="${esc(n.id)}" data-name="${esc(n.b)}">${chev}<span class="ell grow nm">${esc(n.b)}</span><span class="cnt dim small">${n.n}</span></div>`;
  }
  const pinned = pins.has(S.kind + ':' + n.id);
  return (
    `<div class="row mrow tn" ${style} data-nav tabindex="-1"${n.n ? ' data-node' : ''} data-ctx="row" data-kind="${S.kind}" data-id="${esc(n.id)}" title="Bấm: chọn menu · nhấp đúp: mở web · chuột phải: thêm">` +
    `${chev}<span class="ell grow nm">${esc(n.b)}</span><span class="id">${esc(n.id)}</span>` +
    `<button class="ib sm pinb${pinned ? ' on' : ''}" data-a="pinRow" title="${pinned ? 'Bỏ ghim' : 'Ghim menu'}">${I.pin}</button></div>`
  );
}

function nodesHtml(parent, depth, pins) {
  let html = '';
  for (const n of T.kids.get(parent) || []) {
    html += nodeRow(n, depth, pins);
    if (n.n && ui.open[nodeKey(n.id)]) html += nodesHtml(n.id, depth + 1, pins);
  }
  return html;
}

function searchHtml(q, pins) {
  const link = q.charAt(0) === '#';
  const toks = norm(link ? q.slice(1) : q).split(/\s+/).filter(Boolean);
  if (!toks.length) return '';
  const hits = [];
  for (const n of T.byId.values()) {
    if (!n.o) continue;
    const hay = link ? String(n.l || '').toLowerCase() : norm(n.b + ' ' + n.id + ' ' + n.s);
    if (!toks.every((t) => hay.indexOf(t) >= 0)) continue;
    hits.push({ n, rank: !link && norm(n.b).indexOf(toks[0]) === 0 ? 0 : 1 });
  }
  hits.sort((a, b) => a.rank - b.rank);
  if (!hits.length) return '<div class="note">Không có menu nào khớp.</div>';
  const shown = hits.slice(0, 80);
  const rows = shown
    .map(({ n }) => {
      const pinned = pins.has(S.kind + ':' + n.id);
      const trail = trailOf(n);
      return (
        `<div class="row mrow sr" data-nav tabindex="-1" data-ctx="row" data-kind="${S.kind}" data-id="${esc(n.id)}" title="${esc(trail)}">` +
        `<span class="nm ell">${esc(n.b)}</span><span class="ell grow dim small">${esc(trail)}</span><span class="id">${esc(n.id)}</span>` +
        `<button class="ib sm pinb${pinned ? ' on' : ''}" data-a="pinRow" title="${pinned ? 'Bỏ ghim' : 'Ghim menu'}">${I.pin}</button></div>`
      );
    })
    .join('');
  return rows + (hits.length > shown.length ? `<div class="note small">Còn ${hits.length - shown.length} kết quả nữa — gõ thêm để thu hẹp.</div>` : '');
}

function drawTree() {
  const host = $('tree');
  const ok = inProject() && !S.sel && T.kind === S.kind && T.byId.size > 0;
  host.hidden = !ok;
  if (ok) drawTreeBody();
}

function drawTreeBody() {
  const q = tq.value.trim();
  const pins = pinnedSet();
  setHtml($('tres'), q ? searchHtml(q, pins) : '');
  setHtml($('tnodes'), q ? '' : nodesHtml('', 0, pins));
  fixTab();
}

function toggleNode(id, refocus) {
  const k = nodeKey(id);
  ui.open[k] = !ui.open[k];
  persist();
  drawTreeBody();
  if (refocus) {
    const el = document.querySelector(`#tnodes [data-node][data-id="${CSS.escape(id)}"]`);
    if (el) el.focus();
  }
}

tq.addEventListener('input', drawTreeBody);

/* ===== Chưa chọn menu: Ghim + Gần đây (tối đa 8 mỗi nhóm), bấm thẳng ===== */
/** Tiêu đề mục (Ghim / Gần đây); scope = có nút thùng rác xóa cả danh sách (menus | projects). */
function secHead(title, ic, count, scope) {
  const clear = scope ? `<button class="ib sm sec-x" data-a="clearRecent" data-scope="${scope}" title="Xóa danh sách gần đây">${I.trash}</button>` : '';
  return `<div class="sec">${ic}<span>${title}</span><span class="cnt">${count}</span>${clear}</div>`;
}

function menuRow(r, recent) {
  const tag = r.kind === 'mob' ? '<span class="tag">MOB</span>' : '';
  return (
    `<div class="row mrow" data-nav tabindex="-1" data-ctx="row"${recent ? ' data-recent="1"' : ''} data-kind="${r.kind}" data-id="${esc(r.id)}" ` +
    `title="Bấm: chọn menu · nhấp đúp hoặc Enter: mở web host 2 · chuột phải: thêm">` +
    `<span class="ell grow">${esc(r.bar)}</span>${tag}<span class="id">${esc(r.id)}</span>` +
    `<button class="ib sm pinb${r.pinned ? ' on' : ''}" data-a="pinRow" title="${r.pinned ? 'Bỏ ghim' : 'Ghim menu'}">${I.pin}</button>` +
    (recent ? `<button class="ib sm rx" data-a="removeRecent" title="Xóa khỏi gần đây">${I.close}</button>` : '') +
    '</div>'
  );
}

function drawQuick() {
  const el = $('quick');
  const q = inProject() && !S.sel ? S.quick : null;
  if (!q) {
    el.innerHTML = '';
    return;
  }
  const part = (title, ic, rows, recent) => (rows.length ? secHead(title, ic, rows.length, recent ? 'menus' : '') + rows.map((r) => menuRow(r, recent)).join('') : '');
  const html = part('Ghim', I.pin, q.pins, false) + part('Gần đây', I.clock, q.recents, true);
  setHtml(el, html);
}

/* ===== Ô lọc + nhóm file ===== */
function drawFilterBar() {
  const g = inProject() && S.sel ? S.groups : null;
  $('flt').hidden = !(g && !g.loading && g.list.length > 0);
}

const tokens = () => norm(ui.fq).split(/\s+/).filter(Boolean);
const matches = (name, toks) => {
  const h = norm(name);
  return toks.every((t) => h.indexOf(t) >= 0);
};

function drawGroups() {
  const host = $('groups');
  const g = inProject() && S.sel ? S.groups : null;
  if (!g) {
    host.innerHTML = '';
    return;
  }
  if (g.loading) {
    host.innerHTML = '<div class="skel"><i></i><i></i><i></i><i></i><i></i><i></i></div>';
    return;
  }
  if (!g.list.length) {
    host.innerHTML = '<div class="note">Menu chưa khai file nào.</div>';
    return;
  }
  const toks = tokens();
  const html = g.list.map((x) => groupHtml(x, toks)).join('');
  setHtml(host, html || '<div class="note">Không có file nào khớp bộ lọc.</div>');
  fixTab();
}

function groupHtml(g, toks) {
  const key = S.kind + ':' + g.key;
  const items = g.files || g.leaves || [];
  const list = toks.length ? items.filter((it) => matches(g.files ? it.name : it, toks)) : items;
  if (toks.length && !list.length) return '';
  // Đang lọc thì mở hết để thấy kết quả (không đổi trạng thái thu / mở đã nhớ).
  const collapsed = toks.length ? false : ui.collapsed[key] !== undefined ? ui.collapsed[key] : g.collapsed;
  const count = toks.length ? list.length + '/' + items.length : items.length;
  const rows = g.files ? list.map((f) => fileRow(f, g.key)).join('') : list.map((n) => leafRow(g.key, n)).join('');
  const label = String(g.label || '');
  return (
    `<div class="grp ${esc(g.key)}${collapsed ? ' collapsed' : ''}" data-gk="${esc(key)}">` +
    `<div class="gh" data-nav tabindex="-1" data-a="toggleGroup" data-ctx="grp" data-key="${esc(key)}" data-label="${esc(g.label)}" title="${esc(label)} · ${count}"><i class="chev">${I.chev}</i><span class="gic">${GICON[g.key] || I.folder}</span><span class="gn ell">${esc(label.charAt(0).toUpperCase() + label.slice(1))}</span><span class="cnt">${count}</span></div>` +
    `<div class="gb"><div class="gl">${rows}</div></div></div>`
  );
}

/** Dòng file: icon nhóm (màu theo loại) · tên · tuổi / cảnh báo mờ ở phải · chip đuôi file. */
function fileRow(f, gkey) {
  const cls = 'row frow' + (f.open ? ' open' : '') + (f.stale ? ' stale' : '') + (f.missing ? ' missing' : '');
  const chip = f.ft ? `<span class="ft ${esc(f.ft)}">${FT_LABEL[f.ft] || esc(f.ft)}</span>` : '';
  const tail = f.missing
    ? `<span class="tm miss">${I.alert}<span>thiếu</span></span>`
    : (f.time ? `<span class="tm">${esc(f.time)}</span>` : '') + (f.stale ? `<span class="warn" title=".f cũ hơn .xml">${I.warn}</span>` : '') + chip;
  return `<div class="${cls}" data-nav tabindex="-1" data-ctx="file" data-fp="${esc(f.path)}" data-name="${esc(f.name)}" ${f.missing ? '' : `data-a="openFile" data-path="${esc(f.path)}"`} title="${esc(f.tip)}"><span class="fic">${GICON[gkey] || I.file}</span><span class="nm ell grow">${esc(f.name)}</span>${tail}</div>`;
}

/** Dòng Store / Bảng: giống dòng file; nút copy tên và → Update chỉ hiện khi rê chuột (nằm đè lên cuối dòng, không chiếm chỗ). */
function leafRow(kind, name) {
  const store = kind === 'store';
  const tip = store ? 'Bấm: mở mã ALTER trong tab Query · Ctrl+bấm: DROP + CREATE' : 'Bấm: mở Select Table · Ctrl+bấm: script CREATE TABLE trong tab Query';
  return (
    `<div class="row leaf" data-nav tabindex="-1" data-a="leaf" data-ctx="leaf" data-leaf="${kind}" data-name="${esc(name)}" title="${esc(name)}\n${tip}">` +
    `<span class="fic">${store ? I.play : I.table}</span><span class="nm ell grow">${esc(name)}</span>` +
    `<span class="acts"><button class="ib sm" data-a="copyName" title="Copy tên">${I.copy}</button>` +
    `<button class="ib sm" data-a="addUpdate" title="→ Update">${I.plus}</button></span></div>`
  );
}

/* ===== Menu chuột phải / ⋯ ===== */
function closePop() {
  if (pop) {
    pop.remove();
    pop = null;
  }
}

/** items: { label, run } | { sep } | { cap }; (x, y) = góc trái trên; right = neo mép phải tại x. */
function openPop(items, x, y, right) {
  closePop();
  const el = document.createElement('div');
  el.className = 'pop';
  el.innerHTML = items
    .map((it, i) => (it.sep ? '<div class="sep"></div>' : it.cap ? `<div class="cap">${esc(it.cap)}</div>` : `<div class="it" data-i="${i}">${esc(it.label)}${it.key ? `<span class="k">${esc(it.key)}</span>` : ''}</div>`))
    .join('');
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-i]');
    if (!t) return;
    const it = items[Number(t.getAttribute('data-i'))];
    closePop();
    if (it && it.run) it.run();
  });
  document.body.appendChild(el);
  const r = el.getBoundingClientRect();
  const left = right ? x - r.width : x;
  el.style.left = Math.max(4, Math.min(left, window.innerWidth - r.width - 4)) + 'px';
  el.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + 'px';
  pop = el;
}

/** Mục chung cho menu ⋯ của thẻ và menu chuột phải của dòng; ref = { kind, id } (không có = menu đang chọn). */
const act = (a, ref) => () => post(ref ? { t: 'action', action: a, kind: ref.kind, id: ref.id } : { t: 'action', action: a });
const ACT_ORDER = ['openAll', 'web1', 'web2', 'script', 'ai'];
const ACT_LABEL = {
  openAll: 'Mở tất cả file',
  web1: 'Mở web host 1',
  web2: 'Mở web host 2',
  script: 'Xem script menu',
  ai: 'Copy cho AI'
};
const ACT_KEY = { web2: 'Nhấp đúp', script: 'F12' };
/** Mục thao tác của menu (ids theo thứ tự cho trước, bỏ cái không dùng được với loại menu). */
const actionItems = (kind, ref, ids) =>
  ids.filter((id) => buttonAvailable(id, kind)).map((id) => ({ label: ACT_LABEL[id], key: ACT_KEY[id], run: act(id, ref) }));
/** Mở màn khác theo menu: sửa menu / Update Script (điền sẵn theo menu) / Multi Search (điền sẵn ô tìm file). ref không có = menu đang chọn.
 *  skip = mục bỏ qua (menu ⋯ của thẻ bỏ mục đã có nút sẵn). */
const toolItems = (ref, skip) => {
  const tool = (name) => () => post(ref ? { t: 'menuTool', tool: name, kind: ref.kind, id: ref.id } : { t: 'menuTool', tool: name });
  return [
    { id: 'edit', label: 'Sửa menu…', run: tool('edit') },
    { id: 'update', label: 'Update của menu này', run: tool('update') },
    { id: 'search', label: 'Tìm file của menu này', run: tool('search') }
  ].filter((it) => !(skip || []).includes(it.id));
};

function cardMenu(anchor) {
  const s = S.sel;
  if (!s) return;
  // Việc không để sẵn trên hàng nút (hoặc không có nút: Web 1, Copy cho AI) nằm ở đây.
  const shown = S.buttons || [];
  const items = actionItems(s.kind, undefined, ACT_ORDER.filter((id) => !shown.includes(id)));
  if (items.length) items.push({ sep: true });
  items.push(...toolItems(undefined, shown));
  const r = anchor.getBoundingClientRect();
  openPop(items, r.right, r.bottom + 2, true);
}

function rowMenu(row, x, y) {
  const ref = { kind: row.getAttribute('data-kind'), id: row.getAttribute('data-id') };
  const pinned = pinnedSet().has(ref.kind + ':' + ref.id);
  const items = [
    ...actionItems(ref.kind, ref, ['openAll', 'web1', 'web2']),
    { label: pinned ? 'Bỏ ghim' : 'Ghim lên trang đầu', run: () => post({ t: 'togglePin', kind: ref.kind, id: ref.id }) },
    ...(row.hasAttribute('data-recent') ? [{ label: 'Xóa khỏi gần đây', run: () => post({ t: 'removeRecent', what: 'menu', kind: ref.kind, id: ref.id }) }] : []),
    { sep: true },
    ...actionItems(ref.kind, ref, ['script', 'ai']),
    { sep: true },
    ...toolItems(ref)
  ];
  openPop(items, x, y, false);
}

/** Dòng file của menu: mở / mở bên cạnh / mở thư mục chứa / copy tên, đường dẫn. File thiếu chỉ copy được. */
function fileMenu(row, x, y) {
  const p = row.getAttribute('data-fp');
  const name = row.getAttribute('data-name') || '';
  const missing = row.classList.contains('missing');
  const items = [];
  if (!missing) items.push({ label: 'Mở', run: () => post({ t: 'open', path: p }) }, { label: 'Mở bên cạnh', run: () => post({ t: 'openSide', path: p }) }, { label: 'Mở thư mục chứa', run: () => post({ t: 'reveal', path: p }) }, { sep: true });
  items.push({ label: 'Copy tên file', run: () => post({ t: 'copy', text: name }) }, { label: 'Copy đường dẫn', run: () => post({ t: 'copy', text: p }) });
  openPop(items, x, y, false);
}

/** Dòng Store / Bảng: giống bấm và Ctrl+bấm, thêm copy tên. */
function leafMenu(row, x, y) {
  const name = row.getAttribute('data-name');
  const store = row.getAttribute('data-leaf') === 'store';
  const items = store
    ? [{ label: 'Xem mã ALTER (tab Query)', run: () => post({ t: 'openStore', name, ctrl: false }) }, { label: 'Script DROP + CREATE (tab Query)', key: 'Ctrl+bấm', run: () => post({ t: 'openStore', name, ctrl: true }) }]
    : [{ label: 'Mở Select Table', run: () => post({ t: 'openTable', name, ctrl: false }) }, { label: 'Script CREATE TABLE (tab Query)', key: 'Ctrl+bấm', run: () => post({ t: 'openTable', name, ctrl: true }) }];
  items.push({ sep: true }, { label: '→ Update', run: () => post({ t: 'addToPackage', name, leaf: store ? 'store' : 'table' }) }, { label: 'Copy tên', run: () => post({ t: 'copy', text: name }) });
  openPop(items, x, y, false);
}

/** Tiêu đề nhóm file: thu / mở nhóm, thu / mở mọi nhóm, mở hết file của nhóm, copy tên. */
function groupMenu(head, x, y) {
  const grp = head.closest('.grp');
  const collapsed = grp.classList.contains('collapsed');
  const files = [...grp.querySelectorAll('[data-a="openFile"]')].map((el) => el.getAttribute('data-path'));
  const leaves = [...grp.querySelectorAll('.leaf')].map((el) => el.getAttribute('data-name'));
  const items = [{ label: collapsed ? 'Mở nhóm' : 'Thu gọn nhóm', run: () => toggleGroup(grp) }, { label: 'Thu gọn tất cả nhóm', run: collapseAll }, { label: 'Mở tất cả nhóm', run: expandAll }];
  if (files.length) items.push({ sep: true }, { label: `Mở ${files.length} file của nhóm`, run: () => files.forEach((path) => post({ t: 'open', path })) });
  if (leaves.length) items.push({ sep: true }, { label: `Copy ${leaves.length} tên`, run: () => post({ t: 'copy', text: leaves.join('\n') }) });
  openPop(items, x, y, false);
}

/** Dòng dự án ở Gần đây (chưa chọn dự án). */
function projectRecentMenu(row, x, y) {
  const code = row.getAttribute('data-code');
  openPop([{ label: 'Xóa khỏi gần đây', run: () => post({ t: 'removeRecent', what: 'project', code }) }], x, y, false);
}

/** Nhánh (thư mục) của cây menu: thu / mở nhánh, mở sâu, thu gọn cả cây, copy tên. */
function folderMenu(row, x, y) {
  const id = row.getAttribute('data-id');
  const open = !!ui.open[nodeKey(id)];
  const deep = (pid) => {
    for (const k of T.kids.get(pid) || []) if (k.n) { ui.open[nodeKey(k.id)] = true; deep(k.id); }
  };
  const items = [
    { label: open ? 'Thu gọn nhánh' : 'Mở nhánh', run: () => toggleNode(id) },
    { label: 'Mở hết nhánh con', run: () => { ui.open[nodeKey(id)] = true; deep(id); persist(); drawTreeBody(); } },
    { label: 'Thu gọn cả cây', run: () => { ui.open = {}; persist(); drawTreeBody(); } },
    { sep: true },
    { label: 'Copy tên nhánh', run: () => post({ t: 'copy', text: row.getAttribute('data-name') }) }
  ];
  openPop(items, x, y, false);
}

/* ===== Rê chuột lên dòng menu: dò sẵn file của menu đó (sau 150 ms dừng lại) để bấm vào là hiện ngay ===== */
const prefetched = new Set();
let hoverTimer = 0;
document.addEventListener('mouseover', (e) => {
  const row = e.target.closest ? e.target.closest('.mrow') : null;
  clearTimeout(hoverTimer);
  if (!row) return;
  const ref = rowRef(row);
  const key = ref.kind + ':' + ref.id;
  if (prefetched.has(key)) return;
  hoverTimer = setTimeout(() => {
    prefetched.add(key);
    post({ t: 'prefetch', ...ref });
  }, 150);
});

/* ===== Thao tác chuột ===== */
const rowRef = (row) => ({ kind: row.getAttribute('data-kind'), id: row.getAttribute('data-id') });

/** Lần bấm dòng Ghim / Gần đây gần nhất: bấm lần 1 đã đổi sang thẻ menu (dòng biến mất), nên nhấp đúp nhận theo vị trí + thời gian. */
let lastRow = null;
/** Lúc vừa nhận nhấp đúp dòng Ghim / Gần đây: sự kiện dblclick đến ngay sau đó (rơi vào thẻ menu mới) bị bỏ để không mở web hai lần. */
let rowDblAt = 0;

document.addEventListener('click', (e) => {
  if (lastRow && Date.now() - lastRow.t < 400 && Math.abs(e.clientX - lastRow.x) < 6 && Math.abs(e.clientY - lastRow.y) < 6) {
    const r = lastRow;
    lastRow = null;
    rowDblAt = Date.now();
    if (buttonAvailable('web2', r.kind)) post({ t: 'action', action: 'web2', kind: r.kind, id: r.id });
    return;
  }
  lastRow = null;
  const copyEl = e.target.closest ? e.target.closest('.cp') : null;
  if (copyEl) {
    closePop();
    copyValue(copyEl, e);
    return;
  }
  const t = e.target.closest ? e.target.closest('[data-a],[data-cmd],.mrow') : null;
  if (!t) {
    closePop();
    return;
  }
  const cmd = t.getAttribute('data-cmd');
  if (cmd) {
    closePop();
    post({ t: 'cmd', id: cmd });
    return;
  }
  const a = t.getAttribute('data-a');
  // Dòng Ghim / Gần đây / cây menu: bấm vào dòng (không phải nút ghim) = chỉ chọn menu, không mở file; lần bấm thứ hai của nhấp đúp bỏ qua.
  if (!a && t.classList.contains('mrow')) {
    closePop();
    lastRow = { ...rowRef(t), t: Date.now(), x: e.clientX, y: e.clientY };
    post({ t: 'selectMenu', ...rowRef(t) });
    return;
  }
  if (a === 'cardMore') {
    const had = pop && pop.dataset.for === 'card';
    closePop();
    if (!had) {
      cardMenu(t);
      pop.dataset.for = 'card';
    }
    e.stopPropagation();
    return;
  }
  closePop();
  switch (a) {
    case 'find':
      post({ t: 'findMenu', kind: t.getAttribute('data-kind') });
      break;
    case 'kind':
      post({ t: 'setKind', kind: t.getAttribute('data-kind') });
      tq.focus();
      break;
    case 'toggleNode':
      toggleNode(t.getAttribute('data-id'));
      e.stopPropagation();
      break;
    case 'collapseTree':
      ui.open = {};
      persist();
      drawTreeBody();
      break;
    case 'pickProject':
      post({ t: 'pickProject', code: t.getAttribute('data-code') });
      break;
    case 'pinCard':
      // Đổi hình nút ngay, khỏi chờ vòng extension → webview (extension gửi lại trạng thái chuẩn sau đó).
      t.classList.toggle('on');
      if (S.sel) post({ t: 'togglePin', kind: S.sel.kind, id: S.sel.id });
      break;
    case 'pinRow': {
      const row = t.closest('.mrow');
      t.classList.toggle('on');
      if (row) post({ t: 'togglePin', ...rowRef(row) });
      e.stopPropagation();
      break;
    }
    case 'toggleTools':
      ui.tools = !ui.tools;
      persist();
      drawTools();
      break;
    case 'clearRecent':
      post({ t: 'clearRecent', scope: t.getAttribute('data-scope') });
      e.stopPropagation();
      break;
    case 'removeRecent': {
      if (t.getAttribute('data-what') === 'project') post({ t: 'removeRecent', what: 'project', code: t.getAttribute('data-code') });
      else {
        const row = t.closest('.mrow');
        if (row) post({ t: 'removeRecent', what: 'menu', ...rowRef(row) });
      }
      e.stopPropagation();
      break;
    }
    case 'screenFocus':
      post({ t: 'screenFocus', id: t.getAttribute('data-id') });
      break;
    case 'screenClose':
      post({ t: 'screenClose', id: t.getAttribute('data-id') });
      e.stopPropagation();
      break;
    case 'deselect':
      post({ t: 'deselect' });
      break;
    case 'selectMenu':
      if (e.detail > 1) break;
      post({ t: 'selectMenu', kind: t.getAttribute('data-kind'), id: t.getAttribute('data-id') });
      break;
    case 'act':
      post({ t: 'action', action: t.getAttribute('data-act') });
      break;
    case 'tool':
      // Nút theo menu trên thẻ: Tìm file (Multi Search) / Update (Update Script), điền sẵn menu đang chọn.
      post({ t: 'menuTool', tool: t.getAttribute('data-tool') });
      break;
    case 'toggleGroup':
      toggleGroup(t.closest('.grp'));
      break;
    case 'collapseAll':
      collapseAll();
      break;
    case 'expandAll':
      expandAll();
      break;
    case 'addUpdate': {
      const leaf = t.closest('.leaf');
      if (leaf) post({ t: 'addToPackage', name: leaf.getAttribute('data-name'), leaf: leaf.getAttribute('data-leaf') === 'store' ? 'store' : 'table' });
      e.stopPropagation();
      break;
    }
    case 'openFile':
      // Ctrl+bấm = copy đường dẫn file (không mở).
      if (e.ctrlKey || e.metaKey) {
        post({ t: 'copy', text: t.getAttribute('data-path'), what: 'đường dẫn file' });
        toast(t);
      } else post({ t: 'open', path: t.getAttribute('data-path') });
      break;
    case 'leaf':
      openLeaf(t, e.ctrlKey || e.metaKey);
      break;
    case 'copyName': {
      const leaf = t.closest('.leaf');
      if (leaf) post({ t: 'copy', text: leaf.getAttribute('data-name') });
      e.stopPropagation();
      break;
    }
  }
});

/* ===== Bấm-là-copy trên thẻ menu (tên, mã, đường dẫn menu, sysid, aspx, thư mục nguồn, đường dẫn chương trình) =====
 * Quyết định click / dblclick: chỉ TÊN MENU có nhấp đúp (mở web host 2). Khi nhấp đúp có hiệu lực (data-dbl), bấm đơn vào tên
 * KHÔNG copy ngay mà chờ COPY_DELAY ms; nhấp đúp tới (lần bấm thứ 2, e.detail > 1, hoặc sự kiện dblclick) thì hủy copy và mở web.
 * Các giá trị khác (và tên khi không có web) copy ngay, không độ trễ. */
const COPY_DELAY = 300;
let copyTimer = 0;

function copyValue(el, e) {
  const text = el.getAttribute('data-copy');
  if (!text) return;
  clearTimeout(copyTimer);
  if (e.detail > 1) return;
  const run = () => {
    post({ t: 'copy', text, what: el.getAttribute('data-what') || '' });
    toast(el);
  };
  if (el.hasAttribute('data-dbl')) copyTimer = setTimeout(run, COPY_DELAY);
  else run();
}

/** Phản hồi tại chỗ: nháy nền xanh ở giá trị vừa copy + nhãn nhỏ "Đã copy" cạnh nó (thanh trạng thái do extension báo thêm). */
function toast(el) {
  document.querySelectorAll('.toast').forEach((n) => n.remove());
  el.classList.remove('copied');
  void el.offsetWidth;
  el.classList.add('copied');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = 'Đã copy';
  document.body.appendChild(t);
  const r = el.getBoundingClientRect();
  const w = t.getBoundingClientRect().width;
  t.style.left = Math.max(4, Math.min(r.left, window.innerWidth - w - 4)) + 'px';
  t.style.top = (r.bottom + 22 > window.innerHeight ? Math.max(4, r.top - 24) : r.bottom + 2) + 'px';
  setTimeout(() => {
    t.remove();
    el.classList.remove('copied');
  }, 900);
}

/** Nhấp đúp tên menu trên thẻ / "Cũng dùng ở" = mở web host 2 (chỉ menu FBO có host 2). Dòng Ghim / Gần đây xử lý ở click (lastRow). */
document.addEventListener('dblclick', (e) => {
  clearTimeout(copyTimer);
  const t = e.target.closest ? e.target.closest('[data-dbl]') : null;
  if (!t || Date.now() - rowDblAt < 600) return;
  if (t.tagName === 'A') {
    const kind = t.getAttribute('data-kind');
    if (buttonAvailable('web2', kind)) post({ t: 'action', action: 'web2', kind, id: t.getAttribute('data-id') });
  } else if (S.sel && buttonAvailable('web2', S.sel.kind)) {
    post({ t: 'action', action: 'web2' });
  }
});

document.addEventListener('contextmenu', (e) => {
  const t = e.target.closest ? e.target.closest('[data-ctx]') : null;
  if (!t) return;
  e.preventDefault();
  const kind = t.getAttribute('data-ctx');
  const menus = { row: rowMenu, file: fileMenu, leaf: leafMenu, grp: groupMenu, folder: folderMenu, precent: projectRecentMenu };
  if (menus[kind]) {
    closePop();
    menus[kind](t, e.clientX, e.clientY);
  } else {
    // Thẻ menu: cùng menu với nút ⋯.
    const more = t.querySelector('[data-a="cardMore"]');
    if (more) {
      cardMenu(more);
      pop.dataset.for = 'card';
    }
  }
});

function openLeaf(el, ctrl) {
  const name = el.getAttribute('data-name');
  post({ t: el.getAttribute('data-leaf') === 'store' ? 'openStore' : 'openTable', name, ctrl });
}

function toggleGroup(grp) {
  if (!grp) return;
  const collapsed = grp.classList.toggle('collapsed');
  // Đang lọc thì chỉ đổi tạm; không ghi đè trạng thái đã nhớ.
  if (!tokens().length) {
    ui.collapsed[grp.getAttribute('data-gk')] = collapsed;
    persist();
  }
}

function expandAll() {
  const filtering = tokens().length > 0;
  document.querySelectorAll('#groups .grp').forEach((grp) => {
    grp.classList.remove('collapsed');
    if (!filtering) ui.collapsed[grp.getAttribute('data-gk')] = false;
  });
  if (!filtering) persist();
}

function collapseAll() {
  const filtering = tokens().length > 0;
  document.querySelectorAll('#groups .grp').forEach((grp) => {
    grp.classList.add('collapsed');
    if (!filtering) ui.collapsed[grp.getAttribute('data-gk')] = true;
  });
  if (!filtering) persist();
}

/* ===== Ô lọc + bàn phím ===== */
fq.addEventListener('input', () => {
  ui.fq = fq.value;
  drawGroups();
});

/** Phần tử di chuyển được bằng ↑↓: dòng / nhóm đang thấy (không nằm trong nhóm thu gọn). */
function navList() {
  return [...document.querySelectorAll('[data-nav]')].filter((el) => !el.closest('.grp.collapsed .gb'));
}

/** Chỉ phần tử nav đầu có tabindex 0 (Tab vào danh sách một lần); các phần tử khác -1, tới bằng ↑↓. */
function fixTab() {
  const list = navList();
  document.querySelectorAll('[data-nav]').forEach((el) => el.setAttribute('tabindex', '-1'));
  if (list[0]) list[0].setAttribute('tabindex', '0');
}

function activate(el, key, e) {
  if (el.getAttribute('data-a') === 'toggleNode') {
    if (key === 'Enter' || key === ' ') toggleNode(el.getAttribute('data-id'), true);
    return;
  }
  if (el.classList.contains('mrow') && (el.classList.contains('tn') || el.classList.contains('sr'))) {
    // Cây / kết quả tìm: Enter hoặc Space chọn menu (không mở file); F12 xem script.
    if (key === 'F12') post({ t: 'action', action: 'script', kind: S.kind, id: el.getAttribute('data-id') });
    else post({ t: 'selectMenu', ...rowRef(el) });
    return;
  }
  if (el.classList.contains('mrow')) {
    const r = rowRef(el);
    if (key === 'Delete') {
      if (el.hasAttribute('data-recent')) post({ t: 'removeRecent', what: 'menu', ...r });
    } else if (key === 'Enter') {
      if (buttonAvailable('web2', r.kind)) post({ t: 'action', action: 'web2', kind: r.kind, id: r.id });
    } else if (key === ' ') {
      post({ t: 'selectMenu', ...r });
    } else if (key === 'F12') {
      post({ t: 'action', action: 'script', kind: r.kind, id: r.id });
    }
    return;
  }
  if (key === 'F12') return;
  const a = el.getAttribute('data-a');
  if (a === 'toggleGroup') toggleGroup(el.closest('.grp'));
  else if (a === 'openFile') post({ t: 'open', path: el.getAttribute('data-path') });
  else if (a === 'leaf') openLeaf(el, e.ctrlKey || e.metaKey);
  else if (a === 'pickProject') post({ t: 'pickProject', code: el.getAttribute('data-code') });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (pop) {
      closePop();
      return;
    }
    if (e.target === fq && ui.fq) {
      ui.fq = '';
      fq.value = '';
      drawGroups();
    }
    return;
  }
  const list = navList();
  if (e.target === tq) {
    const rows = [...document.querySelectorAll('#tres [data-nav], #tnodes [data-nav]')];
    if (e.key === 'ArrowDown' && rows.length) {
      e.preventDefault();
      rows[0].focus();
    } else if (e.key === 'Enter' && tq.value.trim()) {
      const first = document.querySelector('#tres .sr');
      if (first) post({ t: 'selectMenu', ...rowRef(first) });
    } else if (e.key === 'Escape' && tq.value) {
      tq.value = '';
      drawTreeBody();
    }
    return;
  }
  if (e.target === fq) {
    if (e.key === 'ArrowDown' && list.length) {
      e.preventDefault();
      list[0].focus();
    }
    return;
  }
  const el = e.target.closest ? e.target.closest('[data-nav]') : null;
  if (!el || e.target !== el) return;
  if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && el.hasAttribute('data-node')) {
    const id = el.getAttribute('data-id');
    if ((e.key === 'ArrowRight') !== !!ui.open[S.kind + ':' + id]) {
      e.preventDefault();
      toggleNode(id, true);
    }
    return;
  }
  const i = list.indexOf(el);
  if (e.key === 'ArrowDown' && i < list.length - 1) {
    e.preventDefault();
    list[i + 1].focus();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (i > 0) list[i - 1].focus();
    else if (!$('flt').hidden) fq.focus();
  } else if (e.key === 'Enter' || e.key === ' ' || e.key === 'F12' || (e.key === 'Delete' && el.hasAttribute('data-recent'))) {
    e.preventDefault();
    activate(el, e.key, e);
  }
});

window.addEventListener('blur', closePop);
window.addEventListener('resize', closePop);

post({ t: 'ready' });
