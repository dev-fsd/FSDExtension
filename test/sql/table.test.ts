import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';
import { errorLine52, cleanProcedure, formatServerError, splitBatches52 } from '../../src/core/sql/queryRunner';
import { ScriptStore } from '../../src/core/sql/scriptStore';
import type { RawSet, SqlDb } from '../../src/core/sql/sqlSession';
import { describeColumn, toCell, type ColumnInfo } from '../../src/core/sql/sqlTypes';
import { getLogTableName, getLegacyLogTableName, getLogDataType } from '../../src/core/sql/logTable';
import { objectScript, xtypeName } from '../../src/core/sql/sqlObjects';
import {
  alterNullScript,
  buildSelectSql,
  columnScript,
  dataScript,
  dataScriptToSink,
  literal,
  logTargets,
  rowsScript,
  runSave,
  saveStatements,
  sqlLiteral,
  tableInfo
} from '../../src/core/sql/tableOps';

// out-test/test/sql → thư mục gốc extension
const scripts = new ScriptStore(path.join(__dirname, '..', '..', '..', 'resources', 'scripts'));

const col = (name: string, clr: string, type = '', scale?: number): ColumnInfo => ({ name, clr, type, scale });

/** SqlDb giả: trả bảng kết quả theo điều kiện trên câu SQL. */
function fakeDb(handlers: Array<[RegExp, RawSet[]]>, log: string[] = []): SqlDb {
  return {
    async query(sql: string): Promise<RawSet[]> {
      log.push(sql);
      for (const [re, res] of handlers) if (re.test(sql)) return res;
      return [];
    }
  };
}

test('script system.db đã xuất đủ và đọc được', () => {
  for (const id of ['GETFULLCOL', 'QUERYPARTITION', 'SELECTPARTITION', 'ALTERFIELDNULL', 'SCRIPTADDCOLUMN', 'SCRIPTADDCOLUMN$', 'SCRIPTALTERCOLUMN', 'SCRIPTALTERCOLUMN$',
    'SCRIPTDROPCOLUMN', 'SCRIPTDROPCOLUMN$', 'DROPOBJECT', 'GETSCRIPTGENDEL', 'GETTABLEVIEW', 'GETTABLESCRIPT']) {
    assert.ok(scripts.get(id).length > 10, id);
  }
  assert.throws(() => scripts.get('KHONGCO'), /Thiếu script KHONGCO/);
});

test('splitBatches52 + errorLine52: dòng 0-based; lỗi trong store tính từ đầu batch tạo nó', () => {
  const sql = 'SELECT 1\nGO\n-- chú thích\nCREATE PROC dbo.p_x AS\nSELECT 1\nSELECT bad\nGO\nEXEC p_x';
  const b = splitBatches52(sql);
  assert.deepEqual(b.map((x) => x.startLine), [0, 2, 7]);
  // lỗi trực tiếp dòng 2 của batch 2 → dòng 3 của văn bản
  assert.equal(errorLine52(b, b[1], undefined, 2), 3);
  // lỗi trong p_x chạy từ batch 3, dòng 4 tính từ đầu batch CREATE (có dòng chú thích) → startLine 2 + 4 - 1
  assert.equal(errorLine52(b, b[2], 'p_x', 4), 5);
  assert.equal(errorLine52(b, b[2], 'p_khac', 4), -1);
  assert.equal(errorLine52(b, b[0], undefined, 0), -1);
  assert.equal(cleanProcedure('#p_____________00036CFE'), '#p');
  assert.equal(
    formatServerError({ number: 156, class: 15, state: 1, procName: 'p_x', lineNumber: 3, message: 'Incorrect syntax' }),
    'Msg 156, Level 15, State 1, p_x, Line 3: Incorrect syntax'
  );
  assert.equal(
    formatServerError({ number: 102, class: 15, state: 1, lineNumber: 1, message: 'x' }),
    'Msg 102, Level 15, State 1, Line 1: x'
  );
});

test('describeColumn + toCell: kiểu .NET và giá trị ô như QueryService.Cell', () => {
  const intN = describeColumn({ colName: 'a', type: { name: 'IntN' }, dataLength: 8 });
  assert.deepEqual([intN.type, intN.clr], ['bigint', 'System.Int64']);
  const dec = describeColumn({ colName: 'b', type: { name: 'DecimalN' }, scale: 2 });
  assert.equal(toCell(12.5, dec), '12.50');
  const money = describeColumn({ colName: 'm', type: { name: 'MoneyN' }, dataLength: 8 });
  assert.equal(toCell(3, money), '3.0000');
  const dt = describeColumn({ colName: 'd', type: { name: 'DateTimeN' }, dataLength: 8 });
  assert.equal(toCell(new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 6)), dt), '2026-01-02 03:04:05.006');
  const bit = describeColumn({ colName: 'f', type: { name: 'BitN' } });
  assert.equal(toCell(true, bit), true);
  assert.equal(toCell(null, bit), null);
  const bin = describeColumn({ colName: 'x', type: { name: 'VarBinary' } });
  assert.equal(toCell(Buffer.from([1, 171]), bin), '0x01AB');
  const guid = describeColumn({ colName: 'g', type: { name: 'UniqueIdentifier' } });
  assert.equal(toCell('ABCD', guid), 'abcd');
  const big = describeColumn({ colName: 'n', type: { name: 'BigInt' } });
  assert.equal(toCell('12', big), 12);
  assert.equal(toCell('9007199254740993', big), '9007199254740993');
});

test('buildSelectSql: thường, tự viết, bảng chia kỳ (không lỗi với "$" trong tên bảng)', () => {
  assert.equal(buildSelectSql(scripts, { fields: '', table: 'dmkh', where: '' }), 'SELECT * FROM dmkh');
  assert.equal(buildSelectSql(scripts, { fields: 'ma_kh', table: 'dmkh', where: "ma_kh = 'A'" }), "SELECT ma_kh FROM dmkh WHERE ma_kh = 'A'");
  assert.equal(buildSelectSql(scripts, { where: '\\ SELECT 1 ' }), 'SELECT 1');
  const q = buildSelectSql(scripts, { where: "\\select * from m81$000000 where a='x'", partition: true, dfrom: '2026-01-01', dto: '2026-12-31' });
  assert.match(q, /set @strsql = N'select \* from m81\$%Partition where a=''x'''/);
  assert.match(q, /'20260101', '20261231'/);
  const p = buildSelectSql(scripts, { fields: '*', table: 'm81$000000', where: "so_ct = 'a'", partition: true, dfrom: '2026-01-01', dto: '2026-12-31' });
  assert.match(p, /select \* into #data FROM m81\$000000/);
  assert.match(p, /from m81\$%Partition with\(nolock\) where %\[so_ct = ''a''\]%/);
});

test('columnScript: thêm cột thường (GO + UPDATE giá trị rỗng) kèm bảng log', () => {
  const s = columnScript(scripts, 'add', 'dmkh', false, [{ name: 'ghi_chu', type: 'nvarchar(50)' }, { name: 'sl', type: 'numeric(18,2)' }], ['dmkh$log'], '', '');
  const lines = s.split('\r\n');
  assert.match(lines[0], /^IF NOT EXISTS\(SELECT 1 FROM syscolumns/);
  assert.ok(s.includes("name = 'ghi_chu')\n\tALTER TABLE dmkh ADD ghi_chu NVARCHAR(50)"));
  assert.ok(s.includes('ALTER TABLE [dmkh$log] ADD [ghi_chu] NVARCHAR(50)'));
  assert.ok(s.includes("GO\r\nUPDATE dmkh SET ghi_chu = '' WHERE ghi_chu IS NULL\r\nUPDATE dmkh SET sl = 0 WHERE sl IS NULL"));
  assert.ok(!s.endsWith('\r\n'));
});

test('columnScript: bảng chia kỳ dùng script $ và GO giữa các cột', () => {
  const s = columnScript(scripts, 'add', 'm81$000000', true, [{ name: 'a', type: 'int' }, { name: 'b', type: 'nvarchar(10)' }], [], '2026-01-01', '2026-12-31');
  assert.ok(s.includes('ALTER TABLE m81$000000 ADD a INT'));
  assert.ok(s.includes('update m81$%Partition set a = 0 where'));
  assert.ok(s.includes("set b = '''' where"));
  assert.equal(s.split('\r\nGO\r\n').length, 2);
  const d = columnScript(scripts, 'drop', 'm81$000000', true, [{ name: 'a', type: 'int' }], ['m81$log'], '', '');
  assert.ok(d.endsWith('GO'));
  assert.ok(d.includes('DROP COLUMN [a]'));
});

test('alterNullScript + tên bảng log', () => {
  assert.ok(alterNullScript(scripts, ' dmkh ').includes("SELECT @cTable ='dmkh'"));
  assert.equal(getLogTableName('m46$'), 'm46$log');
  assert.equal(getLogTableName('dmkh'), 'dmkh$log');
  assert.equal(getLegacyLogTableName('m52$'), 'm52log');
  assert.equal(getLogDataType('NVARCHAR(50) NOT NULL DEFAULT 1'), 'NVARCHAR(50)');
  assert.deepEqual(logTargets('m81$000000', true), { base: 'm81$000000'.replace('000000', '') + '000000', targets: ['m81$log', 'm81log'] });
  assert.equal(logTargets('dmkh$log', false), null);
  assert.equal(logTargets('', false), null);
});

test('saveStatements: DELETE / UPDATE cột đổi / INSERT bỏ ô null; thiếu khóa chính → lỗi', () => {
  const columns = [col('ma', 'System.String'), col('sl', 'System.Decimal'), col('ok', 'System.Boolean'), col('ten', 'System.String')];
  const list = saveStatements({
    table: 'dm ',
    pk: ['MA'],
    columns,
    deleted: [['X', '1', false, null]],
    updated: [{ row: ['A', '5', true, "O'K"], orig: ['A', '5', false, null] }, { row: ['B', '1', true, 'x'], orig: ['B', '1', true, 'x'] }],
    added: [['N', '2.5', true, null], [null, null, null, null]]
  });
  assert.deepEqual(list, [
    "DELETE FROM dm WHERE ma = N'X'",
    "UPDATE dm SET ok = 1, ten = N'O''K' WHERE ma = N'A'",
    "INSERT INTO dm (ma, sl, ok) VALUES (N'N', 2.5, 1)"
  ]);
  assert.throws(() => saveStatements({ table: 'dm', pk: ['khong'], columns, deleted: [], updated: [], added: [] }), /khóa chính/);
  assert.equal(saveStatements({ table: 'dm', pk: ['ma'], columns, deleted: [[null, 1, 0, 0]], updated: [], added: [] })[0], 'DELETE FROM dm WHERE ma IS NULL');
});

test('runSave: UPDATE không trúng dòng nào → lỗi; INSERT 0 dòng thì thôi; không báo số dòng thì qua', async () => {
  const counts = [1, 0];
  await assert.rejects(runSave(['UPDATE a', 'DELETE b'], async () => counts.shift()), /Không có dòng nào khớp[\s\S]*DELETE b/);
  await runSave(['INSERT x'], async () => 0);
  await runSave(['UPDATE a'], async () => undefined);
});

test('literal: theo kiểu .NET của cột', () => {
  assert.equal(literal(null, 'System.String'), 'NULL');
  assert.equal(literal('abc', 'System.Int32'), "N'abc'");
  assert.equal(literal('12.50', 'System.Decimal'), '12.50');
  assert.equal(literal(3, 'System.Int64'), '3');
  assert.equal(literal(true, 'System.Boolean'), '1');
  assert.equal(literal('0xAB', 'System.Byte[]'), '0xAB');
  assert.equal(literal('2026-01-01 00:00:00.000', 'System.DateTime'), "'2026-01-01 00:00:00.000'");
});

test('sqlLiteral: ConvertTextSQL — chuỗi cắt khoảng trắng cuối, ngày không mili giây, null → NULL', () => {
  assert.equal(sqlLiteral("O'K  ", col('a', 'System.String')), "N'O''K'");
  assert.equal(sqlLiteral(12.5, col('a', 'System.Decimal', '', 2)), '12.50');
  assert.equal(sqlLiteral(true, col('a', 'System.Boolean')), '1');
  assert.equal(sqlLiteral(new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 999)), col('a', 'System.DateTime')), "'20260102 03:04:05'");
  const minDate = new Date(0);
  minDate.setUTCFullYear(1, 0, 1);
  minDate.setUTCHours(0, 0, 0, 0);
  assert.equal(sqlLiteral(minDate, col('a', 'System.DateTime')), 'NULL');
  assert.equal(sqlLiteral(null, col('a', 'System.Int32')), 'NULL');
});

const dataSet: RawSet = {
  columns: [col('ma', 'System.String'), col('sl', 'System.Decimal', '', 2), col('anh', 'System.Byte[]'), col('ngay', 'System.DateTime')],
  rows: [['A ', 1.5, Buffer.from([1]), new Date(Date.UTC(2026, 4, 6))], ['B', null, null, null]]
};

test('dataScript: DELETE + INSERT có [cột], bỏ cột nhị phân, CRLF', async () => {
  const db = fakeDb([[/SELECT \* FROM dm WHERE/, [dataSet]]]);
  const s = await dataScript(db, 'dm', 'ma > 0');
  assert.equal(
    s,
    "DELETE FROM dm WHERE ma > 0\r\n" +
      "INSERT INTO dm([ma], [sl], [ngay]) VALUES(N'A', 1.50, '20260506 00:00:00')\r\n" +
      "INSERT INTO dm([ma], [sl], [ngay]) VALUES(N'B', NULL, NULL)\r\n"
  );
  assert.ok((await dataScript(db, 'dm', '  ')).startsWith('DELETE FROM dm WHERE 1=1'));
});

test('dataScriptToSink: bản ghi file — cột trần, mỗi INSERT một dòng mới', async () => {
  const db = fakeDb([[/SELECT \* FROM dm/, [dataSet]]]);
  let out = '';
  await dataScriptToSink(db, 'dm', undefined, { write: (t) => { out += t; } });
  assert.equal(out, "DELETE FROM dm WHERE 1=1\r\nINSERT INTO dm(ma, sl, ngay) VALUES(N'A', 1.50, '20260506 00:00:00')\r\nINSERT INTO dm(ma, sl, ngay) VALUES(N'B', NULL, NULL)");
});

test('rowsScript: chỉ cột có trong bảng, giữ thứ tự cột của lưới', async () => {
  const db = fakeDb([[/WHERE 1 = 0/, [{ columns: [col('ma', ''), col('SL', '')], rows: [] }]]]);
  const s = await rowsScript(db, {
    table: 'dm ',
    where: 'ma <> 0',
    columns: [{ name: 'sl', clr: 'System.Decimal' }, { name: 'la', clr: 'System.String' }, { name: 'ma', clr: 'System.String' }],
    rows: [['3', 'x', 'A'], [null, 'y', "B'"]]
  });
  assert.equal(s, "DELETE FROM dm WHERE ma <> 0\r\nINSERT INTO dm (sl, ma) VALUES (3, N'A')\r\nINSERT INTO dm (sl, ma) VALUES (NULL, N'B''')\r\n");
});

test('tableInfo: cột từ GETFULLCOL, bảng chia kỳ + khoảng ngày; DB không có sysgendata → không chia kỳ', async () => {
  const cols: RawSet = {
    columns: [col('pkey', ''), col('val', ''), col('type', '')],
    rows: [[true, 'ma_kh ', 'nvarchar(16)'], [false, 'ten', 'nvarchar(max)']]
  };
  const ok = fakeDb([
    [/INFORMATION_SCHEMA/, [cols]],
    [/FROM sysgendata/, [{ columns: [col('c', '')], rows: [[1]] }]],
    [/FROM dmstt/, [{ columns: [col('a', ''), col('b', '')], rows: [[new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 11, 31))]] }]]
  ]);
  assert.deepEqual(await tableInfo(ok, scripts, 'm81$000000'), {
    columns: [{ name: 'ma_kh', type: 'nvarchar(16)', pkey: true }, { name: 'ten', type: 'nvarchar(max)', pkey: false }],
    partition: true,
    dfrom: '2026-01-01',
    dto: '2026-12-31'
  });
  const noSys: SqlDb = {
    async query(sql) {
      if (/sysgendata/.test(sql)) throw new Error('Invalid object name');
      return [cols];
    }
  };
  const r = await tableInfo(noSys, scripts, 'x');
  assert.equal(r.partition, false);
  assert.equal(r.columns.length, 2);
});

test('objectScript: store → DROP + GO + CREATE; alter → ALTER; quotedOff; bảng kỳ thêm khối đăng ký', async () => {
  const helptext: RawSet = { columns: [col('Text', '')], rows: [['/* c */ CREATE PROC p AS\r\n'], ['SELECT 1\r\n']] };
  const db = fakeDb([
    [/COUNT\(1\) FROM sysobjects/, [{ columns: [col('n', '')], rows: [[0]] }]],
    [/sp_helptext/, [helptext]],
    [/SELECT xtype FROM sysobjects/, [{ columns: [col('x', '')], rows: [['P ']] }]]
  ]);
  const drop = await objectScript(db, scripts, 'p');
  assert.equal(
    drop,
    "IF EXISTS (SELECT 1 FROM sysobjects WHERE name = 'p' AND OBJECTPROPERTY(id, 'IsEncrypted') = 0) DROP PROCEDURE p\r\nGO\r\n/* c */ CREATE PROC p AS\r\nSELECT 1\r\n\r\nGO\r\n"
  );
  const alter = await objectScript(db, scripts, 'p', { alter: true, quotedOff: true });
  assert.equal(alter, '--SET QUOTED_IDENTIFIER OFF\r\n--GO\r\nALTER PROC p AS\r\nSELECT 1\r\n\r\nGO\r\n');
  assert.equal(xtypeName('fn'), 'FUNCTION');
  assert.equal(xtypeName('SQ'), '');

  const tbl = fakeDb([
    [/COUNT\(1\) FROM sysobjects/, [{ columns: [col('n', '')], rows: [[1]] }]],
    [/CREATE TABLE|DECLARE @cTable/, [{ columns: [col('val', '')], rows: [['CREATE TABLE t(\r\n)\r\n']] }]],
    [/FROM sysgendata/, [{ columns: ['primetable', 'refprimetable', 'primefilegroup', 'type', 'status'].map((n) => col(n, '')), rows: [['m81$', 'r', 'FG', 1, 'A']] }]]
  ]);
  const t = await objectScript(tbl, scripts, 'm81$000000');
  assert.ok(t.startsWith("-- IF EXISTS (SELECT 1 FROM sysobjects WHERE name = 'm81$000000' AND xtype = 'U') DROP TABLE [m81$000000]\r\nCREATE TABLE t("));
  assert.ok(t.includes("GO\r\n\r\n-- Tạo bảng kỳ\r\nDECLARE @d1 SMALLDATETIME"));
  assert.ok(t.includes("EXEC FastBusiness$App$Dynamic$AddTable 'm81$000000', 'm81$', 'r', 'FG$', 1, @d1, @d2, 1"));
  assert.ok(t.endsWith('GO\r\n'));
});
