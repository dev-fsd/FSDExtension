import { test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DmdaRow, ProjectRecord } from '../../src/core/types';
import { ProjectStore, matchProjectByPath, mobileRoot, toProjectRecord, webRoot } from '../../src/core/projects/projectStore';
import { readDmda } from '../../src/core/projects/configDb';
import { decodeText } from '../../src/core/legacy/legacyText';

function proj(code: string, web: string, extra: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    code, name: code, menuType: '2', server: 's', user: 'u', mode: '1', sysDatabase: code + '_S',
    webSource: web, webProgramDir: web, webHost1: '', webHost2: '', mobileDir: '', active: true, ...extra,
  };
}

const ICDTN = proj('ICDTN', '\\\\172.168.5.14\\CustomerPro\\FBI\\ICDTN\\FBISP2421\\');

test('webRoot: web_source, trống thì webprogram_dir, luôn có "\\" cuối', () => {
  assert.strictEqual(webRoot(proj('A', 'D:/x/web')), 'D:\\x\\web\\');
  assert.strictEqual(webRoot(proj('A', '', { webProgramDir: 'D:\\p' })), 'D:\\p\\');
  assert.strictEqual(webRoot(proj('A', '', { webProgramDir: '' })), '');
});

test('mobileRoot: rỗng / tên / đường dẫn đủ', () => {
  assert.strictEqual(mobileRoot(ICDTN), '\\\\172.168.5.14\\CustomerPro\\FBI\\ICDTN\\MobileApp\\');
  assert.strictEqual(mobileRoot({ ...ICDTN, mobileDir: 'MobApp2' }), '\\\\172.168.5.14\\CustomerPro\\FBI\\ICDTN\\MobApp2\\');
  assert.strictEqual(mobileRoot({ ...ICDTN, mobileDir: '5' }), '\\\\172.168.5.14\\CustomerPro\\FBI\\ICDTN\\MobileApp\\'); // tên số không hợp lệ
  assert.strictEqual(mobileRoot({ ...ICDTN, mobileDir: 'E:\\m\\app' }), 'E:\\m\\app\\');
  assert.strictEqual(mobileRoot(proj('B', '')), '');
  assert.strictEqual(mobileRoot(proj('B', '\\\\host\\share\\')), ''); // gốc share không có cha
  assert.strictEqual(mobileRoot(proj('B', 'D:\\web\\')), 'D:\\MobileApp\\');
});

test('matchProjectByPath: file web', () => {
  const m = matchProjectByPath([ICDTN], '\\\\172.168.5.14\\CustomerPro\\FBI\\ICDTN\\FBISP2421\\App_Data\\Controllers\\Dir\\GLTran.xml');
  assert.ok(m);
  assert.strictEqual(m.project.code, 'ICDTN');
  assert.strictEqual(m.area, 'web');
  assert.strictEqual(m.root, '\\\\172.168.5.14\\CustomerPro\\FBI\\ICDTN\\FBISP2421\\');
  assert.strictEqual(m.controllersDir, '\\\\172.168.5.14\\CustomerPro\\FBI\\ICDTN\\FBISP2421\\App_Data\\Controllers\\');
});

test('matchProjectByPath: file mobile cạnh web', () => {
  const m = matchProjectByPath([ICDTN], '\\\\172.168.5.14\\CustomerPro\\FBI\\ICDTN\\MobileApp\\App_Data\\Controllers\\Mobile\\Dir\\X.xml');
  assert.ok(m);
  assert.strictEqual(m.area, 'mobile');
  assert.strictEqual(m.controllersDir, '\\\\172.168.5.14\\CustomerPro\\FBI\\ICDTN\\MobileApp\\App_Data\\Controllers\\Mobile\\');
});

test('matchProjectByPath: dấu "/" và chữ thường vẫn khớp; không khớp thì undefined', () => {
  const m = matchProjectByPath([ICDTN], '//172.168.5.14/customerpro/fbi/icdtn/fbisp2421/app_data/controllers/dir/gltran.f');
  assert.ok(m);
  assert.strictEqual(m.project.code, 'ICDTN');
  assert.strictEqual(m.root, '\\\\172.168.5.14\\CustomerPro\\FBI\\ICDTN\\FBISP2421\\'); // giữ hoa thường gốc
  assert.strictEqual(matchProjectByPath([ICDTN], 'C:\\other\\file.xml'), undefined);
  // chỉ trùng tiền tố tên thư mục thì không tính
  assert.strictEqual(matchProjectByPath([ICDTN], '\\\\172.168.5.14\\CustomerPro\\FBI\\ICDTN\\FBISP2421X\\a.xml'), undefined);
});

test('matchProjectByPath: lồng nhau lấy gốc dài nhất; bằng nhau ưu tiên active', () => {
  const outer = proj('OUT', 'D:\\a\\');
  const inner = proj('IN', 'D:\\a\\b\\c\\');
  assert.strictEqual(matchProjectByPath([outer, inner], 'D:\\a\\b\\c\\App_Data\\x.xml')?.project.code, 'IN');
  assert.strictEqual(matchProjectByPath([inner, outer], 'D:\\a\\other.xml')?.project.code, 'OUT');
  const off = proj('OFF', 'D:\\z\\', { active: false });
  const on = proj('ON', 'D:\\z\\');
  assert.strictEqual(matchProjectByPath([off, on], 'D:\\z\\f.xml')?.project.code, 'ON');
});

test('toProjectRecord bỏ mật khẩu; ProjectStore lưu / đọc lại', async () => {
  const row: DmdaRow = { ...ICDTN, passwordEncoded: 'SECRET-MARK' };
  assert.ok(!('passwordEncoded' in toProjectRecord(row)));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsdproj-'));
  try {
    const file = path.join(dir, 'sub', 'projects.json');
    const store = new ProjectStore(file);
    assert.deepStrictEqual(await store.load(), []);
    await store.save([row]);
    assert.ok(!fs.readFileSync(file, 'utf8').includes('SECRET-MARK'));
    assert.deepStrictEqual(await store.load(), [ICDTN]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Tích hợp: chỉ chạy khi máy có config.db thật; không in mật khẩu.
const REAL_DB = 'D:\\SOFT\\FSDStudio\\config.db';
test('readDmda trên config.db thật (bỏ qua nếu không có file)', { skip: !fs.existsSync(REAL_DB) }, async () => {
  const rows = await readDmda(REAL_DB);
  assert.ok(rows.length > 0);
  const withPass = rows.filter((r) => r.passwordEncoded !== '');
  const decoded = withPass.filter((r) => decodeText(r.passwordEncoded, 13) !== '');
  assert.ok(decoded.length / Math.max(1, withPass.length) > 0.9);
});
