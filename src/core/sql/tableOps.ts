// Màn Select Table: cột của bảng, bảng chia kỳ, câu SELECT, script cột, script dữ liệu, bảng log, lưu lưới.
// Port từ TableService + ObjectScripter/SqlS (GenSQLInsert, ConvertTextSQL) của FSD Studio 5.2 / 5.1, giữ nguyên định dạng script.
import * as fs from 'fs';
import {
  addColumnSql,
  alterColumnSql,
  dropColumnSql,
  getLegacyLogTableName,
  getLogTableName,
  isLogOfSql,
  isLogTable,
  needReorder,
  reorderColumnsSql,
  statusSql,
  type LogTableStatus
} from './logTable';
import { replaceAll, type ScriptStore } from './scriptStore';
import { rowObjects, type SqlDb } from './sqlSession';
import { dayText, type ColumnInfo } from './sqlTypes';

const NL = '\r\n';

export interface TableColumn {
  name: string;
  type: string;
  pkey: boolean;
}

export interface TableInfo {
  columns: TableColumn[];
  /** Bảng gốc chia kỳ (m81$000000…) khai trong sysgendata. */
  partition: boolean;
  dfrom: string;
  dto: string;
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** {columns:[{name,type,pkey}], partition, dfrom, dto} — cột từ script GETFULLCOL, chia kỳ từ sysgendata + khoảng ngày dmstt. */
export async function tableInfo(db: SqlDb, scripts: ScriptStore, table: string): Promise<TableInfo> {
  table = (table ?? '').trim();
  const sets = await db.query(replaceAll(scripts.get('GETFULLCOL'), '%tbl', table.replace(/'/g, "''")));
  const columns = rowObjects(sets[0]).map((r) => ({ name: str(r.val).trim(), type: str(r.type).trim(), pkey: Boolean(r.pkey) }));
  let partition = false;
  let dfrom = '';
  let dto = '';
  // DB khác (Sys) không có sysgendata → coi như không chia kỳ.
  try {
    const c = await db.query('SELECT COUNT(1) FROM sysgendata WHERE basetable = @t', { t: table });
    partition = Number(c[0]?.rows[0]?.[0] ?? 0) > 0;
    if (partition) {
      const d = await db.query('SELECT ngay_gh1, ngay_gh2 FROM dmstt');
      const r = d[0]?.rows[0];
      if (r) {
        dfrom = dayText(r[0]);
        dto = dayText(r[1]);
      }
    }
  } catch {
    partition = false;
  }
  return { columns, partition, dfrom, dto };
}

/**
 * Câu SELECT như 5.1 getQuerry: where bắt đầu "\" = câu SQL tự viết (bảng chia kỳ: chạy qua QUERYPARTITION);
 * bảng chia kỳ: SELECTPARTITION theo khoảng ngày; thường: SELECT fields FROM table WHERE where.
 */
export function buildSelectSql(
  scripts: ScriptStore,
  a: { fields?: string; table?: string; where?: string; partition?: boolean; dfrom?: string; dto?: string }
): string {
  let fields = (a.fields ?? '').trim();
  const table = (a.table ?? '').trim();
  const where = (a.where ?? '').trim();
  const partition = a.partition === true;
  if (fields === '') fields = '*';
  const d1 = (a.dfrom ?? '').replace(/-/g, '');
  const d2 = (a.dto ?? '').replace(/-/g, '');
  if (where.startsWith('\\')) {
    let raw = where.slice(1).trim();
    if (!partition) return raw;
    raw = replaceAll(raw, '000000', '%Partition');
    let s = replaceAll(scripts.get('QUERYPARTITION'), '%strSQL', `N'${raw.replace(/'/g, "''")}'`);
    s = replaceAll(s, '%dfrom', d1);
    return replaceAll(s, '%dto', d2);
  }
  if (partition) {
    const key = (where === '' ? '1=1' : where).replace(/'/g, "''");
    let s = replaceAll(scripts.get('SELECTPARTITION'), '%field', fields);
    s = replaceAll(s, '%table', table);
    s = replaceAll(s, '%key', key);
    s = replaceAll(s, '%dfrom', d1);
    s = replaceAll(s, '%dto', d2);
    return replaceAll(s, '%rfirst', table.slice(0, table.indexOf('$') + 1));
  }
  return `SELECT ${fields}${table !== '' ? ' FROM ' + table : ''}${where !== '' ? ' WHERE ' + where : ''}`;
}

/** Giá trị thay NULL theo kiểu: chuỗi → emptyString, số / bit → 0, còn lại null. */
function emptyValue(type: string, emptyString: string): string {
  const t = type.toLowerCase();
  if (t.includes('char') || t.includes('text') || t.startsWith('uniqueidentifier')) return emptyString;
  if (/^(float|real|money|numeric|decimal|bit)/.test(t) || t.includes('int')) return '0';
  return 'null';
}

export type ColumnKind = 'add' | 'alter' | 'drop';

/**
 * kind add | alter | drop cho các cột [{name, type}] → script (không chạy) như 5.1 GenColumnAdd / Alter / Drop:
 * bảng chia kỳ dùng script "$" (mọi kỳ qua FastBusiness$Partition$Execute, GO giữa các cột); mỗi cột kèm lệnh cho
 * bảng log đang có trên DB (logTables); thêm cột bảng thường: GO + UPDATE giá trị rỗng / 0 cho dòng NULL.
 */
export function columnScript(
  scripts: ScriptStore,
  kind: string,
  table: string,
  partition: boolean,
  columns: Array<{ name: string; type: string }>,
  logTables: string[],
  dfrom: string,
  dto: string
): string {
  const k = kind.toUpperCase();
  table = table.trim();
  const tmpl = scripts.get(`SCRIPT${k}COLUMN${partition ? '$' : ''}`);
  const tbl = partition ? table.slice(0, table.indexOf('$') + 1) : table;
  const sb: string[] = [];
  const updates: string[] = [];
  const line = (s: string): void => {
    sb.push(s + NL);
  };
  for (const c of columns) {
    const name = c.name;
    const type = c.type.toUpperCase();
    let s = replaceAll(tmpl, '%tbl', tbl);
    s = replaceAll(s, '%col', name);
    s = replaceAll(s, '%datatype', type);
    s = replaceAll(s, '%dfrom', dfrom.replace(/-/g, ''));
    s = replaceAll(s, '%dto', dto.replace(/-/g, ''));
    if (partition) {
      if (k === 'ADD' && sb.length > 0) line('GO');
      s = replaceAll(s, '%valnull', emptyValue(type, "''''"));
    }
    line(s);
    for (const logTable of logTables) {
      if (k === 'ADD') line(addColumnSql(logTable, name, type));
      else if (k === 'ALTER') line(alterColumnSql(logTable, name, type));
      else line(dropColumnSql(logTable, name));
    }
    if (partition && k !== 'ADD') line('GO');
    if (k === 'ADD' && !partition) {
      const v = emptyValue(type, "''");
      if (v !== 'null') updates.push(`UPDATE ${table} SET ${name} = ${v} WHERE ${name} IS NULL${NL}`);
    }
  }
  if (k === 'ADD' && !partition) {
    line('GO');
    sb.push(updates.join(''));
  }
  return sb.join('').trimEnd();
}

/** Script cột cho phép NULL của bảng (không cần DB). */
export function alterNullScript(scripts: ScriptStore, table: string): string {
  return replaceAll(scripts.get('ALTERFIELDNULL'), '%tbl', table.trim());
}

// ===================== Bảng log =====================

/** Bảng gốc (lấy thứ tự cột) + tên các bảng log của bảng đang chọn; null = chưa chọn bảng / đang ở bảng log. */
export function logTargets(table: string, partition: boolean): { base: string; targets: string[] } | null {
  table = (table ?? '').trim();
  if (table === '' || isLogTable(table)) return null;
  let source = table;
  let base: string;
  if (partition && table.includes('$')) {
    source = table.slice(0, table.indexOf('$') + 1);
    base = source + '000000';
  } else {
    base = table;
  }
  const list: string[] = [];
  for (const logTable of [getLogTableName(source), getLegacyLogTableName(source)]) {
    if (logTable !== '' && logTable.toLowerCase() !== table.toLowerCase() && !list.includes(logTable)) list.push(logTable);
  }
  return list.length > 0 ? { base, targets: list } : null;
}

/** Bảng log có trên DB và đúng là log của bảng gốc. */
export async function existingLogTables(db: SqlDb, table: string, partition: boolean): Promise<string[]> {
  const t = logTargets(table, partition);
  if (!t) return [];
  const out: string[] = [];
  for (const logTable of t.targets) {
    const sets = await db.query(isLogOfSql(t.base, logTable));
    if (Number(sets[0]?.rows[0]?.[0] ?? 0) === 1) out.push(logTable);
  }
  return out;
}

/** Cột của bảng log: tình trạng so với bảng gốc (chỉ đọc). */
export async function logStatus(db: SqlDb, base: string, logTable: string): Promise<LogTableStatus> {
  const sets = await db.query(statusSql(base, logTable));
  const r = rowObjects(sets[0])[0];
  if (!r) return { exists: false, missingCount: 0, misorderedCount: 0 };
  return { exists: Number(r.co_log) === 1, missingCount: Number(r.thieu), misorderedCount: Number(r.lech) };
}

export interface LogInfo {
  ok: boolean;
  base?: string;
  targets?: string[];
  existing?: string[];
  need?: string[];
  message?: string;
}

/** {ok, base, targets, existing, need:[bảng lệch], message} — chỉ đọc. */
export async function logInfo(db: SqlDb, table: string, partition: boolean): Promise<LogInfo> {
  const t = logTargets(table, partition);
  if (!t) return { ok: false };
  const need: string[] = [];
  let message = '';
  const existing = await existingLogTables(db, table, partition);
  for (const logTable of t.targets) {
    let status: LogTableStatus;
    try {
      status = await logStatus(db, t.base, logTable);
    } catch {
      continue;
    }
    if (!needReorder(status)) continue;
    need.push(logTable);
    if (message.length > 0) message += NL;
    message += `Bảng log [${logTable}] so với [${t.base}]:`;
    if (status.misorderedCount > 0) message += NL + `- ${status.misorderedCount} cột đứng sai thứ tự`;
    if (status.missingCount > 0) message += NL + `- thiếu ${status.missingCount} cột`;
  }
  return { ok: true, base: t.base, targets: t.targets, existing, need, message };
}

/**
 * Script sắp xếp lại cột bảng log: bảng log có trên DB; không có bảng nào thì vẫn sinh cho $log.
 * only = chỉ các bảng này; direct = kết thúc bằng SELECT thông báo (chạy tay).
 */
export async function logReorderScript(db: SqlDb, a: { table: string; partition: boolean; only?: string[]; direct?: boolean }): Promise<string> {
  const t = logTargets(a.table, a.partition);
  if (!t) return '';
  let list: string[];
  if (a.only) {
    list = a.only;
  } else {
    list = await existingLogTables(db, a.table, a.partition);
    if (list.length === 0) list.push(t.targets[0]);
  }
  let sb = '';
  for (const logTable of list) sb += reorderColumnsSql(t.base, logTable, a.direct === true) + NL + 'GO' + NL;
  return sb;
}

// ===================== Script dữ liệu (SqlS.GenSQLInsert / ConvertTextSQL) =====================

/** Ngày giờ kiểu SqlS: 'yyyyMMdd HH:mm:ss' (không mili giây); ngày nhỏ nhất của .NET (0001) → NULL. */
function dateLiteral(v: Date): string {
  if (Number.isNaN(v.getTime()) || v.getUTCFullYear() <= 1) return 'NULL';
  const p = (n: number): string => String(n).padStart(2, '0');
  return `'${v.getUTCFullYear()}${p(v.getUTCMonth() + 1)}${p(v.getUTCDate())} ${p(v.getUTCHours())}:${p(v.getUTCMinutes())}:${p(v.getUTCSeconds())}'`;
}

/**
 * Giá trị đọc từ DB → hằng SQL như SqlS.ConvertTextSQL: chuỗi N'…' (cắt khoảng trắng cuối), số giữ chữ số thập phân,
 * bit 1/0, ngày 'yyyyMMdd HH:mm:ss', NULL → NULL. Khác 5.2 có chủ ý: uniqueidentifier / time / datetimeoffset được ghi
 * (5.2 ghi NULL cho các kiểu này).
 */
export function sqlLiteral(v: unknown, col: ColumnInfo): string {
  if (v === null || v === undefined) return 'NULL';
  switch (col.clr) {
    case 'System.String':
      // VB RTrim (SqlS.ConvertTextSQL, isRtrimGen mặc định True) chỉ cắt dấu cách U+0020 / U+3000, không cắt tab / xuống dòng.
      return `N'${String(v).replace(/[ 　]+$/, '').replace(/'/g, "''")}'`;
    case 'System.Boolean':
      return v ? '1' : '0';
    case 'System.Decimal':
      return typeof v === 'number' ? v.toFixed(col.scale ?? 0) : String(v);
    case 'System.Byte':
    case 'System.Int16':
    case 'System.Int32':
    case 'System.Int64':
    case 'System.Double':
    case 'System.Single':
      return String(v);
    case 'System.DateTime':
      return v instanceof Date ? dateLiteral(v) : 'NULL';
    case 'System.DateTimeOffset':
      return v instanceof Date ? dateLiteral(v).replace(/'$/, " +00:00'") : 'NULL';
    case 'System.TimeSpan':
      return v instanceof Date ? `'${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}:${String(v.getUTCSeconds()).padStart(2, '0')}'` : 'NULL';
    case 'System.Guid':
      return `'${String(v)}'`;
    default:
      return 'NULL';
  }
}

const keyOrAll = (where: string | undefined): string => (where === undefined || where.trim() === '' ? '1=1' : where);

/** Các câu INSERT của bảng theo điều kiện; bracket = [cột] (bản chuỗi) hay cột trần (bản ghi file). Bỏ cột nhị phân. */
function insertLine(table: string, cols: ColumnInfo[], values: unknown[], bracket: boolean): string | null {
  const fields: string[] = [];
  const vals: string[] = [];
  cols.forEach((c, i) => {
    if (c.clr === 'System.Byte[]') return;
    fields.push(bracket ? `[${c.name}]` : c.name);
    vals.push(sqlLiteral(values[i], c));
  });
  if (fields.length === 0) return null;
  return `INSERT INTO ${table}(${fields.join(', ')}) VALUES(${vals.join(', ')})`;
}

/** Script DELETE + INSERT dữ liệu bảng theo điều kiện (table.dataScript). */
export async function dataScript(db: SqlDb, table: string, where: string | undefined): Promise<string> {
  const key = keyOrAll(where);
  const sets = await db.query(`SELECT * FROM ${table} WHERE ${key}`);
  const set = sets[0];
  let inserts = '';
  for (const row of set?.rows ?? []) {
    const l = insertLine(table, set.columns, row, true);
    if (l) inserts += l + NL;
  }
  return `DELETE FROM ${table} WHERE ${key}` + NL + inserts;
}

/** Nơi nhận dòng khi ghi script ra file (tách để test). */
export interface TextSink {
  write(text: string): void;
}

/** Gen Script By Condition To File: DELETE rồi từng INSERT (cột trần) ghi dần, không dựng cả script trong bộ nhớ. */
export async function dataScriptToSink(
  db: SqlDb & { stream?: (sql: string, onSet: (c: ColumnInfo[]) => void, onRow: (v: unknown[], c: ColumnInfo[]) => void) => Promise<void> },
  table: string,
  where: string | undefined,
  sink: TextSink
): Promise<void> {
  const key = keyOrAll(where);
  sink.write(`DELETE FROM ${table} WHERE ${key}`);
  const sql = `SELECT * FROM ${table} WHERE ${key}`;
  if (db.stream) {
    await db.stream(sql, () => undefined, (values, cols) => {
      const l = insertLine(table, cols, values, false);
      if (l) sink.write(NL + l);
    });
    return;
  }
  const set = (await db.query(sql))[0];
  for (const row of set?.rows ?? []) {
    const l = insertLine(table, set.columns, row, false);
    if (l) sink.write(NL + l);
  }
}

/** Sink ghi file UTF-8 có BOM (StreamWriter(path, False, UTF8) của .NET), gom ~1 MB mỗi lần ghi. */
export class FileSink implements TextSink {
  private readonly fd: number;
  private buf: string[] = [];
  private size = 0;

  constructor(path: string) {
    this.fd = fs.openSync(path, 'w');
    fs.writeSync(this.fd, Buffer.from([0xef, 0xbb, 0xbf]));
  }

  write(text: string): void {
    this.buf.push(text);
    this.size += text.length;
    if (this.size > 1 << 20) this.flush();
  }

  private flush(): void {
    if (this.buf.length > 0) fs.writeSync(this.fd, Buffer.from(this.buf.join(''), 'utf8'));
    this.buf = [];
    this.size = 0;
  }

  close(): void {
    this.flush();
    fs.closeSync(this.fd);
  }
}

// ===================== Script từ lưới (JSON) =====================

/** Hằng SQL từ giá trị ô JSON (như QueryService.Cell gửi lên) theo kiểu .NET của cột. */
export function literal(v: unknown, clr: string): string {
  if (v === null || v === undefined) return 'NULL';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  switch (clr) {
    case 'System.Boolean':
      return typeof v === 'boolean' ? (v ? '1' : '0') : s === '1' || s.toLowerCase() === 'true' ? '1' : '0';
    case 'System.Int16':
    case 'System.Int32':
    case 'System.Int64':
    case 'System.Byte':
    case 'System.Decimal':
    case 'System.Double':
    case 'System.Single':
      return /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(s) ? s : `N'${s.replace(/'/g, "''")}'`;
    case 'System.Byte[]':
      return /^0x/i.test(s) ? s : 'NULL';
    case 'System.DateTime':
      return `'${s.replace(/'/g, "''")}'`;
    default:
      return `N'${s.replace(/'/g, "''")}'`;
  }
}

/** Gen Script By Data Selected: DELETE theo điều kiện + INSERT các dòng đang hiện trên lưới; chỉ ghi cột có trong bảng. */
export async function rowsScript(
  db: SqlDb,
  a: { table: string; where?: string; columns: Array<{ name: string; clr: string }>; rows: unknown[][] }
): Promise<string> {
  const table = a.table.trim();
  const key = keyOrAll(a.where);
  const empty = await db.query(`SELECT * FROM ${table} WHERE 1 = 0`);
  const tableCols = new Set((empty[0]?.columns ?? []).map((c) => c.name.toLowerCase()));
  const use = a.columns.map((_, i) => i).filter((i) => tableCols.has(a.columns[i].name.toLowerCase()));
  const fields = use.map((i) => a.columns[i].name).join(', ');
  let sb = `DELETE FROM ${table} WHERE ${key}` + NL;
  for (const row of a.rows) {
    sb += `INSERT INTO ${table} (${fields}) VALUES (${use.map((i) => literal(row[i], a.columns[i].clr)).join(', ')})` + NL;
  }
  return sb;
}

export interface SaveArgs {
  table: string;
  pk: string[];
  columns: Array<{ name: string; clr: string }>;
  deleted: unknown[][];
  updated: Array<{ row: unknown[]; orig: unknown[] }>;
  added: unknown[][];
}

/**
 * Câu lệnh lưu sửa đổi trên lưới (SqlS.ExecuteUpdate): deleted → DELETE theo khóa chính (giá trị gốc), updated → UPDATE cột đổi
 * theo khóa gốc, added → INSERT. Khóa chính phải có trong kết quả.
 */
export function saveStatements(a: SaveArgs): string[] {
  const table = a.table.trim();
  const cols = a.columns;
  const names = cols.map((c) => c.name);
  const pk = (a.pk ?? []).map((k) => names.findIndex((n) => n.toLowerCase() === k.toLowerCase()));
  if (pk.length === 0 || pk.includes(-1)) {
    throw new Error(`Kết quả phải có đủ cột khóa chính của ${table} mới sinh được script lưu.`);
  }
  const lit = (row: unknown[], i: number): string => literal(row[i], cols[i].clr);
  const where = (row: unknown[]): string =>
    pk.map((i) => names[i] + (row[i] === null || row[i] === undefined ? ' IS NULL' : ' = ' + lit(row, i))).join(' AND ');
  const list: string[] = [];
  for (const row of a.deleted ?? []) list.push(`DELETE FROM ${table} WHERE ${where(row)}`);
  for (const u of a.updated ?? []) {
    const sets: string[] = [];
    for (let i = 0; i < cols.length; i++) {
      const x = u.row[i] ?? null;
      const y = u.orig[i] ?? null;
      if (x !== y) sets.push(`${names[i]} = ${lit(u.row, i)}`);
    }
    if (sets.length > 0) list.push(`UPDATE ${table} SET ${sets.join(', ')} WHERE ${where(u.orig)}`);
  }
  for (const row of a.added ?? []) {
    const idx = cols.map((_, i) => i).filter((i) => row[i] !== null && row[i] !== undefined);
    if (idx.length === 0) continue;
    list.push(`INSERT INTO ${table} (${idx.map((i) => names[i]).join(', ')}) VALUES (${idx.map((i) => lit(row, i)).join(', ')})`);
  }
  return list;
}

/** Chạy lần lượt các câu trong một transaction qua `exec`; câu UPDATE / DELETE không trúng dòng nào → ném lỗi (hoàn tác ở người gọi). */
export async function runSave(statements: string[], exec: (sql: string) => Promise<number | undefined>): Promise<void> {
  for (const sql of statements) {
    const n = await exec(sql);
    if (n === 0 && !sql.startsWith('INSERT')) {
      throw new Error('Không có dòng nào khớp (dòng đã bị xóa hoặc đổi ở nơi khác) — chưa lưu gì:' + NL + sql);
    }
  }
}
