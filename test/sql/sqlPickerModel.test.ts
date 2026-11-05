// QuickPick "Đối tượng SQL": lọc / sắp / đếm / nhãn ngày / icon (src/core/sql/sqlPickerModel.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildView, countText, dateLabel, descriptionOf, formatDay, iconOf, isRecent, matcher, parseDay, prepare, rangeLabel, sortObjects, typeOk } from '../../src/core/sql/sqlPickerModel';

const obj = (name: string, type: string, modified = '2026-01-01 00:00:00') => ({ name, type, modified, lname: name.toLowerCase() });

test('buildView: loại FN gộp IF/TF, "a b" = AND, "a, b" = OR; count / all khớp', () => {
  const base = [obj('rs_a', 'P'), obj('fn_x', 'FN'), obj('fn_y', 'IF'), obj('fn_z', 'TF'), obj('dmkh', 'U'), obj('rs_b', 'P')];
  let v = buildView({ base, found: null, searching: false, type: 'FN', filter: '' });
  assert.deepEqual(v.rows.map((o) => o.name), ['fn_x', 'fn_y', 'fn_z']);
  assert.equal(countText(v), '3 / 6');
  v = buildView({ base, found: null, searching: false, type: '', filter: 'rs, dm' });
  assert.equal(v.count, 3);
  v = buildView({ base, found: null, searching: false, type: '', filter: 'rs b' });
  assert.deepEqual(v.rows.map((o) => o.name), ['rs_b']);
  v = buildView({ base, found: null, searching: false, type: '', filter: '  ' });
  assert.equal(countText(v), '6 đối tượng');
  assert.equal(typeOk('FN', obj('a', 'TF')), true);
  assert.equal(typeOk('P', obj('a', 'V')), false);
});

test('buildView: hàng nghìn dòng không bị cắt; chế độ tìm lấy theo found', () => {
  const base = Array.from({ length: 5000 }, (_, i) => obj('t' + i, 'U'));
  assert.equal(buildView({ base, found: null, searching: false, type: 'U', filter: '' }).rows.length, 5000);
  const s = buildView({ base, found: [obj('dmkh', 'U')], searching: true, type: 'COL', filter: 'bỏ qua' });
  assert.equal(s.count, 1);
  assert.equal(countText(s, true), '1 đối tượng');
  assert.equal(buildView({ base, found: null, searching: true, type: 'COL', filter: '' }).count, 0);
});

test('matcher: dấu phẩy rỗng / khoảng trắng thừa', () => {
  assert.equal(matcher(', ,')('abc'), true);
  assert.equal(matcher('A  B')('xa_b'), true);
  assert.equal(matcher('a, zz')('bbb'), false);
});

test('sortObjects: ngày sửa mới trước (bằng nhau theo tên) / theo tên; không đổi mảng gốc', () => {
  const base = [obj('b', 'P', '2026-01-01'), obj('c', 'P', '2026-03-01'), obj('a', 'P', '2026-01-01')];
  assert.deepEqual(sortObjects(base, 'date').map((o) => o.name), ['c', 'a', 'b']);
  assert.deepEqual(sortObjects(base, 'name').map((o) => o.name), ['a', 'b', 'c']);
  assert.equal(base[0].name, 'b');
});

test('nhãn: ngày dd/MM/yyyy, "mới" trong 7 ngày, icon theo loại, prepare', () => {
  assert.equal(dateLabel('2026-11-05 10:20:30'), '05/11/2026');
  assert.equal(dateLabel(''), '');
  const now = Date.UTC(2026, 10, 5, 12);
  assert.equal(isRecent('2026-11-01 00:00:00', now), true);
  assert.equal(isRecent('2026-10-01 00:00:00', now), false);
  assert.equal(descriptionOf(obj('x', 'P', '2026-11-04 08:00:00'), now), '04/11/2026 · mới');
  assert.equal(descriptionOf(obj('x', 'P', '2025-01-02 08:00:00'), now), '02/01/2025');
  assert.equal(iconOf('U'), 'symbol-class');
  assert.equal(iconOf('TF'), 'symbol-function');
  assert.equal(iconOf('TR'), 'zap');
  const p = prepare([{ name: 'DmKH', type: 'U', modified: '' }]);
  assert.equal(p[0].lname, 'dmkh');
  assert.deepEqual(prepare(null), []);
});

test('ngày nhập tay: parseDay / formatDay / rangeLabel', () => {
  assert.equal(parseDay('05/11/2026'), '2026-11-05');
  assert.equal(parseDay('5-1-2026'), '2026-01-05');
  assert.equal(parseDay('2026-11-05'), '2026-11-05');
  assert.equal(parseDay('31/02/2026'), undefined);
  assert.equal(parseDay('abc'), undefined);
  assert.equal(formatDay(new Date(2026, 10, 5)), '05/11/2026');
  assert.equal(rangeLabel('2026-11-03', '2026-11-04'), '03/11–04/11');
  assert.equal(rangeLabel('2025-12-30', '2026-01-02'), '30/12/25–02/01/26');
});
