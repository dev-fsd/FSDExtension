// Phần thuần (không vscode) của QuickPick "Đối tượng SQL": lọc, sắp, đếm, nhãn ngày, icon theo loại.
// Port web/js/sqlobjects/listModel.js (panel cũ) sang TS để test bằng node và dùng cho src/vscode/sqlPicker.ts.
import type { ObjectRow } from './sqlObjects';

/** Đối tượng đã chuẩn hóa: tên viết thường tính sẵn một lần (lọc theo từng phím không phải toLowerCase lại). */
export interface PickObj extends ObjectRow {
  lname: string;
}

/** Các loại lọc: '' = tất cả; COL / CONTENT = chế độ tìm (gõ rồi Enter). */
export const TYPE_FILTERS: ReadonlyArray<{ type: string; label: string }> = [
  { type: '', label: 'Tất cả' },
  { type: 'P', label: 'Store' },
  { type: 'FN', label: 'Function' },
  { type: 'V', label: 'View' },
  { type: 'U', label: 'Bảng' },
  { type: 'TR', label: 'Trigger' },
  { type: 'COL', label: 'Tìm cột' },
  { type: 'CONTENT', label: 'Tìm nội dung' }
];

/** Gợi ý ô tìm ở chế độ Tìm cột / Tìm nội dung. */
export const SEARCH_HINT: Readonly<Record<string, string>> = {
  COL: 'Tên cột rồi Enter (bảng có cột chứa chuỗi)',
  CONTENT: 'Từ khóa rồi Enter (mã store / view / function chứa chuỗi)'
};

export const isSearchType = (type: string): boolean => type in SEARCH_HINT;

export const typeLabel = (type: string): string => TYPE_FILTERS.find((t) => t.type === type)?.label ?? type;

/** Loại đối tượng panel liệt kê được (khớp listObjects). */
const KNOWN_TYPES = new Set(['U', 'V', 'P', 'FN', 'IF', 'TF', 'TR']);
export const isKnownType = (type: string): boolean => KNOWN_TYPES.has(type);

/** Codicon theo loại đối tượng. */
export function iconOf(type: string): string {
  switch (type) {
    case 'U':
      return 'symbol-class';
    case 'V':
      return 'eye';
    case 'P':
      return 'symbol-method';
    case 'FN':
    case 'IF':
    case 'TF':
      return 'symbol-function';
    case 'TR':
      return 'zap';
    default:
      return 'symbol-misc';
  }
}

export function prepare(rows: ObjectRow[] | null | undefined): PickObj[] {
  return (rows ?? []).map((o) => ({ name: o.name, type: o.type, modified: o.modified || '', lname: o.name.toLowerCase() }));
}

/** Lọc kiểu 5.2: "a b" = có cả a và b; "a, b" = a hoặc b. */
export function matcher(text: string): (lname: string) => boolean {
  const groups = text
    .toLowerCase()
    .split(',')
    .map((g) => g.trim().split(/\s+/).filter(Boolean))
    .filter((g) => g.length);
  if (!groups.length) return () => true;
  return (lname) => groups.some((g) => g.every((w) => lname.includes(w)));
}

/** Loại FN gộp cả IF / TF (function nhiều dòng, function bảng). */
export const typeOk = (type: string, o: { type: string }): boolean => !type || o.type === type || (type === 'FN' && (o.type === 'IF' || o.type === 'TF'));

const byName = (a: PickObj, b: PickObj): number => a.name.localeCompare(b.name);
const byDate = (a: PickObj, b: PickObj): number => (a.modified < b.modified ? 1 : a.modified > b.modified ? -1 : byName(a, b));

/** Bản sắp mới của danh sách: 'date' (mới sửa trước, bằng nhau theo tên) hoặc 'name'. */
export function sortObjects(list: PickObj[], sort: string): PickObj[] {
  return list.slice().sort(sort === 'date' ? byDate : byName);
}

export interface PickView {
  rows: PickObj[];
  /** Số dòng hiển thị. */
  count: number;
  /** Tổng của nguồn (để hiện "n / tổng" khi đang lọc). */
  all: number;
}

/** Danh sách hiển thị + số đếm. base = nguồn đã sắp; found = kết quả Tìm cột / nội dung (null = chưa tìm) khi searching. */
export function buildView(p: { base: PickObj[]; found: PickObj[] | null; searching: boolean; type: string; filter: string }): PickView {
  if (p.searching) {
    const rows = p.found ?? [];
    return { rows, count: rows.length, all: rows.length };
  }
  const m = matcher(p.filter);
  const rows: PickObj[] = [];
  for (const o of p.base) if (typeOk(p.type, o) && m(o.lname)) rows.push(o);
  return { rows, count: rows.length, all: p.base.length };
}

/** "N đối tượng" hoặc "n / tổng" khi đang lọc. */
export function countText(v: { count: number; all: number }, searching = false): string {
  if (searching || v.count === v.all) return v.count + ' đối tượng';
  return v.count + ' / ' + v.all;
}

/** Ngày sửa "yyyy-MM-dd HH:mm:ss" → "dd/MM/yyyy" (rỗng nếu không đọc được). */
export function dateLabel(modified: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(modified);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Sửa trong vòng `days` ngày gần đây (mặc định 7) — so sánh theo ngày như panel cũ. */
export function isRecent(modified: string, now: number = Date.now(), days = 7): boolean {
  const limit = new Date(now - days * 864e5).toISOString().slice(0, 10);
  return modified.slice(0, 10) >= limit;
}

/** Mô tả ở bên phải tên: "05/11/2026" hoặc "05/11/2026 · mới". */
export function descriptionOf(o: PickObj, now: number = Date.now()): string {
  const d = dateLabel(o.modified);
  return isRecent(o.modified, now) && d !== '' ? `${d} · mới` : d;
}

/** Nhãn khoảng ngày "03/11–04/11" (yyyy-MM-dd; khác năm thì dd/MM/yy). */
export function rangeLabel(from: string, to: string): string {
  const [fy, fm, fd] = from.split('-');
  const [ty, tm, td] = to.split('-');
  const a = fd + '/' + fm;
  const b = td + '/' + tm;
  return fy === ty ? a + '–' + b : a + '/' + fy.slice(2) + '–' + b + '/' + ty.slice(2);
}

/** Ngày nhập tay "dd/MM/yyyy" (hoặc "yyyy-MM-dd") → "yyyy-MM-dd"; không hợp lệ → undefined. */
export function parseDay(text: string): string | undefined {
  const t = text.trim();
  let y: number, mo: number, d: number;
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m) {
    d = +m[1];
    mo = +m[2];
    y = +m[3];
  } else if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) {
    y = +m[1];
    mo = +m[2];
    d = +m[3];
  } else return undefined;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return undefined;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Ngày địa phương → "dd/MM/yyyy" (ô nhập mặc định). */
export function formatDay(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
