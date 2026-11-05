// Đọc file văn bản cho Multi Search (xem file + tìm nội dung): giải BOM như File.ReadAllText của .NET, nhận diện file nhị phân
// như 5.1 IsTextFile, đoán ngôn ngữ tô màu. Chỉ đọc — không bao giờ ghi file, càng không ghi .f.
// File .f: nếu truyền crypto thì giải vùng mã hóa TRONG BỘ NHỚ (convertText) để so khớp; không truyền thì giữ nguyên văn.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { convertText } from '../controllers/controllerReader';
import type { FControllerCrypto } from '../controllers/fCrypto';

/** Giới hạn xem file (5.2: 10 MB). */
export const MAX_VIEW_BYTES = 10 * 1024 * 1024;

/** Đọc theo BOM: UTF-16 LE / BE, UTF-8 (bỏ BOM); không BOM → UTF-8. */
export function decodeBuffer(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  return buf.toString('utf8');
}

/** 5.1 IsTextFile: có ký tự điều khiển 1–7 hoặc 14–25 → file nhị phân (xlsx, rpt, ảnh…). */
export function looksBinary(text: string, limit = 65536): boolean {
  const n = Math.min(text.length, limit);
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if ((c > 0 && c < 8) || (c > 13 && c < 26)) return true;
  }
  return false;
}

/** Ngôn ngữ Monaco theo đuôi. */
export function languageOf(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case '.xml': case '.f': case '.xsd': case '.ent': case '.config': case '.frx': case '.upd': return 'xml';
    case '.js': case '.json': return 'javascript';
    case '.sql': return 'sql';
    case '.aspx': case '.html': case '.htm': return 'html';
    case '.css': return 'css';
    case '.vb': return 'vb';
    default: return 'plaintext';
  }
}

/** Văn bản dùng để so khớp nội dung: bỏ qua file lớn / nhị phân (trả undefined). */
export async function readSearchText(file: string, maxBytes: number, crypto?: FControllerCrypto): Promise<string | undefined> {
  let buf: Buffer;
  try {
    const st = await fs.promises.stat(file);
    if (!st.isFile() || st.size > maxBytes) return undefined;
    buf = await fs.promises.readFile(file);
  } catch {
    return undefined;
  }
  let text = decodeBuffer(buf);
  if (looksBinary(text)) return undefined;
  if (crypto && crypto.keyCount > 0 && path.extname(file).toLowerCase() === '.f') text = convertText(text, crypto).text;
  return text;
}

export interface ViewFile {
  path: string;
  text: string;
  /** yyyy-MM-dd HH:mm:ss */
  modified: string;
  language: string;
}

export function formatTime(d: Date, seconds: boolean): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return seconds ? `${day}:${p(d.getSeconds())}` : day;
}

/** file.read: đọc để xem (tối đa 10 MB); file nhị phân thì ném lỗi. Văn bản nguyên văn (kể cả .f). */
export async function readForView(file: string): Promise<ViewFile> {
  let st: fs.Stats;
  try {
    st = await fs.promises.stat(file);
  } catch {
    throw new Error('Không có file ' + file);
  }
  if (!st.isFile()) throw new Error('Không có file ' + file);
  if (st.size > MAX_VIEW_BYTES) throw new Error('File lớn hơn 10 MB — mở bằng IDE ngoài.');
  const text = decodeBuffer(await fs.promises.readFile(file));
  if (looksBinary(text)) throw new Error('Không phải file chữ — mở bằng ứng dụng ngoài (double click).');
  return { path: file, text, modified: formatTime(st.mtime, true), language: languageOf(file) };
}
