// ctx của view "Cây màn" ở sidebar: cùng hình với ctx của tab màn (host.js) đủ cho ui/explorer.js —
// { call, on, toast, project(), opts, open(key, opts), openFile(path, line) } — nhưng không có tab riêng nên toast và mở màn đi qua extension.
import { call, on } from '../bridge.js';

/** HTML ngắn của toast (có <b>, <span>, &amp;…) → chữ thường để hiện bằng thông báo của IDE. */
function plain(html) {
  const d = document.createElement('div');
  d.innerHTML = String(html == null ? '' : html);
  return (d.textContent || '').replace(/\s+/g, ' ').trim();
}

/** Khóa màn kiểu 5.2 (ctx.open) → tên màn của extension. */
const SCREENS = { UpdateScript: 'update-script', MultiSearch: 'multi-search', Query: 'query', SelectTable: 'select-table' };

export function createSideCtx(getProject) {
  const toast = (html) => {
    const text = plain(html);
    if (!text) return;
    call('ui.toast', { text, kind: /^⚠/.test(text) ? 'warn' : 'info' }).catch(() => { /* IDE không nhận toast: bỏ qua */ });
  };
  return {
    call, on, toast,
    project: getProject,
    opts: {},
    open: (key, opts) => {
      const screen = SCREENS[key];
      if (!screen) { toast(`⚠ "${key}" chưa có trong extension`); return Promise.resolve(null); }
      return call('side.openScreen', { screen, opts: opts || {} }).catch((e) => toast('⚠ ' + e.message));
    },
    openFile: (path, line) => call('file.openInEditor', { path, line: line || 0 }).catch((e) => toast('⚠ ' + e.message))
  };
}
