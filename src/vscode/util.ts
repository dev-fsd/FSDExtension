// Hàm dùng chung cho lớp VS Code.
import type { MenuFileRole, MenuRef } from '../core/types';

/** Khóa file: chuẩn hóa đường dẫn, chữ thường, bỏ đuôi .f / .xml (mở .f hay .xml đều cùng khóa). */
export function fileKey(p: string): string {
  return p.replace(/\//g, '\\').toLowerCase().replace(/\.(f|xml)$/, '');
}

export function sameRef(a: MenuRef | undefined, b: MenuRef | undefined): boolean {
  return !!a && !!b && a.kind === b.kind && a.menuId === b.menuId;
}

/** Khóa lưu một menu: "fbo:07.10.06". */
export function refKey(ref: Pick<MenuRef, 'kind' | 'menuId'>): string {
  return `${ref.kind}:${ref.menuId}`;
}

/** Bỏ dấu tiếng Việt + chữ thường, để tìm "hoa don" ra "Hóa đơn". */
export function normText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

/** "2 giờ", "3 ngày"... */
export function relativeTime(ms: number | undefined, now = Date.now()): string {
  if (!ms) return '';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'vừa xong';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} phút`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} giờ`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} ngày`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo} tháng`;
  return `${Math.round(mo / 12)} năm`;
}

/** Nhãn nhóm theo loại menu: FBO ghi "Report", Mobile ghi "Dashboards". */
export function groupLabel(g: { key: string; label: string }, kind: string): string {
  return g.key === 'report' && kind === 'mob' ? 'Dashboards' : g.label;
}

export function shortName(name: string): string {
  const parts = name.split(/[\\/]/);
  return parts[parts.length - 1] || name;
}

/** Nhóm hiển thị theo thứ tự trong view: Dir → Filter → Grid → Report → Upload → còn lại (mở sẵn Dir, Filter, Grid). */
export const roleGroups: { key: string; label: string; roles: MenuFileRole[]; collapsed: boolean }[] = [
  { key: 'dir', label: 'Dir', roles: ['dir'], collapsed: false },
  { key: 'filter', label: 'Filter', roles: ['filter'], collapsed: false },
  { key: 'grid', label: 'Grid', roles: ['grid'], collapsed: false },
  { key: 'report', label: 'Report', roles: ['report', 'dashboard'], collapsed: true },
  { key: 'import', label: 'Upload', roles: ['import'], collapsed: true },
  { key: 'lookup', label: 'Lookup', roles: ['lookup'], collapsed: true },
  { key: 'template', label: 'Mẫu in', roles: ['template'], collapsed: true },
  { key: 'include', label: 'Include', roles: ['include'], collapsed: true }
];

