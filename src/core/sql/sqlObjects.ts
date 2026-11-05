// Đối tượng SQL của một DB dự án (bảng, view, store, function, trigger): danh sách, cột, định nghĩa, tìm, script.
// Port từ SqlObjectService + ObjectScripter của FSD Studio 5.2 (ObjectScripter = xCmd.GetObjectHelpText 5.1), giữ nguyên định dạng script.
import { replaceAll, type ScriptStore } from './scriptStore';
import { rowObjects, type RawSet, type SqlDb } from './sqlSession';
import { shortDateText, typeText } from './sqlTypes';

const NL = '\r\n';

export interface ObjectRow {
  name: string;
  /** U / V / P / FN / IF / TF / TR */
  type: string;
  modified: string;
}

export interface ColumnRow {
  name: string;
  type: string;
  nullable: boolean;
  pk: boolean;
}

export interface DefinitionRow {
  name: string;
  type: string;
  text: string;
  db: string;
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** [{name, type, modified}] xếp theo tên. */
export async function listObjects(db: SqlDb): Promise<ObjectRow[]> {
  const sets = await db.query(
    "SELECT name, RTRIM(type) AS type, modify_date FROM sys.objects WHERE type IN ('U','V','P','FN','IF','TF','TR') AND is_ms_shipped = 0 ORDER BY name"
  );
  return (sets[0]?.rows ?? []).map((r) => ({ name: str(r[0]), type: str(r[1]), modified: shortDateText(r[2]) }));
}

/** [{name, type, nullable, pk}] theo thứ tự cột (pk = cột thuộc khóa chính). */
export async function listColumns(db: SqlDb, name: string): Promise<ColumnRow[]> {
  const sets = await db.query(
    'SELECT c.name, TYPE_NAME(c.user_type_id), c.max_length, c.precision, c.scale, c.is_nullable, ' +
      'CAST(CASE WHEN EXISTS (SELECT 1 FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id ' +
      'WHERE i.object_id = c.object_id AND i.is_primary_key = 1 AND ic.column_id = c.column_id) THEN 1 ELSE 0 END AS bit) ' +
      'FROM sys.columns c WHERE c.object_id = OBJECT_ID(@name) ORDER BY c.column_id',
    { name: name ?? '' }
  );
  return (sets[0]?.rows ?? []).map((r) => ({
    name: str(r[0]),
    type: typeText(str(r[1]), Number(r[2]), Number(r[3]), Number(r[4])),
    nullable: Boolean(r[5]),
    pk: Boolean(r[6])
  }));
}

/** {name, type, text, db}: text = mã CREATE của store / view / function; bảng → text rỗng. Không có đối tượng → null. */
export async function getDefinition(db: SqlDb, name: string, dbName: string): Promise<DefinitionRow | null> {
  const sets = await db.query(
    'SELECT o.name, RTRIM(o.type), OBJECT_DEFINITION(o.object_id) FROM sys.objects o WHERE o.object_id = OBJECT_ID(@name)',
    { name: name ?? '' }
  );
  const r = sets[0]?.rows[0];
  if (!r) return null;
  return { name: str(r[0]), type: str(r[1]), text: str(r[2]), db: dbName };
}

/**
 * Panel SQL chế độ Search Column / Search Content: col = bảng có cột tên chứa chuỗi; content = đối tượng có mã chứa chuỗi
 * (sys.sql_modules). Trả [{name, type, modified}].
 */
export async function searchObjects(db: SqlDb, mode: string, text: string): Promise<ObjectRow[]> {
  const sql =
    mode === 'col'
      ? "SELECT DISTINCT o.name, RTRIM(o.type), o.modify_date FROM sys.columns c JOIN sys.objects o ON o.object_id = c.object_id WHERE o.type = 'U' AND o.is_ms_shipped = 0 AND c.name LIKE @k ORDER BY o.name"
      : 'SELECT o.name, RTRIM(o.type), o.modify_date FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id WHERE m.definition LIKE @k ORDER BY RTRIM(o.type), o.name';
  const sets = await db.query(sql, { k: '%' + (text ?? '').trim().replace(/\[/g, '[[]') + '%' });
  return (sets[0]?.rows ?? []).map((r) => ({ name: str(r[0]), type: str(r[1]), modified: shortDateText(r[2]) }));
}

/** Loại đối tượng panel SQL liệt kê (khớp listObjects). */
const LIST_TYPES = new Set(['U', 'V', 'P', 'FN', 'IF', 'TF', 'TR']);

/**
 * 5.1 "Filter Object Customize By Date" / "Get All Object Customize": script GETOBJECTMODIFY (khoảng ngày yyyyMMdd) hoặc
 * GETOBJECTMODIFYALL (sửa sau ngày tạo DB) của system.db. GETOBJECTMODIFY không trả modify_date → lấy từ danh sách đầy đủ `known`.
 * Chỉ giữ loại panel liệt kê được (bỏ ràng buộc 'F' mà script lấy theo sysobjects).
 */
export async function listModifiedObjects(
  db: SqlDb,
  scripts: ScriptStore,
  range: { from: string; to: string } | 'all',
  known: ObjectRow[]
): Promise<ObjectRow[]> {
  let sql: string;
  if (range === 'all') sql = scripts.get('GETOBJECTMODIFYALL');
  else {
    if (!/^\d{8}$/.test(range.from) || !/^\d{8}$/.test(range.to)) throw new Error('Ngày phải dạng yyyyMMdd.');
    sql = replaceAll(replaceAll(scripts.get('GETOBJECTMODIFY'), '%dfrom', range.from), '%dto', range.to);
  }
  const byName = new Map(known.map((o) => [o.name.toLowerCase() + '|' + o.type, o.modified]));
  const out: ObjectRow[] = [];
  for (const r of rowObjects((await db.query(sql))[0])) {
    const name = str(r.val);
    const type = str(r.xtype).trim();
    if (!name || !LIST_TYPES.has(type)) continue;
    const md = shortDateText(r.modify_date);
    out.push({ name, type, modified: md !== '' ? md : (byName.get(name.toLowerCase() + '|' + type) ?? '') });
  }
  return out;
}

/** Tách danh sách tên của "Custom Gen": phân cách bằng xuống dòng hoặc dấu phẩy, bỏ trống / trùng. */
export function splitObjectNames(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of (text ?? '').split(/[\r\n,]+/)) {
    const n = s.trim();
    if (n !== '' && !seen.has(n.toLowerCase())) {
      seen.add(n.toLowerCase());
      out.push(n);
    }
  }
  return out;
}

/**
 * 5.1 CustomGen: script (ALTER hoặc DROP + CREATE) lần lượt từng tên, mỗi đối tượng kết bằng GO (không lặp GO nếu script đã có).
 * Tên không lấy được script được liệt kê trong failed.
 */
export async function customGenScript(
  db: SqlDb,
  scripts: ScriptStore,
  names: string[],
  alter: boolean
): Promise<{ text: string; failed: string[] }> {
  let text = '';
  const failed: string[] = [];
  for (const name of names) {
    let code = '';
    try {
      code = await objectScript(db, scripts, name, { alter, quotedOff: false });
    } catch {
      code = '';
    }
    if (code.trim() === '') {
      failed.push(name);
      continue;
    }
    text += code;
    if (!/(^|\n)GO\s*$/i.test(code.trimEnd())) text += (code.endsWith('\n') ? '' : NL) + 'GO' + NL;
  }
  return { text, failed };
}

// ===================== Script đối tượng (ObjectScripter) =====================

/** Tên loại cho DROP: bảng xtypeobjects của system.db (xtype → ctext); loại khác → "". */
const XTYPE_NAMES: Record<string, string> = {
  IF: 'FUNCTION',
  U: 'TABLE',
  P: 'PROCEDURE',
  V: 'VIEW',
  TF: 'FUNCTION',
  FN: 'FUNCTION',
  TR: 'TRIGGER',
  F: 'FUNCTION'
};

export function xtypeName(xtype: string): string {
  return XTYPE_NAMES[xtype.trim().toUpperCase()] ?? '';
}

/** Nối cột 1 của mọi dòng bảng kết quả đầu tiên (SqlS.GetTable → Concat); không có bảng → null. */
function concatFirst(sets: RawSet[]): string | null {
  const first = sets[0];
  if (!first) return null;
  return first.rows.map((r) => str(r[0])).join('');
}

const safe = (s: string): string => s.replace(/'/g, "''");

/** Bảng (xtype U) hay đối tượng có mã (store / view / function / trigger). */
export async function isTable(db: SqlDb, name: string): Promise<boolean> {
  const sets = await db.query(`SELECT COUNT(1) FROM sysobjects WHERE name = '${safe(name)}' AND xtype = 'U'`);
  return Number(sets[0]?.rows[0]?.[0] ?? 0) > 0;
}

/**
 * Script một đối tượng. name bắt đầu "exec " → chạy và nối cột 1 của kết quả. Bảng: GETTABLESCRIPT (isAlter = chỉ phần thay đổi,
 * không tạo bảng / index / default) + dòng DROP TABLE comment sẵn + khối đăng ký bảng kỳ (*$000000 có trong sysgendata).
 * Store / view / function: DROPOBJECT + GO (trừ isAlter) + mã sp_helptext (isAlter: CREATE đầu tiên → ALTER) + GO.
 */
export async function objectScript(
  db: SqlDb,
  scripts: ScriptStore,
  name: string,
  opts: { alter?: boolean; quotedOff?: boolean } = {}
): Promise<string> {
  const isAlter = opts.alter === true;
  if (name.toLowerCase().startsWith('exec ')) return concatFirst(await db.query(name)) ?? '';

  if (await isTable(db, name)) {
    let sql = replaceAll(scripts.get('GETTABLESCRIPT'), '%table', name);
    sql = replaceAll(sql, '%trigger', '1');
    const flag = isAlter ? '0' : '1';
    sql = replaceAll(replaceAll(replaceAll(sql, '%cretable', flag), '%index', flag), '%createdf', flag);
    let body = concatFirst(await db.query(sql));
    if (body === null) return '';
    // DROP TABLE: comment sẵn — bỏ "--" khi cần tạo lại bảng đã có.
    if (!isAlter && body !== '') {
      body = `-- IF EXISTS (SELECT 1 FROM sysobjects WHERE name = '${safe(name.trim())}' AND xtype = 'U') DROP TABLE [${name.trim().replace(/]/g, ']]')}]${NL}${body}`;
    }
    return appendPartitionTable(db, name, body);
  }

  const help = await db.query(`EXEC sp_helptext '${safe(name)}'`);
  const lines = help[0];
  if (!lines) return '';
  const all = lines.rows.map((r) => str(r[0]));
  let out = '';
  if (!isAlter) {
    const xt = str((await db.query(`SELECT xtype FROM sysobjects WHERE name = '${safe(name)}'`))[0]?.rows[0]?.[0]).trim();
    let drop = replaceAll(scripts.get('DROPOBJECT'), '%name', name);
    drop = replaceAll(drop, '%xtypename', xtypeName(xt));
    drop = replaceAll(drop, '%xtype', xt);
    out += drop + NL + 'GO' + NL;
  }
  if (opts.quotedOff && !all.join('').toUpperCase().includes('--SET QUOTED_IDENTIFIER OFF')) {
    out += '--SET QUOTED_IDENTIFIER OFF' + NL + '--GO' + NL;
  }
  let replaced = false;
  for (let line of all) {
    if (isAlter && !replaced && line.includes('CREATE')) {
      replaced = true;
      line = 'ALTER' + line.slice(line.indexOf('CREATE') + 6);
    }
    out += line;
  }
  return out + NL + 'GO' + NL;
}

/** Bảng kỳ gốc (*$000000) khai trong sysgendata: thêm khối Dynamic$AddTable + INSERT sysgendata (tách batch GO). */
async function appendPartitionTable(db: SqlDb, table: string, baseScript: string): Promise<string> {
  if (!table || !table.includes('$000000')) return baseScript;
  const sf = safe(table);
  const sets = await db.query(`SELECT primetable, refprimetable, primefilegroup, type, status FROM sysgendata WHERE basetable = '${sf}'`);
  const row = rowObjects(sets[0])[0];
  if (!row) return baseScript;
  const prime = str(row.primetable);
  const refPrime = str(row.refprimetable);
  const fileGroup = str(row.primefilegroup);
  const typeVal = str(row.type);
  const statusVal = str(row.status);
  const addFg = fileGroup !== '' && !fileGroup.endsWith('$') ? fileGroup + '$' : fileGroup;
  const q = safe;
  const block =
    '-- Tạo bảng kỳ' + NL +
    'DECLARE @d1 SMALLDATETIME, @d2 SMALLDATETIME' + NL +
    'SELECT @d1 = ngay_gh1, @d2 = ngay_gh2 FROM dmstt' + NL +
    NL +
    `EXEC FastBusiness$App$Dynamic$AddTable '${sf}', '${q(prime)}', '${q(refPrime)}', '${q(addFg)}', ${typeVal}, @d1, @d2, 1` + NL +
    NL +
    `IF NOT EXISTS(SELECT 1 FROM sysgendata WHERE basetable = '${sf}')` + NL +
    `  INSERT INTO sysgendata (basetable,primetable,refprimetable,primefilegroup,type,status)VALUES(N'${sf}',N'${q(prime)}',N'${q(refPrime)}',N'${q(fileGroup)}',${typeVal},N'${q(statusVal)}')` + NL +
    'GO';
  let result = baseScript;
  if (result !== '' && !result.endsWith(NL)) result += NL;
  // Tách batch CREATE TABLE trước khi DECLARE / EXEC đăng ký kỳ.
  if (result !== '') {
    if (!/go$/i.test(result.replace(/[\r\n \t]+$/, ''))) result += 'GO' + NL;
    result += NL;
  }
  return result + block + NL;
}
