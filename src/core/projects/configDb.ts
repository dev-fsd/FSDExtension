// Đọc bảng dmda của config.db (FSD Studio) bằng sql.js — chỉ đọc, không ghi lại file.
import * as fs from 'node:fs';
import type { DmdaRow } from '../types';

type SqlJs = import('sql.js').SqlJsStatic;

let sqlModule: Promise<SqlJs> | undefined;
let sqlModuleWasm = '';

async function loadSql(wasmPath?: string): Promise<SqlJs> {
  const wasm = wasmPath || require.resolve('sql.js/dist/sql-wasm.wasm');
  if (!sqlModule || sqlModuleWasm !== wasm) {
    sqlModuleWasm = wasm;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const initSqlJs = require('sql.js') as (cfg?: object) => Promise<SqlJs>;
    const wasmBinary = fs.readFileSync(wasm);
    sqlModule = initSqlJs({ wasmBinary: wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength) });
  }
  return sqlModule;
}

const text = (v: unknown): string => (v == null ? '' : String(v).trim());

/** Thêm "\" cuối cho đường dẫn thư mục (rỗng giữ rỗng). */
export function withSlash(p: string): string {
  return p !== '' && !p.endsWith('\\') && !p.endsWith('/') ? p + '\\' : p;
}

/** Đọc toàn bộ dmda (mọi dòng, kèm cờ active), sắp theo stt, ma_da. Mật khẩu vẫn mã hóa. */
export async function readDmda(configDbPath: string, wasmPath?: string): Promise<DmdaRow[]> {
  const SQL = await loadSql(wasmPath);
  const db = new SQL.Database(new Uint8Array(fs.readFileSync(configDbPath)));
  try {
    const stmt = db.prepare('SELECT * FROM dmda ORDER BY stt, ma_da');
    const rows: DmdaRow[] = [];
    try {
      while (stmt.step()) {
        const r = stmt.getAsObject();
        const code = text(r.ma_da);
        if (code === '') continue;
        const status = r.status;
        rows.push({
          code,
          name: text(r.ten_da),
          menuType: text(r.ma_td2) || '2',
          server: text(r.server),
          user: text(r.username),
          mode: text(r.mode),
          sysDatabase: text(r.sysdatabase),
          webSource: withSlash(text(r.web_source)),
          webProgramDir: withSlash(text(r.webprogram_dir)),
          webHost1: text(r.web_host01),
          webHost2: text(r.web_host02),
          mobileDir: text(r.mobile_dir),
          active: status === 1 || status === '1' || status === 'true',
          passwordEncoded: text(r.pass_word),
        });
      }
    } finally {
      stmt.free();
    }
    return rows;
  } finally {
    db.close();
  }
}

/** Đọc một giá trị trong bảng options (cột id / val) của config.db; không có → ''. Chỉ đọc. */
export async function readOption(configDbPath: string, id: string, wasmPath?: string): Promise<string> {
  const SQL = await loadSql(wasmPath);
  const db = new SQL.Database(new Uint8Array(fs.readFileSync(configDbPath)));
  try {
    const stmt = db.prepare('SELECT val FROM options WHERE id = ? LIMIT 1');
    try {
      stmt.bind([id]);
      return stmt.step() ? text(stmt.getAsObject().val) : '';
    } finally {
      stmt.free();
    }
  } catch {
    // Không có bảng options.
    return '';
  } finally {
    db.close();
  }
}
