import { test } from 'node:test';
import * as assert from 'node:assert';
import type { ProjectRecord } from '../../src/core/types';
import { matchProjectsByWorkspace } from '../../src/core/projects/projectStore';

function proj(code: string, web: string, extra: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    code, name: code, menuType: '2', server: 's', user: 'u', mode: '1', sysDatabase: code + '_S',
    webSource: web, webProgramDir: web, webHost1: '', webHost2: '', mobileDir: '', active: true, ...extra,
  };
}

const IMPCO = proj('IMPCO', '\\\\172.168.5.14\\CustomerPro\\FBO\\IMPCO\\R2SP242\\');
const ICDTN = proj('ICDTN', '\\\\172.168.5.14\\CustomerPro\\FBI\\ICDTN\\FBISP2421\\');
const all = [IMPCO, ICDTN];

test('workspace: folder bằng gốc web, nằm trong gốc web, hoặc là gốc mobile', () => {
  assert.deepStrictEqual(matchProjectsByWorkspace(all, ['\\\\172.168.5.14\\CustomerPro\\FBO\\IMPCO\\R2SP242']).map((p) => p.code), ['IMPCO']);
  assert.deepStrictEqual(matchProjectsByWorkspace(all, ['\\\\172.168.5.14\\CustomerPro\\FBO\\IMPCO\\R2SP242\\App_Data']).map((p) => p.code), ['IMPCO']);
  assert.deepStrictEqual(matchProjectsByWorkspace(all, ['//172.168.5.14/CustomerPro/FBI/ICDTN/MobileApp']).map((p) => p.code), ['ICDTN']);
});

test('workspace: folder cha của gốc web chỉ khớp khi đúng một dự án', () => {
  assert.deepStrictEqual(matchProjectsByWorkspace(all, ['\\\\172.168.5.14\\CustomerPro\\FBO\\IMPCO']).map((p) => p.code), ['IMPCO']);
  // hai dự án cùng nằm dưới folder cha → không đoán
  assert.deepStrictEqual(matchProjectsByWorkspace(all, ['\\\\172.168.5.14\\CustomerPro']), []);
  // folder khác tên tiền tố (IMPCO2 không phải IMPCO)
  assert.deepStrictEqual(matchProjectsByWorkspace(all, ['\\\\172.168.5.14\\CustomerPro\\FBO\\IMPCO2']), []);
});

test('workspace: nhiều folder giữ thứ tự, bỏ trùng; gốc dài nhất thắng', () => {
  const res = matchProjectsByWorkspace(all, [
    '\\\\172.168.5.14\\CustomerPro\\FBI\\ICDTN\\FBISP2421\\App_Data',
    '\\\\172.168.5.14\\CustomerPro\\FBO\\IMPCO\\R2SP242',
    '\\\\172.168.5.14\\CustomerPro\\FBI\\ICDTN\\FBISP2421'
  ]);
  assert.deepStrictEqual(res.map((p) => p.code), ['ICDTN', 'IMPCO']);
  const nested = proj('NEST', '\\\\172.168.5.14\\CustomerPro\\FBO\\IMPCO\\R2SP242\\Sub\\');
  assert.deepStrictEqual(
    matchProjectsByWorkspace([IMPCO, nested], ['\\\\172.168.5.14\\CustomerPro\\FBO\\IMPCO\\R2SP242\\Sub\\x']).map((p) => p.code),
    ['NEST']
  );
});
