// Check Voucher (btnCheckVoucherController 5.1): tên controller trùng giữa các file Grid\Config\Include\Voucher.Controller.xxx.
// Mỗi file (đúng 3 ký tự sau tiền tố) là danh sách thẻ <controller name="...">; tên lặp trong cùng file hoặc có ở hai file → lỗi.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { decodeBuffer } from './readText';

export const VOUCHER_INCLUDE_DIR = 'App_Data\\Controllers\\Grid\\Config\\Include\\';
const PREFIX = 'Voucher.Controller.';

export interface VoucherError {
  a: string;
  name: string;
  b: string;
}

export interface VoucherCheck {
  errors: VoucherError[];
  /** Đường dẫn tương đối từ gốc của các file lỗi (không trùng). */
  files: string[];
}

/** Tên của các thẻ <controller name="…"> theo thứ tự xuất hiện (đã trim). */
export function controllerNames(text: string): string[] {
  const names: string[] = [];
  const re = /<controller\b[^>]*?\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) names.push((m[1] ?? m[2] ?? '').trim());
  return names;
}

/** Kiểm trùng giữa các tập tên theo file (đã sắp theo tên file). */
export function findDuplicates(byFile: Map<string, string[]>): VoucherError[] {
  const errors: VoucherError[] = [];
  const keys = [...byFile.keys()];
  for (const [file, names] of byFile) {
    const seen = new Set<string>();
    for (const c of names) {
      if (seen.has(c)) errors.push({ a: file, name: c, b: file });
      else seen.add(c);
    }
  }
  for (let i = 0; i < keys.length - 1; i++) {
    for (let k = i + 1; k < keys.length; k++) {
      const other = new Set(byFile.get(keys[k]));
      for (const c of new Set(byFile.get(keys[i]))) if (other.has(c)) errors.push({ a: keys[i], name: c, b: keys[k] });
    }
  }
  return errors;
}

export async function checkVoucher(root: string): Promise<VoucherCheck> {
  const base = root.replace(/[\\/]+$/, '') + path.sep;
  const folder = base + VOUCHER_INCLUDE_DIR.replace(/\\/g, path.sep);
  let entries: string[];
  try {
    entries = await fs.promises.readdir(folder);
  } catch {
    throw new Error('Không có thư mục ' + folder);
  }
  const byFile = new Map<string, string[]>();
  const files = entries
    .filter((n) => n.toLowerCase().startsWith(PREFIX.toLowerCase()) && n.length === PREFIX.length + 3)
    .sort((x, y) => x.localeCompare(y, 'en', { sensitivity: 'base' }));
  for (const name of files) {
    byFile.set(name, controllerNames(decodeBuffer(await fs.promises.readFile(path.join(folder, name)))));
  }
  const errors = findDuplicates(byFile);
  const bad: string[] = [];
  for (const e of errors) {
    for (const n of [e.a, e.b]) if (!bad.includes(VOUCHER_INCLUDE_DIR + n)) bad.push(VOUCHER_INCLUDE_DIR + n);
  }
  return { errors, files: bad };
}
