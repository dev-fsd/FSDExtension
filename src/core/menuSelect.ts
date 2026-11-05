// Luật chọn menu đang chọn khi đổi tab file (BA 6.3). Hàm thuần: không dùng vscode để test được bằng node:test.
import type { MenuRef } from './types';

const same = (a: MenuRef | undefined, b: MenuRef): boolean => !!a && a.kind === b.kind && a.menuId === b.menuId;

/**
 * Menu đang chọn sau khi đổi sang một file.
 * - roots: các menu nhận file này làm file gốc (Dir / Grid / Filter / Report trùng sysid). File dùng chung → rỗng.
 * - menus: mọi menu dùng file này; menu đang chọn nằm trong đó thì giữ nguyên.
 * - Có menu đang chọn: chỉ đổi khi file là file gốc của menu khác (selected không nằm trong roots); file dùng chung giữ nguyên.
 * - Chưa chọn: lấy menu đầu trong roots; không có thì không chọn (undefined).
 */
export function pickMenuForFile(roots: readonly MenuRef[], selected: MenuRef | undefined, menus: readonly MenuRef[] = []): MenuRef | undefined {
  // File thuộc menu đang chọn (kể cả file con, vd Grid con là file gốc của menu khác) → giữ nguyên.
  if (selected && menus.some((m) => same(selected, m))) return selected;
  if (roots.length === 0) return selected;
  if (selected && roots.some((r) => same(selected, r))) return selected;
  return roots[0];
}
