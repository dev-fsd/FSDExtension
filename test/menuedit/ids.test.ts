import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_NEW_SCRIPT } from '../../src/core/menuedit/autoCommand';
import { commandPrefix, dec2Seq, increaseSeq, left3, mobilePrefix, nextMenuId, seq2Dec } from '../../src/core/menuedit/ids';

const BASE36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

test('ids: ff_IncreaseSeq — mọi mã 1–2 ký tự [0-9A-Z] khớp phép +1 hệ 36 tính độc lập (parseInt / toString)', () => {
  const all: string[] = [];
  for (const a of BASE36) {
    all.push(a);
    for (const b of BASE36) all.push(a + b);
  }
  for (const s of all) {
    const expected = (parseInt(s, 36) + 1).toString(36).toUpperCase();
    assert.equal(increaseSeq(s), expected, `increaseSeq(${s})`);
    assert.equal(seq2Dec(s), parseInt(s, 36), `seq2Dec(${s})`);
  }
  assert.equal(dec2Seq(0), '');
  assert.equal(increaseSeq('99'), '9A');
  assert.equal(increaseSeq('9Z'), 'A0');
  assert.equal(increaseSeq('ZZ'), '100');
});

test('ids: hằng số của ff_Seq2Dec / ff_Dec2Seq đúng như trong script T-SQL của 5.1', () => {
  // Các dòng này là nơi ids.ts lấy số 36, 48, 55, 58, 10 — nếu script 5.1 đổi thì test đỏ.
  for (const frag of [
    'SELECT @nRem=@nQuot%36',
    'SELECT @nQuot=@nQuot/36',
    'SELECT @cHex = CASE WHEN @nRem <10 THEN CAST(@nRem AS VARCHAR) ELSE CHAR(@nRem + 55) END',
    'SELECT @nRem = @nRem - CASE WHEN @nRem <58 THEN  48 ELSE 55 END',
    'SELECT @nDec= @nDec*36 + @nRem, @i = @i + 1',
    'RETURN dbo.ff_Dec2Seq(dbo.ff_Seq2Dec(@sHex) + 1)'
  ]) {
    assert.ok(AUTO_NEW_SCRIPT.split('\n').some((l) => l.trim() === frag), frag);
  }
});

test('ids: nextMenuId = AllocateNextFboCommandMenuId / AllocateNextMobileMenuId của 5.1', () => {
  assert.equal(nextMenuId('', '88.01.'), '88.01.01');
  assert.equal(nextMenuId(null, 'M1.02.'), 'M1.02.01');
  assert.equal(nextMenuId('88.01.07', '88.01.'), '88.01.08');
  assert.equal(nextMenuId('88.01.98', '88.01.'), '88.01.99');
  assert.equal(nextMenuId('88.01.99', '88.01.'), '88.01.9A');
  assert.equal(nextMenuId('88.01.9Z', '88.01.'), '88.01.A0');
  // Strings.Right("0" + x, 2): kết quả 3 ký tự bị cắt còn 2 (ZZ → 100 → "00"), đúng như 5.1.
  assert.equal(nextMenuId('88.01.ZZ', '88.01.'), '88.01.00');
  // Hai ký tự cuối không phải số → đi nhánh ff_IncreaseSeq.
  assert.equal(nextMenuId('88.01.1A', '88.01.'), '88.01.1B');
  assert.equal(left3('03.10.01'), '03.');
  assert.equal(commandPrefix('v'), '88.01.');
  assert.equal(commandPrefix(' R '), '88.02.');
  assert.equal(mobilePrefix('D'), 'M1.01.');
  assert.equal(mobilePrefix('X'), 'M1.02.');
});
