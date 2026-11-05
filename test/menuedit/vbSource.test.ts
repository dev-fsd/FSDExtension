// Chứng minh SQL của Sửa menu khớp VB 5.1: đọc lại chính các file VB trong repo (FSDStudioSrc\…) và đối chiếu
//   1) mỗi đoạn mã VB được trích ở VB_REFS còn nằm đúng dòng đã ghi;
//   2) hai script AUTO (autoCommand.ts) = hai khối XML literal trong frmWCommandUpdate.vb (từng dòng, bỏ thụt lề / khoảng trắng cuối / dòng trống);
//   3) bốn form KHÔNG còn gọi xCmd.GetScript(...) (mọi lần gọi đã comment) — tức không câu nào lấy từ system.db lúc chạy;
//   4) buildAutoNew thay [%…] cho kết quả như chuỗi Replace của VB (khi giá trị không chứa nháy / "[%").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AUTO_MAIN_SCRIPT, AUTO_NEW_SCRIPT, buildAutoNew } from '../../src/core/menuedit/autoCommand';
import { VB_REFS } from '../../src/core/menuedit/sql51';

// out-test\test\menuedit → lên 4 cấp = gốc repo (FSDStudio V5.1).
const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const SRC = path.join(REPO, 'FSDStudioSrc');
const cache = new Map<string, string[]>();

function vbLines(rel: string): string[] {
  const file = path.resolve(SRC, rel);
  let l = cache.get(file);
  if (!l) {
    l = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');
    cache.set(file, l);
  }
  return l;
}

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

test('VB_REFS: đoạn mã VB được trích còn nằm đúng dòng đã ghi', () => {
  assert.ok(fs.existsSync(SRC), `không thấy ${SRC}`);
  for (const r of VB_REFS) {
    const line = vbLines(r.file)[r.line - 1] ?? '';
    assert.ok(squash(line).includes(squash(r.vb)), `${r.fn}: ${r.file}:${r.line} không chứa đoạn VB đã trích.\n  dòng: ${line.trim()}\n  cần : ${r.vb}`);
  }
});

/** Lấy nội dung XML literal <sql>…</sql> bắt đầu ở dòng `start` (1-based) trong VB; giải mã &lt; &gt; &amp;. */
function xmlLiteral(rel: string, start: number): string {
  const lines = vbLines(rel);
  const out: string[] = [];
  for (let i = start - 1; i < lines.length; i++) {
    let l = lines[i];
    if (i === start - 1) l = l.slice(l.indexOf('<sql>') + 5);
    const end = l.indexOf('</sql>');
    if (end >= 0) {
      out.push(l.slice(0, end));
      break;
    }
    out.push(l);
  }
  return out.join('\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** So theo từng dòng: bỏ thụt lề / khoảng trắng cuối dòng và dòng trống (dòng chú thích `--` vẫn là dòng riêng nên không nuốt lệnh). */
const byLines = (s: string): string[] => s.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter((l) => l !== '');

test('AUTO_MAIN_SCRIPT = khối <sql> frmWCommandUpdate.vb:933–989', () => {
  const vb = xmlLiteral('UI/Dialogs/frmWCommandUpdate.vb', 933);
  assert.deepEqual(byLines(AUTO_MAIN_SCRIPT), byLines(vb));
});

test('AUTO_NEW_SCRIPT = khối <sql> frmWCommandUpdate.vb:998–1098', () => {
  const vb = xmlLiteral('UI/Dialogs/frmWCommandUpdate.vb', 998);
  assert.deepEqual(byLines(AUTO_NEW_SCRIPT), byLines(vb));
});

test('bốn form Sửa menu không gọi xCmd.GetScript — mọi lần gọi đều đã comment', () => {
  for (const f of ['frmWCommandUpdate.vb', 'frmCommandUpdate.vb', 'frmDVCommand.vb', 'frmDuplicateUpdate.vb']) {
    vbLines('UI/Dialogs/' + f).forEach((l, i) => {
      if (/GetScript\s*\(/i.test(l)) assert.ok(l.trim().startsWith("'"), `${f}:${i + 1} còn gọi GetScript đang chạy: ${l.trim()}`);
    });
  }
});

test('buildAutoNew = chuỗi Replace của VB (frmWCommandUpdate.vb:1100–1101) với giá trị thường', () => {
  const a = { type: 'V', wmenuId: '03.10.01', menuId: '', bar: 'Phiếu nhập', bar2: 'Voucher', link: 'inctpnd', sysId: 'SVTran', sysCode: 'PN' };
  const l1100 = vbLines('UI/Dialogs/frmWCommandUpdate.vb')[1099];
  const l1101 = vbLines('UI/Dialogs/frmWCommandUpdate.vb')[1100];
  // thứ tự Replace trong VB: Type, WMenu_id, Menu_id, Bar2, Bar | Exe, SysID, SysCode
  assert.deepEqual([...(l1100 + l1101).matchAll(/Replace\("\[%(\w+)\]"/g)].map((m) => m[1]), ['Type', 'WMenu_id', 'Menu_id', 'Bar2', 'Bar', 'Exe', 'SysID', 'SysCode']);
  const vbWay = AUTO_NEW_SCRIPT.replace('[%Type]', a.type).replace('[%WMenu_id]', a.wmenuId).replace('[%Menu_id]', a.menuId).replace('[%Bar2]', a.bar2).replace('[%Bar]', a.bar)
    .replace('[%Exe]', a.link).replace('[%SysID]', a.sysId).replace('[%SysCode]', a.sysCode);
  assert.equal(buildAutoNew(a), vbWay);
});
