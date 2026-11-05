// Kết nối SQL Server bằng tedious — chỉ cho câu SELECT, một kết nối mở lười, query chạy nối tiếp.
import { Connection, Request, TYPES } from 'tedious';
import { stripLiteralsAndComments } from './sqlText';

export interface SqlConfig {
  server: string;
  user: string;
  password: string;
  database: string;
  /** Thời gian chờ một câu (ms), mặc định 30 giây. */
  timeoutMs?: number;
}

export interface ParsedServer {
  host: string;
  instanceName?: string;
  port?: number;
  connectTimeoutMs?: number;
}

/** Tách "host", "host\instance", "host,port" và phần "; Connect Timeout = N" (giây → ms). */
export function parseServer(server: string): ParsedServer {
  const parts = (server ?? '').split(';');
  let main = (parts[0] ?? '').trim();
  const result: ParsedServer = { host: '' };

  for (const extra of parts.slice(1)) {
    const eq = extra.indexOf('=');
    if (eq < 0) continue;
    const key = extra.slice(0, eq).trim().toLowerCase().replace(/\s+/g, ' ');
    const val = extra.slice(eq + 1).trim();
    if (key === 'connect timeout' || key === 'connection timeout' || key === 'timeout') {
      const n = Number(val);
      if (Number.isFinite(n) && n > 0) result.connectTimeoutMs = Math.round(n * 1000);
    }
  }

  // Bỏ tiền tố "tcp:"
  if (/^tcp:/i.test(main)) main = main.slice(4);

  const bs = main.indexOf('\\');
  if (bs >= 0) {
    result.host = main.slice(0, bs).trim();
    const rest = main.slice(bs + 1).trim();
    // "host\instance,port" → ưu tiên cổng
    const comma = rest.indexOf(',');
    if (comma >= 0) {
      const port = Number(rest.slice(comma + 1).trim());
      if (Number.isInteger(port) && port > 0) result.port = port;
      else result.instanceName = rest.slice(0, comma).trim() || undefined;
    } else if (rest) {
      result.instanceName = rest;
    }
    return result;
  }

  const comma = main.indexOf(',');
  if (comma >= 0) {
    result.host = main.slice(0, comma).trim();
    const port = Number(main.slice(comma + 1).trim());
    if (Number.isInteger(port) && port > 0) result.port = port;
    return result;
  }

  result.host = main;
  return result;
}

/** Chỉ cho một câu SELECT (không INTO, không nhiều câu). Sai → throw. */
export function assertSelectOnly(sql: string): void {
  const clean = stripLiteralsAndComments(sql).trim();
  if (!/^select\b/i.test(clean)) {
    throw new Error('Chỉ cho phép câu SELECT (bản này không ghi dữ liệu).');
  }
  if (/\binto\b/i.test(clean)) {
    throw new Error('Không cho phép SELECT ... INTO.');
  }
  const semi = clean.indexOf(';');
  if (semi >= 0 && clean.slice(semi + 1).trim() !== '') {
    throw new Error('Chỉ cho phép một câu SELECT.');
  }
}

/** Mô tả "server / database" cho thông báo lỗi (không chứa mật khẩu). */
export function describeConfig(cfg: SqlConfig): string {
  return `${cfg.server} / ${cfg.database}`;
}

/** Tạo (chưa kết nối) một kết nối tedious từ cấu hình dự án. requestTimeoutMs: 0 = không giới hạn. */
export function createConnection(cfg: SqlConfig, requestTimeoutMs?: number): Connection {
  const s = parseServer(cfg.server);
  return new Connection({
    server: s.host,
    authentication: {
      type: 'default',
      options: { userName: cfg.user, password: cfg.password },
    },
    options: {
      database: cfg.database,
      encrypt: false,
      trustServerCertificate: true,
      instanceName: s.port ? undefined : s.instanceName,
      port: s.port,
      connectTimeout: s.connectTimeoutMs ?? 15000,
      requestTimeout: requestTimeoutMs ?? cfg.timeoutMs ?? 30000,
      rowCollectionOnRequestCompletion: false,
      useColumnNames: false,
    },
  });
}

/** Thủ tục được gọi bằng callAllowed (tên thường). */
const ALLOWED_PROCS = new Set(['ns_getlistdept']);

export class SqlClient {
  private _conn?: Connection;
  private _connecting?: Promise<Connection>;
  private _chain: Promise<unknown> = Promise.resolve();
  private readonly _cfg: SqlConfig;

  constructor(cfg: SqlConfig) {
    this._cfg = cfg;
  }

  private describe(): string {
    return describeConfig(this._cfg);
  }

  private open(): Promise<Connection> {
    if (this._conn) return Promise.resolve(this._conn);
    if (this._connecting) return this._connecting;
    const p = new Promise<Connection>((resolve, reject) => {
      const conn = createConnection(this._cfg);
      conn.on('error', () => {
        // Lỗi socket sau khi mở: bỏ kết nối để lần sau mở lại.
        if (this._conn === conn) this._conn = undefined;
      });
      conn.on('end', () => {
        if (this._conn === conn) this._conn = undefined;
      });
      conn.connect((err) => {
        if (err) {
          try { conn.close(); } catch { /* bỏ qua */ }
          // Thông báo của tedious không chứa mật khẩu; chỉ nêu server/DB.
          reject(new Error(`Không kết nối được SQL Server ${this.describe()}: ${err.message}`));
          return;
        }
        this._conn = conn;
        resolve(conn);
      });
    });
    this._connecting = p;
    const clear = (): void => { this._connecting = undefined; };
    p.then(clear, clear);
    return p;
  }

  /** Chạy một câu SELECT; chuỗi trả về đã trim, null → ''. Các lời gọi được xếp hàng nối tiếp. */
  query<T = Record<string, unknown>>(sql: string, params?: Record<string, string | number>): Promise<T[]> {
    try {
      assertSelectOnly(sql);
    } catch (e) {
      return Promise.reject(e);
    }
    return this.enqueue(() => this.exec<T>(sql, params));
  }

  /**
   * Gọi một thủ tục trong danh sách cho phép (chỉ đọc danh mục), tham số có kiểu (@p0, @p1…).
   * Tên ngoài danh sách → từ chối. Câu khác vẫn phải qua query() (chỉ SELECT).
   */
  callAllowed<T = Record<string, unknown>>(proc: string, args: Array<string | number>): Promise<T[]> {
    if (!ALLOWED_PROCS.has(proc.toLowerCase())) {
      return Promise.reject(new Error(`Thủ tục "${proc}" không nằm trong danh sách cho phép.`));
    }
    const params: Record<string, string | number> = {};
    args.forEach((v, i) => { params[`p${i}`] = v; });
    const sql = `EXEC ${proc} ${args.map((_, i) => `@p${i}`).join(', ')}`.trim();
    return this.enqueue(() => this.exec<T>(sql, params));
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = this._chain.then(run, run);
    this._chain = next.catch(() => undefined);
    return next;
  }

  private async exec<T>(sql: string, params?: Record<string, string | number>): Promise<T[]> {
    const conn = await this.open();
    return new Promise<T[]>((resolve, reject) => {
      const rows: T[] = [];
      const req = new Request(sql, (err) => {
        if (err) reject(this.wrapQueryError(err));
        else resolve(rows);
      });
      for (const [name, value] of Object.entries(params ?? {})) {
        if (typeof value === 'number') req.addParameter(name, TYPES.Int, value);
        else req.addParameter(name, TYPES.NVarChar, value);
      }
      req.on('row', (cols: Array<{ metadata: { colName: string }; value: unknown }>) => {
        const row: Record<string, unknown> = {};
        for (const c of cols) {
          const v = c.value;
          row[c.metadata.colName] = v === null || v === undefined ? '' : typeof v === 'string' ? v.trim() : v;
        }
        rows.push(row as T);
      });
      conn.execSql(req);
    });
  }

  private wrapQueryError(err: Error & { number?: number }): Error {
    const e = new Error(`Lỗi truy vấn trên ${this.describe()}: ${err.message}`) as Error & { number?: number };
    e.number = err.number;
    return e;
  }

  async close(): Promise<void> {
    const pending = this._connecting;
    if (pending) {
      try { await pending; } catch { /* bỏ qua */ }
    }
    const conn = this._conn;
    this._conn = undefined;
    if (!conn) return;
    await new Promise<void>((resolve) => {
      conn.once('end', () => resolve());
      try { conn.close(); } catch { resolve(); }
    });
  }
}
