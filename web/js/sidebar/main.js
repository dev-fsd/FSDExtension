// View "Cây màn" (fsd.screenTree) — ES module chạy trong webview ở sidebar trái, cùng khu với cây menu hệ thống.
// Hiện cây "trái" của màn đang focus: Update Script (Đối tượng SQL · File · Dữ liệu khai báo) hoặc Multi Search (File · Dữ liệu khai báo).
// Hai cây giữ nguyên trạng thái (tick, kết quả tìm) khi chuyển qua lại; đổi dự án thì dựng lại.
// Extension (src/vscode/sideTreeView.ts) báo trạng thái bằng sự kiện side.state, chuyển lệnh dữ liệu cho dịch vụ upd.* / ms.*, và chuyển
// sự kiện giữa view ⇄ tab màn (side.toTab: ms.view · ms.find · ms.cmd; side.fromTab: menu · checkVoucher).
import { call, on, inHost } from '../bridge.js';
import { createSideCtx } from './ctx.js';
import { ic } from './icons.js';
import { mountSearchPanel } from './search-panel.js';
import { mountUpdatePanel } from './update-panel.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const app = document.getElementById('app');

const SCREENS = {
  'update-script': { label: 'Update', tip: 'Update Script — Đối tượng SQL · File · Dữ liệu khai báo → thêm vào Update', icon: 'pkg', color: 'orange', mount: mountUpdatePanel, open: 'Mở màn Update' },
  'multi-search': { label: 'Tìm file', tip: 'Multi Search — tìm tên / nội dung file, bấm file để xem và sửa ở tab', icon: 'search', color: 'blue', mount: mountSearchPanel, open: 'Mở màn Tìm file (Multi Search)' }
};

const S = { mode: null, machineCode: '', project: null, screen: '', tabs: {} };
const panels = new Map(); // screen → { el, api }
const shared = new Map(); // screen → json cuối đã chia sẻ (không gửi lại khi không đổi)
let projectCode = '';

const ctx = createSideCtx(() => S.project || {});

/** Thư mục chương trình view đang dùng → extension nhớ + báo cho tab cùng màn (tab Update dùng làm gốc khi thêm file / tạo Update). */
function share(screen, program, mode) {
  const json = JSON.stringify([program, mode]);
  if (shared.get(screen) === json) return;
  shared.set(screen, json);
  call('side.share', { screen, program, mode }).catch(() => { /* không có tab / extension chưa sẵn sàng: bỏ qua */ });
}

/** Gửi sự kiện tới tab mới nhất của màn đang hiện; opts { reveal, open } xem sideTreeView.ts. Không có tab và không yêu cầu mở → nhắc người dùng. */
function toTab(screen) {
  return async (event, data, opts) => {
    try {
      const r = await call('side.toTab', { screen, event, data, reveal: !!(opts && opts.reveal), open: opts && opts.open });
      if (r && !r.delivered && !r.opened) ctx.toast(`⚠ Chưa mở tab ${SCREENS[screen].label} — bấm nút mở ở đầu view`);
    } catch (e) { ctx.toast('⚠ ' + esc(e.message || e)); }
  };
}

function panel(screen) {
  let p = panels.get(screen);
  if (p) return p;
  const el = document.createElement('div');
  el.className = 'sb-pane';
  el.dataset.p = screen;
  el.hidden = true;
  app.querySelector('.sb-body').appendChild(el);
  const env = { ctx, share, toTab: (event, data, opts) => toTab(screen)(event, data, opts) };
  p = { el, api: SCREENS[screen].mount(el, env) };
  panels.set(screen, p);
  return p;
}

function dropPanels() {
  for (const p of panels.values()) { try { p.api.dispose(); } catch { /* panel đã hỏng: bỏ */ } p.el.remove(); }
  panels.clear();
  shared.clear();
}

/* ===== Khung ===== */
app.innerHTML = `
  <div class="sb-head" data-a="head" hidden>
    <div class="sb-seg" role="tablist" data-a="seg"></div>
    <span class="sp"></span>
    <span class="sb-proj" data-a="proj"></span>
    <button class="icon-btn" data-a="openTab" title="">${ic('external', '', 14)}</button>
  </div>
  <div class="sb-empty" data-a="empty" hidden></div>
  <div class="sb-body" data-a="body"></div>`;
const q = (a) => app.querySelector(`[data-a="${a}"]`);

function drawHead() {
  const seg = q('seg');
  seg.innerHTML = Object.entries(SCREENS).map(([k, s]) => {
    const n = S.tabs[k] || 0;
    return `<button class="${S.screen === k ? 'on' : ''}" role="tab" data-s="${k}" title="${esc(s.tip)}${n ? ` — ${n} tab đang mở` : ' — chưa mở tab'}">${ic(s.icon, s.color, 14)}<span>${s.label}</span>${n ? `<i class="n">${n}</i>` : ''}</button>`;
  }).join('');
  seg.querySelectorAll('button').forEach((b) => { b.onclick = () => call('side.mode', { screen: b.dataset.s }).catch(() => {}); });
  const p = S.project;
  q('proj').innerHTML = p ? `${ic('db', 'green', 13)}<b>${esc(p.code)}</b>` : '';
  q('proj').title = p ? `Dự án ${p.code} — ${p.name}` : '';
  const cur = SCREENS[S.screen];
  const ob = q('openTab');
  ob.title = cur ? `${cur.open} — thêm tab mới` : '';
  ob.hidden = !cur;
}

function drawEmpty(html) {
  const el = q('empty');
  el.hidden = false;
  el.innerHTML = html;
  el.querySelectorAll('[data-cmd]').forEach((b) => { b.onclick = () => call('side.cmd', { id: b.dataset.cmd }).catch(() => {}); });
  el.querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => call('side.openScreen', { screen: b.dataset.open, opts: {} }).catch((e) => ctx.toast('⚠ ' + esc(e.message || e))); });
}

function render() {
  const inProject = S.mode === 'project' && S.project;
  q('head').hidden = !inProject;
  for (const [k, p] of panels) p.el.hidden = !(inProject && S.screen === k);
  if (!inProject) {
    drawEmpty(S.mode === 'locked'
      ? `<div class="es-ic">${ic('warn', 'orange', 32)}</div><div class="es-t">Cần key để dùng</div><div class="es-d">Mã máy: <span class="mono">${esc(S.machineCode)}</span></div>` +
        '<div class="btns"><button class="btn primary" data-cmd="fsd.enterKey">Nhập key</button><button class="btn" data-cmd="fsd.copyMachineCode">Copy mã máy</button></div>'
      : `<div class="es-ic">${ic('folder', 'yellow', 32)}</div><div class="es-t">Chưa mở dự án</div><div class="es-d">Chọn dự án để dùng cây của màn Update và Tìm file.</div>` +
        '<div class="btns"><button class="btn primary" data-cmd="fsd.changeProject">Chọn dự án…</button></div>');
    return;
  }
  drawHead();
  if (!S.screen) {
    drawEmpty(`<div class="es-ic">${ic('panel', 'muted', 32)}</div><div class="es-t">Chưa mở màn nào</div>` +
      '<div class="es-d">Cây này đi theo màn Update hoặc Tìm file đang mở.</div>' +
      `<div class="btns"><button class="btn primary" data-open="update-script">${ic('pkg', '', 14)}Mở Update</button><button class="btn" data-open="multi-search">${ic('search', 'blue', 14)}Mở Tìm file</button></div>`);
    return;
  }
  q('empty').hidden = true;
  const p = panel(S.screen);
  p.el.hidden = false;
}

on('side.state', (d) => {
  if (!d) return;
  const code = d.project ? d.project.code : '';
  if (code !== projectCode) { dropPanels(); projectCode = code; }
  Object.assign(S, { mode: d.mode, machineCode: d.machineCode || '', project: d.project || null, screen: d.screen || '', tabs: d.tabs || {} });
  render();
});

/** Tin từ tab màn: menu mở kèm tab → điền ô tìm của cây; checkVoucher → chạy ở view Tìm file. */
on('side.fromTab', (d) => {
  if (!d || !SCREENS[d.screen] || !S.project) return;
  const p = panel(d.screen);
  if (d.event === 'menu' && d.data && d.data.n) p.api.menuChanged(d.data.kind || 'fbo', d.data.n);
  else p.api.event(d.event, d.data);
});

q('openTab').onclick = () => { if (S.screen) call('side.openScreen', { screen: S.screen, opts: {} }).catch((e) => ctx.toast('⚠ ' + esc(e.message || e))); };

// Báo extension view đã sẵn sàng nhận trạng thái (và tin chờ từ tab).
if (inHost) call('side.ready').catch(() => {});
