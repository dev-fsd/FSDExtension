import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { checkLicense, expectedKey, keyLevel, listMacs, machineCodeFromMac, readKeyFile } from '../../src/core/license/license';

// Cặp (mã máy -> số key cấp 1..5) tính bằng PowerShell `[Math]::Round` thật, port nguyên văn Sys.CheckCode (Sys.vb):
//   Math.Round((789 - 13*k - i*11 - Asc(c(i))) / (i + k), 0)
// Nhiều dòng có đúng ,5 (làm tròn số chẵn) nên kiểm được roundHalfEven khớp .NET. Đây là dữ liệu test, không phải key thật.
const vbKeys: Record<string, string[]> = {
  'Q0NERDExMjI=': ['695358225168130109927268575450', '34123516613210691786360514845', '2231731301088978685553454441', '164136106917668604948414037', '12911189786660544443373634'],
  ']0NERDExMjI=': ['683358225168130109927268575450', '33523516613210691786360514845', '2191731301088978685553454441', '161136106917668604948414037', '12611189786660544443373634'],
  'YkIzQzRENUU=': ['687329227155130100907968595350', '33721516712210684776960534745', '220158131998972676053474341', '162124107837662595448433937', '12710190716755524843393534'],
  'ZUQwMTAyMDM=': ['686340224156131106927268615450', '33622216512210789796360544845', '2201641291009076695553494341', '162128106847766614948443937', '12710589726758544443403634'],
  'Y0I5QzdBMTA=': ['687358227172130100877968595550', '33723516713510684756960534945', '2201731311118972656153474441', '162136107937662575448434037', '12711190806755514843393734'],
  'YEMwRDBFMEY=': ['687348226156130109927968615250', '33722816612210691796860544745', '2201681301008978696053484241', '162131106847668605448443837', '12710789726660544843403534'],
  'ZTY3ODlBQkM=': ['686340222173131109867967575450', '33622316313610791746959514845', '2201641281119078646153454341', '162128104937768565447413937', '12710588806760504843373634'],
  ']kE5ODc2NTQ=': ['683329228172131109878168595350', '33521516813510791757160534845', '2191581321119078656253474341', '161124108937768575548433937', '12610190806760515043393634'],
  'YDAwMDAwMDE=': ['687348230156131109927268615450', '33722816912210791796360544945', '2201681331009078695553494441', '162132108847768614948444037', '12710891726760544443403634']
};

test('expectedKey khớp công thức VB thật (Math.Round làm tròn số chẵn, gồm các ca đúng ,5)', () => {
  for (const [code, keys] of Object.entries(vbKeys)) {
    keys.forEach((want, i) => assert.equal(expectedKey(code, i + 1), want, `mã máy ${code} cấp ${i + 1}`));
  }
});

test('machineCodeFromMac: bỏ dấu : và -, không phân biệt hoa thường, lấy 8 ký tự hex cuối', () => {
  const a = machineCodeFromMac('AABBCCDD1122');
  assert.equal(a, ']0NERDExMjI=');
  assert.equal(machineCodeFromMac('aa:bb:cc:dd:11:22'), a);
  assert.equal(machineCodeFromMac('AA-BB-CC-DD-11-22'), a);
  // Chỉ 8 ký tự cuối có nghĩa.
  assert.equal(machineCodeFromMac('001122CCDD1122'), machineCodeFromMac('FFFFFFCCDD1122'));
  assert.notEqual(machineCodeFromMac('AABBCCDD1123'), a);
});

const mac = 'F8:E4:3B:9C:7A:10';
const code = machineCodeFromMac(mac);
const keyOf = (level: number): string => `${code}||${expectedKey(code, level)}`;

test('keyLevel: cấp 1, 2, 3, 5 đúng cấp; cấp 4 = 0', () => {
  assert.equal(keyLevel(keyOf(1), code), 1);
  assert.equal(keyLevel(keyOf(2), code), 2);
  assert.equal(keyLevel(keyOf(3), code), 3);
  assert.equal(keyLevel(keyOf(5), code), 5);
  assert.equal(keyLevel(keyOf(4), code), 0);
  // Khoảng trắng hai đầu và một dấu | đơn như VB (Replace("||","|")).
  assert.equal(keyLevel(`  ${keyOf(2)}\r\n`, code), 2);
  assert.equal(keyLevel(`${code}|${expectedKey(code, 3)}`, code), 3);
});

test('keyLevel: sai số, sai mã máy, thiếu || đều = 0', () => {
  assert.equal(keyLevel(`${code}||${expectedKey(code, 1)}0`, code), 0);
  assert.equal(keyLevel(`${code}||`, code), 0);
  assert.equal(keyLevel(`${code}||12345`, code), 0);
  const other = machineCodeFromMac('AA:BB:CC:DD:11:22');
  assert.equal(keyLevel(`${other}||${expectedKey(other, 1)}`, code), 0, 'key của máy khác');
  assert.equal(keyLevel(`${code}||${expectedKey(other, 1)}`, code), 0);
  assert.equal(keyLevel(code, code), 0, 'thiếu phần số');
  assert.equal(keyLevel('', code), 0);
});

function tmpFile(name: string, data: Buffer): { file: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsdkey-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, data);
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('readKeyFile: UTF-16LE có BOM, UTF-8 (có/không BOM), file không có', () => {
  const text = keyOf(1);
  const u16 = tmpFile('k16.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text + '\r\n', 'utf16le')]));
  const u8 = tmpFile('k8.txt', Buffer.from(text + '\n', 'utf8'));
  const u8bom = tmpFile('k8b.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]));
  try {
    assert.ok(readKeyFile(u16.file) === text, 'UTF-16LE');
    assert.ok(readKeyFile(u8.file) === text, 'UTF-8');
    assert.ok(readKeyFile(u8bom.file) === text, 'UTF-8 BOM');
    assert.equal(readKeyFile(path.join(os.tmpdir(), 'fsdkey-khong-co', 'x.txt')), '');
  } finally {
    u16.cleanup();
    u8.cleanup();
    u8bom.cleanup();
  }
});

test('checkLicense: key hợp lệ cho MAC thật của máy -> ok; key rác / không key -> không ok', async () => {
  const macs = await listMacs();
  assert.ok(macs.length > 0, 'máy phải có ít nhất một card mạng');
  const real = machineCodeFromMac(macs[0]);
  const good = await checkLicense(`${real}||${expectedKey(real, 2)}`, []);
  assert.equal(good.ok, true);
  assert.equal(good.level, 2);
  assert.equal(good.machineCode, real);
  assert.ok(good.key !== undefined);

  for (const bad of ['rac', `${real}||0`, `${real}||${expectedKey(real, 4)}`, undefined]) {
    const r = await checkLicense(bad, []);
    assert.equal(r.ok, false);
    assert.equal(r.level, 0);
    assert.equal(r.key, undefined);
    assert.equal(r.machineCode, real, 'vẫn trả mã máy để người dùng xin key');
  }
});

test('checkLicense: nhận key từ file (UTF-16LE) khi không có key lưu', async () => {
  const macs = await listMacs();
  const real = machineCodeFromMac(macs[0]);
  const f = tmpFile('key16.fsi', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`${real}||${expectedKey(real, 1)}`, 'utf16le')]));
  try {
    const r = await checkLicense(undefined, [f.file]);
    assert.equal(r.ok, true);
    assert.equal(r.level, 1);
  } finally {
    f.cleanup();
  }
});
