// report.writeSchema: ghi cấu trúc kết quả query ra .xsd (Crystal) hoặc đồng bộ <Dictionary> của .frx (FastReport).
// Args như query.js gửi: { path, name, tables: [{ name, columns: [{ name, clr }] }] } → trả câu báo kết quả.
import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { buildSchemaSet, buildXsd, frxMessage, syncFrx, type SchemaColumn } from '../../core/basket/reportSchema';
import type { Registry } from '../bridge/types';

const BOM = '﻿';

export function register(reg: Registry): void {
  reg.register('report.writeSchema', async (args) => {
    let target = args.path == null ? '' : String(args.path).trim();
    if (target === '') {
      const pick = await vscode.window.showSaveDialog({ filters: { 'XSD / FRX': ['xsd', 'frx'] }, saveLabel: 'Ghi' });
      if (!pick) throw new Error('Đã hủy — chưa chọn file.');
      target = pick.fsPath;
    }
    const tables = Array.isArray(args.tables) ? (args.tables as Array<{ name?: string; columns?: SchemaColumn[] }>) : [];
    if (tables.length === 0) throw new Error('Chưa có bảng kết quả nào.');
    const set = buildSchemaSet(
      args.name == null ? 'ds' : String(args.name),
      tables.map((t) => ({ name: String(t.name ?? ''), columns: Array.isArray(t.columns) ? t.columns : [] }))
    );

    if (/\.frx$/i.test(target)) {
      const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : undefined;
      const { text, result } = syncFrx(existing, set);
      fs.writeFileSync(target, BOM + text, 'utf8');
      return frxMessage(result, target);
    }
    fs.writeFileSync(target, BOM + buildXsd(set), 'utf8');
    return 'Đã ghi ' + target;
  });
}
