import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import { cellValue, kindOf, parseDateWall, writeWorkbook } from '../../src/core/basket/excelExport';
import { buildSchemaSet, buildXsd, encodeXmlName, frxMessage, parseXml, syncFrx } from '../../src/core/basket/reportSchema';

const set = (): ReturnType<typeof buildSchemaSet> =>
  buildSchemaSet('ds', [
    { name: 'd1', columns: [{ name: 'ma_vt', clr: 'System.String' }, { name: 'so_luong', clr: 'System.Decimal' }, { name: 'ma_vt', clr: 'System.Int32' }, { name: 'x y', clr: 'Lạ' }] },
    { name: 'd2', columns: [{ name: 'ngay', clr: 'System.DateTime' }, { name: 'ok', clr: 'System.Boolean' }] }
  ]);

test('buildSchemaSet: cột trùng tên thành x1, kiểu lạ thành String, bảng trùng báo lỗi', () => {
  const s = set();
  assert.deepEqual(s.tables[0].columns.map((c) => c.name), ['ma_vt', 'so_luong', 'ma_vt1', 'x y']);
  assert.equal(s.tables[0].columns[3].clr, 'System.String');
  assert.throws(() => buildSchemaSet('ds', [{ name: 'd1', columns: [] }, { name: 'D1', columns: [] }]), /đã có/);
});

test('buildXsd: cấu trúc DataSet.WriteXmlSchema', () => {
  const xsd = buildXsd(set());
  assert.ok(xsd.startsWith('<?xml version="1.0" standalone="yes"?>\r\n<xs:schema id="ds"'));
  assert.ok(xsd.includes('<xs:element name="d1">'));
  assert.ok(xsd.includes('<xs:element name="so_luong" type="xs:decimal" minOccurs="0" />'));
  assert.ok(xsd.includes('<xs:element name="ngay" type="xs:dateTime" minOccurs="0" />'));
  assert.ok(xsd.includes('<xs:element name="x_x0020_y" type="xs:string" minOccurs="0" />'));
  assert.ok(xsd.endsWith('</xs:schema>'));
  assert.equal(encodeXmlName('1a'), '_x0031_a');
});

test('syncFrx: file mới có khung + Dictionary đủ bảng / cột', () => {
  const { text, result } = syncFrx(undefined, set());
  assert.equal(result.isNewFile, true);
  assert.deepEqual(result.addedTables, ['d1', 'd2']);
  const root = parseXml(text);
  assert.equal(root.name, 'Report');
  assert.ok(text.includes('<XmlDataConnection Name="Connection">'));
  assert.ok(text.includes('<Column Name="so_luong" DataType="System.Decimal"/>'));
  assert.ok(text.includes('<ReportPage Name="Page1" Watermark.Font="Arial, 60pt"/>'));
  assert.match(frxMessage(result, 'a.frx'), /^Đã tạo mới: a\.frx\nThêm bảng: d1, d2\nThêm cột: /);
});

test('syncFrx: file có sẵn — chỉ đổi Dictionary, giữ phần còn lại, giữ cột Calculated, bỏ cột thừa', () => {
  const before =
    '<?xml version="1.0" encoding="utf-8"?>\r\n<Report ScriptLanguage="CSharp" ReportInfo.Created="1/1/2026 00:00:00">\r\n' +
    '  <Dictionary>\r\n    <XmlDataConnection Name="Connection">\r\n      <TableDataSource Name="d1" DataType="System.Int32" Enabled="true" TableName="d1">\r\n' +
    '        <Column Name="ma_vt" DataType="System.Int32" Custom="keep"/>\r\n        <Column Name="cu" DataType="System.String"/>\r\n' +
    '        <Column Name="tong" DataType="System.Decimal" Calculated="true" Expression="[d1.a]"/>\r\n      </TableDataSource>\r\n    </XmlDataConnection>\r\n' +
    '    <Parameter Name="P1" DataType="System.String"/>\r\n  </Dictionary>\r\n  <ReportPage Name="Page1">\r\n    <TextObject Name="Text1" Text="a &amp; b"/>\r\n  </ReportPage>\r\n</Report>\r\n';
  const { text, result } = syncFrx(before, set());
  assert.deepEqual(result.addedTables, ['d2']);
  assert.deepEqual(result.removedColumns, ['d1.cu']);
  assert.ok(result.addedColumns.includes('d1.so_luong'));
  // Phần ngoài Dictionary giữ nguyên từng byte.
  assert.ok(text.startsWith(before.slice(0, before.indexOf('  <Dictionary>'))));
  assert.ok(text.endsWith(before.slice(before.indexOf('</Dictionary>') + '</Dictionary>'.length)));
  assert.ok(text.includes('<Column Name="ma_vt" DataType="System.String" Custom="keep"/>'));
  assert.ok(text.includes('<Parameter Name="P1" DataType="System.String"/>'));
  assert.ok(text.indexOf('Name="tong"') > text.indexOf('Name="x y"'));
  assert.ok(!text.includes('Name="cu"'));
  // Chạy lại → không đổi.
  const again = syncFrx(text, set());
  assert.equal(again.text, text);
  assert.match(frxMessage(again.result, 'a.frx'), /Cấu trúc không đổi\.$/);
});

test('syncFrx: không có Dictionary thì chèn sau <Report>; không phải Report thì lỗi', () => {
  const { text } = syncFrx('<Report A="1">\n  <ReportPage Name="P"/>\n</Report>', set());
  assert.ok(text.startsWith('<Report A="1">\n  <Dictionary>'));
  assert.ok(text.includes('<ReportPage Name="P"/>'));
  assert.throws(() => syncFrx('<Foo/>', set()), /FastReport/);
});

test('excel: kindOf / cellValue / parseDateWall', () => {
  assert.equal(kindOf('System.Int64'), 'int');
  assert.equal(kindOf('System.Single'), 'dec');
  assert.equal(kindOf(undefined), 'str');
  assert.equal(cellValue('int', null), 0);
  assert.equal(cellValue('dec', '12.5'), 12.5);
  assert.equal(cellValue('bool', 'true'), 1);
  assert.equal(cellValue('bool', null), 0);
  assert.equal(cellValue('str', '  ab '), 'ab');
  assert.equal(cellValue('str', null), '');
  assert.equal(cellValue('date', 'không phải ngày'), '');
  assert.equal(parseDateWall('2026-03-05T07:08:09')?.toISOString(), '2026-03-05T07:08:09.000Z');
  assert.equal(parseDateWall('05/03/2026')?.toISOString(), '2026-03-05T00:00:00.000Z');
});

test('writeWorkbook: ghi xlsx đọc lại được — 5 dòng đầu, tiêu đề, dữ liệu', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-xlsx-'));
  try {
    const file = path.join(dir, 'b.xlsx');
    await writeWorkbook(
      {
        title: ' Báo cáo ',
        columns: [{ name: 'Mã', clr: 'System.String', width: 70 }, { name: 'SL', clr: 'System.Int32', width: 50 }, { name: 'Ngày', clr: 'System.DateTime' }, { name: 'OK', clr: 'System.Boolean' }],
        rows: [['A1 ', 3, '2026-01-02T00:00:00', true], ['B', null, null, false]]
      },
      file
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.getWorksheet('Sheet1')!;
    assert.equal(ws.getCell(1, 1).value, 'Fast Software Company');
    assert.equal(ws.getCell(4, 1).value, 'Báo cáo');
    assert.equal(ws.getCell(6, 2).value, 'SL');
    assert.equal(ws.getCell(7, 1).value, 'A1');
    assert.equal(ws.getCell(7, 2).value, 3);
    assert.equal((ws.getCell(7, 3).value as Date).toISOString(), '2026-01-02T00:00:00.000Z');
    assert.equal(ws.getCell(7, 4).value, 1);
    assert.equal(ws.getCell(8, 2).value, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
