// Kiểm toán nguồn SQL (docs/extension/sql-source-audit.md): SQL chạy xuống DB phải lấy từ system.db của FSD Studio,
// hoặc (khi system.db không có) khớp chuỗi VB gốc của 5.1 / 5.2. Test đọc system.db và mã VB ở repo cha, CHỈ ĐỌC; thiếu file thì bỏ qua.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { contentDeclareScripts, SQL_OBJECTS_QUERY } from '../../src/core/update/declareSql';
import { UPDATE_CATEGORIES, UPDATE_FILE_TYPES } from '../../src/core/update/catalog';
import { xtypeName, listObjects, listColumns, getDefinition, searchObjects } from '../../src/core/sql/sqlObjects';
import { addColumnSql, alterColumnSql, dropColumnSql, getLogDataType, isLogOfSql, reorderColumnsSql, statusSql } from '../../src/core/sql/logTable';
import { sqlLiteral } from '../../src/core/sql/tableOps';
import { fromBasket } from '../../src/core/update/packageStore';
import type { RawSet, SqlDb, SqlParams } from '../../src/core/sql/sqlSession';

const extRoot = path.resolve(__dirname, '..', '..', '..');
const repoRoot = path.resolve(extRoot, '..');
const SYSTEM_DB = process.env.FSD_SYSTEM_DB || 'D:\\SOFT\\FSDStudio\\system.db';
const NORM = (s: string): string => s.replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').trim();

type Row = Record<string, string>;

/** Bản copy system.db đọc bằng sql.js (không ghi): tên bảng → dòng. */
async function readSystemDb(): Promise<((q: string) => Row[]) | undefined> {
  if (!fs.existsSync(SYSTEM_DB)) return undefined;
  const bytes = fs.readFileSync(SYSTEM_DB);
  const initSqlJs = require('sql.js') as (cfg?: object) => Promise<import('sql.js').SqlJsStatic>;
  const wasm = fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'));
  const SQL = await initSqlJs({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) });
  const db = new SQL.Database(new Uint8Array(bytes));
  return (q: string): Row[] => {
    const r = db.exec(q)[0];
    if (!r) return [];
    return r.values.map((v) => Object.fromEntries(r.columns.map((c, i) => [c, v[i] == null ? '' : String(v[i])])));
  };
}

function vbText(rel: string): string | undefined {
  const f = path.join(repoRoot, ...rel.split('/'));
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n') : undefined;
}

// ===================== system.db =====================

test('resources/scripts khớp bảng script của system.db (chỉ khác EOL / khoảng trắng cuối dòng)', async () => {
  const q = await readSystemDb();
  if (!q) return;
  const db = new Map(q('SELECT id, script FROM script').map((r) => [r.id, r.script]));
  const dir = path.join(extRoot, 'resources', 'scripts');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
    const id = f.slice(0, -4);
    assert.ok(db.has(id), `system.db thiếu script ${id}`);
    const local = fs.readFileSync(path.join(dir, f), 'utf8').replace(/^﻿/, '');
    assert.equal(NORM(local), NORM(db.get(id) as string), `script ${id} lệch system.db`);
  }
});

test('catalog updatecategory / updatefile khớp system.db, thứ tự như 5.2 (ORDER BY sText)', async () => {
  const q = await readSystemDb();
  if (!q) return;
  const cats = q('SELECT * FROM updatecategory ORDER BY sText');
  assert.deepEqual(UPDATE_CATEGORIES.map((c) => c.sText), cats.map((c) => c.sText));
  for (const d of cats) {
    const t = UPDATE_CATEGORIES.find((c) => c.sText === d.sText) as unknown as Row;
    for (const k of ['sType', 'sView', 'sDatabase', 'sGetSysID', 'sGetSysID2', 'sysSqlCode', 'appSqlCode']) {
      assert.equal(NORM(t[k]), NORM(d[k]), `${d.sText}.${k}`);
    }
  }
  const files = q("SELECT * FROM updatefile WHERE sView NOT LIKE 'zzz%'");
  assert.deepEqual(UPDATE_FILE_TYPES.map((c) => c.sText), files.map((c) => c.sText));
  for (const d of files) {
    const t = UPDATE_FILE_TYPES.find((c) => c.sText === d.sText) as unknown as Row;
    for (const k of ['sType', 'sView', 'sUrl', 'sExt', 'sUrlSaveTo']) assert.equal(t[k], d[k], `${d.sText}.${k}`);
  }
});

test('xtypeName khớp bảng xtypeobjects của system.db', async () => {
  const q = await readSystemDb();
  if (!q) return;
  for (const r of q('SELECT xtype, ctext FROM xtypeobjects')) assert.equal(xtypeName(r.xtype), r.ctext.trim(), r.xtype);
});

test('fromBasket dùng script GETSCRIPTGEN được truyền (không tự gõ)', () => {
  const p = fromBasket({ items: [{ kind: 'data', table: 'dmkh', key: "ma_kh='A'", db: 'app' }], otherAppSql: '', otherSysSql: '' } as never, 'SELECT * FROM %tbl WHERE %key -- gen');
  assert.equal(p.rows[0].sView, "SELECT * FROM dmkh WHERE ma_kh='A' -- gen");
});

// ===================== VB 5.2: UpdateExplorer / SqlObjectService =====================

test('Content Declare + SQL Explorer khớp UpdateExplorer.vb (5.2)', () => {
  const vb = vbText('FSDStudio52/Features/Update/UpdateExplorer.vb');
  if (!vb) return;
  const get = (name: string): string => (new RegExp(`Const ${name} As String = "\\n?([\\s\\S]*?)"\\n\\n?(?:\\s*Private|End Class)`).exec(vb) as RegExpExecArray)[1].replace(/""/g, '"');
  const key = "insert into #val values('K1')\n";
  const [app, sys] = contentDeclareScripts('K1') as [string, string];
  assert.equal(NORM(app), NORM(get('AppDeclareSql').replace('|KeySearch|', key)));
  assert.equal(NORM(sys), NORM(get('SysDeclareSql').replace('|KeySearch|', key)));
  assert.equal(
    SQL_OBJECTS_QUERY,
    "select name, rtrim(type) type, case when type = 'u' then 'tables' when type in ('v') then 'views' else 'stores - functions - triggers' end as tp from sys.objects where type in ('u', 'v', 'p', 'tr', 'fn', 'tf') order by tp, modify_date desc"
  );
});

test('SQL của panel đối tượng khớp SqlObjectService.vb (5.2)', async () => {
  const vb = vbText('FSDStudio52/Services/SqlObjectService.vb');
  if (!vb) return;
  // Gom các literal "..." của một khối VB thành một chuỗi (bỏ " & _ " nối dòng).
  const lit = (block: string): string => [...block.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"')).join('');
  const seen: string[] = [];
  const db: SqlDb = {
    query(sql: string, _p?: SqlParams): Promise<RawSet[]> {
      seen.push(sql);
      return Promise.resolve([{ columns: [], rows: [] }]);
    }
  };
  await listObjects(db);
  await listColumns(db, 'x');
  await getDefinition(db, 'x', 'd');
  await searchObjects(db, 'col', 'a');
  await searchObjects(db, 'content', 'a');
  const objects = lit((/Const sql As String = "SELECT name, RTRIM[\s\S]*?ORDER BY name"/.exec(vb) as RegExpExecArray)[0]);
  const columns = lit((/Const sql As String = "SELECT c\.name[\s\S]*?ORDER BY c\.column_id"/.exec(vb) as RegExpExecArray)[0]);
  const defn = lit((/Const sql As String = "SELECT o\.name, RTRIM\(o\.type\), OBJECT_DEFINITION[^\n]*/.exec(vb) as RegExpExecArray)[0]);
  const searchCol = lit((/"SELECT DISTINCT o\.name[\s\S]*?ORDER BY o\.name"/.exec(vb) as RegExpExecArray)[0]);
  const searchContent = lit((/"SELECT o\.name, RTRIM\(o\.type\), o\.modify_date FROM sys\.sql_modules[\s\S]*?RTRIM\(o\.type\), o\.name"/.exec(vb) as RegExpExecArray)[0]);
  assert.deepEqual(seen, [objects, columns, defn, searchCol, searchContent]);
});

// ===================== VB 5.1: LogTableScript.vb =====================

/** Đổi biểu thức VB (literal, vbTab, NewLine, +) sang JS rồi chạy. */
function evalVbExpr(expr: string, scope: Record<string, unknown>): unknown {
  const parts: string[] = [];
  const rx = /"((?:[^"]|"")*)"|vbTab|NewLine|[A-Za-z_]\w*|\+|\(|\)|,|\s+/g;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = rx.exec(expr)) !== null) {
    if (m.index !== last) throw new Error('Không đổi được biểu thức VB: ' + expr.slice(last, m.index + 20));
    last = rx.lastIndex;
    const t = m[0];
    if (m[1] !== undefined) parts.push(JSON.stringify(m[1].replace(/""/g, '"')));
    else if (t === 'vbTab') parts.push('"\\t"');
    else if (t === 'NewLine') parts.push('"\\r\\n"');
    else if (/^\s+$/.test(t)) parts.push(' ');
    else parts.push(t);
  }
  const names = Object.keys(scope);
  return new Function(...names, 'return ' + parts.join('') + ';')(...names.map((n) => scope[n]));
}

/** Gom dòng VB thành các câu: dòng kết thúc bằng + (nối tiếp ngầm) dính với dòng sau. */
function vbStatements(block: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const raw of block.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith("'")) continue;
    cur += (cur === '' ? '' : ' ') + line;
    if (!/[+&]$/.test(line)) {
      out.push(cur);
      cur = '';
    }
  }
  return out;
}

const lit = (v: string): string => v.trim().replace(/'/g, "''");
const quote = (v: string): string => '[' + v.trim().replace(/]/g, ']]') + ']';

function vbLogTable(vb: string): {
  logGuard: () => string;
  addColumn: (a: string, b: string, c: string) => string;
  alterColumn: (a: string, b: string, c: string) => string;
  dropColumn: (a: string, b: string) => string;
  isLogOf: (a: string, b: string) => string;
  status: (a: string, b: string) => string;
  reorder: (a: string, b: string, sel: boolean) => string;
} {
  const fn = (header: RegExp): string => {
    const m = header.exec(vb);
    if (!m) throw new Error('Không thấy ' + header);
    const rest = vb.slice(m.index + m[0].length);
    return rest.slice(0, rest.search(/\n\s*End (Function|Sub)/));
  };
  const retExpr = (header: RegExp, scope: Record<string, unknown>): unknown => {
    const stmts = vbStatements(fn(header));
    const r = stmts.find((s) => s.startsWith('Return '));
    return evalVbExpr((r as string).slice(7), scope);
  };
  const guard = (): string => retExpr(/Private Shared Function LogGuardCondition\(\) As String/, {}) as string;
  const sc = { Lit: lit, Quote: quote, GetLogDataType: getLogDataType, LogGuardCondition: guard };
  // Chạy thân Sub / Function dạng lines.Add(...) và gọi Append*.
  const runLines = (body: string, vars: Record<string, unknown>, lines: string[]): void => {
    for (const s of vbStatements(body)) {
      let m = /^lines\.Add\((.*)\)$/.exec(s);
      if (m) {
        let e = m[1];
        const ifm = /^If\(selectResult, ("(?:[^"]|"")*"), ("(?:[^"]|"")*")\)$/.exec(e);
        if (ifm) {
          lines.push((vars.selectResult ? evalVbExpr(ifm[1], {}) : evalVbExpr(ifm[2], {})) as string);
          continue;
        }
        e = e.replace(/\bindent\b/g, 'indent');
        lines.push(evalVbExpr(e, { ...sc, ...vars }) as string);
        continue;
      }
      m = /^AppendOrderBlock\(lines, (.*)\)$/.exec(s);
      if (m) {
        runLines(fn(/Private Shared Sub AppendOrderBlock[^\n]*/), { indent: evalVbExpr(m[1], {}) }, lines);
        continue;
      }
      if (/^AppendDeclare\(lines, baseTable, logTable\)$/.test(s)) {
        runLines(fn(/Private Shared Sub AppendDeclare[^\n]*/), vars, lines);
        continue;
      }
      if (/^Dim lines|^Return String\.Join/.test(s)) continue;
      throw new Error('Câu VB chưa hỗ trợ: ' + s);
    }
  };
  const build = (header: RegExp, vars: Record<string, unknown>): string => {
    const lines: string[] = [];
    runLines(fn(header), vars, lines);
    return lines.join('\r\n');
  };
  const f3 = (name: string) => (a: string, b: string, c: string): string =>
    retExpr(new RegExp(`Public Shared Function ${name}\\(ByVal logTable As String, ByVal column As String(?:, ByVal dataType As String)?\\) As String`), { ...sc, logTable: a, column: b, dataType: c }) as string;
  return {
    logGuard: guard,
    addColumn: f3('AddColumn'),
    alterColumn: f3('AlterColumn'),
    dropColumn: (a, b) => f3('DropColumn')(a, b, ''),
    isLogOf: (a, b) => {
      const body = fn(/Public Shared Function IsLogOf[^\n]*/);
      const stmts = vbStatements(body);
      const d = stmts.find((s) => s.startsWith('Dim sql As String = ')) as string;
      return evalVbExpr(d.slice('Dim sql As String = '.length), { ...sc, baseTable: a, logTable: b }) as string;
    },
    status: (a, b) => build(/Public Shared Function StatusSql[^\n]*/, { baseTable: a, logTable: b }),
    reorder: (a, b, sel) => build(/Public Shared Function ReorderColumns[^\n]*/, { baseTable: a, logTable: b, selectResult: sel })
  };
}

test('LogTable: chuỗi SQL sinh ra khớp LogTableScript.vb (5.1)', () => {
  const vb = vbText('FSDStudioSrc/Features/LogTable/LogTableScript.vb');
  if (!vb) return;
  const v = vbLogTable(vb);
  const t = "m46$'x";
  assert.equal(addColumnSql(t + 'log', "c'1", ' NVARCHAR(50) NOT NULL DEFAULT 1'), v.addColumn(t + 'log', "c'1", ' NVARCHAR(50) NOT NULL DEFAULT 1'));
  assert.equal(alterColumnSql('m46$log', 'ma_kh', 'DECIMAL(18,2)'), v.alterColumn('m46$log', 'ma_kh', 'DECIMAL(18,2)'));
  assert.equal(dropColumnSql('m46$log', 'ma_kh'), v.dropColumn('m46$log', 'ma_kh'));
  assert.equal(isLogOfSql('m46$000000', 'm46$log'), v.isLogOf('m46$000000', 'm46$log'));
  assert.equal(statusSql('m46$000000', 'm46$log'), v.status('m46$000000', 'm46$log'));
  assert.equal(reorderColumnsSql('m46$000000', 'm46$log', true), v.reorder('m46$000000', 'm46$log', true));
  assert.equal(reorderColumnsSql('dmkh', 'dmkh$log', false), v.reorder('dmkh', 'dmkh$log', false));
});

// ===================== SqlS.ConvertTextSQL =====================

test('sqlLiteral: chuỗi chỉ cắt dấu cách cuối như VB RTrim (giữ tab / xuống dòng)', () => {
  const col = { name: 'a', type: 'nvarchar', clr: 'System.String' };
  assert.equal(sqlLiteral('ab \u3000 ', col), "N'ab'");
  assert.equal(sqlLiteral('ab\t', col), "N'ab\t'");
  assert.equal(sqlLiteral('ab\r\n', col), "N'ab\r\n'");
});
