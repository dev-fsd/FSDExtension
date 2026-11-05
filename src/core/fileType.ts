// Loại file hiển thị ở cuối dòng file (BA 6.2 #2). Hàm thuần.
// Không lấy thẳng path.extname: file Include như "Extender.Include.SVTran" có "đuôi" là sysid.
import * as path from 'node:path';
import type { MenuFile } from './types';

/** Danh sách đuôi có icon riêng; ngoài danh sách dùng icon chung. */
export const FILE_TYPES = ['xml', 'f', 'ent', 'txt', 'rpt', 'frx', 'rldc', 'xlsx'] as const;
export type FileType = (typeof FILE_TYPES)[number];

/**
 * Loại file của một dòng trong view: controller có .xml → 'xml', chỉ có .f → 'f' (một icon duy nhất, theo file sẽ mở);
 * file khác (mẫu in, Include…) theo đuôi thật nếu nằm trong danh sách cố định, không thì '' (icon chung).
 */
export function fileTypeOf(f: Pick<MenuFile, 'path' | 'hasF' | 'hasXml'>): FileType | '' {
  if (f.hasXml) return 'xml';
  if (f.hasF) return 'f';
  const ext = path.win32.extname(path.win32.basename(f.path)).slice(1).toLowerCase();
  return (FILE_TYPES as readonly string[]).includes(ext) ? (ext as FileType) : '';
}
