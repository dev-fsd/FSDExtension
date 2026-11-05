// Các câu SQL của Sửa menu, dựng THEO ĐÚNG cấu trúc câu trong VB 5.1 (mỗi hàm ghi file:dòng nguồn).
// 5.1 không lấy câu nào của Sửa menu từ system.db (bảng script) — đều là chuỗi dựng trong VB hoặc do SqlS.GenSQLInsert / GenSQLUpdate sinh —
// nên đây là nơi duy nhất giữ "chuỗi mẫu" của chúng. Test\menuedit\vbSource.test.ts mở lại các file VB, kiểm đoạn mã nguồn
// được trích ở VB_REFS còn nằm đúng dòng đó, và so từng câu sinh ra với chuỗi mẫu rút từ VB.
//
// Khác 5.1 DUY NHẤT: giá trị chuỗi được nhân đôi nháy đơn (esc) — 5.1 nối thẳng nên tên có dấu ' làm hỏng câu / chèn lệnh.
// Mọi phần guard / transaction / verify do extension thêm KHÔNG nằm ở đây mà ở extWrap.ts.
import { sqlLiteral } from '../sql/tableOps';
import type { ColumnInfo } from '../sql/sqlTypes';
import { esc } from './spec';

/** Nơi từng câu được chép: file (so với FSDStudioSrc\) + dòng + đoạn mã VB phải xuất hiện ở dòng đó (test kiểm). */
export interface VbRef {
  fn: string;
  file: string;
  line: number;
  vb: string;
}

const WCMD = 'UI/Dialogs/frmWCommandUpdate.vb';
const CMD = 'UI/Dialogs/frmCommandUpdate.vb';
const DV = 'UI/Dialogs/frmDVCommand.vb';
const DUP = 'UI/Dialogs/frmDuplicateUpdate.vb';
const MAIN = 'Application/frmMain.vb';
const SQLS = '../Library/clsLibrary/GroupLibraries/SqlS.vb';

export const VB_REFS: VbRef[] = [
  { fn: 'sqlCountById(wcommand)', file: WCMD, line: 842, vb: `"SELECT COUNT(1) FROM wcommand WHERE wmenu_id = '" + txtWmenu_id.Text + "'"` },
  { fn: 'sqlCountById(command)', file: CMD, line: 140, vb: `"SELECT COUNT(1) FROM command WHERE menu_id = '" + txtMenu_id.Text + "'"` },
  { fn: 'sqlCountById(dvcommand)', file: DV, line: 792, vb: `"SELECT COUNT(1) FROM dvcommand WHERE wmenu_id = '" + txtWmenu_id.Text + "'"` },
  { fn: 'sqlCountById(command, mã cũ)', file: WCMD, line: 897, vb: `"SELECT COUNT(1) FROM command WHERE menu_id = '" + safeOldMenu + "'"` },
  { fn: 'sqlCountById(dvcommand, mã cũ)', file: WCMD, line: 1141, vb: `"SELECT COUNT(1) FROM dvcommand WHERE wmenu_id = '" + safeOld + "'"` },
  { fn: 'sqlCountById(wcommand, cảnh báo Mobile)', file: DV, line: 1191, vb: `"SELECT COUNT(1) FROM wcommand WHERE wmenu_id = '" + safeOld + "'"` },
  { fn: 'sqlSelectRowById(wcommand)', file: MAIN, line: 6865, vb: `"SELECT * FROM wcommand WHERE wmenu_id = '" + trvWCommand.SelectedNode.Tag("wmenu_id") + "'"` },
  { fn: 'sqlSelectRowById(command)', file: MAIN, line: 4078, vb: `"SELECT * FROM command WHERE menu_id = '" + trvCommand.SelectedNode.Tag("menu_id") + "'"` },
  { fn: 'sqlSelectRowById(dvcommand)', file: MAIN, line: 6887, vb: `"SELECT * FROM dvcommand WHERE wmenu_id = '" + trvMobCommand.SelectedNode.Tag("wmenu_id") + "'"` },
  { fn: 'sqlSchema', file: WCMD, line: 1191, vb: `"SELECT * FROM command WHERE 1 = 0"` },
  { fn: 'sqlMaxMenuId(command)', file: WCMD, line: 1235, vb: `"SELECT MAX(menu_id) FROM command WHERE menu_id LIKE '" + prefix + "%'"` },
  { fn: 'sqlMaxMenuId(dvcommand)', file: DV, line: 750, vb: `"SELECT MAX(menu_id) FROM dvcommand WHERE menu_id LIKE '" + prefix + "%'"` },
  { fn: 'sqlCountCommand88', file: WCMD, line: 931, vb: `"SELECT COUNT(1) FROM command WHERE menu_id LIKE '88%'"` },
  { fn: 'sqlRenameCommand', file: WCMD, line: 910, vb: `"UPDATE command SET menu_id = N'" + safeNewMenu + "' WHERE menu_id = '" + safeOldMenu + "'"` },
  { fn: 'sqlRenameWcommand', file: WCMD, line: 911, vb: `"UPDATE wcommand SET menu_id = N'" + safeNewMenu + "' WHERE wmenu_id = '" + txtWmenu_id.Text.Trim().Replace("'", "''") + "'"` },
  { fn: 'sqlSyncDvcommand', file: WCMD, line: 1146, vb: `"UPDATE dvcommand SET menu_id = N'" + newMenuId.Replace("'", "''") + "' WHERE wmenu_id = '" + safeOld + "'"` },
  { fn: 'sqlSetCommandExe (exe = N…)', file: WCMD, line: 1194, vb: `"exe = N'" + linkVal.Replace("'", "''") + "'"` },
  { fn: 'sqlSetCommandExe (UPDATE command SET …)', file: WCMD, line: 1200, vb: `"UPDATE command SET " + String.Join(", ", extraSets.ToArray()) + " WHERE menu_id = '" + safeLookup + "'"` },
  { fn: 'genSqlInsert', file: SQLS, line: 444, vb: `"INSERT INTO " + cTable + "(" + cFields.Substring(2) + ") VALUES(" + cValues.Substring(2) + ")"` },
  { fn: 'genSqlUpdate', file: SQLS, line: 558, vb: `"UPDATE " + cTable + " SET " + cUpdates.Substring(2) + " WHERE " + cKey` },
  { fn: 'genSqlUpdate/Insert (ghép từng cột)', file: SQLS, line: 555, vb: `cUpdates += ", " + cF + " = " + SqlS.ConvertTextSQL(oRow(cF))` },
  { fn: 'sqlDupSelect (SELECT)', file: DUP, line: 59, vb: `"SELECT CAST(0 AS BIT) AS tag, " + w + "menu_id, " + w + "menu_id0, bar AS phan_he, bar, bar2, " + exe` },
  { fn: 'sqlDupSelect (INTO)', file: DUP, line: 60, vb: `" INTO #tmp"` },
  { fn: 'sqlDupSelect (FROM)', file: DUP, line: 61, vb: `" FROM " + menuTable` },
  { fn: 'sqlDupSelect (WHERE)', file: DUP, line: 62, vb: `" WHERE (" + exe + " <> '' AND " + exe + " LIKE '"` },
  { fn: 'sqlDupSelect (sysID)', file: DUP, line: 68, vb: `"') OR (sysID = '" + currNode.Tag("sysid").ToString.Trim + "')"` },
  { fn: 'sqlDupSelect (UPDATE phan_he)', file: DUP, line: 69, vb: `" UPDATE #tmp SET phan_he = ISNULL(b.bar,'') FROM #tmp a LEFT JOIN " + menuTable + " b ON LEFT(a." + w + "menu_id0,2)+'.00.00' = b." + w + "menu_id"` },
  { fn: 'sqlDupSelect (SELECT *)', file: DUP, line: 70, vb: `" SELECT * FROM #tmp"` },
  { fn: 'sqlDupUpdate', file: DUP, line: 104, vb: `"UPDATE " + menuTable + " SET bar = N'" + row("bar").ToString.Trim + "', bar2 = N'" + row("bar2").ToString.Trim + "', " + exe + " = '" + row(exe).ToString.Trim + "' WHERE " + w + "menu_id = '" + row(w + "menu_id").ToString.Trim + "'"` }
];

// ----- Đọc -----

/** SELECT COUNT(1) FROM <bảng> WHERE <cột khóa> = '<mã>' (kiểm cha / mã trùng / command đã có…). */
export function sqlCountById(table: string, keyCol: string, id: string): string {
  return `SELECT COUNT(1) FROM ${table} WHERE ${keyCol} = '${esc(id)}'`;
}

/** SELECT * theo mã (SqlS.GetRow nạp Me.Row). */
export function sqlSelectRowById(table: string, keyCol: string, id: string): string {
  return `SELECT * FROM ${table} WHERE ${keyCol} = '${esc(id)}'`;
}

/** Cấu trúc bảng không lấy dòng (GenSQLInsert / GenSQLUpdate và PushWCommandRowToCommand đọc cột bảng đích). */
export function sqlSchema(table: string): string {
  return `SELECT * FROM ${table} WHERE 1 = 0`;
}

/** MAX(menu_id) theo tiền tố (AllocateNext…MenuId); prefix như "88.01." / "M1.01.". */
export function sqlMaxMenuId(table: string, prefix: string): string {
  return `SELECT MAX(menu_id) FROM ${table} WHERE menu_id LIKE '${esc(prefix)}%'`;
}

/** Đã có dòng command 88% chưa (quyết định có chạy AUTO_MAIN_SCRIPT). */
export function sqlCountCommand88(): string {
  return "SELECT COUNT(1) FROM command WHERE menu_id LIKE '88%'";
}

// ----- Ghi: đổi tên / đồng bộ command, dvcommand -----

/** Xóa trắng menu_id lúc Sửa: đổi tên dòng command cũ (frmWCommandUpdate.vb:910). */
export function sqlRenameCommand(newMenuId: string, oldMenuId: string): string {
  return `UPDATE command SET menu_id = N'${esc(newMenuId)}' WHERE menu_id = '${esc(oldMenuId)}'`;
}

/** …rồi gán lại cho wcommand (frmWCommandUpdate.vb:911). */
export function sqlRenameWcommand(newMenuId: string, wmenuId: string): string {
  return `UPDATE wcommand SET menu_id = N'${esc(newMenuId)}' WHERE wmenu_id = '${esc(wmenuId)}'`;
}

/** Sửa FBO → dvcommand chỉ đồng bộ cột menu_id theo wmenu_id cũ (frmWCommandUpdate.vb:1146). */
export function sqlSyncDvcommand(menuId: string, oldWmenuId: string): string {
  return `UPDATE dvcommand SET menu_id = N'${esc(menuId)}' WHERE wmenu_id = '${esc(oldWmenuId)}'`;
}

/** Sau khi đẩy cột trùng: exe của command = link của wcommand (frmWCommandUpdate.vb:1194 + 1200). */
export function sqlSetCommandExe(link: string, lookupMenuId: string): string {
  const extraSets = [`exe = N'${esc(link)}'`];
  return `UPDATE command SET ${extraSets.join(', ')} WHERE menu_id = '${esc(lookupMenuId)}'`;
}

// ----- SqlS.GenSQLInsert / GenSQLUpdate (clsLibrary\GroupLibraries\SqlS.vb) -----

/** Bỏ cột nhị phân như GenSQLUpdate (dòng 554); GenSQLInsert(DataRow) không bỏ nhưng ConvertTextSQL cho NULL — sqlLiteral cũng NULL. */
export const isBinary = (c: ColumnInfo): boolean => c.clr === 'System.Byte[]';

/** INSERT INTO t(c1, c2) VALUES(v1, v2) — tên cột trần theo thứ tự cột của dòng (SqlS.vb:434–446). */
export function genSqlInsert(table: string, cols: ColumnInfo[], values: unknown[]): string {
  const fields = cols.map((c) => c.name);
  const vals = cols.map((c, i) => sqlLiteral(values[i], c));
  return `INSERT INTO ${table}(${fields.join(', ')}) VALUES(${vals.join(', ')})`;
}

/** UPDATE t SET c1 = v1, c2 = v2 WHERE <key> — bỏ cột nhị phân (SqlS.vb:548–560). key là mệnh đề WHERE đã dựng sẵn. */
export function genSqlUpdate(table: string, cols: ColumnInfo[], values: unknown[], key: string): string {
  const sets: string[] = [];
  cols.forEach((c, i) => {
    if (!isBinary(c)) sets.push(`${c.name} = ${sqlLiteral(values[i], c)}`);
  });
  return `UPDATE ${table} SET ${sets.join(', ')} WHERE ${key}`;
}

// ----- Menu trùng đường dẫn / sysid (frmDuplicateUpdate.vb) -----

/**
 * Câu tìm menu trùng (getData, dòng 59–70) — một batch, nối bằng khoảng trắng đúng như VB.
 * pathVal = giá trị cột đường dẫn (exe / link / action) của menu vừa sửa, đã trim; bỏ "zc" đầu nếu có (dòng 63–67).
 * w = "" (FB) hoặc "w" (FBO / Mobile).
 */
export function sqlDupSelect(menuTable: string, exeCol: string, w: string, pathVal: string, sysId: string): string {
  const pattern = pathVal.startsWith('zc') && pathVal.length > 2 ? pathVal.substring(2) : pathVal;
  let s = 'SELECT CAST(0 AS BIT) AS tag, ' + w + 'menu_id, ' + w + 'menu_id0, bar AS phan_he, bar, bar2, ' + exeCol;
  s += ' INTO #tmp';
  s += ' FROM ' + menuTable;
  s += ' WHERE (' + exeCol + " <> '' AND " + exeCol + " LIKE '";
  s += esc(pattern);
  s += "') OR (sysID = '" + esc(sysId) + "')";
  s += " UPDATE #tmp SET phan_he = ISNULL(b.bar,'') FROM #tmp a LEFT JOIN " + menuTable + ' b ON LEFT(a.' + w + "menu_id0,2)+'.00.00' = b." + w + 'menu_id';
  s += ' SELECT * FROM #tmp';
  return s;
}

/** Cập nhật một menu trùng đã tick (updateData, dòng 104). Các giá trị đã trim. */
export function sqlDupUpdate(menuTable: string, exeCol: string, w: string, bar: string, bar2: string, path: string, id: string): string {
  return `UPDATE ${menuTable} SET bar = N'${esc(bar)}', bar2 = N'${esc(bar2)}', ${exeCol} = '${esc(path)}' WHERE ${w}menu_id = '${esc(id)}'`;
}
