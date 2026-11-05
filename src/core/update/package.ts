// Một gói update đang soạn (port phần trạng thái của UpdatePackage.vb 5.2): dòng gen + Other SQL App / Sys.
// Thuần: không SQL, không đọc đĩa trừ chỗ truyền vào (fileExists). Mỗi dòng giữ đủ cột của .upd để Load → Save không mất gì.
import * as path from 'node:path';
import { type UpdCategory, type UpdFileType } from './catalog';
import { normalizeDir, type PackagePaths } from './packagePaths';
import { type UpdContent, type UpdRow } from './updFile';

const NL = '\r\n';

/** Giá trị cột, DBNull → ''. */
export const txt = (r: UpdRow, col: keyof UpdRow): string => r[col] ?? '';

const isFileType = (t: string): boolean => t === 'E' || t === 'P' || t === 'X';

/** Dòng code cuối (bỏ dòng trống và comment --) là GO. */
export function endsWithGo(script: string): boolean {
  const lines = (script ?? '').replace(/\s+$/, '').split(/\r\n|\n|\r/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (l === '' || l.startsWith('--')) continue;
    if (l.length < 2 || !/^go/i.test(l)) return false;
    return l.length === 2 || /\s/.test(l[2]) || l[2] === '-';
  }
  return false;
}

/** Mô tả (Memo) trong tên .upd: {menu}_{user}_{yyyyMMdd}_{memo}.upd. */
export function memoOf(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '');
  const parts = base.split('_');
  if (parts.length < 3) return '';
  parts.splice(0, 3);
  if (parts.length === 0) return '';
  parts[parts.length - 1] = parts[parts.length - 1].replace('.upd', '');
  return parts.join('_');
}

export class UpdatePackage {
  rows: UpdRow[] = [];
  otherAppSql = '';
  otherSysSql = '';
  /** File .upd đang mở / vừa lưu ('' = chưa lưu). */
  filePath = '';

  clear(): void {
    this.rows = [];
    this.otherAppSql = '';
    this.otherSysSql = '';
    this.filePath = '';
  }

  isEmpty(): boolean {
    return this.rows.length === 0 && this.otherAppSql.trim() === '' && this.otherSysSql.trim() === '';
  }

  /** Số hiện trên badge: số dòng + 1 nếu có Other SQL. */
  count(): number {
    return this.rows.length + (this.otherAppSql.trim() !== '' || this.otherSysSql.trim() !== '' ? 1 : 0);
  }

  toContent(): UpdContent {
    return { rows: this.rows, appSql: this.otherAppSql, sysSql: this.otherSysSql };
  }

  // ===================== .upd =====================

  /** .upd cũ lưu folder tương đối → tuyệt đối (dòng E / P / X). */
  private normalizeFolders(rows: UpdRow[], paths: PackagePaths, programPath: string): void {
    for (const row of rows) {
      if (!isFileType(txt(row, 'sType').trim())) continue;
      let source = txt(row, 'sUrl');
      if (source === '') source = txt(row, 'sUrlSaveTo');
      source = paths.absoluteFolder(source, programPath);
      if (source === '') continue;
      row.sUrl = source;
      row.sUrlSaveTo = source;
    }
  }

  /** Trùng: cùng sValue; dòng file thì thêm điều kiện cùng folder. */
  private isDuplicate(incoming: UpdRow): boolean {
    const value = txt(incoming, 'sValue').toLowerCase();
    const isFile = isFileType(txt(incoming, 'sType').trim());
    for (const cur of this.rows) {
      if (txt(cur, 'sValue').toLowerCase() !== value) continue;
      if (!isFile) return true;
      if (txt(cur, 'sUrl').replace(/\//g, '\\').toLowerCase() === txt(incoming, 'sUrl').replace(/\//g, '\\').toLowerCase()) return true;
    }
    return false;
  }

  /** Nạp nội dung .upd (merge = cộng dồn, bỏ dòng trùng). Trả số dòng bị bỏ vì trùng. */
  load(content: UpdContent, filePath: string, paths: PackagePaths, programPath: string, merge: boolean): number {
    const src = content.rows.map((r) => ({ ...r }));
    this.normalizeFolders(src, paths, programPath);
    if (!merge) this.clear();
    let skipped = 0;
    for (const r of src) {
      if (merge && this.isDuplicate(r)) skipped++;
      else this.rows.push(r);
    }
    const app = content.appSql;
    const sys = content.sysSql;
    if (merge) {
      if (app !== '' && !this.otherAppSql.includes(app)) this.otherAppSql += app;
      if (sys !== '' && !this.otherSysSql.includes(sys)) this.otherSysSql += sys;
    } else {
      this.otherAppSql = app;
      this.otherSysSql = sys;
    }
    if (!merge) this.filePath = filePath;
    return skipped;
  }

  // ===================== Thêm dòng =====================

  /** Đã có dòng cùng mã (phần trước dấu phẩy của sValue) và cùng nhóm loại. */
  categoryDuplicate(cat: UpdCategory, code: string): boolean {
    const c = code.trim().toLowerCase();
    return this.rows.some((r) => txt(r, 'sValue').split(',')[0].toLowerCase() === c && txt(r, 'sType').toLowerCase().startsWith(cat.sType.trim().toLowerCase()));
  }

  /**
   * Loại + mã (cmdAddSysId 5.1). v2 = mã thứ 2 của chứng từ (sGetSysID2) — chỉ dùng khi loại V.
   * Trả câu lỗi hoặc ''.
   */
  addCategory(cat: UpdCategory, code: string, isAlter: boolean, quotedOff: boolean, name: string | undefined, xtype: string | undefined, v2 = ''): string {
    code = code.trim();
    if (code === '') return 'Chưa nhập mã.';
    if (this.categoryDuplicate(cat, code)) return `Đã có ${code} trong gói.`;
    let sType = cat.sType.trim();
    let view = cat.sView.split('%code').join(code);
    if (sType === 'S') {
      sType += (isAlter ? '1' : '0') + (quotedOff ? '1' : '0');
      view = view.split('%kind').join((isAlter ? 'ALTER' : 'CREATE') + (quotedOff ? ', QUOTED OFF' : ''));
    }
    const row: UpdRow = {
      sView: view,
      sDB: cat.sDatabase,
      sType,
      sValue: sType === 'V' ? `${code},${v2.trim()}` : code,
      sysSqlCode: cat.sysSqlCode,
      appSqlCode: cat.appSqlCode,
      name: name ?? code,
      type: xtype ?? ''
    };
    this.rows.push(row);
    return '';
  }

  private hasData(table: string, sKey: string, isSys: boolean): boolean {
    const sDB = isSys ? 'Sys' : 'App';
    return this.rows.some(
      (r) => txt(r, 'sType').trim() === 'O' && txt(r, 'sTbl').toLowerCase() === table.toLowerCase() && txt(r, 'sKey').toLowerCase() === sKey.toLowerCase() && txt(r, 'sDB').toLowerCase() === sDB.toLowerCase()
    );
  }

  /** Điều kiện chuẩn hóa: rỗng → 1=1. */
  static dataKey(key: string | undefined): string {
    return (key ?? '').trim() === '' ? '1=1' : key!.trim();
  }

  /** Dòng đã có (bảng, điều kiện, DB)? */
  dataDuplicate(table: string, key: string | undefined, isSys: boolean): boolean {
    return this.hasData(table, UpdatePackage.dataKey(key), isSys);
  }

  /** Dòng O (dữ liệu bảng) không thử chạy điều kiện. Trùng → false. sView = GETSCRIPTGEN đã thay. */
  addDataRow(table: string, key: string | undefined, isSys: boolean, scriptGen: string): boolean {
    const sKey = UpdatePackage.dataKey(key);
    if (this.hasData(table, sKey, isSys)) return false;
    this.rows.push({ sView: scriptGen.split('%tbl').join(table).split('%key').join(sKey).trim(), sType: 'O', sDB: isSys ? 'Sys' : 'App', sTbl: table, sKey });
    return true;
  }

  hasFile(folder: string, name: string): boolean {
    const f = normalizeDir((folder ?? '').replace(/\//g, '\\')).toLowerCase();
    return this.rows.some((r) => txt(r, 'sUrl').toLowerCase() === f && txt(r, 'sValue').toLowerCase() === (name ?? '').toLowerCase());
  }

  hasValue(value: string): boolean {
    return this.rows.some((r) => txt(r, 'sValue') === value);
  }

  /** File chọn từ đĩa (dòng E / P / X). Trả câu lỗi hoặc ''. */
  addFile(fullPath: string, fileTypes: readonly UpdFileType[], paths: PackagePaths, fileExists: (p: string) => boolean): string {
    if (!fileExists(fullPath)) return `Không có file ${fullPath}`;
    const folder = normalizeDir(path.win32.dirname(fullPath));
    const name = path.win32.basename(fullPath);
    if (this.rows.some((r) => txt(r, 'sValue').toLowerCase() === name.toLowerCase() && txt(r, 'sUrl').toLowerCase() === folder.toLowerCase())) return 'Đã có trong gói.';
    const save = paths.savePath(fullPath);
    let relFolder = path.win32.dirname(save);
    if (relFolder === '.') relFolder = '';
    const i = relFolder.indexOf('\\');
    relFolder = i >= 0 ? normalizeDir(relFolder.substring(i + 1)) : '';
    const ext = path.win32.extname(name).toLowerCase();
    let pick: UpdFileType | undefined;
    for (const t of fileTypes) {
      if (t.sUrl.replace(/\//g, '\\').toLowerCase() !== relFolder.toLowerCase()) continue;
      if (!pick) pick = t;
      if (t.sExt.toLowerCase() === '*' + ext) { pick = t; break; }
    }
    this.rows.push({
      sView: pick ? pick.sView.split('%code').join(name) : `File: ${name}`,
      sDB: '',
      sType: pick ? pick.sType : ext === '.exe' || ext === '.dll' ? 'E' : 'X',
      sValue: name,
      sUrl: folder,
      sUrlSaveTo: folder
    });
    return '';
  }

  /** SQL Explorer: store / function / trigger / view → S00, bảng → T; đối tượng DB Sys thêm " [Sys]". Trả true khi thêm. */
  addExplorerObject(name: string, xtype: string, isSys: boolean): boolean {
    name = (name ?? '').trim();
    if (name === '' || this.hasValue(name)) return false;
    let sType = 'S00';
    let kind: string;
    let view: string;
    switch ((xtype ?? '').trim().toUpperCase()) {
      case 'P': kind = 'Store'; view = `Store: ${name} (CREATE)`; break;
      case 'U': kind = 'Table'; sType = 'T'; view = `Table: ${name}`; break;
      case 'FN': case 'TF': case 'IF': kind = 'Function'; view = `Function: ${name} (CREATE)`; break;
      case 'TR': kind = 'Trigger'; view = `Trigger: ${name} (CREATE)`; break;
      case 'V': kind = 'View'; view = `View: ${name} (CREATE)`; break;
      default: return false;
    }
    this.rows.push({ sView: view + (isSys ? ' [Sys]' : ''), sDB: isSys ? 'Sys' : 'App', sType, sysSqlCode: '', appSqlCode: '', name, type: kind, sValue: name });
    return true;
  }

  /** SQL Content Declare: dòng O "App Table: tb where điều kiện". */
  addDeclare(db: string, table: string, where: string): void {
    this.rows.push({ sView: `${db} Table: ${table} where ${where}`, sDB: db, sType: 'O', sysSqlCode: '', appSqlCode: '', sTbl: table, sKey: where, sValue: table });
  }

  /** Dòng file với folder tuyệt đối. fileType = dòng updatefile hoặc undefined = File Explorer (X, "File: …"). */
  addFileRow(fileType: UpdFileType | undefined, folder: string, name: string): string {
    folder = normalizeDir((folder ?? '').replace(/\//g, '\\'));
    name = (name ?? '').trim();
    if (name === '') return 'Chưa nhập tên file.';
    const row: UpdRow = fileType
      ? { sView: fileType.sView.split('%code').join(name), sDB: '', sType: fileType.sType, sValue: name, sUrlSaveTo: folder, sUrl: folder }
      : { sView: `File: ${folder}${name}`, sDB: '', sType: 'X', sValue: name, sUrlSaveTo: folder, sUrl: folder };
    this.rows.push(row);
    return '';
  }

  /** Other SQL đã có mà chưa kết thúc bằng GO → chèn GO rồi nối script. */
  appendOtherSql(isSys: boolean, sql: string): void {
    if (!sql) return;
    let cur = isSys ? this.otherSysSql : this.otherAppSql;
    if (cur.trim() !== '' && !endsWithGo(cur)) cur += NL + 'GO' + NL;
    cur += sql;
    if (isSys) this.otherSysSql = cur;
    else this.otherAppSql = cur;
  }

  /** Xóa các dòng theo vị trí (index ngoài khoảng bị bỏ qua). */
  removeAt(indexes: number[]): void {
    for (const i of [...new Set(indexes)].sort((a, b) => b - a)) {
      if (Number.isInteger(i) && i >= 0 && i < this.rows.length) this.rows.splice(i, 1);
    }
  }
}

/** sys.objects.type → tên danh mục update (UpdateService.AddObject 5.2); undefined nếu chưa hỗ trợ. */
export function categoryNameOf(xtype: string, isSys: boolean): string | undefined {
  switch ((xtype ?? '').trim().toUpperCase()) {
    case 'P': return 'Store';
    case 'FN': case 'IF': case 'TF': return 'Function';
    case 'V': return 'View';
    case 'TR': return 'Trigger';
    case 'U': return isSys ? 'Table Sys' : 'Table App';
    default: return undefined;
  }
}
