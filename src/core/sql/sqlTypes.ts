// Kiểu cột SQL Server theo tedious → tên kiểu SQL + kiểu .NET (clr) + giá trị ô gửi sang JSON, đúng như QueryService.Cell của 5.2.
// JS 5.2 (ui/grid.js, select-table.js) đọc `clr` để biết cột số / ngày / bool / nhị phân nên phải giữ nguyên tên kiểu .NET.

/** Siêu dữ liệu một cột do tedious báo (columnMetadata). */
export interface TediousColumn {
  colName: string;
  type?: { name?: string };
  dataLength?: number;
  precision?: number;
  scale?: number;
}

/** Cột kết quả: type = tên kiểu SQL chữ thường (như SqlDataReader.GetDataTypeName), clr = tên đầy đủ kiểu .NET. */
export interface ColumnInfo {
  name: string;
  type: string;
  clr: string;
  /** Số chữ số thập phân của decimal / money (để in lại đúng "12.50"); không gửi sang JS. */
  scale?: number;
}

/** Ô gửi sang JSON: NULL → null, số nguyên / bit giữ kiểu, còn lại (decimal, ngày, nhị phân) là chuỗi. */
export type Cell = string | number | boolean | null;

const CLR = {
  byte: 'System.Byte',
  int16: 'System.Int16',
  int32: 'System.Int32',
  int64: 'System.Int64',
  bool: 'System.Boolean',
  single: 'System.Single',
  double: 'System.Double',
  decimal: 'System.Decimal',
  date: 'System.DateTime',
  dateOffset: 'System.DateTimeOffset',
  time: 'System.TimeSpan',
  string: 'System.String',
  bytes: 'System.Byte[]',
  guid: 'System.Guid',
  object: 'System.Object'
};

/** Tên kiểu tedious (chữ thường) → [kiểu SQL, kiểu .NET]. Kiểu "N" (IntN, FloatN…) xử lý riêng theo dataLength. */
const TYPE_MAP: Record<string, [string, string]> = {
  tinyint: ['tinyint', CLR.byte],
  smallint: ['smallint', CLR.int16],
  int: ['int', CLR.int32],
  bigint: ['bigint', CLR.int64],
  bit: ['bit', CLR.bool],
  bitn: ['bit', CLR.bool],
  real: ['real', CLR.single],
  float: ['float', CLR.double],
  money: ['money', CLR.decimal],
  smallmoney: ['smallmoney', CLR.decimal],
  decimal: ['decimal', CLR.decimal],
  numeric: ['decimal', CLR.decimal],
  decimaln: ['decimal', CLR.decimal],
  numericn: ['decimal', CLR.decimal],
  datetime: ['datetime', CLR.date],
  smalldatetime: ['smalldatetime', CLR.date],
  date: ['date', CLR.date],
  datetime2: ['datetime2', CLR.date],
  datetimeoffset: ['datetimeoffset', CLR.dateOffset],
  time: ['time', CLR.time],
  char: ['char', CLR.string],
  varchar: ['varchar', CLR.string],
  nchar: ['nchar', CLR.string],
  nvarchar: ['nvarchar', CLR.string],
  text: ['text', CLR.string],
  ntext: ['ntext', CLR.string],
  xml: ['xml', CLR.string],
  binary: ['binary', CLR.bytes],
  varbinary: ['varbinary', CLR.bytes],
  image: ['image', CLR.bytes],
  uniqueidentifier: ['uniqueidentifier', CLR.guid],
  variant: ['sql_variant', CLR.object]
};

/** Mô tả một cột từ siêu dữ liệu tedious. */
export function describeColumn(meta: TediousColumn): ColumnInfo {
  const raw = (meta.type?.name ?? '').toLowerCase();
  const len = meta.dataLength ?? 0;
  let hit: [string, string] | undefined;
  if (raw === 'intn') hit = len === 1 ? TYPE_MAP.tinyint : len === 2 ? TYPE_MAP.smallint : len === 8 ? TYPE_MAP.bigint : TYPE_MAP.int;
  else if (raw === 'floatn') hit = len === 4 ? TYPE_MAP.real : TYPE_MAP.float;
  else if (raw === 'moneyn') hit = len === 4 ? TYPE_MAP.smallmoney : TYPE_MAP.money;
  else if (raw === 'datetimen') hit = len === 4 ? TYPE_MAP.smalldatetime : TYPE_MAP.datetime;
  else hit = TYPE_MAP[raw];
  const [type, clr] = hit ?? [raw || 'sql_variant', CLR.object];
  const scale = clr === CLR.decimal ? (type === 'money' || type === 'smallmoney' ? 4 : meta.scale ?? 0) : undefined;
  return { name: meta.colName, type, clr, scale };
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

/** tedious (useUTC mặc định) trả Date có các trường UTC = giá trị trong DB. */
function dateText(v: Date): string {
  return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}.${pad(v.getUTCMilliseconds(), 3)}`;
}

/**
 * Giá trị ô → JSON như QueryService.Cell của 5.2: NULL → null; số nguyên / bit giữ số / bool; float → số;
 * decimal → chuỗi (đủ chữ số thập phân); ngày "yyyy-MM-dd HH:mm:ss.fff" (cả kiểu date, như DateTime của .NET);
 * nhị phân → "0x…" đủ; guid chữ thường.
 */
export function toCell(v: unknown, col: ColumnInfo): Cell {
  if (v === null || v === undefined) return null;
  switch (col.clr) {
    case CLR.bool:
      return typeof v === 'boolean' ? v : Boolean(v);
    case CLR.byte:
    case CLR.int16:
    case CLR.int32:
      return typeof v === 'number' ? v : Number(v);
    case CLR.int64: {
      // tedious trả bigint dạng chuỗi; chỉ đổi sang số khi không mất chính xác.
      const n = Number(v);
      return Number.isSafeInteger(n) ? n : String(v);
    }
    case CLR.single:
    case CLR.double: {
      const n = Number(v);
      return Number.isFinite(n) ? n : String(v);
    }
    case CLR.decimal:
      return typeof v === 'number' ? (Number.isFinite(v) ? v.toFixed(col.scale ?? 0) : String(v)) : String(v);
    case CLR.date:
      return v instanceof Date ? (Number.isNaN(v.getTime()) ? null : dateText(v)) : String(v);
    case CLR.dateOffset:
      return v instanceof Date ? (Number.isNaN(v.getTime()) ? null : `${dateText(v)} +00:00`) : String(v);
    case CLR.time: {
      if (!(v instanceof Date) || Number.isNaN(v.getTime())) return String(v);
      const ms = v.getUTCMilliseconds();
      return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}${ms ? `.${pad(ms, 3)}0000` : ''}`;
    }
    case CLR.bytes:
      return v instanceof Uint8Array ? '0x' + Buffer.from(v).toString('hex').toUpperCase() : String(v);
    case CLR.guid:
      return String(v).toLowerCase();
    default:
      if (v instanceof Uint8Array) return '0x' + Buffer.from(v).toString('hex').toUpperCase();
      if (v instanceof Date) return dateText(v);
      if (typeof v === 'number' || typeof v === 'boolean') return v;
      return String(v);
  }
}

/** Kiểu hiển thị như SSMS: nvarchar(50), numeric(18,2), varchar(max)… (sql.columns). */
export function typeText(type: string, maxLength: number, precision: number, scale: number): string {
  switch (type.toLowerCase()) {
    case 'char':
    case 'varchar':
    case 'binary':
    case 'varbinary':
      return `${type}(${maxLength === -1 ? 'max' : maxLength})`;
    case 'nchar':
    case 'nvarchar':
      return `${type}(${maxLength === -1 ? 'max' : Math.trunc(maxLength / 2)})`;
    case 'decimal':
    case 'numeric':
      return `${type}(${precision},${scale})`;
    default:
      return type;
  }
}

/** "yyyy-MM-dd HH:mm:ss" từ Date của tedious (trường UTC) — cột modify_date của sql.objects. */
export function shortDateText(v: unknown): string {
  if (!(v instanceof Date) || Number.isNaN(v.getTime())) return '';
  return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`;
}

/** "yyyy-MM-dd" từ Date của tedious. */
export function dayText(v: unknown): string {
  if (!(v instanceof Date) || Number.isNaN(v.getTime())) return '';
  return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
}
