// Panel "Đối tượng SQL": lọc / sắp / đếm / cuộn ảo (web/js/sqlobjects/listModel.js), lọc object đã sửa (GETOBJECTMODIFY*), Custom Gen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { customGenScript, listModifiedObjects, splitObjectNames } from '../../src/core/sql/sqlObjects';
import { ScriptStore } from '../../src/core/sql/scriptStore';
import type { ColumnInfo } from '../../src/core/sql/sqlTypes';
import type { RawSet, SqlDb, SqlParams } from '../../src/core/sql/sqlSession';

const extRoot = path.resolve(__dirname, '..', '..', '..');
const scriptsDir = path.join(extRoot, 'resources', 'scripts');

// import() thật (không bị tsc đổi thành require) vì listModel.js là ES module.
const realImport = new Function('u', 'return import(u)') as (u: string) => Promise<any>;
const model = () => realImport(pathToFileURL(path.join(extRoot, 'web', 'js', 'sqlobjects', 'listModel.js')).href);

const obj = (name: string, type: string, modified = '2026-01-01 00:00:00') => ({ name, type, modified, lname: name.toLowerCase() });

function fakeDb(handler: (sql: string) => RawSet[]): SqlDb & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    query(sql: string, _p?: SqlParams): Promise<RawSet[]> {
      calls.push(sql);
      return Promise.resolve(handler(sql));
    }
  };
}
const cols = (...names: string[]): ColumnInfo[] => names.map((name) => ({ name })) as unknown as ColumnInfo[];

test('buildView: lọc loại FN gộp IF/TF, "a b" = AND, "a, b" = OR; count / all khớp', async () => {
  const { buildView, countText } = await model();
  const base = [obj('rs_a', 'P'), obj('fn_x', 'FN'), obj('fn_y', 'IF'), obj('fn_z', 'TF'), obj('dmkh', 'U'), obj('rs_b', 'P')];
  let v = buildView({ base, found: null, searching: false, type: 'FN', filter: '' });
  assert.deepEqual(v.rows.map((o: any) => o.name), ['fn_x', 'fn_y', 'fn_z']);
  assert.equal(v.count, 3);
  assert.equal(v.all, 6);
  assert.equal(countText({ ...v, searching: false }), '3 / 6');
  v = buildView({ base, found: null, searching: false, type: '', filter: 'rs, dm' });
  assert.equal(v.count, 3);
  v = buildView({ base, found: null, searching: false, type: '', filter: 'rs b' });
  assert.deepEqual(v.rows.map((o: any) => o.name), ['rs_b']);
  v = buildView({ base, found: null, searching: false, type: '', filter: '' });
  assert.equal(countText({ ...v, searching: false }), '6 đối tượng');
});

test('buildView: không giới hạn 400 dòng, chế độ tìm lấy theo found', async () => {
  const { buildView, countText } = await model();
  const base = Array.from({ length: 5000 }, (_, i) => obj('t' + i, 'U'));
  const v = buildView({ base, found: null, searching: false, type: 'U', filter: '' });
  assert.equal(v.rows.length, 5000);
  assert.equal(v.count, 5000);
  const s = buildView({ base, found: [obj('dmkh', 'U')], searching: true, type: 'COL', filter: 'bỏ qua' });
  assert.equal(s.count, 1);
  assert.equal(countText({ ...s, searching: true }), '1 đối tượng');
  const none = buildView({ base, found: null, searching: true, type: 'COL', filter: '' });
  assert.equal(none.count, 0);
});

test('sortRows: ngày sửa mới trước (bằng nhau theo tên) / theo tên; không đổi mảng gốc', async () => {
  const { sortRows } = await model();
  const base = [obj('b', 'P', '2026-01-01'), obj('c', 'P', '2026-03-01'), obj('a', 'P', '2026-01-01')];
  assert.deepEqual(sortRows(base, 'date').map((o: any) => o.name), ['c', 'a', 'b']);
  assert.deepEqual(sortRows(base, 'name').map((o: any) => o.name), ['a', 'b', 'c']);
  assert.equal(base[0].name, 'b');
});

test('cuộn ảo: windowRange, scrollForIndex, indexOfKey', async () => {
  const { ROW_H, windowRange, scrollForIndex, indexOfKey } = await model();
  assert.equal(ROW_H, 22);
  assert.deepEqual(windowRange(0, 220, 5000, 6), [0, 16]);
  const [s, e] = windowRange(22 * 1000, 220, 5000, 6);
  assert.equal(s, 994);
  assert.equal(e, 1016);
  assert.deepEqual(windowRange(0, 220, 3, 6), [0, 3]); // ít dòng: không vượt n
  // đã thấy: giữ; thấp hơn: cuộn xuống vừa đủ; cao hơn: cuộn lên
  assert.equal(scrollForIndex(3, 0, 220), 0);
  assert.equal(scrollForIndex(20, 0, 220), 20 * 22 + 22 - 220);
  assert.equal(scrollForIndex(2, 200, 220), 44);
  const rows = [obj('a', 'P'), obj('b', 'P'), obj('b', 'V')];
  assert.equal(indexOfKey(rows, { name: 'b', type: 'V' }), 2);
  assert.equal(indexOfKey(rows, { name: 'zz', type: 'V' }), 0);
  assert.equal(indexOfKey(rows, null), 0);
});

test('rangeLabel: cùng năm dd/MM–dd/MM, khác năm có yy', async () => {
  const { rangeLabel } = await model();
  assert.equal(rangeLabel('2026-11-03', '2026-11-04'), '03/11–04/11');
  assert.equal(rangeLabel('2025-12-30', '2026-01-02'), '30/12/25–02/01/26');
});

test('GETOBJECTMODIFY / GETOBJECTMODIFYALL đã đăng ký trong resources/scripts', () => {
  const store = new ScriptStore(scriptsDir);
  assert.match(store.get('GETOBJECTMODIFY'), /%dfrom 00:00:00.*%dto 23:59:00/s);
  assert.match(store.get('GETOBJECTMODIFYALL'), /master\.\.sysdatabases/);
});

test('listModifiedObjects theo ngày: thay %dfrom / %dto, lấy modify_date từ danh sách đầy đủ, bỏ loại lạ (F)', async () => {
  const store = new ScriptStore(scriptsDir);
  const db = fakeDb(() => [{ columns: cols('val', 'xtype'), rows: [['zc_a', 'P '], ['FK_x', 'F '], ['dmkh', 'U ']] }]);
  const known = [{ name: 'zc_a', type: 'P', modified: '2026-11-03 10:00:00' }];
  const r = await listModifiedObjects(db, store, { from: '20261103', to: '20261104' }, known);
  assert.match(db.calls[0], /BETWEEN '20261103 00:00:00' AND '20261104 23:59:00'/);
  assert.ok(!db.calls[0].includes('%d'));
  assert.deepEqual(r, [{ name: 'zc_a', type: 'P', modified: '2026-11-03 10:00:00' }, { name: 'dmkh', type: 'U', modified: '' }]);
  await assert.rejects(() => listModifiedObjects(db, store, { from: "2026'", to: '20261104' }, known), /yyyyMMdd/);
});

test('listModifiedObjects all: dùng modify_date của kết quả', async () => {
  const store = new ScriptStore(scriptsDir);
  const db = fakeDb(() => [{ columns: cols('val', 'xtype', 'name', 'modify_date'), rows: [['zc_a', 'P', 'zc_a', new Date(Date.UTC(2026, 10, 3, 1, 2, 3))]] }]);
  const r = await listModifiedObjects(db, store, 'all', []);
  assert.match(db.calls[0], /master\.\.sysdatabases/);
  assert.deepEqual(r, [{ name: 'zc_a', type: 'P', modified: '2026-11-03 01:02:03' }]);
});

test('splitObjectNames: tách xuống dòng / dấu phẩy, bỏ trống và trùng', () => {
  assert.deepEqual(splitObjectNames('a, b\r\nc,,\n  B \n'), ['a', 'b', 'c']);
  assert.deepEqual(splitObjectNames(''), []);
});

test('customGenScript: mỗi đối tượng kết bằng GO một lần, tên lỗi vào failed', async () => {
  const store = new ScriptStore(scriptsDir);
  const db = fakeDb((sql) => {
    if (sql === 'exec ok1') return [{ columns: cols('t'), rows: [['SELECT 1']] }];
    if (sql === 'exec ok2') return [{ columns: cols('t'), rows: [['SELECT 2' + '\r\nGO\r\n']] }];
    return [];
  });
  const r = await customGenScript(db, store, ['exec ok1', 'exec ok2', 'exec none'], true);
  assert.equal(r.text, 'SELECT 1\r\nGO\r\nSELECT 2\r\nGO\r\n');
  assert.deepEqual(r.failed, ['exec none']);
});

test('panel SQL: không có SQL tự viết trong web/js/sqlobjects', () => {
  const dir = path.join(extRoot, 'web', 'js', 'sqlobjects');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/\b(SELECT|INSERT|UPDATE|DELETE)\b\s+\w+.*\bFROM\b/i.test(src.replace(/\/\/.*$/gm, '')), `${f} có SQL`);
  }
});
