import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  addData, addObject, appendSql, basketCount, buildBasketScript, clearBasket, describeItem, emptyBasket, removeItem, resolveDb
} from '../../src/core/basket/basket';
import { BasketStore, parseBasket } from '../../src/core/basket/basketStore';
import { appendMemory } from '../../src/core/basket/memory';
import { deleteFilesIn, profilerArgs, profilerDbName, structAppDirs } from '../../src/core/basket/shellHelpers';

test('resolveDb: tên DB Sys hoặc "Sys" là sys, còn lại app', () => {
  assert.equal(resolveDb('IMPCO_S', 'impco_s'), 'sys');
  assert.equal(resolveDb('Sys', 'IMPCO_S'), 'sys');
  assert.equal(resolveDb('IMPCO_App', 'IMPCO_S'), 'app');
  assert.equal(resolveDb('', 'IMPCO_S'), 'app');
});

test('addData: điều kiện trống thành 1=1, trùng bị báo', () => {
  const s = emptyBasket();
  assert.equal(addData(s, 'dmvt', '', 'app'), '');
  assert.equal(s.items[0].kind === 'data' && s.items[0].key, '1=1');
  assert.equal(addData(s, 'DMVT', ' 1=1 ', 'app'), 'Đã có trong gói.');
  assert.equal(addData(s, 'dmvt', '1=1', 'sys'), '');
  assert.equal(s.items.length, 2);
});

test('addObject: ánh xạ loại, bảng Sys, trùng, loại lạ', () => {
  const s = emptyBasket();
  assert.equal(addObject(s, 'zc_x', 'P', 'app', true, false), '');
  assert.equal(addObject(s, 'fn_x', 'IF', 'sys', false, false), '');
  assert.equal(addObject(s, 'sysfoo', 'U', 'sys', false, false), '');
  assert.equal(addObject(s, 'dmfoo', 'U', 'app', false, false), '');
  assert.deepEqual(s.items.map((i) => (i.kind === 'object' ? i.category : '')), ['Store', 'Function', 'Table Sys', 'Table App']);
  assert.equal(s.items[1].db, 'sys');
  assert.equal(addObject(s, 'ZC_X', 'P', 'app', true, false), 'Đã có ZC_X trong gói.');
  assert.equal(addObject(s, 'x', 'XX', 'app', false, false), 'Loại đối tượng XX chưa hỗ trợ.');
  assert.equal(addObject(s, '  ', 'P', 'app', false, false), 'Chưa nhập mã.');
});

test('appendSql: chèn GO khi batch trước chưa kết thúc, không chèn khi đã có', () => {
  const s = emptyBasket();
  appendSql(s, 'SELECT 1', false);
  appendSql(s, 'SELECT 2', false);
  assert.equal(s.otherAppSql, 'SELECT 1\r\nGO\r\nSELECT 2');
  appendSql(s, 'SELECT 3\r\nGO\r\n', false);
  appendSql(s, 'SELECT 4', false);
  assert.ok(s.otherAppSql.endsWith('SELECT 3\r\nGO\r\nSELECT 4'));
  appendSql(s, '', true);
  assert.equal(s.otherSysSql, '');
  appendSql(s, 'EXEC x', true);
  assert.equal(s.otherSysSql, 'EXEC x');
});

test('basketCount, removeItem, clearBasket', () => {
  const s = emptyBasket();
  addData(s, 't', 'a=1', 'app');
  addObject(s, 'p1', 'P', 'app', false, false);
  assert.equal(basketCount(s), 2);
  appendSql(s, 'x', false);
  assert.equal(basketCount(s), 3);
  assert.equal(removeItem(s, 5), false);
  assert.equal(removeItem(s, 0), true);
  assert.equal(s.items.length, 1);
  clearBasket(s);
  assert.equal(basketCount(s), 0);
});

test('describeItem', () => {
  const s = emptyBasket();
  addData(s, 'dmvt', "ma_vt='A'", 'sys');
  addObject(s, 'zc_x', 'P', 'app', true, true);
  assert.deepEqual(describeItem(s.items[0]), { label: "dmvt WHERE ma_vt='A'", detail: 'Dữ liệu · Sys' });
  assert.deepEqual(describeItem(s.items[1]), { label: 'zc_x', detail: 'Store · App · ALTER, QUOTED OFF' });
});

test('buildBasketScript: App rồi Sys, mỗi mục cách GO, dùng scriptOf', async () => {
  const s = emptyBasket();
  addObject(s, 'p1', 'P', 'app', true, false);
  addData(s, 'dmvt', '', 'sys');
  appendSql(s, 'EXEC other', false);
  const text = await buildBasketScript(s, async (i) => (i.kind === 'object' ? `ALTER PROC ${i.name}` : `-- data ${i.table}`));
  assert.equal(text, '-- ===== App =====\r\nALTER PROC p1\r\nGO\r\nEXEC other\r\nGO\r\n\r\n-- ===== Sys =====\r\n-- data dmvt');
  assert.equal(await buildBasketScript(emptyBasket()), '');
});

test('BasketStore: lưu / nạp JSON theo dự án, file hỏng thành giỏ rỗng', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-basket-'));
  try {
    const a = new BasketStore(dir);
    const s = a.get('IMPCO');
    addData(s, 'dmvt', 'a=1', 'app');
    addObject(s, 'p1', 'P', 'sys', true, true);
    appendSql(s, 'SELECT 1', true);
    a.save('IMPCO');
    const b = new BasketStore(dir);
    assert.deepEqual(b.get('IMPCO'), s);
    assert.equal(b.get('KHAC').items.length, 0);
    fs.writeFileSync(path.join(dir, 'BAD.basket.json'), '{hỏng', 'utf8');
    assert.equal(new BasketStore(dir).get('BAD').items.length, 0);
    assert.equal(parseBasket({ items: [{ kind: 'x' }, { kind: 'data', db: 'sys', table: 't', key: 'k' }] }).items.length, 1);
    new BasketStore().save('NOFILE'); // không có thư mục: chỉ bộ nhớ, không lỗi
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('appendMemory: nối + GO, bỏ khoảng trắng cuối, text trống bỏ qua', () => {
  let t = appendMemory('', 'SELECT 1  \n\n');
  assert.equal(t, 'SELECT 1\r\nGO\r\n');
  t = appendMemory(t, '   ');
  assert.equal(t, 'SELECT 1\r\nGO\r\n');
  t = appendMemory(t, 'SELECT 2');
  assert.equal(t, 'SELECT 1\r\nGO\r\nSELECT 2\r\nGO\r\n');
});

test('profilerDbName / profilerArgs', () => {
  assert.equal(profilerDbName('IMPCO_S'), 'IMPCO');
  assert.equal(profilerDbName('A_B_S'), 'A_B');
  assert.equal(profilerDbName('NOUNDER'), 'NOUNDER');
  assert.deepEqual(profilerArgs({ server: 'srv;Connect Timeout=5', user: 'u1' }, 'pw', 'IMPCO'), [
    '-start', '-server', 'srv', '-user', 'u1', '-password', 'pw', '-databasename', 'like', 'IMPCO'
  ]);
  const a = profilerArgs({ server: '172.168.5.14', user: 'u1' }, 'pw', 'X');
  assert.deepEqual(a.slice(3, 7), ['-user', 'profile', '-password', 'fsd']);
});

test('structAppDirs: hai gốc khác nhau, gộp trùng, bỏ gốc rỗng', () => {
  assert.deepEqual(structAppDirs({ webSource: 'D:\\web\\', webProgramDir: 'D:\\WEB' }), ['D:\\web\\App_Data\\Controllers\\Structure\\App']);
  assert.deepEqual(structAppDirs({ webSource: '', webProgramDir: '\\\\srv\\share\\x' }), ['\\\\srv\\share\\x\\App_Data\\Controllers\\Structure\\App']);
  assert.equal(structAppDirs({ webSource: '', webProgramDir: '' }).length, 0);
});

test('deleteFilesIn: chỉ xóa file ngay trong thư mục, giữ thư mục con; thư mục thiếu bỏ qua', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-struct-'));
  try {
    const dir = path.join(root, 'Structure', 'App');
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.xml'), '1');
    fs.writeFileSync(path.join(dir, 'b.xml'), '2');
    fs.writeFileSync(path.join(dir, 'sub', 'c.xml'), '3');
    const r = deleteFilesIn([dir, path.join(root, 'khong-co')]);
    assert.equal(r.deleted.length, 2);
    assert.equal(r.failed.length, 0);
    assert.deepEqual(fs.readdirSync(dir), ['sub']);
    assert.ok(fs.existsSync(path.join(dir, 'sub', 'c.xml')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
