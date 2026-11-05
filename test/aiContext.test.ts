import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAiContext } from '../src/core/aiContext';
import type { MenuFile, MenuStructureResult } from '../src/core/types';

const file = (role: MenuFile['role'], p: string, missing = false): MenuFile => ({
  path: p,
  role,
  name: p,
  via: 'root',
  hasF: !missing,
  hasXml: !missing,
  staleF: false,
  missing
});

const structure = (files: MenuFile[], tables: string[] = [], stores: string[] = []): MenuStructureResult => ({
  sysId: 'GLTran',
  controllersDir: 'C:\\W\\App_Data\\Controllers\\',
  files,
  tables,
  stores,
  fellBack: []
});

const project = { code: 'TALAD', name: 'Công ty Talad' };

test('buildAiContext FBO: đủ dự án, mã menu, sysid, link, loại, nhóm file, bảng, store', () => {
  const text = buildAiContext({
    project,
    ref: { kind: 'fbo', menuId: '01.02.03', sysId: 'GLTran', bar: 'Phiếu kế toán' },
    item: { link: 'Main/Voucher.aspx?id=GLTran', type: 'V' },
    structure: structure(
      [
        file('dir', 'C:\\W\\App_Data\\Controllers\\Dir\\GLTran.f'),
        file('grid', 'C:\\W\\App_Data\\Controllers\\Grid\\GLTran.f'),
        file('grid', 'C:\\W\\App_Data\\Controllers\\Grid\\GLTranDetail.f'),
        file('report', 'C:\\W\\App_Data\\Controllers\\Report\\GLTran.f'),
        file('include', 'C:\\W\\App_Data\\Controllers\\Include\\Command\\Common.ent'),
        file('grid', 'C:\\W\\App_Data\\Controllers\\Grid\\GLTranThieu.xml', true)
      ],
      ['GLTran', 'GLTranDetail'],
      ['zc_GLTran_Post']
    )
  });
  const want = [
    '# Menu Phiếu kế toán (FBO)',
    '',
    '- Dự án: TALAD — Công ty Talad',
    '- Menu id: 01.02.03',
    '- sysid: GLTran',
    '- Link: Main/Voucher.aspx?id=GLTran',
    '- Loại: V',
    '',
    '## Dir',
    '- C:\\W\\App_Data\\Controllers\\Dir\\GLTran.f',
    '',
    '## Grid',
    '- C:\\W\\App_Data\\Controllers\\Grid\\GLTran.f',
    '- C:\\W\\App_Data\\Controllers\\Grid\\GLTranDetail.f',
    '',
    '## Report',
    '- C:\\W\\App_Data\\Controllers\\Report\\GLTran.f',
    '',
    '## Include',
    '- C:\\W\\App_Data\\Controllers\\Include\\Command\\Common.ent',
    '',
    '## Khai báo nhưng thiếu file',
    '- C:\\W\\App_Data\\Controllers\\Grid\\GLTranThieu.xml',
    '',
    '## Bảng',
    '- GLTran',
    '- GLTranDetail',
    '',
    '## Store',
    '- zc_GLTran_Post',
    ''
  ].join('\n');
  assert.equal(text, want);
  // File thiếu không lẫn vào nhóm Grid.
  assert.ok(text.indexOf('GLTranThieu') > text.indexOf('## Khai báo nhưng thiếu file'));
});

test('buildAiContext: không có link / loại / bảng / store / file thiếu thì bỏ dòng và mục đó', () => {
  const text = buildAiContext({
    project,
    ref: { kind: 'fbo', menuId: 'M1', sysId: 'X', bar: 'X' },
    structure: structure([file('dir', 'C:\\Dir\\X.f')])
  });
  for (const s of ['- Link:', '- Loại:', '## Bảng', '## Store', 'thiếu file']) assert.ok(!text.includes(s), s);
  assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'));
});

test('buildAiContext Mobile: ghi (Mobile) và nhóm Dashboards thay cho Report', () => {
  const text = buildAiContext({
    project: { code: 'AMIANA', name: 'Amiana' },
    ref: { kind: 'mob', menuId: 'D01', sysId: 'MobSales', bar: 'Bán hàng' },
    structure: structure([file('dashboard', 'C:\\M\\Mobile\\Report\\MobSales.f'), file('dir', 'C:\\M\\Mobile\\Dir\\MobSales.f')])
  });
  assert.ok(text.startsWith('# Menu Bán hàng (Mobile)\n'));
  assert.ok(text.includes('## Dashboards\n- C:\\M\\Mobile\\Report\\MobSales.f'));
  assert.ok(!text.includes('## Report'));
  assert.ok(text.indexOf('## Dir') < text.indexOf('## Dashboards'), 'đúng thứ tự nhóm như view');
});
