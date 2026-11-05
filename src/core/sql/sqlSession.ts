// Kết nối SQL Server cho các lệnh của Query / Select Table / đối tượng SQL (đọc VÀ ghi, khác SqlClient chỉ-SELECT).
// Một kết nối, các lệnh xếp hàng nối tiếp; giá trị ô giữ nguyên (không trim, NULL = null) để sinh script đúng.
import { Connection, Request, TYPES } from 'tedious';
import { createConnection, describeConfig, type SqlConfig } from './sqlClient';
import { describeColumn, type ColumnInfo, type TediousColumn } from './sqlTypes';

/** Một bảng kết quả thô: cột + dòng giá trị tedious. */
export interface RawSet {
  columns: ColumnInfo[];
  rows: unknown[][];
}

export type SqlParams = Record<string, string | number>;

/** Phần của SqlSession mà logic core cần — để test thay bằng bản giả. */
export interface SqlDb {
  /** Chạy một batch, trả mọi bảng kết quả (có cột). */
  query(sql: string, params?: SqlParams): Promise<RawSet[]>;
}

/** Tên cột → giá trị cho từng dòng của một bảng kết quả (tên cột trùng thì cột sau thắng). */
export function rowObjects(set: RawSet | undefined): Array<Record<string, unknown>> {
  if (!set) return [];
  return set.rows.map((r) => {
    const o: Record<string, unknown> = {};
    set.columns.forEach((c, i) => { o[c.name] = r[i]; });
    return o;
  });
}

function columnsOf(cols: unknown): TediousColumn[] {
  return (Array.isArray(cols) ? cols : Object.values(cols as object)) as TediousColumn[];
}

export class SqlSession implements SqlDb {
  private chain: Promise<unknown> = Promise.resolve();
  private ended = false;
  private lastUse = Date.now();

  private constructor(private readonly conn: Connection, readonly cfg: SqlConfig) {
    conn.on('error', () => { this.ended = true; });
    conn.on('end', () => { this.ended = true; });
  }

  /** Mở kết nối (requestTimeoutMs 0 = không giới hạn thời gian chạy một câu). */
  static open(cfg: SqlConfig, requestTimeoutMs = 0): Promise<SqlSession> {
    return new Promise<SqlSession>((resolve, reject) => {
      const conn = createConnection(cfg, requestTimeoutMs);
      let session: SqlSession | undefined;
      conn.on('error', () => { /* lỗi socket sau khi mở: session.ended đã đặt */ });
      conn.connect((err) => {
        if (err) {
          try { conn.close(); } catch { /* bỏ qua */ }
          reject(new Error(`Không kết nối được SQL Server ${describeConfig(cfg)}: ${err.message}`));
          return;
        }
        session = new SqlSession(conn, cfg);
        resolve(session);
      });
    });
  }

  /** Kết nối còn dùng được. */
  get alive(): boolean {
    return !this.ended;
  }

  get idleMs(): number {
    return Date.now() - this.lastUse;
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    this.lastUse = Date.now();
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  query(sql: string, params?: SqlParams): Promise<RawSet[]> {
    return this.enqueue(() => this.exec(sql, params));
  }

  private exec(sql: string, params?: SqlParams): Promise<RawSet[]> {
    return new Promise<RawSet[]>((resolve, reject) => {
      const sets: RawSet[] = [];
      let cur: RawSet | undefined;
      const req = new Request(sql, (err) => {
        if (err) reject(toError(err));
        else resolve(sets);
      });
      const names = Object.keys(params ?? {});
      for (const n of names) {
        const v = (params as SqlParams)[n];
        if (typeof v === 'number') req.addParameter(n, TYPES.Int, v);
        else req.addParameter(n, TYPES.NVarChar, v);
      }
      req.on('columnMetadata', (cols) => {
        cur = { columns: columnsOf(cols).map(describeColumn), rows: [] };
        sets.push(cur);
      });
      req.on('row', (cols: Array<{ value: unknown }>) => {
        cur?.rows.push(cols.map((c) => c.value));
      });
      if (names.length > 0) this.conn.execSql(req);
      else this.conn.execSqlBatch(req);
    });
  }

  /** Chạy một câu ghi; trả số dòng bị ảnh hưởng (undefined nếu server không báo — SET NOCOUNT ON). */
  execute(sql: string): Promise<number | undefined> {
    return this.enqueue(
      () =>
        new Promise<number | undefined>((resolve, reject) => {
          let total: number | undefined;
          const add = (n: number | undefined): void => {
            if (n !== undefined) total = (total ?? 0) + n;
          };
          const req = new Request(sql, (err) => {
            if (err) reject(toError(err));
            else resolve(total);
          });
          req.on('done', add);
          req.on('doneInProc', add);
          this.conn.execSqlBatch(req);
        })
    );
  }

  /**
   * Chạy một batch và đưa từng dòng cho onRow ngay khi đến (không giữ trong bộ nhớ) — ghi file dữ liệu lớn.
   * onSet gọi khi bắt đầu mỗi bảng kết quả.
   */
  stream(sql: string, onSet: (columns: ColumnInfo[]) => void, onRow: (values: unknown[], columns: ColumnInfo[]) => void): Promise<void> {
    return this.enqueue(
      () =>
        new Promise<void>((resolve, reject) => {
          let columns: ColumnInfo[] = [];
          const req = new Request(sql, (err) => (err ? reject(toError(err)) : resolve()));
          req.on('columnMetadata', (cols) => {
            columns = columnsOf(cols).map(describeColumn);
            onSet(columns);
          });
          req.on('row', (cols: Array<{ value: unknown }>) => onRow(cols.map((c) => c.value), columns));
          this.conn.execSqlBatch(req);
        })
    );
  }

  /** Chạy fn trong một transaction: fn lỗi → hoàn tác rồi ném lại; xong → commit. */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.enqueue(() => new Promise<void>((res, rej) => this.conn.beginTransaction((e) => (e ? rej(toError(e)) : res()))));
    try {
      const out = await fn();
      await this.enqueue(() => new Promise<void>((res, rej) => this.conn.commitTransaction((e) => (e ? rej(toError(e)) : res()))));
      return out;
    } catch (e) {
      try {
        await this.enqueue(() => new Promise<void>((res) => this.conn.rollbackTransaction(() => res())));
      } catch {
        // kết nối đã mất: server tự hoàn tác
      }
      throw e;
    }
  }

  async close(): Promise<void> {
    this.ended = true;
    await new Promise<void>((resolve) => {
      this.conn.once('end', () => resolve());
      try {
        this.conn.close();
      } catch {
        resolve();
      }
      setTimeout(resolve, 1500).unref();
    });
  }
}

function toError(err: Error & { number?: number }): Error {
  const e = new Error(err.message) as Error & { number?: number };
  e.number = err.number;
  return e;
}
