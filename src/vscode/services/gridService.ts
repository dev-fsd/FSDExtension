// grid.exportExcel: xuất lưới ra .xlsx (exceljs) rồi mở bằng chương trình mặc định (Excel).
// Args như grid.js gửi: { title, columns: [{ name, clr, width }], rows: [[...]] } → trả đường dẫn file đã ghi.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { writeWorkbook, type ExportColumn } from '../../core/basket/excelExport';
import type { Registry } from '../bridge/types';

const pad = (n: number): string => String(n).padStart(2, '0');

export function register(reg: Registry): void {
  reg.register('grid.exportExcel', async (args) => {
    const columns = Array.isArray(args.columns) ? (args.columns as ExportColumn[]) : [];
    if (columns.length === 0) throw new Error('Lưới chưa có cột nào để xuất.');
    const rows = Array.isArray(args.rows) ? (args.rows as unknown[][]) : [];
    // Mỗi lần một file riêng trong %TEMP%\XML (5.2 ghi đè Book.xml; xlsx đang mở trong Excel thì bị khóa nên đặt theo giờ).
    const dir = path.join(os.tmpdir(), 'XML');
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date();
    const file = path.join(dir, `Book_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.xlsx`);
    await writeWorkbook({ title: args.title == null ? '' : String(args.title), columns, rows }, file);
    await vscode.env.openExternal(vscode.Uri.file(file));
    return file;
  });
}
