// Chạy SQL tự viết của Query (BA 6.5): nhiều batch (tách theo GO), nhiều recordset, hủy được, cắt dòng.
// Đây là đường riêng của Query; SqlClient.query() vẫn chỉ cho SELECT. Mỗi lần chạy mở một kết nối riêng rồi đóng.
import { Request } from 'tedious';
import { createConnection, describeConfig, type SqlConfig } from './sqlClient';
import { splitBatches } from './sqlText';
import { describeColumn, toCell, type Cell as SqlCell, type ColumnInfo, type TediousColumn } from './sqlTypes';

/** Số dòng tối đa giữ lại cho mỗi recordset (vượt thì cắt và báo). */
export const MAX_ROWS_PER_SET = 5000;

export type Cell = string | number | null;

export interface QueryColumn {
  name: string;
  /** Tên kiểu SQL (Int, VarChar, DateTime…) theo tedious. */
  type: string;
}

export interface QueryRecordset {
  columns: QueryColumn[];
  rows: Cell[][];
  /** Tổng số dòng server trả (có thể lớn hơn rows.length). */
  total: number;
  truncated: boolean;
}

export interface QueryMessage {
  kind: 'info' | 'error' | 'count';
  text: string;
  /** Dòng (1-based) trong văn bản đã gửi; 0 = không xác định (lỗi trong store / không có số dòng). */
  line: number;
}

export interface QueryResult {
  recordsets: QueryRecordset[];
  messages: QueryMessage[];
  ms: number;
  cancelled: boolean;
  batches: number;
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

/** Giá trị một ô → dạng hiển thị / JSON được (null giữ null). */
export function formatCell(v: unknown, typeName = ''): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // tedious (useUTC mặc định) trả Date có các trường UTC = giá trị trong DB.
    const d = `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
    if (/^date$/i.test(typeName)) return d;
    const t = `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`;
    if (/^time$/i.test(typeName)) return `${t}.${pad(v.getUTCMilliseconds(), 3)}`;
    return `${d} ${t}.${pad(v.getUTCMilliseconds(), 3)}`;
  }
  if (v instanceof Uint8Array) {
    const hex = Buffer.from(v.subarray(0, 64)).toString('hex');
    return '0x' + hex + (v.length > 64 ? '…' : '');
  }
  return String(v);
}

/** Gom dòng theo recordset, cắt ở maxRows nhưng vẫn đếm tổng. */
export class RecordsetCollector {
  readonly sets: QueryRecordset[] = [];
  private cur?: QueryRecordset;

  constructor(private readonly maxRows = MAX_ROWS_PER_SET) {}

  start(columns: QueryColumn[]): void {
    this.cur = { columns, rows: [], total: 0, truncated: false };
    this.sets.push(this.cur);
  }

  /** Thêm một dòng; trả số dòng đã đếm của recordset hiện tại. */
  add(row: Cell[]): number {
    const s = this.cur;
    if (!s) return 0;
    s.total++;
    if (s.rows.length < this.maxRows) s.rows.push(row);
    else s.truncated = true;
    return s.total;
  }
}

/** Dòng gốc của lỗi: batch.line + dòng trong batch - 1; lỗi trong store / function (có procName) thì không map được. */
export function sourceLine(batchLine: number, lineNumber: number | undefined, procName: string | undefined): number {
  if (!lineNumber || lineNumber <= 0 || procName) return 0;
  return batchLine + lineNumber - 1;
}

export interface RunHooks {
  /** Đang đọc kết quả: recordset thứ n (1-based) đã có rows dòng. */
  onProgress?: (set: number, rows: number) => void;
}

export class QueryRunner {
  private conn?: ReturnType<typeof createConnection>;
  private cancelled = false;
  private running = false;

  constructor(
    private readonly cfg: SqlConfig,
    private readonly maxRows = MAX_ROWS_PER_SET
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** Dừng câu đang chạy và bỏ các batch còn lại. */
  cancel(): void {
    this.cancelled = true;
    try {
      this.conn?.cancel();
    } catch {
      // câu vừa xong đúng lúc bấm Dừng
    }
  }

  async run(sql: string, hooks: RunHooks = {}): Promise<QueryResult> {
    if (this.running) throw new Error('Đang có câu SQL chạy.');
    this.running = true;
    this.cancelled = false;
    const t0 = Date.now();
    const batches = splitBatches(sql);
    const col = new RecordsetCollector(this.maxRows);
    const messages: QueryMessage[] = [];
    try {
      const conn = createConnection(this.cfg, 0);
      this.conn = conn;
      conn.on('error', () => {
        // lỗi socket: câu đang chạy báo qua callback của Request
      });
      let errNow = 0;
      let batchLine = 1;
      conn.on('infoMessage', (m) => {
        messages.push({ kind: 'info', text: m.message, line: 0 });
      });
      conn.on('errorMessage', (m) => {
        errNow++;
        messages.push({
          kind: m.class > 10 ? 'error' : 'info',
          text: `Msg ${m.number}, Level ${m.class}, State ${m.state}${m.procName ? `, Procedure ${m.procName}` : ''}, Line ${m.lineNumber}: ${m.message}`,
          line: sourceLine(batchLine, m.lineNumber, m.procName)
        });
      });
      await new Promise<void>((resolve, reject) => {
        conn.connect((err) => {
          if (err) {
            try { conn.close(); } catch { /* bỏ qua */ }
            reject(new Error(`Không kết nối được SQL Server ${describeConfig(this.cfg)}: ${err.message}`));
          } else resolve();
        });
      });

      for (const b of batches) {
        if (this.cancelled) break;
        batchLine = b.line;
        const before = errNow;
        await new Promise<void>((resolve) => {
          const req = new Request(b.text, (err) => {
            // Lỗi server đã vào messages qua errorMessage; chỉ bổ sung khi không có (hủy, mất kết nối, hết giờ).
            if (err && errNow === before && !this.cancelled) messages.push({ kind: 'error', text: err.message, line: 0 });
            resolve();
          });
          req.on('columnMetadata', (cols) => {
            const list = Array.isArray(cols) ? cols : Object.values(cols);
            col.start(list.map((c) => ({ name: c.colName, type: c.type?.name ?? '' })));
          });
          req.on('row', (cols: Array<{ metadata: { type?: { name?: string } }; value: unknown }>) => {
            const n = col.add(cols.map((c) => formatCell(c.value, c.metadata.type?.name ?? '')));
            if (n % 500 === 0) hooks.onProgress?.(col.sets.length, n);
          });
          // Batch nhiều câu báo từng câu bằng doneInProc; chỉ dùng done (câu cuối) khi không có doneInProc nào.
          let inProc = false;
          const count = (rowCount: number | undefined): void => {
            if (rowCount !== undefined) messages.push({ kind: 'count', text: `(${rowCount} dòng)`, line: 0 });
          };
          req.on('doneInProc', (rowCount) => {
            inProc = true;
            count(rowCount);
          });
          req.on('done', (rowCount) => {
            if (!inProc) count(rowCount);
          });
          conn.execSqlBatch(req);
        });
      }
    } finally {
      const conn = this.conn;
      this.conn = undefined;
      this.running = false;
      try { conn?.close(); } catch { /* bỏ qua */ }
    }
    if (this.cancelled) messages.push({ kind: 'error', text: 'Đã dừng theo yêu cầu.', line: 0 });
    return { recordsets: col.sets, messages, ms: Date.now() - t0, cancelled: this.cancelled, batches: batches.length };
  }
}

// ===================== Chạy SQL theo QueryService của FSD Studio 5.2 =====================
// Kết quả đúng hình JS 5.2 đọc: { sets, messages, ms, cancelled, db, batches }; dòng lỗi 0-based, -1 = không xác định.
// (QueryRunner ở trên là bản cũ cho queryPanel; xóa cùng queryPanel ở gói D.)

/** Một bảng kết quả gửi sang JS 5.2: không giới hạn dòng (truncated luôn false). */
export interface QuerySet {
  columns: Array<{ name: string; type: string; clr: string }>;
  rows: SqlCell[][];
  total: number;
  truncated: boolean;
}

export interface QueryMessage52 {
  kind: 'info' | 'error' | 'count';
  text: string;
  /** Chỉ lỗi có: dòng 0-based trong văn bản gửi lên; -1 = không xác định. */
  line?: number;
}

export interface QueryResult52 {
  sets: QuerySet[];
  messages: QueryMessage52[];
  ms: number;
  cancelled: boolean;
  db: string;
  batches: number;
}

/** Một batch: nội dung + dòng bắt đầu (0-based) trong văn bản gửi lên. */
export interface Batch52 {
  text: string;
  startLine: number;
}

/** Tách batch theo dòng GO (dùng splitBatches của sqlText; startLine đổi sang 0-based). */
export function splitBatches52(sql: string): Batch52[] {
  return splitBatches(sql ?? '').map((b) => ({ text: b.text, startLine: b.line - 1 }));
}

/** Store tạm #p báo tên kèm hậu tố "____…00036CFE" → bỏ hậu tố. */
export function cleanProcedure(procedure: string | undefined): string {
  return (procedure ?? '').replace(/_{3,}[0-9A-F]+$/, '');
}

export interface ServerError {
  number: number;
  class: number;
  state: number;
  procName?: string;
  lineNumber: number;
  message: string;
}

/** "Msg n, Level c, State s, <store>, Line l: nội dung" (5.2 FormatError; không có chữ "Procedure"). */
export function formatServerError(e: ServerError): string {
  const where = e.procName ? `, ${cleanProcedure(e.procName)}` : '';
  return `Msg ${e.number}, Level ${e.class}, State ${e.state}${where}, Line ${e.lineNumber}: ${e.message}`;
}

/**
 * Dòng 0-based trong văn bản gửi lên của một lỗi; -1 = không xác định. lineNumber đếm từ 1 trong batch.
 * Lỗi trong store / function / trigger / view: SQL Server đếm dòng từ đầu batch đã tạo nó (gồm chú thích trước CREATE),
 * nên chỉ map được khi batch CREATE / ALTER của nó nằm trong script.
 */
export function errorLine52(batches: Batch52[], current: Batch52, procName: string | undefined, lineNumber: number): number {
  if (!lineNumber || lineNumber <= 0) return -1;
  if (!procName) return current.startLine + lineNumber - 1;
  const name = cleanProcedure(procName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const def = new RegExp(`\\b(CREATE|ALTER)\\s+(PROC(EDURE)?|FUNCTION|TRIGGER|VIEW)\\s+(\\[?\\w+\\]?\\.)?\\[?${name}\\]?(?![\\w$#])`, 'i');
  for (const b of batches) {
    if (def.test(b.text)) return b.startLine + lineNumber - 1;
  }
  return -1;
}

export interface BatchRunHooks {
  /** Đang đọc bảng kết quả thứ `table` (1-based), đã có `rows` dòng — gọi tối đa ~300 ms một lần. */
  onProgress?: (table: number, rows: number) => void;
}

/** Chạy một lần SQL của Query (nhiều batch GO, nhiều bảng, không giới hạn dòng). Mỗi lần mở một kết nối riêng rồi đóng. */
export class BatchRunner {
  private conn?: ReturnType<typeof createConnection>;
  private cancelled = false;

  constructor(
    private readonly cfg: SqlConfig,
    private readonly db: string
  ) {}

  /** Dừng câu đang chạy và bỏ các batch còn lại. */
  cancel(): void {
    this.cancelled = true;
    try {
      this.conn?.cancel();
    } catch {
      // câu vừa xong đúng lúc bấm Dừng
    }
  }

  async run(sql: string, hooks: BatchRunHooks = {}): Promise<QueryResult52> {
    const t0 = Date.now();
    const batches = splitBatches52(sql);
    const sets: QuerySet[] = [];
    const messages: QueryMessage52[] = [];
    try {
      const conn = createConnection(this.cfg, 0);
      this.conn = conn;
      conn.on('error', () => {
        // lỗi socket: câu đang chạy báo qua callback của Request
      });
      let errNow = 0;
      let current: Batch52 = { text: '', startLine: 0 };
      conn.on('infoMessage', (m) => {
        messages.push({ kind: 'info', text: m.message });
      });
      conn.on('errorMessage', (m) => {
        errNow++;
        messages.push({
          kind: m.class > 10 ? 'error' : 'info',
          text: formatServerError({ number: m.number, class: m.class, state: m.state, procName: m.procName, lineNumber: m.lineNumber, message: m.message }),
          line: errorLine52(batches, current, m.procName, m.lineNumber)
        });
      });
      await new Promise<void>((resolve, reject) => {
        conn.connect((err) => {
          if (err) {
            try { conn.close(); } catch { /* bỏ qua */ }
            reject(new Error(`Không kết nối được SQL Server ${describeConfig(this.cfg)}: ${err.message}`));
          } else resolve();
        });
      });

      for (const b of batches) {
        if (this.cancelled) break;
        current = b;
        const before = errNow;
        await new Promise<void>((resolve) => {
          const req = new Request(b.text, (err) => {
            // Lỗi server đã vào messages qua errorMessage; chỉ bổ sung khi không có (mất kết nối, hết giờ).
            if (err && errNow === before && !this.cancelled) messages.push({ kind: 'error', text: err.message, line: -1 });
            resolve();
          });
          let set: QuerySet | undefined;
          let infos: ColumnInfo[] = [];
          let tick = Date.now();
          req.on('columnMetadata', (cols) => {
            const list = (Array.isArray(cols) ? cols : Object.values(cols)) as TediousColumn[];
            infos = list.map(describeColumn);
            set = { columns: infos.map((c) => ({ name: c.name, type: c.type, clr: c.clr })), rows: [], total: 0, truncated: false };
            sets.push(set);
            tick = Date.now();
          });
          req.on('row', (cols: Array<{ value: unknown }>) => {
            if (!set) return;
            const row: SqlCell[] = new Array(cols.length);
            for (let i = 0; i < cols.length; i++) row[i] = toCell(cols[i].value, infos[i]);
            set.rows.push(row);
            set.total++;
            if (hooks.onProgress && Date.now() - tick > 300) {
              hooks.onProgress(sets.length, set.total);
              tick = Date.now();
            }
          });
          // Batch nhiều câu báo từng câu bằng doneInProc; chỉ dùng done (câu cuối) khi không có doneInProc nào.
          let inProc = false;
          const count = (rowCount: number | undefined): void => {
            if (rowCount !== undefined) messages.push({ kind: 'count', text: `(${rowCount} dòng)` });
          };
          req.on('doneInProc', (rowCount) => {
            inProc = true;
            count(rowCount);
          });
          req.on('done', (rowCount) => {
            if (!inProc) count(rowCount);
          });
          conn.execSqlBatch(req);
        });
      }
    } catch (e) {
      messages.push({ kind: 'error', text: e instanceof Error ? e.message : String(e), line: -1 });
    } finally {
      const conn = this.conn;
      this.conn = undefined;
      try { conn?.close(); } catch { /* bỏ qua */ }
    }
    if (this.cancelled) messages.push({ kind: 'error', text: 'Đã dừng theo yêu cầu.', line: -1 });
    return { sets, messages, ms: Date.now() - t0, cancelled: this.cancelled, db: this.db, batches: batches.length };
  }
}
