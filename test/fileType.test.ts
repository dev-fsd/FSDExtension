import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileTypeOf } from '../src/core/fileType';

const f = (p: string, hasF = false, hasXml = false) => ({ path: p, hasF, hasXml });

test('fileTypeOf: controller có .xml hiện xml dù cũng có .f; chỉ có .f hiện f', () => {
  assert.equal(fileTypeOf(f('C:\\C\\Dir\\SVTran.xml', true, true)), 'xml');
  assert.equal(fileTypeOf(f('C:\\C\\Dir\\SVTran.xml', false, true)), 'xml');
  assert.equal(fileTypeOf(f('C:\\C\\Dir\\SVTran.f', true, false)), 'f');
});

test('fileTypeOf: file mẫu / Include theo đuôi trong danh sách cố định', () => {
  assert.equal(fileTypeOf(f('C:\\C\\Include\\Command\\Revert.SVTran.ent')), 'ent');
  assert.equal(fileTypeOf(f('C:\\C\\Include\\Javascript\\Currency.txt')), 'txt');
  assert.equal(fileTypeOf(f('C:\\C\\Templates\\Rpt\\Rep1.RPT')), 'rpt');
  assert.equal(fileTypeOf(f('C:\\C\\Templates\\Frx\\Rep1.frx')), 'frx');
  assert.equal(fileTypeOf(f('C:\\C\\Templates\\Rldc\\Rep1.rldc')), 'rldc');
  assert.equal(fileTypeOf(f('C:\\C\\Templates\\Excel\\Mau1.xlsx')), 'xlsx');
  assert.equal(fileTypeOf(f('C:\\C\\Templates\\Upload\\GLImp.xml')), 'xml');
});

test('fileTypeOf: file Include có "đuôi" là sysid thì dùng icon chung', () => {
  assert.equal(fileTypeOf(f('C:\\C\\Include\\Javascript\\Extender.Include.SVTran')), '');
  assert.equal(fileTypeOf(f('C:\\C\\Include\\Command\\MultiPrint.Grid.Queries.SVTran')), '');
  assert.equal(fileTypeOf(f('C:\\C\\Include\\Command\\Tiny.External.GLTran')), '');
  assert.equal(fileTypeOf(f('C:\\C\\Include\\Command\\NoExt')), '');
});
