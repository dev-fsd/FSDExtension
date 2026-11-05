import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { FControllerCrypto } from '../../src/core/controllers/fCrypto';
import { convertText, readController, resolveKeyFile, stripControllerExt } from '../../src/core/controllers/controllerReader';
import { buildFixture, writeFile } from './fixture';

test('convertText: <Encrypted> và ENTITY Begin…End', () => {
  const key = new Uint8Array(16).fill(7);
  const iv = new Uint8Array(16).fill(9);
  const fc = new FControllerCrypto([{ key, iv }]);
  const a = FControllerCrypto.encode('AAA', key, iv);
  const b = FControllerCrypto.encode('BBB', key, iv);
  const input = `x<Encrypted>${a}</encrypted>y<!ENTITY E "FastBusiness.Encryption.Begin${b}FastBusiness.Encryption.End">z<Encrypted>rac</Encrypted>`;
  const r = convertText(input, fc);
  assert.equal(r.text, `xAAAy<!ENTITY E "BBB">z<Encrypted>rac</Encrypted>`);
  assert.equal(r.decodedRegions, 2);
  assert.equal(r.lockedRegions, 1);
  // không có khóa: giữ nguyên, đếm khóa
  const r2 = convertText(input);
  assert.equal(r2.text, input);
  assert.equal(r2.lockedRegions, 3);
});

test('stripControllerExt', () => {
  assert.equal(stripControllerExt('a\\b.F'), 'a\\b');
  assert.equal(stripControllerExt(' a\\b.xml '), 'a\\b');
  assert.equal(stripControllerExt('a\\b'), 'a\\b');
});

test('readController: .f giải trọn, bỏ BOM', async () => {
  const fx = buildFixture();
  try {
    const r = await readController(path.join(fx.controllers, 'Dir', 'GLTran.xml'), fx.crypto);
    assert.ok(r);
    assert.equal(r.source, 'f');
    assert.equal(r.path.endsWith('GLTran.f'), true);
    assert.equal(r.fellBackFromF, false);
    assert.equal(r.decodedRegions, 1);
    assert.ok(r.text.includes('zc_bi_mat'));
    assert.ok(!r.text.startsWith('﻿'));
  } finally {
    fx.cleanup();
  }
});

test('readController: không có khóa, có .xml → đọc .xml (fellBackFromF)', async () => {
  const fx = buildFixture();
  try {
    const r = await readController(path.join(fx.controllers, 'Dir', 'GLTran'));
    assert.ok(r);
    assert.equal(r.source, 'xml');
    assert.equal(r.fellBackFromF, true);
    assert.ok(r.text.includes('zc_GLTran_Xml'));
    assert.ok(!r.text.includes('zc_bi_mat'));
  } finally {
    fx.cleanup();
  }
});

test('readController: chỉ có .f còn vùng khóa → trả bản .f; chỉ .xml; không có gì', async () => {
  const fx = buildFixture();
  try {
    const onlyF = path.join(fx.controllers, 'Dir', 'OnlyLocked');
    writeFile(onlyF + '.f', `<d><Encrypted>QUJDREVGR0hJSktMTU5PUA==</Encrypted></d>`);
    const r = await readController(onlyF);
    assert.ok(r);
    assert.equal(r.source, 'f');
    assert.equal(r.lockedRegions, 1);
    const x = await readController(path.join(fx.controllers, 'Lookup', 'LkAcc'));
    assert.equal(x?.source, 'xml');
    assert.equal(x?.fellBackFromF, false);
    assert.equal(await readController(path.join(fx.controllers, 'Dir', 'KhongCo')), undefined);
  } finally {
    fx.cleanup();
  }
});

test('resolveKeyFile: tham số cấu hình thắng; không có thì rơi về USERPROFILE', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsdkf-'));
  try {
    const f = path.join(dir, 'k.txt');
    fs.writeFileSync(f, '');
    assert.equal(resolveKeyFile(f), f);
    process.env.FSD_TEST_DIR = dir;
    assert.equal(resolveKeyFile('%FSD_TEST_DIR%\\k.txt'), path.join(dir, 'k.txt'));
    const old = process.env.USERPROFILE;
    process.env.USERPROFILE = dir;
    assert.equal(resolveKeyFile(path.join(dir, 'khong-co.txt')), '');
    fs.writeFileSync(path.join(dir, 'convert_keys.txt'), '');
    assert.equal(resolveKeyFile(), path.join(dir, 'convert_keys.txt'));
    process.env.USERPROFILE = old;
  } finally {
    delete process.env.FSD_TEST_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
