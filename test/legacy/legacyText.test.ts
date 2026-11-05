import { test } from 'node:test';
import * as assert from 'node:assert';
import { decodeUtf7, encodeUtf7 } from '../../src/core/legacy/utf7';
import { decodeP, decodeText, encodeText } from '../../src/core/legacy/legacyText';

const ascii = (b: Uint8Array): string => Buffer.from(b).toString('latin1');
const b64 = (b: Uint8Array): string => Buffer.from(b).toString('base64');

// Cặp (chuỗi gốc, ASCII UTF-7, Base64 của byte) lấy từ System.Text.Encoding.UTF7 của .NET Framework thật (PowerShell 5.1).
const DOTNET: Array<[string, string, string]> = [
  ['abc@def', 'abc+AEA-def', 'YWJjK0FFQS1kZWY='],
  ['a!', 'a+ACE-', 'YStBQ0Ut'],
  ['@', '+AEA-', 'K0FFQS0='],
  ['x+y', 'x+-y', 'eCsteQ=='],
  ['@-', '+AEA--', 'K0FFQS0t'],
  ['ab#', 'ab+ACM-', 'YWIrQUNNLQ=='],
  ['a b$ c', 'a b+ACQ- c', 'YSBiK0FDUS0gYw=='],
  ['~a', '+AH4-a', 'K0FINC1h'],
  ['"q"', '+ACI-q+ACI-', 'K0FDSS1xK0FDSS0='],
  ['a@@b', 'a+AEAAQA-b', 'YStBRUFBUUEtYg=='],
  ['Pass@2024!', 'Pass+AEA-2024+ACE-', 'UGFzcytBRUEtMjAyNCtBQ0Ut'],
  ['a_b', 'a+AF8-b', 'YStBRjgtYg=='],
  ['a-b@', 'a-b+AEA-', 'YS1iK0FFQS0='],
  ['a@+', 'a+AEAAKw-', 'YStBRUFBS3ct'],
  ['a%b&c*d', 'a+ACU-b+ACY-c+ACo-d', 'YStBQ1UtYitBQ1ktYytBQ28tZA=='],
  ['1+1=2', '1+-1+AD0-2', 'MSstMStBRDAtMg=='],
  ['C:\\a', 'C:+AFw-a', 'QzorQUZ3LWE='],
  ['Fast@2024#Vn', 'Fast+AEA-2024+ACM-Vn', 'RmFzdCtBRUEtMjAyNCtBQ00tVm4='],
  // tiếng Việt
  ['M\u1eadt kh\u1ea9u@123', 'M+Hq0-t kh+Hqk-u+AEA-123', 'TStIcTAtdCBraCtIcWstdStBRUEtMTIz'],
  ['S\u1ed1 1, 2; 3', 'S+HtE- 1, 2+ADs- 3', 'UytIdEUtIDEsIDIrQURzLSAz'],
  ['\u00e9', '+AOk-', 'K0FPay0='],
  ['a\u00e9b', 'a+AOk-b', 'YStBT2stYg=='],
  ['\u00e9+', '+AOkAKw-', 'K0FPa0FLdy0='],
  ['Ti\u1ebfng Vi\u1ec7t: \u0110\u1eb7c bi\u1ec7t!', 'Ti+Hr8-ng Vi+Hsc-t: +ARAetw-c bi+Hsc-t+ACE-',
    'VGkrSHI4LW5nIFZpK0hzYy10OiArQVJBZXR3LWMgYmkrSHNjLXQrQUNFLQ=='],
  // cặp thay thế (emoji)
  ['\ud83d\ude00', '+2D3eAA-', 'KzJEM2VBQS0='],
];

test('encodeUtf7 khớp .NET Encoding.UTF7', () => {
  for (const [text, a, b] of DOTNET) {
    const bytes = encodeUtf7(text);
    assert.strictEqual(ascii(bytes), a, `ASCII của ${JSON.stringify(text)}`);
    assert.strictEqual(b64(bytes), b, `Base64 của ${JSON.stringify(text)}`);
  }
});

test('decodeUtf7 giải đúng chuỗi do .NET sinh', () => {
  for (const [text, , b] of DOTNET) {
    assert.strictEqual(decodeUtf7(Buffer.from(b, 'base64')), text);
  }
});

test('decodeUtf7: "+-", ký tự trực tiếp, khối base64 không có "-" kết thúc', () => {
  assert.strictEqual(decodeUtf7(Buffer.from('a+-b')), 'a+b');
  assert.strictEqual(decodeUtf7(Buffer.from('+AEA')), '@');
  assert.strictEqual(decodeUtf7(Buffer.from('+AEA!')), '@!'); // gặp '!' (không thuộc bảng base64) thì khối kết thúc, không nuốt
  assert.strictEqual(decodeUtf7(Buffer.from('+AEA-!')), '@!');
  assert.strictEqual(decodeUtf7(Buffer.from('')), '');
});

const SAMPLES = [
  '',
  'abc',
  'P@ssw0rd!',
  'p@$$ w0rd # % + - _ ; < > [ ] { } | ^ ` ~ \\ "',
  'M\u1eadt kh\u1ea9u \u0110\u1eb7c bi\u1ec7t @ ! # $ % +',
  'Nguy\u1ec5n V\u0103n A:123',
  '\ud83d\ude00 emoji',
];

test('encodeText/decodeText round-trip với nhiều key', () => {
  for (const key of [0, 3, 11, 13, 27]) {
    for (const s of SAMPLES) {
      const enc = encodeText(s, key);
      assert.strictEqual(decodeText(enc, key), s, `key ${key}: ${JSON.stringify(s)}`);
    }
  }
});

test('encodeText: ký tự đầu dịch 3 + key - số chữ số của key', () => {
  // base64 gốc của "Pass@2024!" bắt đầu bằng 'U' (85)
  assert.strictEqual(encodeText('Pass@2024!', 0), String.fromCharCode(85 + 3 + 0 - 1) + 'GFzcytBRUEtMjAyNCtBQ0Ut');
  assert.strictEqual(encodeText('Pass@2024!', 13), String.fromCharCode(85 + 3 + 13 - 2) + 'GFzcytBRUEtMjAyNCtBQ0Ut');
  assert.strictEqual(encodeText('Pass@2024!', 27), String.fromCharCode(85 + 3 + 27 - 2) + 'GFzcytBRUEtMjAyNCtBQ0Ut');
  assert.strictEqual(encodeText('Pass@2024!', 3), String.fromCharCode(85 + 3 + 3 - 1) + 'GFzcytBRUEtMjAyNCtBQ0Ut');
});

test('decodeText lỗi thì trả nguyên chuỗi như VB', () => {
  assert.strictEqual(decodeText('', 13), '');
  assert.strictEqual(decodeText('!!!không phải base64', 13), '!!!không phải base64');
  assert.strictEqual(decodeText('abc', 13), 'abc'); // độ dài không bội 4
});

test('decodeP: Base64 UTF-32LE, tự thêm "=" tối đa 2 lần', () => {
  const utf32 = (s: string): string => {
    const cps = Array.from(s).map((c) => c.codePointAt(0) as number);
    const buf = Buffer.alloc(cps.length * 4);
    cps.forEach((cp, i) => buf.writeUInt32LE(cp, i * 4));
    return buf.toString('base64');
  };
  for (const s of ['abc', 'P@ss', 'M\u1eadt kh\u1ea9u', 'a']) {
    const enc = utf32(s);
    assert.strictEqual(decodeP(enc), s);
    assert.strictEqual(decodeP(enc.replace(/=+$/, '')), s); // thiếu padding
  }
  assert.strictEqual(decodeP('!!!!'), '!!!!');
  assert.strictEqual(decodeP(''), '');
});
