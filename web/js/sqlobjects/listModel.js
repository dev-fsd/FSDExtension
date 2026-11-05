// Phần thuần (không DOM) của panel "Đối tượng SQL": lọc, sắp, đếm, cuộn ảo. Tách riêng để test bằng node (test/sql/sqlObjectsPanel.test.ts).

/** Chiều cao một dòng (px) — cố định để cuộn ảo tính vị trí bằng phép nhân. */
export const ROW_H = 22;

/** Chuẩn hóa dòng từ extension: tên viết thường tính sẵn một lần (lọc theo từng phím không phải toLowerCase lại). */
export function mapRows(rows) {
  return (rows || []).map((o) => ({ name: o.name, type: o.type, modified: o.modified || '', lname: o.name.toLowerCase() }));
}

/** Lọc kiểu 5.2: "a b" = có cả a và b; "a, b" = a hoặc b. */
export function matcher(text) {
  const groups = text.toLowerCase().split(',').map((g) => g.trim().split(/\s+/).filter(Boolean)).filter((g) => g.length);
  if (!groups.length) return () => true;
  return (lname) => groups.some((g) => g.every((w) => lname.includes(w)));
}

/** Loại FN gộp cả IF / TF (function nhiều dòng, function bảng). */
export const typeOk = (type, o) => !type || o.type === type || (type === 'FN' && (o.type === 'IF' || o.type === 'TF'));

const byName = (a, b) => a.name.localeCompare(b.name);
const byDate = (a, b) => (a.modified < b.modified ? 1 : a.modified > b.modified ? -1 : byName(a, b));

/** Bản sắp mới của danh sách: sort = 'date' (mới sửa trước, bằng nhau thì theo tên) hoặc 'name'. */
export function sortRows(list, sort) {
  return list.slice().sort(sort === 'date' ? byDate : byName);
}

/**
 * Danh sách hiển thị + số đếm.
 *   base: toàn bộ đối tượng đang xét (danh sách đầy đủ hoặc danh sách "đã sửa"), ĐÃ sắp.
 *   found: kết quả Tìm cột / Tìm nội dung (null = chưa tìm) khi searching.
 * count = số dòng hiển thị; all = tổng của nguồn (để hiện "n / tổng" khi đang lọc).
 */
export function buildView({ base, found, searching, type, filter }) {
  if (searching) {
    const rows = found || [];
    return { rows, count: rows.length, all: rows.length };
  }
  const m = matcher(filter);
  const rows = [];
  for (const o of base) if (typeOk(type, o) && m(o.lname)) rows.push(o);
  return { rows, count: rows.length, all: base.length };
}

/** Chữ ở thanh dưới: "N đối tượng" hoặc "n / tổng" khi đang lọc. */
export function countText({ count, all, searching }) {
  if (searching) return count + ' đối tượng';
  return count === all ? count + ' đối tượng' : count + ' / ' + all;
}

/** Khoảng dòng cần dựng DOM cho khung nhìn [scrollTop, scrollTop + viewH]: [start, end) có đệm `over` dòng mỗi phía. */
export function windowRange(scrollTop, viewH, n, over = 6) {
  const first = Math.floor(scrollTop / ROW_H);
  const last = Math.ceil((scrollTop + viewH) / ROW_H);
  return [Math.max(0, first - over), Math.min(n, last + over)];
}

/** scrollTop mới để dòng i nằm trọn trong khung nhìn (cuộn ít nhất có thể); giữ nguyên nếu đã thấy. */
export function scrollForIndex(i, scrollTop, viewH) {
  const top = i * ROW_H;
  if (top < scrollTop) return top;
  if (top + ROW_H > scrollTop + viewH) return top + ROW_H - viewH;
  return scrollTop;
}

/** Chỉ số của dòng đang chọn trong danh sách mới (giữ chọn khi đổi sắp / nạp lại); không còn → 0. */
export function indexOfKey(rows, key) {
  if (!key) return 0;
  const i = rows.findIndex((o) => o.name === key.name && o.type === key.type);
  return i < 0 ? 0 : i;
}

/** Nhãn khoảng ngày "03/11–04/11" (yyyy-MM-dd → dd/MM; khác năm thì dd/MM/yy). */
export function rangeLabel(from, to) {
  const p = (s) => s.split('-');
  const [fy, fm, fd] = p(from);
  const [ty, tm, td] = p(to);
  const a = fd + '/' + fm;
  const b = td + '/' + tm;
  return fy === ty ? a + '–' + b : a + '/' + fy.slice(2) + '–' + b + '/' + ty.slice(2);
}
