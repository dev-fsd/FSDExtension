// Giỏ "Tạo update" tối thiểu: các mục SQL (Other App / Sys), dữ liệu bảng, đối tượng SQL — theo dự án.
// Thuần (không import vscode, không đụng đĩa); lưu JSON ở basketStore.ts. Hành vi theo UpdatePackage 5.2.

export type BasketDb = 'app' | 'sys';

/** Loại đối tượng trong giỏ — tên khớp danh mục update của 5.2. */
export type BasketCategory = 'Store' | 'Function' | 'View' | 'Trigger' | 'Table App' | 'Table Sys';

/** Dữ liệu bảng theo điều kiện (dòng O của 5.2). */
export interface BasketDataItem {
  kind: 'data';
  db: BasketDb;
  table: string;
  /** Điều kiện WHERE; trống được lưu thành "1=1" như 5.2. */
  key: string;
}

/** Đối tượng SQL: store, function, view, trigger, bảng. */
export interface BasketObjectItem {
  kind: 'object';
  db: BasketDb;
  category: BasketCategory;
  name: string;
  /** sys.objects.type thô (P, FN, V, U…). */
  type: string;
  alter: boolean;
  quotedOff: boolean;
}

export type BasketItem = BasketDataItem | BasketObjectItem;

export interface BasketState {
  items: BasketItem[];
  otherAppSql: string;
  otherSysSql: string;
}

export function emptyBasket(): BasketState {
  return { items: [], otherAppSql: '', otherSysSql: '' };
}

const NL = '\r\n';

/** Số mục hiển thị trên badge: số dòng + 1 nếu có SQL thêm (như UpdateService.Notify 5.2). */
export function basketCount(s: BasketState): number {
  return s.items.length + (s.otherAppSql.trim() !== '' || s.otherSysSql.trim() !== '' ? 1 : 0);
}

/** db thô từ lệnh (tên DB, "Sys", "App") → app / sys. Trùng tên DB Sys của dự án hoặc "Sys" là sys. */
export function resolveDb(db: string | undefined, sysDatabase: string): BasketDb {
  const d = (db ?? '').trim();
  if (d === '') return 'app';
  if (d === 'Sys' || d.toLowerCase() === sysDatabase.trim().toLowerCase()) return 'sys';
  return 'app';
}

/** Dòng dữ liệu O: trùng (bảng, điều kiện, DB) → "Đã có trong gói." Trả '' khi thêm được. */
export function addData(s: BasketState, table: string, key: string, db: BasketDb): string {
  const sKey = key.trim() === '' ? '1=1' : key.trim();
  const dup = s.items.some(
    (i) => i.kind === 'data' && i.db === db && i.table.toLowerCase() === table.toLowerCase() && i.key.toLowerCase() === sKey.toLowerCase()
  );
  if (dup) return 'Đã có trong gói.';
  s.items.push({ kind: 'data', db, table, key: sKey });
  return '';
}

/** sys.objects.type → danh mục update; undefined nếu chưa hỗ trợ. */
export function categoryOf(type: string, db: BasketDb): BasketCategory | undefined {
  switch (type.trim().toUpperCase()) {
    case 'P': return 'Store';
    case 'FN':
    case 'IF':
    case 'TF': return 'Function';
    case 'V': return 'View';
    case 'TR': return 'Trigger';
    case 'U': return db === 'sys' ? 'Table Sys' : 'Table App';
    default: return undefined;
  }
}

/** Thêm đối tượng SQL. Trả '' khi được; câu báo khi không (loại chưa hỗ trợ, trùng, thiếu tên). */
export function addObject(s: BasketState, name: string, type: string, db: BasketDb, alter: boolean, quotedOff: boolean): string {
  const code = name.trim();
  if (code === '') return 'Chưa nhập mã.';
  const category = categoryOf(type, db);
  if (!category) return `Loại đối tượng ${type} chưa hỗ trợ.`;
  const dup = s.items.some((i) => i.kind === 'object' && i.category === category && i.name.toLowerCase() === code.toLowerCase());
  if (dup) return `Đã có ${code} trong gói.`;
  // Table Sys luôn là sys; còn lại theo DB nguồn (đối tượng lấy từ DB Sys ghi sDB = Sys như 5.2).
  s.items.push({ kind: 'object', db: category === 'Table Sys' ? 'sys' : db, category, name: code, type: type.trim(), alter, quotedOff });
  return '';
}

/** Dòng code cuối (bỏ dòng trống và comment --) là GO. */
function endsWithGo(sql: string): boolean {
  const lines = sql.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t === '' || t.startsWith('--')) continue;
    return /^go$/i.test(t);
  }
  return false;
}

/** Nối SQL vào Other App / Sys: batch trước chưa kết thúc bằng GO thì chèn GO (AppendOtherSql 5.2). */
export function appendSql(s: BasketState, sql: string, isSys: boolean): void {
  if (sql === '') return;
  let cur = isSys ? s.otherSysSql : s.otherAppSql;
  if (cur.trim() !== '' && !endsWithGo(cur)) cur += NL + 'GO' + NL;
  cur += sql;
  if (isSys) s.otherSysSql = cur;
  else s.otherAppSql = cur;
}

/** Xóa mục theo vị trí; ngoài khoảng → false. */
export function removeItem(s: BasketState, index: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= s.items.length) return false;
  s.items.splice(index, 1);
  return true;
}

export function clearBasket(s: BasketState): void {
  s.items = [];
  s.otherAppSql = '';
  s.otherSysSql = '';
}

/** Nhãn một dòng trong danh sách. */
export function describeItem(i: BasketItem): { label: string; detail: string } {
  const db = i.db === 'sys' ? 'Sys' : 'App';
  if (i.kind === 'data') return { label: `${i.table} WHERE ${i.key}`, detail: `Dữ liệu · ${db}` };
  const mode = i.type.toUpperCase() === 'U' ? 'CREATE' : i.alter ? 'ALTER' : 'CREATE';
  return { label: i.name, detail: `${i.category} · ${db} · ${mode}${i.quotedOff ? ', QUOTED OFF' : ''}` };
}

/** Hàm sinh script cho một mục (agent chính nối vào sql.script / table.dataScript). */
export type ScriptOf = (item: BasketItem) => Promise<string>;

/** Script mặc định khi chưa có nguồn: chỉ ghi chú định danh mục. */
export function placeholderScript(i: BasketItem): string {
  const d = describeItem(i);
  return `-- ${d.detail}: ${d.label}`;
}

/** Gộp toàn bộ giỏ thành một script: phần App rồi phần Sys, mỗi mục cách nhau GO. */
export async function buildBasketScript(s: BasketState, scriptOf: ScriptOf = async (i) => placeholderScript(i)): Promise<string> {
  const parts: string[] = [];
  for (const db of ['app', 'sys'] as BasketDb[]) {
    const blocks: string[] = [];
    for (const item of s.items.filter((x) => x.db === db)) {
      const text = (await scriptOf(item)).replace(/\s+$/, '');
      if (text !== '') blocks.push(text);
    }
    const other = (db === 'sys' ? s.otherSysSql : s.otherAppSql).replace(/\s+$/, '');
    if (other.trim() !== '') blocks.push(other);
    if (blocks.length === 0) continue;
    parts.push(`-- ===== ${db === 'sys' ? 'Sys' : 'App'} =====` + NL + blocks.join(NL + 'GO' + NL));
  }
  return parts.join(NL + 'GO' + NL + NL);
}
