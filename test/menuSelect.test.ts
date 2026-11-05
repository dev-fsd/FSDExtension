import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickMenuForFile } from '../src/core/menuSelect';
import type { MenuRef } from '../src/core/types';

const ref = (menuId: string, kind: 'fbo' | 'mob' = 'fbo'): MenuRef => ({ kind, menuId, sysId: 'SVTran', bar: 'Menu ' + menuId });

test('pickMenuForFile: file dùng chung (không phải file gốc) giữ menu đang chọn', () => {
  const sel = ref('07.10.06');
  assert.equal(pickMenuForFile([], sel), sel);
});

test('pickMenuForFile: file con của menu đang chọn mà là file gốc menu khác thì giữ menu đang chọn', () => {
  const sel = ref('07.10.06');
  assert.equal(pickMenuForFile([ref('01.20.01')], sel, [sel, ref('01.20.01')]), sel);
});

test('pickMenuForFile: file dùng chung mà chưa chọn menu nào thì không chọn', () => {
  assert.equal(pickMenuForFile([], undefined), undefined);
});

test('pickMenuForFile: file gốc của menu đang chọn thì giữ (kể cả khi menu khác cùng sysid đứng trước)', () => {
  const sel = ref('11.11.06');
  assert.equal(pickMenuForFile([ref('07.10.06'), ref('11.11.06')], sel), sel);
});

test('pickMenuForFile: file gốc của menu khác thì đổi sang menu đầu của file', () => {
  const sel = ref('05.01.01');
  assert.deepEqual(pickMenuForFile([ref('07.10.06'), ref('11.11.06')], sel), ref('07.10.06'));
});

test('pickMenuForFile: chưa chọn thì ưu tiên menu nhận file làm gốc', () => {
  assert.deepEqual(pickMenuForFile([ref('07.10.06')], undefined), ref('07.10.06'));
});

test('pickMenuForFile: cùng mã khác loại (FBO / Mobile) là hai menu khác nhau', () => {
  const sel = ref('01', 'fbo');
  assert.deepEqual(pickMenuForFile([ref('01', 'mob')], sel), ref('01', 'mob'));
});
