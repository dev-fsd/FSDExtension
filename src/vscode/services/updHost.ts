// Phần host của gói update: tùy chọn (config.db chỉ đọc + globalState), đường dẫn dự án (PackagePaths), nguồn script SQL, khóa .f.
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { FControllerCrypto } from '../../core/controllers/fCrypto';
import { resolveKeyFile } from '../../core/controllers/controllerReader';
import { objectScript, isTable } from '../../core/sql/sqlObjects';
import { dataScript } from '../../core/sql/tableOps';
import { SqlSession } from '../../core/sql/sqlSession';
import { readDmdaExtras, readOptions } from '../../core/update/configExtras';
import type { ScriptSource } from '../../core/update/create';
import { nodePathEnv, normalizeDir, PackagePaths, type PathEnv } from '../../core/update/packagePaths';
import type { CallCtx } from '../bridge/types';
import { configDbPath } from '../projects';
import { resolveDb, scripts } from './sqlHost';

const NL = '\r\n';

let extensionPath = '';
let globalState: vscode.Memento | undefined;

export function initHost(context: vscode.ExtensionContext): void {
  extensionPath = context.extensionPath;
  globalState = context.globalState;
}

const wasmPath = (): string | undefined => (extensionPath ? path.join(extensionPath, 'dist', 'sql-wasm.wasm') : undefined);

// ===================== Tùy chọn (thay Reg của 5.1) =====================

const OPTION_IDS = ['m_updatefile_dir', 'CurrUser', 'CurrDept', 'm_recent_upd', 'filesearch_exact', 'sqlsearch_exact', 'multisearch_autofind'];
let optCache: { at: number; mtime: number; db: string; v: Record<string, string> } | undefined;

/** Giá trị từ config.db (chỉ đọc), nhớ 20 giây. */
async function configOptions(): Promise<Record<string, string>> {
  const db = configDbPath();
  if (!db || !fs.existsSync(db)) return {};
  const mtime = fs.statSync(db).mtimeMs;
  if (optCache && optCache.db === db && optCache.mtime === mtime && Date.now() - optCache.at < 20_000) return optCache.v;
  const v = await readOptions(db, OPTION_IDS, wasmPath());
  optCache = { at: Date.now(), mtime, db, v };
  return v;
}

const stateKey = (name: string): string => `fsd.upd.opt.${name.toLowerCase()}`;

/** Tùy chọn hiệu lực: giá trị người dùng đặt trong extension, không có thì lấy từ config.db. */
export async function getOption(name: string): Promise<string> {
  const own = globalState?.get<string>(stateKey(name));
  if (own !== undefined) return own;
  return (await configOptions())[name.toLowerCase()] ?? '';
}

export async function setOption(name: string, value: string): Promise<void> {
  await globalState?.update(stateKey(name), value);
}

export async function currentUser(): Promise<string> {
  const v = (await configOptions()).curruser ?? '';
  return v !== '' ? v : globalState?.get<string>('fsd.currUser') ?? '';
}

export async function currentDept(): Promise<string> {
  return (await configOptions()).currdept ?? '';
}

/** Thư mục gốc lưu gói theo menu (m_updatefile_dir), có "\" cuối; chưa khai → ''. */
export async function updateRoot(): Promise<string> {
  return normalizeDir(await getOption('m_updatefile_dir'));
}

// ===================== Đường dẫn dự án =====================

const reachCache = new Map<string, Promise<boolean>>();

/** Share UNC tới được không (dò TCP 445 trong 1 giây, nhớ trong phiên); local luôn true. */
export function isReachable(p: string): Promise<boolean> {
  const t = (p ?? '').trim();
  if (!t.startsWith('\\\\')) return Promise.resolve(true);
  const host = t.substring(2).split('\\')[0];
  if (host === '' || host === '.' || host.toLowerCase() === 'localhost') return Promise.resolve(true);
  let r = reachCache.get(host.toLowerCase());
  if (!r) {
    r = new Promise<boolean>((resolve) => {
      const sock = net.connect({ host, port: 445 });
      const done = (ok: boolean): void => { sock.destroy(); resolve(ok); };
      sock.setTimeout(1000, () => done(false));
      sock.once('connect', () => done(true));
      sock.once('error', () => done(false));
    });
    reachCache.set(host.toLowerCase(), r);
  }
  return r;
}

const reachSync = new Map<string, boolean>();

async function warm(paths: string[]): Promise<void> {
  await Promise.all(paths.filter((p) => p.trim() !== '').map(async (p) => {
    const t = p.trim();
    if (t.startsWith('\\\\')) reachSync.set(t.substring(2).split('\\')[0].toLowerCase(), await isReachable(t));
  }));
}

const env: PathEnv = {
  ...nodePathEnv,
  reachable: (p) => {
    const t = (p ?? '').trim();
    if (!t.startsWith('\\\\')) return true;
    return reachSync.get(t.substring(2).split('\\')[0].toLowerCase()) ?? true;
  }
};

const pathsCache = new Map<string, { at: number; p: PackagePaths }>();

/** Gốc Web / Mobile / Other / FB + thư mục làm việc của dự án (dmda trong config.db); nhớ 30 giây. */
export async function projectPaths(ctx: CallCtx): Promise<PackagePaths> {
  const code = ctx.project.code;
  const hit = pathsCache.get(code);
  if (hit && Date.now() - hit.at < 30_000) return hit.p;
  const dbPath = configDbPath();
  const extras = dbPath && fs.existsSync(dbPath) ? await readDmdaExtras(dbPath, code, wasmPath()) : { updateDir: '', fbProgramDir: '' };
  const pr = ctx.project;
  await warm([pr.webSource, pr.webProgramDir, pr.mobileDir, extras.updateDir, extras.fbProgramDir]);
  const p = new PackagePaths({ webSource: pr.webSource, webProgramDir: pr.webProgramDir, mobileDir: pr.mobileDir, updateDir: extras.updateDir, fbProgramDir: extras.fbProgramDir }, env);
  // Gốc đã suy ra (có thể là thư mục con của web_source) cũng cần dò mạng trước khi dùng.
  await warm([p.webRoot, p.mobileRoot, p.otherRoot]);
  pathsCache.set(code, { at: Date.now(), p });
  return p;
}

// ===================== Nguồn script SQL cho tạo gói =====================

const sqlSafe = (s: string): string => s.replace(/'/g, "''");

/**
 * Chạy fn với ScriptSource dùng hai kết nối riêng (App = DB App đầu tiên, Sys), đóng khi xong.
 * Chỉ đọc: sp_helptext, SELECT, GETTABLESCRIPT / GETSCRIPTGENDEL (bảng #temp của phiên).
 */
export async function withScriptSource<T>(ctx: CallCtx, fn: (src: ScriptSource) => Promise<T>): Promise<T> {
  const sessions: Partial<Record<'app' | 'sys', SqlSession>> = {};
  const get = async (db: 'app' | 'sys'): Promise<SqlSession> => {
    let s = sessions[db];
    if (!s) {
      const name = db === 'sys' ? ctx.project.sysDatabase : await resolveDb(ctx, '');
      s = await SqlSession.open(await ctx.session.queryConfig(name));
      sessions[db] = s;
    }
    return s;
  };
  const src: ScriptSource = {
    async objectScript(db, name, alter, quotedOff, table) {
      const s = await get(db);
      if (table && !(await isTable(s, name))) return '';
      return objectScript(s, scripts(), name, { alter, quotedOff });
    },
    async insertScript(db, table, key, deleteMode) {
      const s = await get(db);
      const full = await dataScript(s, table, key);
      const del = `DELETE FROM ${table} WHERE ${key.trim() === '' ? '1=1' : key}${NL}`;
      const inserts = full.startsWith(del) ? full.slice(del.length) : '';
      if (inserts === '') return '';
      let head = del;
      if (deleteMode !== 0) {
        const sql = scripts().get('GETSCRIPTGENDEL').split('%tbl').join(table).split('%key').join(sqlSafe(key));
        const sets = await s.query(sql);
        if (!sets[0]) return '';
        head = sets[0].rows.map((r) => String(r[0] ?? '') + NL).join('');
      }
      return head + inserts + 'GO' + NL;
    },
    async scalar(db, sql) {
      const sets = await (await get(db)).query(sql);
      const v = sets[0]?.rows[0]?.[0];
      return v === null || v === undefined ? '' : String(v);
    }
  };
  try {
    return await fn(src);
  } finally {
    await Promise.all(Object.values(sessions).map((s) => s?.close()));
  }
}

/** Khóa đọc .f (nếu có) để dò menu — cùng cách ProjectSession.makeCrypto. */
export function makeCrypto(): FControllerCrypto | undefined {
  try {
    const configured = vscode.workspace.getConfiguration('fsd').get<string>('fKeyFile', '');
    const keys = FControllerCrypto.loadKeys(resolveKeyFile(configured || undefined));
    return keys.length > 0 ? new FControllerCrypto(keys) : undefined;
  } catch {
    return undefined;
  }
}
