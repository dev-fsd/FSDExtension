// Đọc thêm từ config.db của FSD Studio (chỉ đọc): các cột dmda mà ProjectRecord không có (update_dir, fbprogram_dir)
// và các tùy chọn bảng options (m_updatefile_dir, CurrUser, CurrDept, filesearch_exact…).
import * as fs from 'node:fs';

type SqlJs = import('sql.js').SqlJsStatic;

let sqlModule: Promise<SqlJs> | undefined;
let sqlWasm = '';

async function loadSql(wasmPath?: string): Promise<SqlJs> {
  const wasm = wasmPath || require.resolve('sql.js/dist/sql-wasm.wasm');
  if (!sqlModule || sqlWasm !== wasm) {
    sqlWasm = wasm;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const initSqlJs = require('sql.js') as (cfg?: object) => Promise<SqlJs>;
    const bin = fs.readFileSync(wasm);
    sqlModule = initSqlJs({ wasmBinary: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) });
  }
  return sqlModule;
}

const text = (v: unknown): string => (v == null ? '' : String(v).trim());

export interface DmdaExtras {
  updateDir: string;
  fbProgramDir: string;
}

/** Cột update_dir / fbprogram_dir của dự án trong dmda; không có dòng → rỗng. */
export async function readDmdaExtras(configDbPath: string, projectCode: string, wasmPath?: string): Promise<DmdaExtras> {
  const SQL = await loadSql(wasmPath);
  const db = new SQL.Database(new Uint8Array(fs.readFileSync(configDbPath)));
  try {
    const stmt = db.prepare('SELECT * FROM dmda WHERE UPPER(TRIM(ma_da)) = ? LIMIT 1');
    try {
      stmt.bind([projectCode.trim().toUpperCase()]);
      if (!stmt.step()) return { updateDir: '', fbProgramDir: '' };
      const r = stmt.getAsObject();
      return { updateDir: text(r.update_dir), fbProgramDir: text(r.fbprogram_dir) };
    } finally {
      stmt.free();
    }
  } finally {
    db.close();
  }
}

/** Nhiều tùy chọn (bảng options, cột id / val) một lần; id không có → ''. Khóa kết quả viết thường. */
export async function readOptions(configDbPath: string, ids: string[], wasmPath?: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of ids) out[id.toLowerCase()] = '';
  const SQL = await loadSql(wasmPath);
  const db = new SQL.Database(new Uint8Array(fs.readFileSync(configDbPath)));
  try {
    const stmt = db.prepare('SELECT val FROM options WHERE LOWER(TRIM(id)) = ? LIMIT 1');
    try {
      for (const id of ids) {
        stmt.bind([id.toLowerCase()]);
        if (stmt.step()) out[id.toLowerCase()] = text(stmt.getAsObject().val);
        stmt.reset();
      }
    } finally {
      stmt.free();
    }
  } catch {
    /* không có bảng options */
  } finally {
    db.close();
  }
  return out;
}
