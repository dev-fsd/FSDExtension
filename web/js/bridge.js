// Cầu nối giao diện ↔ extension (src/vscode/bridge/registry.ts), cùng API với bridge.js của 5.2:
// call, callWithFiles, on, setClipboard, inHost. Giao diện chỉ dùng các hàm này, không gọi acquireVsCodeApi trực tiếp.
// Tin nhắn: webview gửi { id, cmd, args }; extension trả { id, ok, result | error } và đẩy sự kiện { event, data }.
// Mở ngoài IDE (xem thử bố cục): inHost = false, lệnh trả mảng rỗng / null.

/** Đối tượng API của VS Code (acquireVsCodeApi chỉ gọi được một lần) — screen.js dùng cho getState / setState. */
export const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
export const inHost = !!vscode;

const pending = new Map();
const listeners = {};
let seq = 0;

if (vscode) {
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.id != null && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.ok ? p.resolve(m.result) : p.reject(new Error(m.error || 'Lỗi không rõ'));
    } else if (m.event) {
      (listeners[m.event] || []).slice().forEach((fn) => { try { fn(m.data); } catch (err) { console.error(err); } });
    }
  });
}

/** Gọi lệnh ở extension; trả Promise kết quả (lỗi → reject Error(message)). */
export function call(cmd, args) {
  if (!vscode) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    vscode.postMessage({ id, cmd, args: args || {} });
  });
}

/** Đọc nội dung File theo BOM: UTF-16 LE/BE (file .sql 5.1 lưu UTF-16), UTF-8 (BOM tự bỏ), không BOM → UTF-8. */
async function readFileText(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  return new TextDecoder('utf-8').decode(buf);
}

/**
 * Gọi lệnh kèm File kéo thả. Webview không biết đường dẫn thật của file, nên đọc nội dung (text) rồi gửi
 * args.files = [{ name, text }] — lệnh file.readDropped trả { path: '', text } (không có đường dẫn: Lưu sẽ hỏi nơi lưu).
 */
export async function callWithFiles(cmd, args, files) {
  const list = await Promise.all(Array.from(files || []).map(async (f) => ({ name: f.name, text: await readFileText(f) })));
  return call(cmd, Object.assign({}, args || {}, { files: list }));
}

/** Nghe sự kiện extension đẩy sang (query.progress, db.changed…). */
export function on(event, fn) {
  (listeners[event] = listeners[event] || []).push(fn);
}

/** Ghi clipboard qua extension (không phụ thuộc focus / quyền clipboard của webview). */
export function setClipboard(text) {
  return vscode ? call('clipboard.set', { text: text || '' }) : navigator.clipboard.writeText(text || '');
}
