import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_MAIN_SCRIPT, buildAutoNew } from '../../src/core/menuedit/autoCommand';
import {
  applyDups, buildDupsApply, buildMainWrite, buildRename, coerceFormValue, findDups, getRow, guardDb, saveMenu,
  type MenuDb, type SaveIO
} from '../../src/core/menuedit/editRepo';
import { wrapBatch } from '../../src/core/menuedit/extWrap';
import { esc, lit, specOf } from '../../src/core/menuedit/spec';
import {
  genSqlInsert, genSqlUpdate, sqlCountById, sqlDupSelect, sqlDupUpdate, sqlMaxMenuId, sqlRenameCommand, sqlRenameWcommand,
  sqlSelectRowById, sqlSetCommandExe, sqlSyncDvcommand
} from '../../src/core/menuedit/sql51';
import type { RawSet } from '../../src/core/sql/sqlSession';
import type { ColumnInfo } from '../../src/core/sql/sqlTypes';

// --- Bản giả DB: mỗi luật = regex khớp câu SQL → các bảng kết quả; ghi lại mọi câu đã chạy ---
const STR = 'System.String';
const col = (name: string, clr = STR): ColumnInfo => ({ name, type: 'x', clr });
function set(cols: Array<string | ColumnInfo>, rows: unknown[][]): RawSet {
  return { columns: cols.map((c) => (typeof c === 'string' ? col(c) : c)), rows };
}
function fakeDb(rules: Array<[RegExp, RawSet[]]>): MenuDb & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    async query(sql: string) {
      log.push(sql);
      for (const [re, sets] of rules) if (re.test(sql)) return sets;
      return [];
    }
  };
}
function fakeIO(confirm = true): SaveIO & { confirmed: Array<{ lines: string[]; sql: string }>; txs: number } {
  const o = {
    sysDb: 'FBO_S',
    confirmed: [] as Array<{ lines: string[]; sql: string }>,
    txs: 0,
    async confirm(lines: string[], sql: string) { o.confirmed.push({ lines, sql }); return confirm; },
    async transaction<T>(fn: () => Promise<T>) { o.txs++; return fn(); }
  };
  return o;
}

// wcommand: 13 cột của form + 2 cột ngoài form (title, datetime0). command có cột trùng (kể cả ngoài form) và exe.
const FORM_W = ['wmenu_id', 'wmenu_id0', 'bar', 'bar2', 'link', 'type', 'sysid', 'syscode', 'menu_id', 'edition', 'expl_icon', 'icon', 'icon_url'];
const WINFO: ColumnInfo[] = [...FORM_W.map((n) => col(n, n === 'expl_icon' ? 'System.Int32' : STR)), col('title'), col('datetime0', 'System.DateTime')];
const CMDINFO: ColumnInfo[] = [...['menu_id', 'menu_id0', 'bar', 'bar2', 'type', 'exe', 'sysid', 'syscode', 'edition'].map((n) => col(n)), col('expl_icon', 'System.Int32'), col('icon'), col('title'), col('datetime0', 'System.DateTime')];
const D0 = new Date(Date.UTC(2026, 0, 1, 10, 20, 30));
const wdata = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  wmenu_id: '03.10.01', wmenu_id0: '03.10.00', bar: 'Phiếu', bar2: 'Voucher', link: 'inctpnd', type: 'V', sysid: 'SVTran', syscode: 'PN', menu_id: '88.01.05', edition: '2',
  expl_icon: 0, icon: '', icon_url: '', title: 'Tiêu đề', datetime0: D0, ...over
});
const wrow = (over: Record<string, unknown> = {}): unknown[] => WINFO.map((c) => wdata(over)[c.name]);
const wset = (over: Record<string, unknown> = {}): RawSet => set(WINFO, [wrow(over)]);
const formValues = (over: Record<string, unknown> = {}): Record<string, unknown> => Object.fromEntries(FORM_W.map((c) => [c, wdata(over)[c]]));

test('spec: form FBO đúng các control Tag=FC của Designer 5.1; lit / esc nhân đôi nháy đơn', () => {
  assert.equal(esc("O'Neil"), "O''Neil");
  assert.equal(lit("O'Neil"), "N'O''Neil'");
  assert.deepEqual(specOf('fbo').fields, FORM_W);
  assert.equal(specOf('mob').table, 'dvcommand');
  assert.equal(specOf('fb').key, 'menu_id');
});

test('sql51: câu dựng đúng chuỗi mẫu rút từ VB (nháy, khoảng trắng, thứ tự)', () => {
  // frmWCommandUpdate.vb:842 / frmCommandUpdate.vb:140 / frmDVCommand.vb:792
  assert.equal(sqlCountById('wcommand', 'wmenu_id', '03.10.01'), "SELECT COUNT(1) FROM wcommand WHERE wmenu_id = '03.10.01'");
  assert.equal(sqlCountById('command', 'menu_id', "A'B"), "SELECT COUNT(1) FROM command WHERE menu_id = 'A''B'");
  // frmMain.vb:6865
  assert.equal(sqlSelectRowById('wcommand', 'wmenu_id', 'X'), "SELECT * FROM wcommand WHERE wmenu_id = 'X'");
  // frmWCommandUpdate.vb:1235 / frmDVCommand.vb:750
  assert.equal(sqlMaxMenuId('command', '88.01.'), "SELECT MAX(menu_id) FROM command WHERE menu_id LIKE '88.01.%'");
  assert.equal(sqlMaxMenuId('dvcommand', 'M1.02.'), "SELECT MAX(menu_id) FROM dvcommand WHERE menu_id LIKE 'M1.02.%'");
  // frmWCommandUpdate.vb:910, 911, 1146, 1194+1200
  assert.equal(sqlRenameCommand('88.01.08', '88.01.05'), "UPDATE command SET menu_id = N'88.01.08' WHERE menu_id = '88.01.05'");
  assert.equal(sqlRenameWcommand('88.01.08', '03.10.01'), "UPDATE wcommand SET menu_id = N'88.01.08' WHERE wmenu_id = '03.10.01'");
  assert.equal(sqlSyncDvcommand('88.01.08', '03.10.01'), "UPDATE dvcommand SET menu_id = N'88.01.08' WHERE wmenu_id = '03.10.01'");
  assert.equal(sqlSetCommandExe('inctpnd 1', '88.01.08'), "UPDATE command SET exe = N'inctpnd 1' WHERE menu_id = '88.01.08'");
  // SqlS.GenSQLInsert / GenSQLUpdate (SqlS.vb:444, 558): cột trần, ", " giữa các cột, giá trị theo ConvertTextSQL
  const cols = [col('wmenu_id'), col('bar'), col('expl_icon', 'System.Int32'), col('datetime0', 'System.DateTime'), col('note')];
  const vals = ['A1', "Tên 'x'  ", 3, D0, null];
  assert.equal(genSqlInsert('wcommand', cols, vals), "INSERT INTO wcommand(wmenu_id, bar, expl_icon, datetime0, note) VALUES(N'A1', N'Tên ''x''', 3, '20260101 10:20:30', NULL)");
  assert.equal(genSqlUpdate('wcommand', cols, vals, "wmenu_id = 'A1'"), "UPDATE wcommand SET wmenu_id = N'A1', bar = N'Tên ''x''', expl_icon = 3, datetime0 = '20260101 10:20:30', note = NULL WHERE wmenu_id = 'A1'");
  // cột nhị phân bị bỏ khỏi UPDATE (GenSQLUpdate:554)
  assert.equal(genSqlUpdate('t', [col('a'), col('b', 'System.Byte[]')], ['x', Buffer.from([1])], 'k = 1'), "UPDATE t SET a = N'x' WHERE k = 1");
});

test('sql51: câu tìm / cập nhật menu trùng đúng chuỗi mẫu frmDuplicateUpdate.vb:59–70, 104', () => {
  // Chuỗi mẫu = nối đúng như getData (mỗi vế là một dòng strSQL +=).
  const mau = (table: string, exe: string, w: string, like: string, sysid: string): string =>
    'SELECT CAST(0 AS BIT) AS tag, ' + w + 'menu_id, ' + w + 'menu_id0, bar AS phan_he, bar, bar2, ' + exe + ' INTO #tmp FROM ' + table +
    ' WHERE (' + exe + " <> '' AND " + exe + " LIKE '" + like + "') OR (sysID = '" + sysid + "')" +
    " UPDATE #tmp SET phan_he = ISNULL(b.bar,'') FROM #tmp a LEFT JOIN " + table + ' b ON LEFT(a.' + w + "menu_id0,2)+'.00.00' = b." + w + 'menu_id SELECT * FROM #tmp';
  assert.equal(sqlDupSelect('wcommand', 'link', 'w', 'zcinctpnd 1', 'SVTran'), mau('wcommand', 'link', 'w', 'inctpnd 1', 'SVTran'));
  assert.equal(sqlDupSelect('wcommand', 'link', 'w', 'inctpnd', 'SVTran'), mau('wcommand', 'link', 'w', 'inctpnd', 'SVTran'));
  assert.equal(sqlDupSelect('command', 'exe', '', 'zc', ''), mau('command', 'exe', '', 'zc', ''));   // "zc" đúng 2 ký tự: không cắt (Length > 2)
  assert.equal(sqlDupSelect('dvcommand', 'action', 'w', '', 'X'), mau('dvcommand', 'action', 'w', '', 'X'));
  assert.equal(
    sqlDupUpdate('wcommand', 'link', 'w', 'Tên (C)', 'EN (C)', 'inctpnd 2', '11.10.07'),
    "UPDATE wcommand SET bar = N'Tên (C)', bar2 = N'EN (C)', link = 'inctpnd 2' WHERE wmenu_id = '11.10.07'"
  );
});

test('extWrap: câu lõi đi nguyên văn vào batch, lớp bọc chỉ thêm câu trước / sau', () => {
  const core = "UPDATE wcommand SET bar = N'x' WHERE wmenu_id = '03.10.01'";
  const sql = buildMainWrite({ spec: specOf('fbo'), mode: 'Edit', oldId: '03.10.01', id: '03.10.09', parent: '03.10.00', idLabel: 'Wmenu_id', core, sysDb: 'FBO_S' });
  const lines = sql.split('\n');
  assert.equal(lines[0], 'SET NOCOUNT ON');
  assert.ok(lines[1].startsWith("IF DB_NAME() <> N'FBO_S'") && lines[1].includes('RETURN'));
  assert.equal(lines[2], "IF NOT EXISTS (SELECT 1 FROM wcommand WHERE wmenu_id = N'03.10.00') BEGIN RAISERROR(N'wmenu_id0 Not Exists!', 16, 1) RETURN END");
  assert.equal(lines[3], "IF EXISTS (SELECT 1 FROM wcommand WHERE wmenu_id = N'03.10.09') BEGIN RAISERROR(N'Wmenu_id Exists!', 16, 1) RETURN END");
  assert.equal(lines[4], core);
  assert.ok(lines[5].startsWith('IF @@ROWCOUNT = 0'));
  assert.equal(lines[6], "SELECT wmenu_id AS id FROM wcommand WHERE wmenu_id = N'03.10.09'");
  assert.equal(lines.length, 7);
  // Giữ nguyên mã: không guard trùng.
  assert.ok(!buildMainWrite({ spec: specOf('fbo'), mode: 'Edit', oldId: 'abc', id: 'ABC', parent: '', idLabel: 'Wmenu_id', core, sysDb: 'S' }).includes('Exists!'));
  // Mới: INSERT không kèm kiểm dòng ảnh hưởng.
  const nw = buildMainWrite({ spec: specOf('fbo'), mode: 'New', oldId: 'abc', id: 'NEW1', parent: '', idLabel: 'Wmenu_id', core: 'INSERT INTO wcommand(a) VALUES(1)', sysDb: 'S' });
  assert.ok(nw.includes('Wmenu_id Exists!') && !nw.includes('@@ROWCOUNT'));
  assert.equal(wrapBatch({ sysDb: 'S', core: [{ sql: 'X' }] }), guardDb('S') + '\nX');
  const r = buildRename('88.01.05', '88.01.08', '03.10.01', 'S');
  assert.ok(r.startsWith(guardDb('S')));
  assert.ok(r.includes(sqlRenameCommand('88.01.08', '88.01.05') + '\n' + sqlRenameWcommand('88.01.08', '03.10.01')));
});

test('coerceFormValue: chữ trên ô → đúng kiểu cột', () => {
  assert.equal(coerceFormValue(' abc', col('a')), ' abc');
  assert.equal(coerceFormValue('', col('n', 'System.Int32')), 0);
  assert.equal(coerceFormValue('12', col('n', 'System.Int16')), 12);
  assert.equal(coerceFormValue('1', col('b', 'System.Boolean')), true);
  assert.equal(coerceFormValue('2.5', col('d', 'System.Decimal')), 2.5);
  assert.throws(() => coerceFormValue('x', col('n', 'System.Int32')), /Cột n phải là số nguyên/);
  assert.throws(() => coerceFormValue('2026', col('d', 'System.DateTime')), /không sửa được/);
});

test('getRow: chỉ cột có thật, giá trị trim; không có dòng → lỗi', async () => {
  const db = fakeDb([[/^SELECT \* FROM wcommand WHERE wmenu_id = 'A'/, [set(['wmenu_id', 'bar', 'zz'], [['A', ' Tên ', 'x']])]]]);
  const r = await getRow(db, 'fbo', 'A');
  assert.deepEqual(r.fields, [{ name: 'wmenu_id', value: 'A' }, { name: 'bar', value: 'Tên' }]);
  await assert.rejects(() => getRow(db, 'fbo', 'KHONG'), /Không có wcommand KHONG/);
});

function fboRules(extra: Array<[RegExp, RawSet[]]> = []): Array<[RegExp, RawSet[]]> {
  return [
    ...extra,
    [/^SELECT \* FROM wcommand WHERE wmenu_id = '03\.10\.01'/, [wset({ bar: 'Tên mới' })]],
    [/^SELECT \* FROM command WHERE 1 = 0/, [set(CMDINFO, [])]],
    [/SELECT wmenu_id AS id FROM wcommand/, [set(['id'], [['03.10.01']])]]
  ];
}

test('saveMenu FBO Sửa (đã có command): UPDATE đúng GenSQLUpdate, đẩy MỌI cột trùng (kể cả ngoài form) + exe, trong 1 transaction', async () => {
  const db = fakeDb(fboRules([
    [/^SELECT COUNT\(1\) FROM wcommand WHERE wmenu_id = '03\.10\.00'/, [set(['n'], [[1]])]],
    [/^SELECT COUNT\(1\) FROM command WHERE menu_id = '88\.01\.05'/, [set(['n'], [[1]])]]
  ]));
  const io = fakeIO();
  const r = await saveMenu(db, { kind: 'fbo', mode: 'Edit', oldId: '03.10.01', values: formValues({ bar: 'Tên mới' }), auto: true }, io);
  assert.equal(r.message, 'Edit Successful');
  assert.equal(r.menu_id, '88.01.05');
  assert.equal(io.txs, 1);
  assert.equal(io.confirmed.length, 1);
  const upd = "UPDATE wcommand SET wmenu_id = N'03.10.01', wmenu_id0 = N'03.10.00', bar = N'Tên mới', bar2 = N'Voucher', link = N'inctpnd', type = N'V', sysid = N'SVTran', syscode = N'PN', menu_id = N'88.01.05', edition = N'2', expl_icon = 0, icon = N'', icon_url = N'' WHERE wmenu_id = '03.10.01'";
  assert.ok(io.confirmed[0].sql.split('\n').includes(upd), io.confirmed[0].sql);
  assert.ok(!db.log.some((s) => s.includes('ff_Dec2Seq')), 'không chạy AUTONEW khi đã có command');
  // PushWCommandRowToCommand: cột trùng giữa dòng wcommand và bảng command (không chỉ cột của form): bar, bar2, type, sysid, syscode, menu_id, edition, expl_icon, icon, title, datetime0.
  const push = db.log.find((s) => s.includes("UPDATE command SET bar = N'Tên mới'"));
  assert.ok(push, 'thiếu câu đẩy cột trùng sang command');
  assert.ok(push.split('\n').includes("UPDATE command SET bar = N'Tên mới', bar2 = N'Voucher', type = N'V', sysid = N'SVTran', syscode = N'PN', menu_id = N'88.01.05', edition = N'2', expl_icon = 0, icon = N'', title = N'Tiêu đề', datetime0 = '20260101 10:20:30' WHERE menu_id = '88.01.05'"), push);
  assert.ok(push.split('\n').includes("UPDATE command SET exe = N'inctpnd' WHERE menu_id = '88.01.05'"), push);
});

test('saveMenu FBO Sửa: không xác nhận → không ghi gì', async () => {
  const db = fakeDb(fboRules([[/^SELECT COUNT\(1\) FROM wcommand WHERE wmenu_id = '03\.10\.00'/, [set(['n'], [[1]])]]]));
  const io = fakeIO(false);
  const r = await saveMenu(db, { kind: 'fbo', mode: 'Edit', oldId: '03.10.01', values: formValues(), auto: false }, io);
  assert.equal(r.cancelled, true);
  assert.equal(io.txs, 0);
  assert.ok(!db.log.some((s) => /UPDATE|INSERT/.test(s)));
});

test('saveMenu: cha không có / mã trùng / Menu_id trống → dừng, không hỏi, không ghi', async () => {
  const io1 = fakeIO();
  await assert.rejects(() => saveMenu(fakeDb(fboRules()), { kind: 'fbo', mode: 'Edit', oldId: '03.10.01', values: formValues(), auto: false }, io1), /wmenu_id0 Not Exists!/);
  assert.equal(io1.confirmed.length, 0);

  const db2 = fakeDb(fboRules([
    [/^SELECT COUNT\(1\) FROM wcommand WHERE wmenu_id = '03\.10\.00'/, [set(['n'], [[1]])]],
    [/^SELECT COUNT\(1\) FROM wcommand WHERE wmenu_id = 'ZZ01'/, [set(['n'], [[1]])]]
  ]));
  await assert.rejects(() => saveMenu(db2, { kind: 'fbo', mode: 'New', oldId: '03.10.01', values: formValues({ wmenu_id: 'ZZ01' }), auto: false }, fakeIO()), /Wmenu_id Exists!/);
  assert.ok(!db2.log.some((s) => /INSERT|UPDATE/.test(s)));

  const db3 = fakeDb(fboRules([[/^SELECT COUNT\(1\) FROM wcommand WHERE wmenu_id = '03\.10\.00'/, [set(['n'], [[1]])]]]));
  await assert.rejects(() => saveMenu(db3, { kind: 'fbo', mode: 'Edit', oldId: '03.10.01', values: formValues({ menu_id: '' }), auto: false }, fakeIO()), /Menu_id is Empty!/);
  assert.ok(!db3.log.some((s) => /UPDATE|INSERT/.test(s)));
});

test('saveMenu FBO Mới + tự cấp: INSERT đủ cột của dòng đang mở, Menu_id luôn xoá trắng (5.1), tạo nhóm 88 rồi chạy AUTO_NEW', async () => {
  const db = fakeDb(fboRules([
    [/^SELECT COUNT\(1\) FROM wcommand WHERE wmenu_id = '03\.10\.00'/, [set(['n'], [[1]])]],
    [/^SELECT COUNT\(1\) FROM command WHERE menu_id LIKE '88%'/, [set(['n'], [[0]])]],
    [/ff_Dec2Seq/, [set(['menu_id'], [['88.01.07']])]]
  ]));
  const io = fakeIO();
  // Form còn menu_id cũ 88.01.05 — Lưu mới phải bỏ nó đi.
  const r = await saveMenu(db, { kind: 'fbo', mode: 'New', oldId: '03.10.01', values: formValues({ wmenu_id: 'ZZ52M01' }), auto: true }, io);
  assert.equal(r.message, 'New Successful');
  assert.equal(r.menu_id, '88.01.07');
  const ins = "INSERT INTO wcommand(wmenu_id, wmenu_id0, bar, bar2, link, type, sysid, syscode, menu_id, edition, expl_icon, icon, icon_url, title, datetime0) VALUES(N'ZZ52M01', N'03.10.00', N'Phiếu', N'Voucher', N'inctpnd', N'V', N'SVTran', N'PN', N'', N'2', 0, N'', N'', N'Tiêu đề', '20260101 10:20:30')";
  assert.ok(io.confirmed[0].sql.split('\n').includes(ins), io.confirmed[0].sql);
  const main = db.log.find((s) => s.includes('INTO #tmp') && s.includes('88.00.00'));
  assert.ok(main && main.endsWith(AUTO_MAIN_SCRIPT), 'AUTO_MAIN chạy nguyên văn sau guard');
  const auto = db.log.find((s) => s.includes('ff_Dec2Seq'));
  assert.ok(auto?.endsWith(buildAutoNew({ type: 'V', wmenuId: 'ZZ52M01', menuId: '', bar: 'Phiếu', bar2: 'Voucher', link: 'inctpnd', sysId: 'SVTran', sysCode: 'PN' })), 'AUTO_NEW chạy nguyên văn sau guard');
  assert.ok(auto?.startsWith(guardDb('FBO_S')));
});

test('saveMenu FBO Mới KHÔNG tự cấp: Menu_id vẫn xoá trắng như 5.1 (cmdSaveNew)', async () => {
  const db = fakeDb(fboRules([[/^SELECT COUNT\(1\) FROM wcommand WHERE wmenu_id = '03\.10\.00'/, [set(['n'], [[1]])]]]));
  const io = fakeIO();
  await saveMenu(db, { kind: 'fbo', mode: 'New', oldId: '03.10.01', values: formValues({ wmenu_id: 'ZZ01', menu_id: '88.01.05' }), auto: false }, io);
  assert.ok(io.confirmed[0].sql.includes("N'PN', N'', N'2', 0"), io.confirmed[0].sql);
  assert.ok(!db.log.some((s) => s.includes('ff_Dec2Seq')));
});

test('saveMenu FBO Sửa, xoá trắng Menu_id + tự cấp, command cũ đã có → đổi tên command (không cấp mới), rồi đẩy cột trùng theo mã mới', async () => {
  const db = fakeDb(fboRules([
    [/^SELECT COUNT\(1\) FROM wcommand WHERE wmenu_id = '03\.10\.00'/, [set(['n'], [[1]])]],
    [/^SELECT COUNT\(1\) FROM command WHERE menu_id = '88\.01\.05'/, [set(['n'], [[1]])]],
    [/^SELECT COUNT\(1\) FROM command WHERE menu_id = '88\.01\.08'/, [set(['n'], [[1]])]],
    [/^SELECT MAX\(menu_id\) FROM command WHERE menu_id LIKE '88\.01\.%'/, [set(['m'], [['88.01.07']])]],
    [/SELECT menu_id FROM wcommand/, [set(['menu_id'], [['88.01.08']])]]
  ]));
  const r = await saveMenu(db, { kind: 'fbo', mode: 'Edit', oldId: '03.10.01', values: formValues({ menu_id: '' }), auto: true }, fakeIO());
  assert.equal(r.menu_id, '88.01.08');
  const ren = db.log.find((s) => s.includes(sqlRenameCommand('88.01.08', '88.01.05')));
  assert.ok(ren?.includes(sqlRenameWcommand('88.01.08', '03.10.01')));
  assert.ok(!db.log.some((s) => s.includes('ff_Dec2Seq')));
  assert.ok(db.log.some((s) => s.includes("WHERE menu_id = '88.01.08'") && s.startsWith(guardDb('FBO_S')) && s.includes('UPDATE command SET exe')));
});

test('saveMenu FBO Sửa đồng bộ menu_id sang dvcommand khi có dòng Mobile; bảng dvcommand không có → bỏ qua', async () => {
  const rules = fboRules([
    [/^SELECT COUNT\(1\) FROM wcommand WHERE wmenu_id = '03\.10\.00'/, [set(['n'], [[1]])]],
    [/^SELECT COUNT\(1\) FROM command WHERE menu_id = '88\.01\.05'/, [set(['n'], [[1]])]],
    [/^SELECT COUNT\(1\) FROM dvcommand WHERE wmenu_id = '03\.10\.01'/, [set(['n'], [[1]])]]
  ]);
  const db = fakeDb(rules);
  const r = await saveMenu(db, { kind: 'fbo', mode: 'Edit', oldId: '03.10.01', values: formValues(), auto: false }, fakeIO());
  assert.ok(db.log.some((s) => s.includes("UPDATE dvcommand SET menu_id = N'88.01.05' WHERE wmenu_id = '03.10.01'")));
  assert.ok(r.notes.some((n) => n.includes('đồng bộ menu_id [88.01.05] sang DVCommand')));
  // Bảng không có → lỗi 208 được coi như 0 dòng.
  const base = fakeDb([]);
  const noTable: MenuDb & { log: string[] } = {
    log: base.log,
    async query(sql: string) {
      if (sql.includes('FROM dvcommand')) throw Object.assign(new Error("Invalid object name 'dvcommand'."), { number: 208 });
      return fakeDb(rules).query(sql);
    }
  };
  const r2 = await saveMenu(noTable, { kind: 'fbo', mode: 'Edit', oldId: '03.10.01', values: formValues(), auto: false }, fakeIO());
  assert.equal(r2.notes.length, 0);
});

const MCOLS = ['wmenu_id', 'wmenu_id0', 'bar', 'bar2', 'menu_id', 'action', 'xtype', 'xgroup', 'sysid', 'status', 'icon_color', 'icon_url'];

test('saveMenu Mobile Mới + tự cấp: M1.01.xx theo MAX + 1; Sửa Mobile báo khi FBO cùng mã', async () => {
  const mset = set(MCOLS, [MCOLS.map(() => 'x')]);
  const db = fakeDb([
    [/^SELECT COUNT\(1\) FROM dvcommand WHERE wmenu_id = 'M\.01'/, [set(['n'], [[1]])]],
    [/^SELECT COUNT\(1\) FROM wcommand WHERE wmenu_id = 'M\.01'/, [set(['n'], [[1]])]],
    [/^SELECT MAX\(menu_id\) FROM dvcommand WHERE menu_id LIKE 'M1\.01\.%'/, [set(['m'], [['M1.01.09']])]],
    [/^SELECT \* FROM dvcommand WHERE wmenu_id = 'M\.01'/, [mset]],
    [/SELECT wmenu_id AS id FROM dvcommand/, [set(['id'], [['M.02']])]]
  ]);
  const values = { wmenu_id: 'M.02', wmenu_id0: 'M.01', bar: 'A', bar2: 'B', menu_id: '', action: 'x', xtype: 'D', xgroup: '', sysid: 'S', status: '1', icon_color: '', icon_url: '' };
  const io = fakeIO();
  const r = await saveMenu(db, { kind: 'mob', mode: 'New', oldId: 'M.01', values, auto: true }, io);
  assert.equal(r.menu_id, 'M1.01.10');
  assert.ok(io.confirmed[0].sql.includes("INSERT INTO dvcommand(wmenu_id, wmenu_id0, bar, bar2, menu_id, action, xtype, xgroup, sysid, status, icon_color, icon_url) VALUES(N'M.02', N'M.01', N'A', N'B', N'M1.01.10', N'x', N'D', N'', N'S', N'1', N'', N'')"), io.confirmed[0].sql);
  const db2 = fakeDb([
    [/^SELECT COUNT\(1\) FROM dvcommand WHERE wmenu_id = 'M\.01'/, [set(['n'], [[1]])]],
    [/^SELECT COUNT\(1\) FROM wcommand WHERE wmenu_id = 'M\.01'/, [set(['n'], [[1]])]],
    [/^SELECT \* FROM dvcommand WHERE wmenu_id = 'M\.01'/, [mset]],
    [/SELECT wmenu_id AS id FROM dvcommand/, [set(['id'], [['M.01']])]]
  ]);
  const e = await saveMenu(db2, { kind: 'mob', mode: 'Edit', oldId: 'M.01', values: { ...values, wmenu_id: 'M.01', menu_id: 'M1.01.03' }, auto: false }, fakeIO());
  assert.ok(e.notes.some((n) => n.includes('Không cập nhật menu FBO (wcommand) cùng mã [M.01]')));
});

test('findDups: điều kiện sysID luôn có như 5.1 (kể cả rỗng), dựng dòng (C), đường dẫn theo menu vừa sửa, ≤ 1 dòng → rỗng', async () => {
  const cur = set(['wmenu_id', 'link', 'sysid'], [['07.10.08', 'inctpnd 1', 'SVTran']]);
  const tmp = set(['tag', 'wmenu_id', 'wmenu_id0', 'phan_he', 'bar', 'bar2', 'link'], [
    [false, '07.10.08', '07.10.00', 'Kho', 'Phiếu', 'Voucher (C)', 'inctpnd 1'],
    [false, '11.10.07', '11.10.00', 'Mua', 'Phiếu B (C)', 'V2', 'zcinctpnd 2']
  ]);
  const db = fakeDb([[/^SELECT \* FROM wcommand WHERE/, [cur]], [/INTO #tmp/, [tmp]]]);
  const rowsOut = await findDups(db, 'fbo', '07.10.08');
  assert.deepEqual(rowsOut, [
    [false, 'Kho', '07.10.08', 'Phiếu (C)', 'Voucher (C)', 'inctpnd 1', true],
    [false, 'Mua', '11.10.07', 'Phiếu B (C)', 'V2 (C)', 'inctpnd 2', false]
  ]);
  const q = db.log.find((s) => s.includes('INTO #tmp'));
  assert.ok(q?.startsWith(sqlDupSelect('wcommand', 'link', 'w', 'inctpnd 1', 'SVTran')));
  assert.ok(q?.endsWith('DROP TABLE #tmp'));
  // Menu không có sysid: 5.1 vẫn thêm "OR (sysID = '')".
  const cur2 = set(['wmenu_id', 'link', 'sysid'], [['07.10.00', '', '']]);
  const db2 = fakeDb([[/^SELECT \* FROM wcommand WHERE/, [cur2]], [/INTO #tmp/, [set(['wmenu_id'], [['x']])]]]);
  assert.deepEqual(await findDups(db2, 'fbo', '07.10.00'), []);
  assert.ok(db2.log.some((s) => s.includes("OR (sysID = '')")));
});

test('buildDupsApply / applyDups: chỉ dòng tick và khác dòng vừa sửa; câu lõi nguyên văn; hủy xác nhận → 0', async () => {
  const rowsIn: unknown[][] = [
    [true, 'Kho', '07.10.08', 'A (C)', 'B (C)', 'p1', true],
    [true, 'Mua', '11.10.07', "Tên 'q' (C)", 'B (C)', 'p2', false],
    [false, 'Bán', '12.10.01', 'x', 'y', 'p3', false]
  ];
  const { sql, ids } = buildDupsApply('fbo', rowsIn, 'S');
  assert.deepEqual(ids, ['11.10.07']);
  assert.ok(sql.startsWith(guardDb('S')));
  assert.ok(sql.split('\n').includes("UPDATE wcommand SET bar = N'Tên ''q'' (C)', bar2 = N'B (C)', link = 'p2' WHERE wmenu_id = '11.10.07'"));
  assert.ok(!sql.includes('07.10.08') && !sql.includes('12.10.01'));
  const db = fakeDb([]);
  assert.equal(await applyDups(db, 'fbo', rowsIn, fakeIO(false)), 0);
  assert.equal(db.log.length, 0);
  const io = fakeIO();
  assert.equal(await applyDups(db, 'fbo', rowsIn, io), 1);
  assert.equal(io.txs, 1);
});
