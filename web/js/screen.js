// Một trang cho mọi màn: đọc screen + opts + project từ khối #fsd-init (extension dựng lúc mở / khôi phục tab),
// import('./screens/<screen>.js') rồi mount(root, ctx). Trạng thái lưu bằng vscode.setState để khôi phục sau khi mở lại IDE.
import { vscode, call } from './bridge.js';
import { createHost } from './host.js';

const root = document.getElementById('root');
/** Màn có css riêng trong web/css/<màn>.css. */
const SCREEN_CSS = new Set(['update-script', 'multi-search', 'menu-edit']);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function readInit() {
  let init = {};
  try { init = JSON.parse(document.getElementById('fsd-init').textContent || '{}'); } catch { /* HTML không có khối init: dùng state */ }
  const old = (vscode && vscode.getState()) || {};
  return {
    panelId: init.panelId || old.panelId || '',
    screen: init.screen || old.screen || '',
    opts: init.opts || old.opts || {},
    project: init.project || old.project || null,
    saved: init.saved !== undefined ? init.saved : old.saved,
    error: init.error || ''
  };
}

function fail(message) {
  root.innerHTML = `<div class="empty">${esc(message)}</div>`;
}

async function main() {
  const init = readInit();
  if (init.error) return fail(init.error);
  if (!/^[\w-]+$/.test(init.screen)) return fail('Tên màn không hợp lệ: ' + init.screen);
  if (!init.project) return fail('Tab không có thông tin dự án.');

  // Trạng thái bền của tab: màn gọi ctx.saveState(data); vscode.setState ghi lại cả screen / opts / project để extension khôi phục.
  const state = { panelId: init.panelId, screen: init.screen, opts: init.opts, project: init.project, saved: init.saved };
  const persist = () => { if (vscode) vscode.setState(state); };
  persist();

  // Màn dựng ngay, không chờ SQL: DB mặc định của tab (DB App đầu của dự án) do từng màn tự điền khi đọc xong project.databases; opts.db / DB đã lưu vẫn thắng.
  const project = Object.assign({ db: '', sysDb: '', kind: '2' }, init.project);

  const { ctx, attach } = createHost({
    screen: init.screen, project, opts: init.opts, saved: init.saved,
    saveState: (data) => { state.saved = data; persist(); }
  });

  const scr = document.createElement('div');
  scr.className = 'scr';
  root.appendChild(scr);
  // CSS riêng của màn (nếu có): web/css/<screen>.css; không có file thì bỏ qua.
  if (SCREEN_CSS.has(init.screen)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../css/' + init.screen + '.css', import.meta.url).href;
    link.onerror = () => link.remove();
    document.head.appendChild(link);
  }
  try {
    const mod = await import('./screens/' + init.screen + '.js');
    const inst = mod.mount(scr, ctx);
    attach(inst);
    window.addEventListener('pagehide', () => { try { inst && inst.dispose && inst.dispose(); } catch { /* đóng tab: bỏ qua lỗi dọn */ } });
  } catch (e) {
    fail(`Không mở được màn ${init.screen}: ${e && e.message ? e.message : e}`);
  }
}

main();
