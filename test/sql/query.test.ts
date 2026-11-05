import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { bracketName, listTablesSql, loadAppDatabases, parseAppDatabases, quoteTable } from '../../src/core/sql/appDatabases';
import { formatCell, RecordsetCollector, sourceLine } from '../../src/core/sql/queryRunner';
import { assertSelectOnly } from '../../src/core/sql/sqlClient';
import { detectWrites, splitBatches } from '../../src/core/sql/sqlText';

test('splitBatches: tách theo dòng GO, không phân biệt hoa thường, nhớ dòng đầu của batch', () => {
  const b = splitBatches('SELECT 1\nGO\nselect 2\n  go  \n\nSELECT 3');
  assert.deepEqual(b.map((x) => x.text), ['SELECT 1', 'select 2', '\nSELECT 3']);
  assert.deepEqual(b.map((x) => x.line), [1, 3, 5]);
});

test('splitBatches: CRLF, GO kèm số lần hoặc comment, batch rỗng bị bỏ', () => {
  const b = splitBatches('A\r\nGO 3\r\n\r\nGO\r\nB\r\nGO -- hết\r\n');
  assert.deepEqual(b.map((x) => x.text), ['A', 'B']);
  assert.deepEqual(b.map((x) => x.line), [1, 5]);
});

test('splitBatches: GO trong chuỗi nhiều dòng hoặc comment khối không phải dấu tách; GO cùng dòng với lệnh thì không', () => {
  const sql = "PRINT 'a\nGO\nb'\n/* chú thích\nGO\n*/\nSELECT 1\nGOTO x\nSELECT go FROM t";
  const b = splitBatches(sql);
  assert.equal(b.length, 1);
  assert.equal(b[0].text, sql);
});

test('splitBatches: văn bản trống → không batch', () => {
  assert.deepEqual(splitBatches(''), []);
  assert.deepEqual(splitBatches('  \nGO\n  '), []);
});

test('detectWrites: các từ khóa ghi', () => {
  assert.deepEqual(detectWrites('SELECT 1'), []);
  assert.deepEqual(detectWrites('insert into t values (1)'), ['INSERT']);
  assert.deepEqual(detectWrites('UPDATE t SET a=1; DELETE FROM t; update t set b=2'), ['UPDATE', 'DELETE']);
  assert.deepEqual(detectWrites('drop table t; alter table t add c int; truncate table t'), ['DROP', 'ALTER', 'TRUNCATE']);
  assert.deepEqual(detectWrites('exec sp_who'), ['EXEC']);
  assert.deepEqual(detectWrites('EXECUTE dbo.zc_x; exec zc_y'), ['EXEC']);
});

test('detectWrites: CREATE, USE, SELECT INTO, gọi store không có EXEC', () => {
  assert.deepEqual(detectWrites('create table t (a int)'), ['CREATE']);
  assert.deepEqual(detectWrites('USE db2\nGO\nSELECT 1'), ['USE']);
  assert.deepEqual(detectWrites('SELECT * INTO t2 FROM t'), ['SELECT INTO']);
  assert.deepEqual(detectWrites('merge into t using s on 1=1 when matched then delete;'), ['MERGE', 'DELETE']);
  assert.deepEqual(detectWrites("zc_XoaHet 'a'"), ['EXEC']);
  assert.deepEqual(detectWrites('SELECT 1\nGO\ndbo.zc_XoaHet'), ['EXEC']);
  assert.deepEqual(detectWrites('DECLARE @a int = 1\nSELECT @a\nFETCH NEXT FROM c INTO @a'), []);
});

test('detectWrites: bỏ qua comment, chuỗi, tên trong ngoặc, biến và tên có tiền tố', () => {
  assert.deepEqual(detectWrites("SELECT 'delete from t' AS s -- update t\n/* drop table x */"), []);
  assert.deepEqual(detectWrites('SELECT [update], "delete" FROM t'), []);
  assert.deepEqual(detectWrites('SELECT @update, t.delete, #drop, update_x, exec_count FROM t'), []);
  assert.deepEqual(detectWrites("SELECT * FROM t WHERE a = 'x''' + ' insert '"), []);
  assert.deepEqual(detectWrites('exec sp_executesql N\'select 1\''), ['EXEC']);
  assert.deepEqual(detectWrites('SELECT 1 /* x */ ; -- ok\nUPDATE t SET a = 1'), ['UPDATE']);
});

test('formatCell: null, số, ngày giờ, nhị phân, bigint', () => {
  assert.equal(formatCell(null), null);
  assert.equal(formatCell(undefined), null);
  assert.equal(formatCell('abc '), 'abc ');
  assert.equal(formatCell(12.5), 12.5);
  assert.equal(formatCell(true), 1);
  assert.equal(formatCell(BigInt('9007199254740993')), '9007199254740993');
  const d = new Date(Date.UTC(2026, 10, 4, 8, 5, 9, 7));
  assert.equal(formatCell(d, 'DateTime'), '2026-11-04 08:05:09.007');
  assert.equal(formatCell(d, 'Date'), '2026-11-04');
  assert.equal(formatCell(d, 'Time'), '08:05:09.007');
  assert.equal(formatCell(Buffer.from([1, 0xab])), '0x01ab');
  assert.equal(String(formatCell(Buffer.alloc(70, 1))).endsWith('…'), true);
  assert.equal(formatCell(new Date(NaN)), null);
});

test('RecordsetCollector: cắt ở maxRows nhưng vẫn đếm tổng và báo đã cắt', () => {
  const c = new RecordsetCollector(3);
  c.start([{ name: 'a', type: 'Int' }]);
  for (let i = 0; i < 5; i++) c.add([i]);
  c.start([{ name: 'b', type: 'Int' }]);
  c.add([9]);
  assert.equal(c.sets.length, 2);
  assert.deepEqual(c.sets[0].rows, [[0], [1], [2]]);
  assert.equal(c.sets[0].total, 5);
  assert.equal(c.sets[0].truncated, true);
  assert.equal(c.sets[1].total, 1);
  assert.equal(c.sets[1].truncated, false);
  // chưa có metadata thì bỏ qua, không ném lỗi
  assert.equal(new RecordsetCollector().add([1]), 0);
});

test('sourceLine: dòng gốc = dòng đầu batch + dòng trong batch - 1; lỗi trong store thì 0', () => {
  assert.equal(sourceLine(10, 1, undefined), 10);
  assert.equal(sourceLine(10, 3, ''), 12);
  assert.equal(sourceLine(10, 3, 'zc_x'), 0);
  assert.equal(sourceLine(10, 0, undefined), 0);
  assert.equal(sourceLine(10, undefined, undefined), 0);
});

test('parseAppDatabases / loadAppDatabases: DB App theo script GETLISTDATAAPP, dòng đầu là mặc định', async () => {
  assert.deepEqual(parseAppDatabases([{ val: ' ICDTN_APP ' }, { val: '' }, { val: 'icdtn_app' }, { val: 'ICDTN_B' }]), ['ICDTN_APP', 'ICDTN_B']);
  const calls: string[] = [];
  const ok = { query: async (sql: string) => (calls.push(sql), [{ val: 'DB1' }, { val: 'DB2' }]) } as never;
  assert.deepEqual(await loadAppDatabases(ok, '﻿SELECT RTRIM(cdata) AS val FROM entity ORDER BY code'), ['DB1', 'DB2']);
  assert.equal(calls[0], 'SELECT RTRIM(cdata) AS val FROM entity ORDER BY code');
  // bảng cũ không có cột cdata → thử lại với data (như 5.1)
  const old: string[] = [];
  const legacy = {
    query: async (sql: string) => {
      old.push(sql);
      if (sql.includes('cdata')) throw new Error('Invalid column name');
      return [{ val: 'OLD' }];
    }
  } as never;
  assert.deepEqual(await loadAppDatabases(legacy, 'SELECT RTRIM(cdata) AS val FROM entity ORDER BY code'), ['OLD']);
  assert.equal(old.length, 2);
  assert.ok(old[1].includes('RTRIM(data)'));
});

test('listTablesSql / quoteTable: câu liệt kê là SELECT-only, tên DB và bảng được quote đúng', () => {
  assertSelectOnly(listTablesSql('ICDTN_APP'));
  assertSelectOnly(listTablesSql('weird]db'));
  assert.ok(listTablesSql('weird]db').includes('[weird]]db].sys.objects'));
  assert.equal(bracketName('a]b'), '[a]]b]');
  assert.equal(quoteTable('dbo', 'dmkh'), 'dmkh');
  assert.equal(quoteTable('', 'm11$202401'), 'm11$202401');
  assert.equal(quoteTable('dbo', 'Bang Co Dau Cach'), '[Bang Co Dau Cach]');
  assert.equal(quoteTable('hr', 'nv'), 'hr.nv');
});
