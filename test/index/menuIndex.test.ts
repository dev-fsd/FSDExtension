import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import type { MenuItem } from '../../src/core/types';
import { MenuIndex } from '../../src/core/index/menuIndex';
import { buildFixture, writeFile } from '../controllers/fixture';

const menu = (id: string, sysId: string, bar = 'Menu ' + id): MenuItem => ({ kind: 'fbo', id, parentId: '', bar, sysId, link: '', type: 'V' });

test('build: file → menu, nhiều menu trùng sysid dùng chung một lần quét; .f/.xml cùng khóa', async () => {
  const fx = buildFixture();
  try {
    const cacheFile = path.join(fx.root, 'cache', 'x.index.json');
    const idx = new MenuIndex({ cacheFile, controllersDir: (k) => (k === 'fbo' ? fx.controllers : undefined), crypto: fx.crypto });
    const progress: number[] = [];
    await idx.build([menu('1', 'GLTran'), menu('2', 'GLTran', 'Menu hai'), menu('3', 'OnlyF'), menu('4', '')], (d, t) => progress.push(d * 100 + t));
    assert.deepEqual(progress.at(-1), 202);
    const viaXml = idx.menusOfFile(path.join(fx.controllers, 'Dir', 'GLTran.xml'));
    const viaF = idx.menusOfFile(path.join(fx.controllers, 'Dir', 'GLTran.f').toUpperCase());
    assert.deepEqual(viaXml.map((m) => m.menuId).sort(), ['1', '2']);
    assert.deepEqual(viaF, viaXml);
    assert.equal(viaXml[0].bar, 'Menu 1');
    assert.deepEqual(idx.menusOfFile(path.join(fx.controllers, 'Dir', 'OnlyF.f')).map((m) => m.menuId), ['3']);
    assert.deepEqual(idx.menusOfFile(path.join(fx.controllers, 'Grid', 'GLTranDetail.f')).map((m) => m.menuId).sort(), ['1', '2']);
    assert.deepEqual(idx.menusOfFile(path.join(fx.controllers, 'Dir', 'khac.xml')), []);
    assert.ok(idx.structureOf('fbo', 'gltran')!.files.length > 5);
    assert.equal(idx.structureOf('mob', 'GLTran'), undefined);

    await idx.save();
    const idx2 = new MenuIndex({ cacheFile, controllersDir: () => undefined });
    await idx2.load();
    assert.deepEqual(idx2.menusOfFile(path.join(fx.controllers, 'Dir', 'GLTran.f')).map((m) => m.menuId).sort(), ['1', '2']);
    assert.equal(idx2.structureOf('fbo', 'GLTran')!.files.length, idx.structureOf('fbo', 'GLTran')!.files.length);
  } finally {
    fx.cleanup();
  }
});

test('build lần 2 dùng cache khi file gốc không đổi, quét lại khi mtime đổi', async () => {
  const fx = buildFixture();
  try {
    const idx = new MenuIndex({ cacheFile: path.join(fx.root, 'c.json'), controllersDir: () => fx.controllers, crypto: fx.crypto });
    await idx.build([menu('1', 'OnlyF')]);
    const first = idx.structureOf('fbo', 'OnlyF');
    // thêm Grid\OnlyF → file gốc mới → chữ ký đổi → quét lại
    await idx.build([menu('1', 'OnlyF')]);
    assert.equal(idx.structureOf('fbo', 'OnlyF'), first, 'cache dùng lại cùng đối tượng');
    writeFile(path.join(fx.controllers, 'Grid', 'OnlyF.xml'), '<grid table="Moi"/>');
    await idx.build([menu('1', 'OnlyF')]);
    assert.notEqual(idx.structureOf('fbo', 'OnlyF'), first);
    assert.ok(idx.structureOf('fbo', 'OnlyF')!.files.some((f) => f.name === 'Grid\\OnlyF'));
    // bỏ menu → bỏ cấu trúc
    await idx.build([]);
    assert.equal(idx.structureOf('fbo', 'OnlyF'), undefined);
  } finally {
    fx.cleanup();
  }
});

test('invalidateFile: quét lại sysId chứa file và trả menu mới', async () => {
  const fx = buildFixture();
  try {
    const idx = new MenuIndex({ cacheFile: path.join(fx.root, 'c.json'), controllersDir: () => fx.controllers, crypto: fx.crypto });
    await idx.build([menu('1', 'GLTran'), menu('2', 'OnlyF')]);
    const detail = path.join(fx.controllers, 'Grid', 'GLTranDetail.f');
    assert.equal(idx.structureOf('fbo', 'GLTran')!.files.find((f) => f.name === 'Grid\\GLTranThieu')!.missing, true);
    // tạo file đang thiếu rồi báo đổi
    writeFile(path.join(fx.controllers, 'Grid', 'GLTranThieu.xml'), '<grid table="Thieu"/>');
    // file không đổi → không quét lại (cùng đối tượng cấu trúc), vẫn trả menu
    const before = idx.structureOf('fbo', 'GLTran');
    assert.deepEqual((await idx.invalidateFile(detail)).map((r) => r.menuId), ['1']);
    assert.equal(idx.structureOf('fbo', 'GLTran'), before);
    // file con đổi ngày sửa → quét lại
    writeFile(detail, '<grid table="GLTranD"><command>exec zc_detail_ds</command></grid>', 2000000000);
    const refs = await idx.invalidateFile(detail);
    assert.deepEqual(refs.map((r) => r.menuId), ['1']);
    assert.notEqual(idx.structureOf('fbo', 'GLTran'), before);
    assert.equal(idx.structureOf('fbo', 'GLTran')!.files.find((f) => f.name === 'Grid\\GLTranThieu')!.missing, false);
    // file gốc mới tạo cho sysId có menu
    const g = path.join(fx.controllers, 'Grid', 'OnlyF.xml');
    writeFile(g, '<grid table="G"/>');
    const refs2 = await idx.invalidateFile(g);
    assert.deepEqual(refs2.map((r) => r.menuId), ['2']);
    assert.ok(idx.menusOfFile(g).length === 1);
    assert.ok(fs.existsSync(path.join(fx.root, 'c.json')));
  } finally {
    fx.cleanup();
  }
});

test('ensureStructure quét khi chưa có, hủy build dừng sớm', async () => {
  const fx = buildFixture();
  try {
    const idx = new MenuIndex({ cacheFile: path.join(fx.root, 'c.json'), controllersDir: () => fx.controllers, crypto: fx.crypto });
    const s = await idx.ensureStructure('fbo', 'OnlyF');
    assert.equal(s.files.length, 1);
    assert.equal(idx.structureOf('fbo', 'OnlyF'), s);
    const idx2 = new MenuIndex({ cacheFile: path.join(fx.root, 'd.json'), controllersDir: () => fx.controllers });
    await idx2.build([menu('1', 'GLTran')], undefined, { isCancellationRequested: true });
    assert.equal(idx2.structureOf('fbo', 'GLTran'), undefined);
  } finally {
    fx.cleanup();
  }
});

test('rootMenusOfFile: chỉ file gốc của menu; file dùng chung thì rỗng; roleOfFile + version', async () => {
  const fx = buildFixture();
  try {
    const idx = new MenuIndex({ cacheFile: path.join(fx.root, 'r.json'), controllersDir: (k) => (k === 'fbo' ? fx.controllers : undefined), crypto: fx.crypto });
    const v0 = idx.version;
    await idx.build([menu('1', 'GLTran'), menu('2', 'GLTran'), menu('3', 'OnlyF')]);
    assert.ok(idx.version > v0);
    const dir = path.join(fx.controllers, 'Dir', 'GLTran.f');
    assert.deepEqual(idx.rootMenusOfFile(dir).map((m) => m.menuId).sort(), ['1', '2']);
    assert.deepEqual(idx.rootMenusOfFile(path.join(fx.controllers, 'Dir', 'OnlyF.xml')).map((m) => m.menuId), ['3']);
    // Grid con (via grid) và Lookup không phải file gốc
    assert.deepEqual(idx.rootMenusOfFile(path.join(fx.controllers, 'Grid', 'GLTranDetail.f')), []);
    assert.deepEqual(idx.rootMenusOfFile(path.join(fx.controllers, 'Lookup', 'LkAcc.xml')), []);
    assert.equal(idx.roleOfFile(dir), 'dir');
    assert.equal(idx.roleOfFile(path.join(fx.controllers, 'Grid', 'GLTranDetail.f')), 'grid');
    assert.equal(idx.roleOfFile(path.join(fx.controllers, 'Lookup', 'LkAcc.xml')), 'lookup');
    assert.equal(idx.roleOfFile(path.join(fx.controllers, 'Report', 'GLTran.xml')), 'report');
    assert.equal(idx.roleOfFile(path.join(fx.controllers, 'Dir', 'khac.xml')), undefined);
  } finally {
    fx.cleanup();
  }
});
