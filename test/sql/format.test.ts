import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatJson, formatSql, formatText, formatXml } from '../../src/core/sql/format';

test('formatJson: thụt tab, giữ nguyên số và chuỗi; lỗi → trả nguyên văn', () => {
  assert.equal(formatJson('{"a":1.0,"b":[1,2],"c":{},"d":[],"e":"x,y:z"}'), '{\r\n\t"a": 1.0,\r\n\t"b": [\r\n\t\t1,\r\n\t\t2\r\n\t],\r\n\t"c": {},\r\n\t"d": [],\r\n\t"e": "x,y:z"\r\n}');
  assert.equal(formatJson('{sai'), '{sai');
  assert.equal(formatJson('  '), '  ');
});

test('formatXml: thụt 2 dấu cách, <a/> → <a />, bỏ khai báo, chữ giữ một dòng, nhiều gốc', () => {
  assert.equal(
    formatXml("<?xml version='1.0'?><r a='1'><x>t</x><y/><z><k>1</k></z><!-- c --></r>"),
    '<r a="1">\r\n  <x>t</x>\r\n  <y />\r\n  <z>\r\n    <k>1</k>\r\n  </z>\r\n  <!-- c -->\r\n</r>'
  );
  assert.equal(formatXml('<a><b/></a><c/>'), '<a>\r\n  <b />\r\n</a>\r\n<c />');
  assert.equal(formatXml('<a><b></a>'), '<a><b></a>');
});

test('formatSql: xuống dòng trước FROM / WHERE, AND thụt 2 tab, từ khóa HOA; không đụng chuỗi và identifier', () => {
  const out = formatSql("select a, b from dmkh where ma = 'x from' and ten like 'a%' order by a");
  assert.equal(out, "SELECT a, b\r\n\tFROM dmkh\r\n\tWHERE ma = 'x from'\r\n\t\tAND ten LIKE 'a%'\r\n\tORDER BY a");
});

test('formatSql: BETWEEN AND giữ cùng dòng; hàm dính ngoặc; trong ngoặc không xuống dòng', () => {
  const out = formatSql('select count(*) from t where a between 1 and 2 and b in (select x from y where z = 1)');
  assert.equal(out, 'SELECT count(*)\r\n\tFROM t\r\n\tWHERE a BETWEEN 1 AND 2\r\n\t\tAND b IN (SELECT x FROM y WHERE z = 1)');
});

test('formatSql: nhiều câu, BEGIN/END thụt tab, IF ... ELSE', () => {
  const out = formatSql('declare @a int set @a = 1 if @a = 1 begin select 1 end else select 2');
  assert.equal(out, 'DECLARE @a INT\r\nSET @a = 1\r\nIF @a = 1\r\nBEGIN\r\n\tSELECT 1\r\nEND\r\n\r\nELSE\r\nSELECT 2'.replace('\r\n\r\nELSE', '\r\nELSE'));
});

test('formatSql: store nhiều tham số → mỗi tham số một dòng; SQL trong XML viết thường; có GO hoặc ngoặc lệch → nguyên văn', () => {
  assert.equal(formatSql('create procedure p @a int, @b varchar(10) as select 1'), 'CREATE PROCEDURE p\r\n\t@a INT,\r\n\t@b VARCHAR(10)\r\nAS\r\nSELECT 1');
  assert.equal(formatText('sql', '<q>SELECT 1 FROM t</q>').startsWith('<q>'), true);
  assert.equal(formatSql('SELECT 1 FROM t', false), 'select 1\r\n\tfrom t');
  const withGo = 'select 1\nGO\nselect 2';
  assert.equal(formatSql(withGo), withGo);
  assert.equal(formatSql('select (1'), 'select (1');
  assert.equal(formatSql("select 'a"), "select 'a");
});

test('formatText: chọn theo mode', () => {
  assert.equal(formatText('json', '[1]'), '[\r\n\t1\r\n]');
  assert.equal(formatText('xml', '<a><b/></a>'), '<a>\r\n  <b />\r\n</a>');
  assert.equal(formatText('sql', ''), '');
});
