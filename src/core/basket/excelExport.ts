// Xuất lưới ra .xlsx bằng exceljs — port GridService.WriteWorkbook 5.2 (SpreadsheetML → xlsx).
// 5 dòng đầu (công ty, bộ phận, trống, tiêu đề gộp, trống), dòng tiêu đề cột, dữ liệu; tối đa 64000 dòng mỗi sheet.
import ExcelJS from 'exceljs';

export interface ExportColumn {
  name: string;
  /** Kiểu .NET đầy đủ, vd "System.Int32". */
  clr?: string;
  /** Độ rộng cột theo điểm ảnh của lưới. */
  width?: number;
}
export interface ExportArgs {
  title?: string;
  columns: ExportColumn[];
  rows: unknown[][];
}

export const MAX_ROWS_PER_SHEET = 64000;

export type CellKind = 'date' | 'bool' | 'int' | 'dec' | 'str';

export function kindOf(clr: string | undefined): CellKind {
  switch (clr ?? '') {
    case 'System.DateTime': return 'date';
    case 'System.Boolean': return 'bool';
    case 'System.Int16':
    case 'System.Int32':
    case 'System.Int64':
    case 'System.Byte': return 'int';
    case 'System.Decimal':
    case 'System.Double':
    case 'System.Single': return 'dec';
    default: return 'str';
  }
}

/** Chuỗi ngày → Date giữ nguyên giờ treo tường (UTC giả) để Excel hiện đúng số ngày/giờ; không đọc được → undefined. */
export function parseDateWall(v: unknown): Date | undefined {
  if (v instanceof Date) return v;
  if (typeof v !== 'string') return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(v.trim());
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)));
  const d = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(v.trim());
  if (d) return new Date(Date.UTC(+d[3], +d[2] - 1, +d[1], +(d[4] ?? 0), +(d[5] ?? 0), +(d[6] ?? 0)));
  return undefined;
}

const isNull = (v: unknown): boolean => v === null || v === undefined;

/** Giá trị ô theo kind (5.1): NULL số = 0, bool = 0/1, chuỗi trim, ngày không đọc được = chuỗi rỗng. */
export function cellValue(kind: CellKind, v: unknown): string | number | Date {
  switch (kind) {
    case 'date': return (!isNull(v) && parseDateWall(v)) || '';
    case 'bool': return !isNull(v) && (v === true || v === 1 || v === '1' || v === 'true' || v === 'True') ? 1 : 0;
    case 'int':
    case 'dec': {
      if (isNull(v)) return 0;
      const n = typeof v === 'number' ? v : Number(String(v).trim());
      return Number.isFinite(n) ? n : 0;
    }
    default: return isNull(v) ? '' : String(v).trim();
  }
}

const FONT = { name: 'Segoe UI', size: 9 };
const NUM_FMT: Record<CellKind, string | undefined> = {
  date: 'dd/mm/yyyy',
  bool: '"ü";"ü";" "',
  int: '0',
  dec: '0.0000',
  str: '@'
};

/** Ghi workbook ra filePath (streaming, không giữ cả sổ trong bộ nhớ). */
export async function writeWorkbook(args: ExportArgs, filePath: string): Promise<void> {
  const cols = args.columns;
  const kinds = cols.map((c) => kindOf(c.clr));
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useStyles: true, useSharedStrings: false });
  const title = (args.title ?? '').trim();

  const startSheet = (n: number, first: boolean): ExcelJS.Worksheet => {
    const ws = wb.addWorksheet('Sheet' + n);
    ws.columns = cols.map((c) => ({ width: Math.max(4, Math.round((c.width ?? 80) / 7)) }));
    if (first) {
      const label = (text: string): void => {
        const r = ws.addRow([text]);
        r.getCell(1).font = { ...FONT, bold: true };
        r.commit();
      };
      label('Fast Software Company');
      label('FSD Dept');
      label('');
      const t = ws.addRow([title]);
      t.getCell(1).font = { ...FONT, bold: true };
      t.getCell(1).alignment = { horizontal: 'center', vertical: 'top', wrapText: true };
      if (cols.length > 1) ws.mergeCells(4, 1, 4, cols.length);
      t.commit();
      label('');
    }
    const h = ws.addRow(cols.map((c) => c.name));
    h.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { ...FONT, bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'top', wrapText: true };
    });
    h.commit();
    return ws;
  };

  let sheet = 1;
  let ws = startSheet(sheet, true);
  let count = 0;
  for (const row of args.rows) {
    count++;
    if (count === MAX_ROWS_PER_SHEET) {
      count = 0;
      ws.commit();
      sheet++;
      ws = startSheet(sheet, false);
    }
    const values = cols.map((_c, i) => cellValue(kinds[i], i < row.length ? row[i] : undefined));
    const r = ws.addRow(values);
    for (let i = 0; i < cols.length; i++) {
      const cell = r.getCell(i + 1);
      const k = kinds[i];
      cell.numFmt = NUM_FMT[k] as string;
      cell.font = k === 'bool' ? { name: 'Wingdings', size: 9 } : FONT;
      cell.alignment =
        k === 'date' || k === 'bool'
          ? { horizontal: 'center', vertical: 'top' }
          : k === 'str'
            ? { horizontal: 'left', vertical: 'top', wrapText: true }
            : { vertical: 'top' };
    }
    r.commit();
  }
  ws.commit();
  await wb.commit();
}
