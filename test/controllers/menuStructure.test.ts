import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';
import { normalizeTable, scanMenu } from '../../src/core/controllers/menuStructure';
import { buildFixture } from './fixture';

const names = (files: { name: string }[]): string[] => files.map((f) => f.name);

test('scanMenu GLTran có khóa: .f trước, đi theo Grid/Lookup/showForm/Import/Report (không dò Include)', async () => {
  const fx = buildFixture();
  try {
    const r = await scanMenu(fx.controllers, 'GLTran', { mobile: false, crypto: fx.crypto });
    const n = names(r.files);
    for (const want of [
      'Dir\\GLTran',
      'Grid\\GLTranDetail',
      'Lookup\\LkAcc',
      'Grid\\GLTranThieu',
      'Filter\\GLTranPrint',
      'Filter\\GLTranKhongCo',
      'Filter\\GLImpImport',
      'Templates\\Upload\\GLImp.xml',
      'Templates\\Excel\\GLImp.xlsx',
      'Grid\\GLTran',
      'Filter\\GLTran',
      'Report\\GLTran',
      'Templates\\Frx\\Rep1.frx',
      'Templates\\Rpt\\Rep1.rpt',
      'Templates\\Excel\\Mau1.xlsx'
    ]) {
      assert.ok(n.includes(want), 'thiếu ' + want + ' trong ' + n.join(', '));
    }
    assert.ok(!n.some((x) => x.startsWith('Include')), 'không còn dò Include');
    assert.equal(new Set(n).size, n.length);

    const dir = r.files.find((f) => f.name === 'Dir\\GLTran')!;
    assert.equal(dir.hasF, true);
    assert.equal(dir.hasXml, true);
    assert.equal(dir.staleF, true);
    assert.equal(dir.role, 'dir');
    assert.equal(dir.via, 'root');
    assert.ok(dir.path.endsWith('GLTran.xml'));
    assert.ok(dir.fMtime! < dir.xmlMtime!);

    const detail = r.files.find((f) => f.name === 'Grid\\GLTranDetail')!;
    assert.equal(detail.via, 'grid');
    assert.equal(detail.hasF, true);
    assert.equal(detail.hasXml, false);
    assert.equal(detail.staleF, false);

    assert.equal(r.files.find((f) => f.name === 'Lookup\\LkAcc')!.role, 'lookup');
    assert.equal(r.files.find((f) => f.name === 'Filter\\GLTranPrint')!.via, 'showForm');
    assert.equal(r.files.find((f) => f.name === 'Filter\\GLImpImport')!.role, 'import');
    assert.equal(r.files.find((f) => f.name === 'Templates\\Frx\\Rep1.frx')!.via, 'reportFile');
    assert.equal(r.files.find((f) => f.name === 'Report\\GLTran')!.role, 'report');

    // missing: chỉ cho controller được khai báo
    const missing = r.files.filter((f) => f.missing).map((f) => f.name).sort();
    assert.deepEqual(missing, ['Filter\\GLTranKhongCo', 'Grid\\GLTranThieu']);
    assert.ok(r.files.find((f) => f.name === 'Grid\\GLTranThieu')!.path.endsWith('GLTranThieu.xml'));

    assert.deepEqual(r.tables.sort(), ['GLTran', 'GLTranD', 'GLTranList']);
    // store: có cả store trong vùng đã giải; bỏ FastBusiness$, biến, entity, lời văn
    const stores = r.stores.map((s) => s.toLowerCase()).sort();
    assert.deepEqual(stores, ['rs_gltran_in', 'zc_bi_mat', 'zc_detail_ds', 'zc_khac', 'zc_list_ds']);
    assert.deepEqual(r.fellBack, []);
  } finally {
    fx.cleanup();
  }
});

test('scanMenu không có khóa: vùng khóa → đọc .xml, ghi fellBack', async () => {
  const fx = buildFixture();
  try {
    const r = await scanMenu(fx.controllers, 'GLTran', { mobile: false });
    assert.equal(r.fellBack.length, 1);
    assert.ok(r.fellBack[0].endsWith('GLTran.f'));
    assert.ok(r.stores.some((s) => s.toLowerCase() === 'zc_gltran_xml'));
    assert.ok(!r.stores.some((s) => s.toLowerCase() === 'zc_bi_mat'));
    // path mở là .xml khi có cả hai (nội dung dò vẫn đọc .f trước)
    assert.ok(r.files.find((f) => f.name === 'Dir\\GLTran')!.path.endsWith('GLTran.xml'));
  } finally {
    fx.cleanup();
  }
});

test('scanMenu: chỉ có .f; sysId không tồn tại không bị đánh missing; thư mục không có', async () => {
  const fx = buildFixture();
  try {
    const r = await scanMenu(fx.controllers, 'OnlyF', { mobile: false });
    assert.deepEqual(names(r.files), ['Dir\\OnlyF']);
    // chỉ có .f thì path vẫn là .f
    assert.ok(r.files[0].path.endsWith('OnlyF.f'));
    assert.equal(r.files[0].hasXml, false);
    assert.deepEqual(r.stores, ['zc_onlyf']);
    assert.deepEqual(r.tables, ['OnlyF']);
    const none = await scanMenu(fx.controllers, 'KhongCoGi', { mobile: false });
    assert.deepEqual(none.files, []);
    const nodir = await scanMenu(path.join(fx.root, 'khong-co'), 'GLTran', { mobile: false });
    assert.deepEqual(nodir.files, []);
    const bad = await scanMenu(fx.controllers, '..\\Dir\\GLTran', { mobile: false });
    assert.deepEqual(bad.files, []);
  } finally {
    fx.cleanup();
  }
});

test('scanMenu mobile: gốc Dashboards thay Report', async () => {
  const fx = buildFixture();
  try {
    const { writeFile } = await import('./fixture');
    writeFile(path.join(fx.controllers, 'Dashboards', 'MobX.xml'), `<dash><reportFile value="Mx.frx"/></dash>`);
    writeFile(path.join(fx.controllers, 'Templates', 'Frx', 'Mx.frx'), '<f/>');
    writeFile(path.join(fx.controllers, 'Report', 'MobX.xml'), `<r/>`);
    const r = await scanMenu(fx.controllers, 'MobX', { mobile: true });
    const n = names(r.files);
    assert.ok(n.includes('Dashboards\\MobX'));
    assert.ok(n.includes('Templates\\Frx\\Mx.frx'));
    assert.ok(!n.includes('Report\\MobX'));
    assert.equal(r.files.find((f) => f.name === 'Dashboards\\MobX')!.role, 'dashboard');
  } finally {
    fx.cleanup();
  }
});

test('scanMenu tôn trọng token hủy', async () => {
  const fx = buildFixture();
  try {
    const r = await scanMenu(fx.controllers, 'GLTran', { mobile: false, token: { isCancellationRequested: true } });
    assert.deepEqual(r.files, []);
  } finally {
    fx.cleanup();
  }
});

test('scanMenu Report: mẫu in khai ở <form reportFile templateFile commandArgument>', async () => {
  const fx = buildFixture();
  try {
    const { writeFile } = await import('./fixture');
    writeFile(
      path.join(fx.controllers, 'Report', 'FormX.xml'),
      `<report>
        <form id="1" reportFile="Co" templateFile="" commandArgument="Pdf"/>
        <form id="2" reportFile="KhongCo.rpt" templateFile="" commandArgument="Pdf"/>
        <form id="3" reportFile="" templateFile="MauThieu" commandArgument="Excel"/>
        <form id="4" reportFile="" templateFile="Mau1" commandArgument="Excel"/>
        <form id="5" reportFile="&amp;bien;" templateFile="" commandArgument="Pdf"/>
      </report>`
    );
    writeFile(path.join(fx.controllers, 'Templates', 'Frx', 'Co.frx'), '<f/>');
    const r = await scanMenu(fx.controllers, 'FormX', { mobile: false });
    const get = (n: string) => r.files.find((f) => f.name === n);
    assert.equal(get('Templates\\Frx\\Co.frx')?.missing, false);
    assert.equal(get('Templates\\Rpt\\KhongCo.rpt')?.missing, true);
    assert.equal(get('Templates\\Excel\\MauThieu.xlsx')?.missing, true);
    assert.equal(get('Templates\\Excel\\Mau1.xlsx')?.missing, false);
    assert.equal(r.files.filter((f) => f.role === 'template').length, 4);
  } finally {
    fx.cleanup();
  }
});

test('normalizeTable: giữ <tên>$000000, bỏ entity / biến / kỳ khác', () => {
  assert.equal(normalizeTable('m11$000000'), 'm11$000000');
  assert.equal(normalizeTable(' GLTran '), 'GLTran');
  assert.equal(normalizeTable('m11$202401'), undefined);
  assert.equal(normalizeTable('m11$'), undefined);
  assert.equal(normalizeTable('$000000'), undefined);
  assert.equal(normalizeTable('&Table;'), undefined);
  assert.equal(normalizeTable('@t'), undefined);
  assert.equal(normalizeTable('a b'), undefined);
  assert.equal(normalizeTable('100%'), undefined);
  assert.equal(normalizeTable(''), undefined);
});
