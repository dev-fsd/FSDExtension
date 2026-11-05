import * as assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import * as zlib from 'node:zlib';
import { FControllerCrypto } from '../../src/core/controllers/fCrypto';

const rnd = (n: number): Uint8Array => new Uint8Array(crypto.randomBytes(n));

test('encode ↔ decodeWith với key 16/24/32 byte', () => {
  for (const len of [16, 24, 32]) {
    const key = rnd(len);
    const iv = rnd(16);
    const text = '<command>exec zc_thu @x=1 -- tiếng Việt: Phiếu nhập kho</command>';
    const enc = FControllerCrypto.encode(text, key, iv);
    assert.equal(FControllerCrypto.decodeWith(enc, key, iv), text);
    // base64 có xuống dòng / khoảng trắng vẫn giải được
    assert.equal(FControllerCrypto.decodeWith(enc.slice(0, 20) + '\r\n  ' + enc.slice(20), key, iv), text);
  }
});

test('key sai hoặc dữ liệu hỏng → undefined, không ném lỗi', () => {
  const key = rnd(16);
  const iv = rnd(16);
  const enc = FControllerCrypto.encode('xin chào', key, iv);
  assert.equal(FControllerCrypto.decodeWith(enc, rnd(16), iv), undefined);
  assert.equal(FControllerCrypto.decodeWith('khong phai base64!!', key, iv), undefined);
  assert.equal(FControllerCrypto.decodeWith('', key, iv), undefined);
  assert.equal(FControllerCrypto.decodeWith('AAAA', key, iv), undefined);
  assert.equal(FControllerCrypto.decodeWith(enc, rnd(10), iv), undefined);
  // vùng bắt đầu & / % với bản mã vô nghĩa
  assert.equal(FControllerCrypto.decodeWith('&' + enc, key, iv), undefined);
  assert.equal(FControllerCrypto.decodeWith('%' + enc, key, iv), undefined);
});

test('thân bắt đầu 1F 8B được gunzip', () => {
  const key = rnd(32);
  const iv = rnd(16);
  const text = '<grid>' + 'abc đ '.repeat(200) + '</grid>';
  const gz = zlib.gzipSync(Buffer.from(text, 'utf8'));
  const c = crypto.createCipheriv('aes-256-cbc', key, iv);
  const enc = Buffer.concat([c.update(gz), c.final()]).toString('base64');
  assert.equal(FControllerCrypto.decodeWith(enc, key, iv), text);
});

test('gzip thiếu phần kết (kiểu .NET cũ) vẫn lấy được phần đã có', () => {
  const key = rnd(16);
  const iv = rnd(16);
  const text = 'dong du lieu\n'.repeat(500);
  const gz = zlib.gzipSync(Buffer.from(text, 'utf8'), { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  const cut = gz.subarray(0, gz.length - 8); // bỏ CRC + ISIZE
  const c = crypto.createCipheriv('aes-128-cbc', key, iv);
  const enc = Buffer.concat([c.update(cut), c.final()]).toString('base64');
  const out = FControllerCrypto.decodeWith(enc, key, iv);
  assert.ok(out !== undefined && out.startsWith('dong du lieu'));
});

test('decode thử nhiều key, nhớ key vừa giải được', () => {
  const k1 = { key: rnd(16), iv: rnd(16) };
  const k2 = { key: rnd(32), iv: rnd(16) };
  const fc = new FControllerCrypto([k1, k2]);
  assert.equal(fc.keyCount, 2);
  assert.equal(fc.decode(FControllerCrypto.encode('a', k2.key, k2.iv)), 'a');
  assert.equal(fc.decode(FControllerCrypto.encode('b', k1.key, k1.iv)), 'b');
  assert.equal(fc.decode(FControllerCrypto.encode('c', rnd(16), rnd(16))), undefined);
  assert.equal(new FControllerCrypto([]).decode('QUJD'), undefined);
});

test('hex và loadKeys', () => {
  assert.deepEqual([...FControllerCrypto.hex('0a ff-10')], [0x0a, 0xff, 0x10]);
  assert.equal(FControllerCrypto.hex('abc').length, 0);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fsdkeys-')), 'keys.txt');
  const key = crypto.randomBytes(16).toString('hex');
  const iv = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(file, `${key}|${iv}\r\n${key}|${iv}\nrac\n${'ab'.repeat(5)}|${iv}\n${crypto.randomBytes(32).toString('hex')}|${iv}\n`);
  const keys = FControllerCrypto.loadKeys(file);
  assert.equal(keys.length, 2);
  assert.equal(keys[0].key.length, 16);
  assert.equal(keys[1].key.length, 32);
  assert.equal(FControllerCrypto.loadKeys(path.join(os.tmpdir(), 'khong-co-file.txt')).length, 0);
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});
