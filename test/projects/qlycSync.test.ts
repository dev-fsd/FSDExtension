import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readOption } from '../../src/core/projects/configDb';
import { encodeText } from '../../src/core/legacy/legacyText';
import { mergeStandard, parseConnectionString, qlycConfigs, rowToProject } from '../../src/core/projects/qlycSync';
import { SqlClient } from '../../src/core/sql/sqlClient';
import type { ProjectRecord } from '../../src/core/types';

const row = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  ma_da: ' AAA ',
  ten_da: 'Dự án A',
  dir_pro_web: '\\\\srv\\p\\AAA',
  dir_src_web: '\\\\srv\\s\\AAA',
  ten_server: 'srv\\sql',
  xuser: 'u1',
  xpass: encodeText('mk123'),
  db_sys: 'AAA_S',
  loai_da: '',
  ...o
});

const rec = (code: string, extra: Partial<ProjectRecord> = {}): ProjectRecord => ({
  code,
  name: 'cũ',
  menuType: '2',
  server: 's',
  user: 'u',
  mode: '1',
  sysDatabase: 'd',
  webSource: '',
  webProgramDir: '',
  webHost1: '',
  webHost2: '',
  mobileDir: 'MobileApp',
  active: true,
  ...extra
});

test('rowToProject: trim, thêm "\\" cuối thư mục, giải mật khẩu key 0, menuType mặc định 2', () => {
  const m = rowToProject(row())!;
  assert.equal(m.project.code, 'AAA');
  assert.equal(m.project.webSource, '\\\\srv\\s\\AAA\\');
  assert.equal(m.project.webProgramDir, '\\\\srv\\p\\AAA\\');
  assert.equal(m.project.sysDatabase, 'AAA_S');
  assert.equal(m.project.menuType, '2');
  assert.equal(m.password, 'mk123');
  assert.equal(rowToProject(row({ ma_da: '' })), undefined);
});

test('mergeStandard: cập nhật dự án đang dùng, thêm dự án mới, bỏ qua dự án tắt', () => {
  const cur = [rec('aaa'), rec('OFF', { active: false })];
  const res = mergeStandard(cur, [row(), row({ ma_da: 'NEW', ten_da: 'Mới' }), row({ ma_da: 'OFF' })]);
  assert.equal(res.updated, 1);
  assert.equal(res.added, 1);
  assert.equal(res.total, 3);
  const a = res.projects.find((p) => p.code === 'aaa')!;
  assert.equal(a.name, 'Dự án A');
  assert.equal(a.mobileDir, 'MobileApp'); // trường không thuộc danh sách chuẩn được giữ
  assert.equal(res.projects.find((p) => p.code === 'OFF')!.name, 'cũ');
  const n = res.projects.find((p) => p.code === 'NEW')!;
  assert.equal(n.active, true);
  assert.equal(n.mode, '1');
  assert.equal(res.passwords.get('NEW'), 'mk123');
  assert.equal(res.passwords.has('OFF'), false);
  assert.equal(cur[0].name, 'cũ'); // không sửa danh sách đầu vào
});

test('qlycConfigs: thử 2 máy chủ, timeout ngắn, đủ user / DB; parseConnectionString', () => {
  const cfgs = qlycConfigs(2);
  assert.equal(cfgs.length, 2);
  assert.match(cfgs[0].server, /^172\.168\.5\.14\\.+; Connect Timeout = 2$/);
  assert.match(cfgs[1].server, /^20\.20\.20\.14\\/);
  assert.ok(cfgs[0].user !== '' && cfgs[0].password !== '' && cfgs[0].database !== '');
  const m = parseConnectionString('Data Source=a\\b;Uid=x;PWD=y=z;');
  assert.equal(m.get('uid'), 'x');
  assert.equal(m.get('pwd'), 'y=z');
});

test('SqlClient.callAllowed: chỉ cho thủ tục trong danh sách; query vẫn chỉ SELECT', async () => {
  const c = new SqlClient({ server: 'x', user: 'u', password: 'p', database: 'd' });
  await assert.rejects(() => c.callAllowed('sp_who', []), /không nằm trong danh sách/);
  await assert.rejects(() => c.callAllowed('ns_getListDept; DROP TABLE x', ['a']), /không nằm trong danh sách/);
  await assert.rejects(() => c.query('EXEC ns_getListDept @p0', { p0: 'a' }), /SELECT/);
});

test('readOption: đọc options.val theo id; thiếu → rỗng', async () => {
  type Db = { run(s: string): void; export(): Uint8Array; close(): void };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const initSqlJs = require('sql.js') as (cfg?: object) => Promise<{ Database: new () => Db }>;
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE options (id TEXT, val TEXT)');
  db.run("INSERT INTO options VALUES ('CurrUser', ' nguyenvan ')");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsdopt-'));
  const file = path.join(dir, 'config.db');
  fs.writeFileSync(file, Buffer.from(db.export()));
  db.close();
  try {
    assert.equal(await readOption(file, 'CurrUser'), 'nguyenvan');
    assert.equal(await readOption(file, 'Khac'), '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
