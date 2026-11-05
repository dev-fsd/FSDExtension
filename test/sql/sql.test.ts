import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseServer, assertSelectOnly, SqlClient } from '../../src/core/sql/sqlClient';
import { branchTitle, buildTree, groupMenusByBranch } from '../../src/core/sql/menuRepo';
import type { MenuItem } from '../../src/core/types';

function mi(id: string, parentId: string, bar = id): MenuItem {
  return { kind: 'fbo', id, parentId, bar, sysId: '', link: '', type: '' };
}

test('parseServer: host đơn', () => {
  assert.deepEqual(parseServer('172.168.5.14'), { host: '172.168.5.14' });
});

test('parseServer: host\\instance', () => {
  assert.deepEqual(parseServer('SRV\\SQL2019'), { host: 'SRV', instanceName: 'SQL2019' });
});

test('parseServer: host,port', () => {
  assert.deepEqual(parseServer('10.0.0.1,1444'), { host: '10.0.0.1', port: 1444 });
});

test('parseServer: kèm Connect Timeout', () => {
  assert.deepEqual(parseServer('SRV\\INST; Connect Timeout = 30'), {
    host: 'SRV',
    instanceName: 'INST',
    connectTimeoutMs: 30000,
  });
  assert.deepEqual(parseServer('10.0.0.1,1433;Connect Timeout=5'), {
    host: '10.0.0.1',
    port: 1433,
    connectTimeoutMs: 5000,
  });
});

test('buildTree: trùng mã giữ dòng đầu, bỏ bar "-"', () => {
  const t = buildTree([mi('A', ''), mi('a', '', 'Trùng'), mi('B', 'A'), mi('C', 'A', '-')]);
  assert.equal(t.length, 1);
  assert.equal(t[0].bar, 'A');
  assert.deepEqual(t[0].children?.map((c) => c.id), ['B']);
});

test('buildTree: cha thiếu hoặc tự trỏ thì không hiện (như FSD Studio 5.1)', () => {
  const t = buildTree([mi('X', 'KHONGCO'), mi('Y', 'Y'), mi('Z', '')]);
  assert.deepEqual(t.map((n) => n.id), ['Z']);
});

test('buildTree: sắp theo mã không phân biệt hoa thường', () => {
  const t = buildTree([mi('b', ''), mi('A', ''), mi('c', '')]);
  assert.deepEqual(t.map((n) => n.id), ['A', 'b', 'c']);
  const t2 = buildTree([mi('P', ''), mi('p2', 'P'), mi('P1', 'p')]);
  assert.deepEqual(t2[0].children?.map((n) => n.id), ['P1', 'p2']);
});

test('guard: chỉ SELECT', () => {
  assertSelectOnly('SELECT 1');
  assertSelectOnly('  -- ghi chú\n /* x */ select a from t where b = \'; drop\'');
  assert.throws(() => assertSelectOnly('UPDATE t SET a = 1'));
  assert.throws(() => assertSelectOnly('DELETE FROM t'));
  assert.throws(() => assertSelectOnly('EXEC sp_who'));
  assert.throws(() => assertSelectOnly('SELECT 1; DROP TABLE t'));
  assert.throws(() => assertSelectOnly('SELECT * INTO x FROM t'));
  assert.throws(() => assertSelectOnly('-- select\nINSERT INTO t VALUES (1)'));
});

test('SqlClient.query từ chối câu ghi trước khi kết nối', async () => {
  const c = new SqlClient({ server: 'khong.ton.tai', user: 'u', password: 'p', database: 'd' });
  await assert.rejects(c.query('DROP TABLE t'), /SELECT/);
  await c.close();
});

test('groupMenusByBranch: khối theo cha trực tiếp, thứ tự duyệt cây', () => {
  const m = (id: string, parentId: string, bar: string, sysId = id): MenuItem => ({ kind: 'fbo', id, parentId, bar, sysId, link: '', type: '' });
  const tree = buildTree([
    m('A', '', 'Tổng hợp', ''),
    m('A1', 'A', 'Chứng từ', ''),
    m('A1a', 'A1', 'Phiếu thu'),
    m('A1b', 'A1', 'Phiếu chi'),
    m('A2', 'A', 'Danh mục'),
    m('A3', 'A', 'Báo cáo', ''),
    m('A3a', 'A3', 'Sổ cái'),
    m('B', '', 'Kho', ''),
    m('B1', 'B', 'Nhập kho'),
    m('Z', '', 'Rỗng', '')
  ]);
  const g = groupMenusByBranch(tree);
  assert.deepEqual(g.map((x) => x.title), ['Tổng hợp', 'Tổng hợp › Chứng từ', 'Tổng hợp › Báo cáo', 'Kho']);
  assert.deepEqual(g.map((x) => x.items.map((i) => i.id)), [['A2'], ['A1a', 'A1b'], ['A3a'], ['B1']]);
});

test('branchTitle: rút cấp giữa khi quá 3 cấp', () => {
  assert.equal(branchTitle(['A', 'B', 'C']), 'A › B › C');
  assert.equal(branchTitle(['A', 'B', 'C', 'D']), 'A › … › D');
});
