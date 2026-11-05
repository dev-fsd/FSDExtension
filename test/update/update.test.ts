import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { findCategory, UPDATE_FILE_TYPES } from '../../src/core/update/catalog';
import { createPackage, packageFolders, type ScriptSource } from '../../src/core/update/create';
import { contentDeclareScripts } from '../../src/core/update/declareSql';
import { searchFiles } from '../../src/core/update/fileSearch';
import { loadUpdFiles, menuStem, saveUpdFile } from '../../src/core/update/menuPackages';
import { endsWithGo, memoOf, UpdatePackage } from '../../src/core/update/package';
import { PackagePaths, type PathEnv } from '../../src/core/update/packagePaths';
import { decodeUpd, parseUpd, serializeUpd } from '../../src/core/update/updFile';

const NL = '\r\n';

/** Mẫu theo đúng định dạng DataSet.WriteXml của 5.1 / 5.2 (CRLF, `<x />`, cột DBNull bị bỏ, escape & < >). */
const SAMPLE =
  `<?xml version="1.0" standalone="yes"?>${NL}<NewDataSet>${NL}` +
  `  <Table1>${NL}    <sView>Store: A$B (CREATE)</sView>${NL}    <sDB>App</sDB>${NL}    <sType>S00</sType>${NL}    <sValue>A$B</sValue>${NL}    <sysSqlCode />${NL}    <appSqlCode />${NL}    <type>Store</type>${NL}    <name>A$B</name>${NL}  </Table1>${NL}` +
  `  <Table1>${NL}    <sView>SELECT * FROM options WHERE name = 'x' AND a &lt;&gt; 1 &amp; 2</sView>${NL}    <sDB>App</sDB>${NL}    <sType>O</sType>${NL}    <sTbl>options</sTbl>${NL}    <sKey>name = 'x'</sKey>${NL}  </Table1>${NL}` +
  `  <Table1>${NL}    <sView>File: \\\\srv\\Pro\\App_Data\\Controllers\\Dir\\PVTran.f</sView>${NL}    <sDB />${NL}    <sType>X</sType>${NL}    <sValue>PVTran.f</sValue>${NL}    <sUrl>\\\\srv\\Pro\\App_Data\\Controllers\\Dir\\</sUrl>${NL}    <sUrlSaveTo>\\\\srv\\Pro\\App_Data\\Controllers\\Dir\\</sUrlSaveTo>${NL}  </Table1>${NL}` +
  `  <Table2>${NL}    <AppSQL>IF 1 = 1${NL}\tALTER TABLE t ADD c INT${NL}GO${NL}</AppSQL>${NL}    <SysSQL />${NL}  </Table2>${NL}</NewDataSet>`;

const noPaths = new PackagePaths({ webSource: '', webProgramDir: '', mobileDir: '', updateDir: '', fbProgramDir: '' });
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-upd-'));

test('.upd: parse → serialize giữ đúng từng byte', () => {
  const c = parseUpd(SAMPLE);
  assert.equal(c.rows.length, 3);
  assert.equal(c.rows[1].sView, "SELECT * FROM options WHERE name = 'x' AND a <> 1 & 2");
  assert.equal(c.rows[0].sUrl, undefined);
  assert.equal(c.rows[2].sDB, '');
  assert.equal(c.appSql, `IF 1 = 1${NL}\tALTER TABLE t ADD c INT${NL}GO${NL}`);
  assert.equal(c.sysSql, '');
  assert.equal(serializeUpd(c), SAMPLE);
});

test('.upd: Load → Save vòng tròn qua đĩa (UTF-8 không BOM)', () => {
  const dir = tmp();
  const f = path.join(dir, '01.00.00_USER_20261104_demo.upd');
  fs.writeFileSync(f, SAMPLE, 'utf8');
  const p = new UpdatePackage();
  const r = loadUpdFiles(p, [f], false, noPaths, '');
  assert.equal(r.memo, 'demo');
  assert.equal(p.filePath, f);
  const out = path.join(dir, 'out.upd');
  saveUpdFile(p, out);
  assert.deepEqual(fs.readFileSync(out), fs.readFileSync(f));
  assert.notEqual(fs.readFileSync(out)[0], 0xef);
});

test('.upd thật (nếu truy cập được): Load → Save ra đúng như file gốc', () => {
  const real = '\\\\172.168.5.14\\CustomerUpdate\\UpdateFiles\\AEQN\\01.00.00_DATNH_20260701_101.upd';
  let buf: Buffer;
  try {
    buf = fs.readFileSync(real);
  } catch {
    return; // không có share trên máy này
  }
  assert.equal(serializeUpd(parseUpd(decodeUpd(buf))), buf.toString('utf8'));
});

test('addCategory: bỏ trùng, S → S+alter+quoted, V lấy mã thứ 2', () => {
  const p = new UpdatePackage();
  const store = findCategory('Store')!;
  assert.equal(p.addCategory(store, 'zc_a', true, false, 'zc_a', 'P'), '');
  assert.equal(p.rows[0].sType, 'S10');
  assert.equal(p.rows[0].sView, 'Store: zc_a (ALTER)');
  assert.equal(p.addCategory(store, 'ZC_A', false, false, 'zc_a', 'P'), 'Đã có ZC_A trong gói.');
  assert.equal(p.addCategory(store, ' ', false, false, undefined, undefined), 'Chưa nhập mã.');
  const v = findCategory('VOUCHER')!;
  assert.equal(p.addCategory(v, 'PN1', false, false, 'PN1', '', 'PNTran'), '');
  assert.equal(p.rows[1].sValue, 'PN1,PNTran');
  assert.equal(p.rows[1].sType, 'V');
  assert.equal(p.addCategory(v, 'pn1', false, false, 'PN1', ''), 'Đã có pn1 trong gói.');
  // Bảng cùng tên khác nhóm loại (T) không coi là trùng với Store.
  assert.equal(p.addCategory(findCategory('Table App')!, 'zc_a', false, false, 'zc_a', 'U'), '');
});

test('addDataRow / addExplorerObject / addDeclare / appendOtherSql bỏ trùng đúng', () => {
  const p = new UpdatePackage();
  const gen = 'SELECT * FROM %tbl WHERE %key';
  assert.equal(p.addDataRow('dmvt', '', false, gen), true);
  assert.equal(p.rows[0].sKey, '1=1');
  assert.equal(p.rows[0].sView, 'SELECT * FROM dmvt WHERE 1=1');
  assert.equal(p.addDataRow('DMVT', ' 1=1 ', false, gen), false);
  assert.equal(p.addDataRow('dmvt', '1=1', true, gen), true);
  assert.equal(p.addExplorerObject('zc_x', 'P', true), true);
  assert.equal(p.rows[2].sView, 'Store: zc_x (CREATE) [Sys]');
  assert.equal(p.addExplorerObject('zc_x', 'P', false), false);
  assert.equal(p.addExplorerObject('t1', 'U', false), true);
  assert.equal(p.rows[3].sType, 'T');
  assert.equal(p.addExplorerObject('v1', 'XX', false), false);
  p.addDeclare('App', 'dmct', "(ma_ct = 'PN1')");
  assert.equal(p.rows[4].sValue, 'dmct');
  p.appendOtherSql(false, 'SELECT 1');
  p.appendOtherSql(false, 'SELECT 2');
  assert.equal(p.otherAppSql, `SELECT 1${NL}GO${NL}SELECT 2`);
  assert.equal(endsWithGo('abc\r\n-- c\r\nGO -- x\r\n'), true);
  assert.equal(endsWithGo('GOTO x'), false);
  p.removeAt([0, 99, 0]);
  assert.equal(p.rows.length, 4);
});

test('load gộp: bỏ dòng trùng, Other SQL không nối lặp', () => {
  const dir = tmp();
  const f = path.join(dir, 'a.upd');
  fs.writeFileSync(f, SAMPLE, 'utf8');
  const p = new UpdatePackage();
  loadUpdFiles(p, [f], false, noPaths, '');
  const r = loadUpdFiles(p, [f], true, noPaths, '');
  assert.equal(r.skipped, 3);
  assert.equal(p.rows.length, 3);
  assert.equal(p.otherAppSql.split('ALTER TABLE').length - 1, 1);
});

test('memoOf / menuStem', () => {
  assert.equal(memoOf('01.00.00_HUYNLV_20261104_yc_64.upd'), 'yc_64');
  assert.equal(memoOf('x.upd'), '');
  assert.equal(menuStem('D:\\U\\', 'PRJ', 'HUYNLV', '06.01.01', 'm', new Date(2026, 10, 4)), 'D:\\U\\PRJ\\06.01.01_HUYNLV_20261104_m');
});

test('contentDeclareScripts: chèn #val theo danh sách mã', () => {
  assert.deepEqual(contentDeclareScripts('  '), []);
  const s = contentDeclareScripts("PN1, PX'1");
  assert.equal(s.length, 2);
  assert.ok(s[0]!.includes("insert into #val values('PN1')"));
  assert.ok(s[1]!.includes("insert into #val values('PX1')"));
});

test('PackagePaths: phân loại Web / MobileApp / FB / Other, đổi folder tương đối', () => {
  const env: PathEnv = {
    dirExists: (p) => p.toLowerCase() === 'd:\\p\\web\\app_data\\controllers',
    fileExists: (p) => p.toLowerCase() === 'd:\\p\\web\\main\\a.aspx',
    subDirs: () => [],
    reachable: () => true
  };
  const pp = new PackagePaths({ webSource: 'D:\\P\\Web', webProgramDir: '', mobileDir: '', updateDir: 'D:\\U', fbProgramDir: 'D:\\FB\\Prog' }, env);
  assert.equal(pp.webRoot, 'D:\\P\\Web\\');
  assert.equal(pp.mobileRoot, 'D:\\P\\MobileApp\\');
  assert.equal(pp.otherRoot, 'D:\\P\\');
  assert.equal(pp.savePath('D:\\P\\Web\\Main\\a.aspx'), 'Web\\Main\\a.aspx');
  assert.equal(pp.savePath('D:\\P\\MobileApp\\App_Data\\x.xml'), 'MobileApp\\App_Data\\x.xml');
  assert.equal(pp.savePath('D:\\FB\\Prog\\x.exe'), 'x.exe');
  assert.equal(pp.savePath('D:\\P\\Other\\y.txt'), 'Other\\Other\\y.txt');
  assert.equal(pp.absoluteFolder('App_Data\\Controllers\\Dir\\', ''), 'D:\\P\\Web\\App_Data\\Controllers\\Dir\\');
  assert.equal(pp.absoluteFolder('MobileApp\\Main\\', ''), 'D:\\P\\MobileApp\\Main\\');
  assert.equal(pp.findSource('Main\\', 'a.aspx', ''), 'D:\\P\\Web\\Main\\a.aspx');
});

test('addFile chọn loại theo folder + đuôi', () => {
  const env: PathEnv = { dirExists: () => true, fileExists: () => true, subDirs: () => [], reachable: () => true };
  const pp = new PackagePaths({ webSource: 'D:\\P\\Web', webProgramDir: '', mobileDir: '', updateDir: '', fbProgramDir: '' }, env);
  const p = new UpdatePackage();
  const full = 'D:\\P\\Web\\App_Data\\Controllers\\Dir\\PVTran.f';
  assert.equal(p.addFile(full, UPDATE_FILE_TYPES, pp, () => true), '');
  assert.equal(p.rows[0].sView, 'Dir File: PVTran.f');
  assert.equal(p.rows[0].sUrl, 'D:\\P\\Web\\App_Data\\Controllers\\Dir\\');
  assert.equal(p.addFile(full, UPDATE_FILE_TYPES, pp, () => true), 'Đã có trong gói.');
  assert.match(p.addFile('D:\\x.f', UPDATE_FILE_TYPES, pp, () => false), /Không có file/);
});

test('createPackage: sinh script UTF-16, copy file, Other SQL, dọn thư mục rỗng, báo thiếu', async () => {
  const root = tmp();
  const web = path.join(root, 'Web');
  fs.mkdirSync(path.join(web, 'App_Data', 'Controllers', 'Dir'), { recursive: true });
  fs.writeFileSync(path.join(web, 'App_Data', 'Controllers', 'Dir', 'A.f'), 'x');
  const paths = new PackagePaths({ webSource: web, webProgramDir: '', mobileDir: '', updateDir: '', fbProgramDir: '' });
  const p = new UpdatePackage();
  p.addExplorerObject('zc_x', 'P', false);
  p.addDataRow('dmvt', '1=1', false, 'SELECT * FROM %tbl WHERE %key');
  p.addFileRow(UPDATE_FILE_TYPES.find((t) => t.sText === 'Dir'), path.join(web, 'App_Data', 'Controllers', 'Dir'), 'A.f');
  p.addFileRow(UPDATE_FILE_TYPES.find((t) => t.sText === 'Dir'), path.join(web, 'App_Data', 'Controllers', 'Dir'), 'Missing.f');
  p.addCategory(findCategory('Store')!, 'zc_bad', false, false, 'zc_bad', 'P');
  p.otherAppSql = 'SELECT 1';
  const source: ScriptSource = {
    async objectScript(_db, name) {
      if (name === 'zc_bad') throw new Error('Invalid object');
      return `-- obj ${name}${NL}GO${NL}`;
    },
    async insertScript(_db, table, key) {
      return `DELETE FROM ${table} WHERE ${key}${NL}GO${NL}`;
    },
    async scalar() {
      return '';
    }
  };
  const out = tmp();
  const r = await createPackage(p, {
    workingDir: out, folderName: 'pkg_', paths, programPath: web, source,
    scripts: { folderUpdate: '1Script,1Rpt,0Images,1Script\\App,1Script\\Sys', updateSysFile: '\\Script\\Sys\\01.GenSQL_sys', updateAppFile: '\\Script\\App\\01.GenSQL_app', getExe: '', getRpt: '' }
  });
  assert.ok(r.folder.endsWith('pkg_'));
  assert.deepEqual(r.files.sort(), ['Script\\App\\00.OtherSQL_app.sql', 'Script\\App\\01.GenSQL_app.sql', 'Web\\App_Data\\Controllers\\Dir\\A.f'].sort());
  assert.ok(r.missing.some((m) => m.includes('Missing.f')));
  assert.ok(r.missing.some((m) => m.includes('Invalid object')));
  const sql = fs.readFileSync(path.join(r.folder, 'Script', 'App', '01.GenSQL_app.sql'));
  assert.deepEqual([...sql.subarray(0, 2)], [0xff, 0xfe]);
  assert.ok(sql.subarray(2).toString('utf16le').includes('-- obj zc_x'));
  // Trùng tên folder (không exact) → thêm yyMMdd_HHmmss.
  const r2 = await createPackage(p, {
    workingDir: out, folderName: 'pkg_', paths, programPath: web, source, now: new Date(2026, 10, 4, 9, 8, 7),
    scripts: { folderUpdate: '1Script', updateSysFile: '\\Script\\Sys\\01.GenSQL_sys', updateAppFile: '\\Script\\App\\01.GenSQL_app', getExe: '', getRpt: '' }
  });
  assert.ok(r2.folder.endsWith('pkg_261104_090807'));
  assert.deepEqual(packageFolders('1Script,0Images,1Rpt'), ['Script', 'Rpt']);
});

test('searchFiles: tên gần đúng / đúng tên, gợi ý thư mục, ưu tiên .f hơn .xml, nội dung', async () => {
  const root = tmp();
  const dir = path.join(root, 'App_Data', 'Controllers', 'Dir');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(root, 'App_Data', 'Controllers', 'Grid'), { recursive: true });
  for (const n of ['SVTran.f', 'SVTran.xml', 'SVTranX.f']) fs.writeFileSync(path.join(dir, n), 'hello zcmarker');
  fs.writeFileSync(path.join(root, 'App_Data', 'Controllers', 'Grid', 'SVTran.f'), 'g');
  const base = { root, mode: 'fb' as const, scoped: false };
  const exact = await searchFiles({ ...base, text: 'SVTran', exact: true });
  assert.deepEqual(exact.map((r) => r.full).sort(), ['App_Data\\Controllers\\Dir\\SVTran.f', 'App_Data\\Controllers\\Grid\\SVTran.f']);
  const fuzzy = await searchFiles({ ...base, text: 'SVTran', exact: false });
  assert.equal(fuzzy.length, 3);
  const hint = await searchFiles({ ...base, text: 'Grid\\SVTran', exact: true });
  assert.deepEqual(hint.map((r) => r.folder), ['App_Data\\Controllers\\Grid\\']);
  const xml = await searchFiles({ ...base, text: 'Dir\\SVTran.xml', exact: true });
  assert.deepEqual(xml.map((r) => r.name), ['SVTran.xml']);
  const content = await searchFiles({ ...base, text: 'ZCMARKER', content: true });
  assert.equal(content.length, 2);
  await assert.rejects(searchFiles({ ...base, root: path.join(root, 'none'), text: 'a' }));
});
