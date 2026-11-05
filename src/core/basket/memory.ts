// Memory Temp: nối script vào chuỗi tạm như app.js 5.2 (bỏ khoảng trắng cuối + CRLF + GO + CRLF; text trống thì bỏ qua).
export function appendMemory(current: string, text: string): string {
  if (text.trim() === '') return current;
  return current + text.replace(/\s+$/, '') + '\r\nGO\r\n';
}
