// Màn Sửa menu: bảng / cột khóa / cột form của từng loại menu trong DB Sys (port MenuEditService.Spec của 5.2; danh sách cột form đã
// đối chiếu với các control Tag = "FC" trong frmWCommandUpdate / frmCommandUpdate / frmDVCommand .Designer.vb) + hàm quote SQL.
// Hàm thuần, không dùng vscode.

/** fbo = wcommand (FBO), fb = command (FB), mob = dvcommand (Mobile). Extension hiện chỉ mở fbo / mob; fb giữ cho đủ lệnh 5.2. */
export type EditKind = 'fbo' | 'fb' | 'mob';

export interface EditSpec {
  table: string;
  /** Cột mã (khóa) của dòng. */
  key: string;
  /** Cột mã cha. */
  parent: string;
  /** Các cột hiện trên form, đúng thứ tự 5.1. */
  fields: string[];
}

export function normalizeKind(kind: unknown): EditKind {
  const k = String(kind ?? '').toLowerCase();
  return k === 'fb' || k === 'mob' ? k : 'fbo';
}

export function specOf(kind: EditKind): EditSpec {
  switch (kind) {
    case 'fb':
      return { table: 'command', key: 'menu_id', parent: 'menu_id0', fields: ['menu_id', 'menu_id0', 'bar', 'bar2', 'exe', 'type', 'sysid', 'syscode', 'expl_icon', 'hide_yn', 'icon', 'vc_active'] };
    case 'mob':
      return { table: 'dvcommand', key: 'wmenu_id', parent: 'wmenu_id0', fields: ['wmenu_id', 'wmenu_id0', 'bar', 'bar2', 'menu_id', 'action', 'xtype', 'xgroup', 'sysid', 'status', 'icon_color', 'icon_url'] };
    default:
      return { table: 'wcommand', key: 'wmenu_id', parent: 'wmenu_id0', fields: ['wmenu_id', 'wmenu_id0', 'bar', 'bar2', 'link', 'type', 'sysid', 'syscode', 'menu_id', 'edition', 'expl_icon', 'icon', 'icon_url'] };
  }
}

/** Cột chứa đường dẫn của menu: fb = exe, mob = action, fbo = link. */
export function pathColumn(kind: EditKind): string {
  return kind === 'fb' ? 'exe' : kind === 'mob' ? 'action' : 'link';
}

/** Nhân đôi nháy đơn để nhúng vào hằng chuỗi T-SQL (5.1 không làm bước này — thêm có chủ ý, tên chứa ' không làm hỏng câu). */
export function esc(s: unknown): string {
  return String(s ?? '').replace(/'/g, "''");
}

/** Chuỗi Unicode T-SQL: N'...' (nháy đơn nhân đôi). Dùng cho phần do extension thêm; câu chép từ 5.1 tự ghép nháy như VB (xem sql51.ts). */
export function lit(s: unknown): string {
  return "N'" + esc(s) + "'";
}

/** Tên cột / bảng chỉ gồm chữ, số, gạch dưới (cột lấy từ metadata nhưng vẫn chặn ký tự lạ trước khi ghép SQL). */
export function ident(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Tên cột không hợp lệ: ${name}`);
  return '[' + name + ']';
}

/** Ghi trên chuỗi: trim, null → ''. */
export function txt(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim();
}
