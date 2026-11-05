// Dựng `ctx` cho màn — cùng hình dạng với ctx của app.js (5.2) openScreen, để chép nguyên screens/*.js:
// { call, on, toast, memory, project(), opts, command, open(cmdKey, opts), openFile(path, line), setTitle(title, tip), menu }
// Thêm cho webview: ctx.state (dữ liệu màn đã lưu ở lần trước, khôi phục sau khi mở lại IDE) và ctx.saveState(data).
import { call, on } from './bridge.js';

/** HTML ngắn của toast (có <b>, <span>, &amp;…) → chữ thường để hiện bằng thông báo của IDE. */
function plain(html) {
  const d = document.createElement('div');
  d.innerHTML = String(html == null ? '' : html);
  return (d.textContent || '').replace(/\s+/g, ' ').trim();
}

/**
 * @param {{ screen: string, project: object, opts?: object, saved?: any, saveState?: (data: any) => void }} init
 * project: { code, name, db, sysDb, kind } (cùng hình project.current của 5.2; kind '2' = FBO).
 * Trả { ctx, attach(inst) }: screen.js gọi attach(inst) sau khi mount để host chuyển sự kiện db.changed vào màn.
 */
export function createHost(init) {
  const project = init.project || {};
  let inst = null;

  const toast = (html) => {
    const text = plain(html);
    if (!text) return;
    call('ui.toast', { text, kind: /^⚠/.test(text) ? 'warn' : 'info' }).catch(() => { /* IDE không nhận toast: bỏ qua */ });
  };

  // Memory Temp: host (gói service) giữ bản chính; ở đây nhớ bản sao để ctx.memory.text đọc đồng bộ như 5.2.
  const memory = {
    cache: '',
    add(text) {
      if (!text || !String(text).trim()) return;
      this.cache += String(text).replace(/\s+$/, '') + '\r\nGO\r\n';
      call('memory.add', { text: String(text) }).catch(() => { /* chưa có service memory */ });
    },
    get text() { return this.cache; }
  };
  const syncMemory = (r) => { memory.cache = typeof r === 'string' ? r : r && typeof r.text === 'string' ? r.text : memory.cache; };
  call('memory.get', {}).then(syncMemory).catch(() => { /* chưa có service memory */ });
  on('memory.changed', syncMemory);

  // Extension chọn DB cho tab (QuickPick) → đẩy db.changed; màn tự đổi DB qua inst.setDb(name).
  on('db.changed', (d) => { if (inst && inst.setDb && d && d.db) inst.setDb(d.db); });

  // Panel "Đối tượng SQL" ở sidebar nạp mã / bảng / chuỗi tìm vào tab đang mở (5.2 panels/sql.js: cur.inst.loadObject · loadTable · setFind).
  on('query.loadObject', (d) => { if (inst && inst.loadObject && d && typeof d.text === 'string') inst.loadObject(d.text); });
  on('query.setFind', (d) => { if (inst && inst.setFind && d) inst.setFind(String(d.text || '')); });
  on('table.load', (d) => { if (inst && inst.loadTable && d && d.table) inst.loadTable(String(d.table)); });

  const ctx = {
    call, on, toast, memory,
    project: () => project,
    opts: init.opts || {},
    command: init.screen,
    state: init.saved === undefined ? null : init.saved,
    saveState: (data) => { if (init.saveState) init.saveState(data); },
    /** Mở màn / chạy lệnh: 'Query' mở tab mới; SetDatabaseTab / SetDatabaseMain / ChangeDatabase hiện QuickPick DB của tab. */
    open: (key, opts) => call('screen.open', { key, opts: opts || {}, currentDb: inst && inst.db ? inst.db() : '' }).catch((e) => toast('⚠ ' + e.message)),
    openFile: (path, line) => call('file.openInEditor', { path, line: line || 0 }).catch((e) => toast('⚠ ' + e.message)),
    setTitle: (title, tip) => { call('screen.setTitle', { title, tip: tip || title }).catch(() => { /* đổi tên tab lỗi: bỏ qua */ }); },
    // Panel MENU nằm ở view của IDE, không trong tab màn: các hàm này an toàn nhưng không làm gì.
    menu: { kind: () => 'fbo', selected: () => null, select: () => {}, run: () => {}, reload: () => {} }
  };

  return { ctx, attach: (i) => { inst = i; } };
}
