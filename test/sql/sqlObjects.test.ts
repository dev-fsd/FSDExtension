import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchObjects } from '../../src/core/sql/sqlObjects';
import type { RawSet, SqlDb, SqlParams } from '../../src/core/sql/sqlSession';

/** DB giả: ghi lại câu SQL + tham số, trả bảng kết quả dựng sẵn. */
function fakeDb(rows: unknown[][]): SqlDb & { calls: Array<{ sql: string; params?: SqlParams }> } {
  const calls: Array<{ sql: string; params?: SqlParams }> = [];
  return {
    calls,
    query(sql: string, params?: SqlParams): Promise<RawSet[]> {
      calls.push({ sql, params });
      return Promise.resolve([{ columns: [], rows }]);
    }
  };
}

test('searchObjects col: chỉ SELECT bảng, tham số @k có %…% và escape "["', async () => {
  const db = fakeDb([['dmkh', 'U', new Date(Date.UTC(2026, 0, 2, 3, 4, 5))]]);
  const r = await searchObjects(db, 'col', '  ma[kh ');
  assert.deepEqual(r, [{ name: 'dmkh', type: 'U', modified: '2026-01-02 03:04:05' }]);
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /^SELECT DISTINCT/);
  assert.match(db.calls[0].sql, /o\.type = 'U'/);
  assert.match(db.calls[0].sql, /c\.name LIKE @k/);
  assert.deepEqual(db.calls[0].params, { k: '%ma[[]kh%' });
  // Không nối chuỗi người dùng vào câu SQL.
  assert.ok(!db.calls[0].sql.includes('ma[kh'));
});

test('searchObjects content: tìm trong sys.sql_modules, mode khác "col" đều là content', async () => {
  const db = fakeDb([]);
  const r = await searchObjects(db, 'content', "o'brien");
  assert.deepEqual(r, []);
  assert.match(db.calls[0].sql, /sys\.sql_modules/);
  assert.match(db.calls[0].sql, /m\.definition LIKE @k/);
  assert.deepEqual(db.calls[0].params, { k: "%o'brien%" });
  assert.ok(!db.calls[0].sql.includes("o'brien"));
});

test('searchObjects: text rỗng / null không ném lỗi', async () => {
  const db = fakeDb([]);
  await searchObjects(db, 'col', undefined as unknown as string);
  assert.deepEqual(db.calls[0].params, { k: '%%' });
});
