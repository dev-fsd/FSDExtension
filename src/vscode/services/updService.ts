// Giỏ "Tạo update" + lệnh cầu nối upd.* của màn Update Script (UpdateService.vb của 5.2): thêm theo loại / file / dữ liệu,
// SQL Explorer, SQL Content Declare, File Explorer, điền ô tìm theo menu, .upd (mở / gộp / lưu / gần đây),
// Save / Load theo menu (cặp .upd + folder), tạo gói, xóa gói. Mọi thay đổi giỏ đẩy sự kiện upd.changed {count}.
// Hình dữ liệu trả về giống 5.2 (thay đổi giỏ → { message, state }).
// Logic thuần ở src/core/update; file này nối vào dự án, SQL Server, VS Code.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { buildBasketScript, type BasketItem, type BasketState, type ScriptOf } from '../../core/basket/basket';
import { scanMenu } from '../../core/controllers/menuStructure';
import { quoteTable } from '../../core/sql/appDatabases';
import { SqlClient } from '../../core/sql/sqlClient';
import { rowObjects } from '../../core/sql/sqlSession';
import type { ProjectRecord } from '../../core/types';
import { findCategory, findFileType, UPDATE_CATEGORIES, UPDATE_FILE_TYPES } from '../../core/update/catalog';
import { createPackage, deleteFolder } from '../../core/update/create';
import { contentDeclareScripts, SQL_OBJECTS_QUERY } from '../../core/update/declareSql';
import { isScoped, searchFiles, type MenuMode } from '../../core/update/fileSearch';
import { forMenu } from '../../core/update/menuContext';
import { deleteUpdFile, loadUpdFiles, menuFiles, menuStem, packageOf, planSaveMenu, removePath, renameFile, saveUpdFile, savePair } from '../../core/update/menuPackages';
import { categoryNameOf, txt, UpdatePackage } from '../../core/update/package';
import { PackageStore } from '../../core/update/packageStore';
import { normalizeDir, type PackagePaths } from '../../core/update/packagePaths';
import type { CallCtx, Registry } from '../bridge/types';
import { register as registerSide } from './sideService';
import { scripts, withDedicated, withPooled } from './sqlHost';
import { currentDept, currentUser, getOption, initHost, isReachable, makeCrypto, projectPaths, setOption, updateRoot, withScriptSource } from './updHost';

/** Chưa có globalStorage (hoặc test) thì giỏ chỉ nằm trong bộ nhớ. */
let store = new PackageStore();
/** Memo (theo tên file .upd vừa nạp) cho màn gán ô Memo. */
let lastMemo = '';

const str = (v: unknown): string => (v == null ? '' : String(v));
const bool = (v: unknown): boolean => v === true;
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Gói đang soạn của dự án. */
export function currentPackage(code: string): UpdatePackage {
  return store.get(code);
}

// ===================== Trạng thái =====================

function ymd(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

async function stateOf(ctx: CallCtx, p: UpdatePackage): Promise<Record<string, unknown>> {
  const paths = await projectPaths(ctx);
  const user = await currentUser();
  const dept = await currentDept();
  const rows = p.rows.map((r, i) => ({ i, type: txt(r, 'sType').trim(), view: txt(r, 'sView'), db: txt(r, 'sDB'), value: txt(r, 'sValue'), url: txt(r, 'sUrl') }));
  const categories = UPDATE_CATEGORIES.map((c) => ({ text: c.sText.trim(), type: c.sType.trim(), db: c.sDatabase }));
  return {
    rows,
    otherApp: p.otherAppSql,
    otherSys: p.otherSysSql,
    file: p.filePath,
    lastMemo,
    workingDir: paths.updateDir,
    webRoot: paths.webRoot,
    mobileRoot: paths.mobileRoot,
    otherRoot: paths.otherRoot,
    fbRoot: paths.fbRoot,
    saveTo: `${ctx.project.code}_${dept !== '' ? dept + '.' : ''}${user}_${ymd(new Date())}_`,
    categories,
    user,
    updateRoot: (await updateRoot()) + ctx.project.code + '\\'
  };
}

/** Chạy thay đổi trên gói, lưu, báo upd.changed, trả { message, state }. */
async function change(ctx: CallCtx, action: (p: UpdatePackage) => Promise<string> | string): Promise<{ message: string; state: Record<string, unknown> }> {
  const p = store.get(ctx.project.code);
  const message = await action(p);
  store.save(ctx.project.code);
  const state = await stateOf(ctx, p);
  ctx.emit('upd.changed', { count: p.count() });
  return { message, state };
}

// ===================== SQL =====================

/** Tên bảng (có thể kèm schema) → chuỗi dùng trong câu SELECT. */
function tableRef(table: string): string {
  const t = table.trim();
  const dot = t.indexOf('.');
  return dot > 0 ? quoteTable(t.slice(0, dot), t.slice(dot + 1)) : quoteTable('', t);
}

const isSysDb = (db: string, ctx: CallCtx): boolean => db === 'Sys' || db.trim().toLowerCase() === ctx.project.sysDatabase.trim().toLowerCase();

/**
 * AddData thử điều kiện trước khi thêm: bảng / điều kiện lỗi hoặc không có dòng nào thì không thêm.
 * Chỉ SELECT TOP 1 (kết nối riêng, chỉ-đọc). Trả '' khi hợp lệ, câu báo khi không.
 */
async function checkDataExists(ctx: CallCtx, table: string, key: string, db: string, isSys: boolean): Promise<string> {
  const sKey = UpdatePackage.dataKey(key);
  let client: SqlClient | undefined;
  try {
    let dbName = ctx.project.sysDatabase;
    if (!isSys) {
      const t = db.trim();
      dbName = t === '' || t === 'App' ? (await ctx.session.appDatabases())[0] : t;
      if (!dbName) return 'Không xác định được DB App của dự án.';
    }
    client = new SqlClient(await ctx.session.queryConfig(dbName));
    const rows = await client.query(`SELECT TOP 1 1 AS x FROM ${tableRef(table)} WHERE ${sKey}`);
    return rows.length === 0 ? `Bảng ${table} không có dòng nào thỏa ${sKey}` : '';
  } catch (e) {
    return `Điều kiện / bảng lỗi: ${table} WHERE ${sKey} (${errText(e)})`;
  } finally {
    try {
      await client?.close();
    } catch {
      /* bỏ qua */
    }
  }
}

/** Gợi ý ô Code: chạy sGetSysID của loại trên DB Sys / App → [{val, value, type}]. */
async function categoryCodes(ctx: CallCtx, text: string): Promise<Array<{ val: string; value: string; type: string }>> {
  const cat = findCategory(text);
  if (!cat) throw new Error(`Không có loại ${text} trong updatecategory.`);
  return withPooled(ctx, cat.sDatabase === 'Sys' ? ctx.project.sysDatabase : '', async (s) => {
    const sets = await s.query(cat.sGetSysID);
    const cell = (r: Record<string, unknown>, c: string): string => (r[c] === null || r[c] === undefined ? '' : String(r[c]).trim());
    return rowObjects(sets[0]).map((r) => ({ val: cell(r, 'val'), value: cell(r, 'value'), type: cell(r, 'type') }));
  });
}

/** Đối tượng SQL (panel SQL / Query): store, function, view, trigger → dòng S; bảng → dòng T. */
async function addObject(ctx: CallCtx, p: UpdatePackage, name: string, xtype: string, db: string, alter: boolean, quotedOff: boolean): Promise<string> {
  const isSys = isSysDb(db, ctx);
  const catName = categoryNameOf(xtype, isSys);
  if (!catName) return `Loại đối tượng ${xtype} chưa hỗ trợ.`;
  const cat = findCategory(catName)!;
  const msg = p.addCategory(cat, name, alter, quotedOff, name, xtype);
  // Danh mục Store / Function… khai sDatabase = App; đối tượng lấy từ DB Sys thì ghi lại Sys.
  if (msg === '' && isSys) p.rows[p.rows.length - 1].sDB = 'Sys';
  return msg;
}

async function addCategory(ctx: CallCtx, p: UpdatePackage, a: Record<string, any>): Promise<string> {
  const cat = findCategory(str(a.category));
  if (!cat) throw new Error(`Không có loại ${str(a.category)} trong updatecategory.`);
  const code = str(a.code).trim();
  let v2 = '';
  if (cat.sType.trim() === 'V' && code !== '' && !p.categoryDuplicate(cat, code)) {
    v2 = await withPooled(ctx, ctx.project.sysDatabase, async (s) => {
      const sets = await s.query(cat.sGetSysID2.split('%sysid').join(code));
      const v = sets[0]?.rows[0]?.[0];
      return v == null ? '' : String(v).trim();
    });
  }
  return p.addCategory(cat, code, bool(a.alter), bool(a.quotedOff), str(a.name), str(a.type), v2);
}

async function addData(ctx: CallCtx, p: UpdatePackage, a: Record<string, any>): Promise<string> {
  const table = str(a.table).trim();
  if (table === '') throw new Error('Chưa chọn bảng.');
  const db = str(a.db);
  const isSys = isSysDb(db, ctx);
  // Trùng thì khỏi thử DB.
  if (p.dataDuplicate(table, str(a.key), isSys)) return 'Đã có trong Update.';
  const msg = await checkDataExists(ctx, table, str(a.key), db, isSys);
  if (msg !== '') return msg;
  p.addDataRow(table, str(a.key), isSys, scripts().get('GETSCRIPTGEN'));
  return '';
}

async function tables(ctx: CallCtx, isSys: boolean): Promise<string[]> {
  return withPooled(ctx, isSys ? ctx.project.sysDatabase : '', async (s) => {
    const sets = await s.query(scripts().get('GETTABLES'));
    const set = sets[0];
    if (!set || set.columns.length === 0) return [];
    const idx = Math.max(0, set.columns.findIndex((c) => c.name === 'val'));
    return set.rows.map((r) => str(r[idx]).trim());
  });
}

async function sqlObjects(ctx: CallCtx): Promise<{ app: unknown[]; sys: unknown[] }> {
  const one = async (db: string): Promise<unknown[]> => {
    try {
      return await withPooled(ctx, db, async (s) =>
        rowObjects((await s.query(SQL_OBJECTS_QUERY))[0]).map((r) => ({ name: str(r.name), type: str(r.type).trim().toUpperCase(), tp: str(r.tp) }))
      );
    } catch {
      return [];
    }
  };
  return { app: await one(''), sys: await one(ctx.project.sysDatabase) };
}

async function contentDeclare(ctx: CallCtx, text: string): Promise<unknown[]> {
  const sql = contentDeclareScripts(text);
  if (sql.length === 0) return [];
  const out: unknown[] = [];
  const pairs: Array<['App' | 'Sys', string, string]> = [['App', '', sql[0]], ['Sys', ctx.project.sysDatabase, sql[1]]];
  for (const [label, db, script] of pairs) {
    try {
      const sets = await withDedicated(ctx, db, (s) => s.query(script));
      const set = sets.find((x) => x.columns.some((c) => c.name === 'tb'));
      for (const r of rowObjects(set)) out.push({ db: label, tb: str(r.tb), tong: Number(r.tong), wh: str(r.wh) });
    } catch {
      /* lỗi một bên (DB không có bảng…) bỏ qua bên đó như 5.1 */
    }
  }
  return out;
}

// ===================== File =====================

function globRegex(p: string): RegExp {
  return new RegExp('^' + p.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
}

async function typedFiles(type: string, root: string): Promise<string[]> {
  const t = findFileType(type);
  if (!t) throw new Error(`Không có loại file ${type} trong updatefile.`);
  const dir = normalizeDir(root) + t.sUrl;
  if (root === '' || !(await isReachable(dir)) || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  const rx = globRegex(t.sExt === '' ? '*.*' : t.sExt);
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && rx.test(e.name)).map((e) => e.name).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

const modeOf = (m: unknown): MenuMode => (m === 'mob' ? 'mob' : m === 'fb' ? 'fb' : 'fbo');

async function searchCmd(ctx: CallCtx, a: Record<string, any>): Promise<unknown> {
  const paths = await projectPaths(ctx);
  const root = normalizeDir(str(a.root));
  if (root === '' || !(await isReachable(root))) throw new Error(`Không vào được thư mục ${root}`);
  const mobile = bool(a.mobile);
  const mode: MenuMode = mobile ? 'mob' : modeOf(a.mode);
  const scoped = isScoped(root, mode, mobile, { web: paths.webRoot, mobile: paths.mobileRoot, fb: paths.fbRoot });
  return searchFiles({
    root, text: str(a.text), mode, mobile, content: bool(a.content), exact: a.exact !== false,
    types: a.types && typeof a.types === 'object' ? (a.types as Record<string, boolean>) : undefined, scoped
  });
}

async function menuContext(a: Record<string, any>): Promise<unknown> {
  const root = normalizeDir(str(a.root));
  const m = await forMenu(
    { kind: str(a.kind), sysid: str(a.sysid), syscode: str(a.syscode), xtype: str(a.xtype), link: str(a.link), root },
    { scan: (ctrl, sysid, mobile) => scanMenu(ctrl, sysid, { mobile, crypto: makeCrypto() }), fileExists: (p) => fs.existsSync(p) && fs.statSync(p).isFile() }
  );
  const files = m.files
    ? m.files.filter((f) => f.toLowerCase().startsWith(root.toLowerCase())).map((f) => {
        const rel = f.substring(root.length);
        const dir = path.win32.dirname(rel);
        let mtime = '';
        try {
          const d = fs.statSync(f).mtime;
          const p2 = (n: number): string => String(n).padStart(2, '0');
          mtime = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
        } catch {
          /* bỏ qua */
        }
        return { full: rel, folder: dir === '.' ? '' : dir, name: path.win32.basename(f), mtime };
      })
    : null;
  return { sql: m.sql, other: m.other, file: m.file, files: str(a.kind) === 'fb' ? null : files, fellBack: m.fellBack };
}

// ===================== Tạo gói =====================

async function createCore(ctx: CallCtx, p: UpdatePackage, working: string, name: string, programPath: string, paths: PackagePaths): Promise<{ folder: string; missing: string[]; files: string[] }> {
  if (working.trim() === '') throw new Error('Chưa nhập thư mục làm việc.');
  let program = normalizeDir(programPath);
  if (program === '') program = paths.webRoot;
  if (program === '') throw new Error('Chưa có đường dẫn chương trình.');
  const sc = scripts();
  return withScriptSource(ctx, (source) =>
    createPackage(p, {
      workingDir: normalizeDir(working), folderName: name, paths, programPath: program, source,
      scripts: { folderUpdate: sc.get('FOLDERUPDATE'), updateSysFile: sc.get('UPDATESYSFILEDF1'), updateAppFile: sc.get('UPDATEAPPFILEDF1'), getExe: sc.get('GETEXE'), getRpt: sc.get('GETRPT') }
    })
  );
}

async function saveMenu(ctx: CallCtx, a: Record<string, any>): Promise<unknown> {
  const p = store.get(ctx.project.code);
  if (p.isEmpty()) throw new Error('Danh sách trống — không có gì để lưu.');
  const memo = str(a.memo).trim();
  if (memo === '') throw new Error('Nhập mô tả cho Update.');
  const menuId = str(a.menuId).trim();
  if (menuId === '') throw new Error('Chọn menu trước khi lưu.');
  const root = await updateRoot();
  if (root === '' || !fs.existsSync(root)) throw new Error(`Thư mục Update (m_updatefile_dir) ${root} không tồn tại.`);
  const user = await currentUser();
  let stem = menuStem(root, ctx.project.code, user, menuId, memo);
  const decision = str(a.decision);
  if (decision === '') return planSaveMenu(p, stem, memo, menuId, user);

  const overwrite = decision === 'overwrite';
  if (overwrite && p.filePath !== '' && fs.existsSync(p.filePath)) stem = path.join(path.dirname(p.filePath), path.basename(p.filePath, path.extname(p.filePath)));
  const paths = await projectPaths(ctx);
  let program = normalizeDir(str(a.programPath));
  if (program === '') program = paths.webRoot;
  if (program === '') throw new Error('Chưa có đường dẫn chương trình.');
  const sc = scripts();
  const saved = await withScriptSource(ctx, (source) =>
    savePair(p, stem, overwrite, root, {
      paths, programPath: program, source,
      scripts: { folderUpdate: sc.get('FOLDERUPDATE'), updateSysFile: sc.get('UPDATESYSFILEDF1'), updateAppFile: sc.get('UPDATEAPPFILEDF1'), getExe: sc.get('GETEXE'), getRpt: sc.get('GETRPT') }
    })
  );
  store.save(ctx.project.code);
  return { saved: saved.updFile, result: { folder: saved.result.folder, missing: saved.result.missing, files: saved.result.files }, state: await stateOf(ctx, p) };
}

async function fileOp(op: string, target: string, name: string): Promise<unknown> {
  switch (op) {
    case 'open':
      await vscode.env.openExternal(vscode.Uri.file(target));
      return null;
    case 'rename':
      return renameFile(target, name);
    case 'delete':
      removePath(target);
      return null;
    case 'program':
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error(`Không có file trong Program: ${target}`);
      await vscode.env.openExternal(vscode.Uri.file(target));
      return null;
    default:
      return null;
  }
}

// ===================== Đăng ký lệnh =====================

const OPTION_NAMES = ['filesearch_exact', 'sqlsearch_exact', 'multisearch_autofind'];

export function register(reg: Registry, context?: vscode.ExtensionContext): void {
  if (context) {
    initHost(context);
    const root = context.globalStorageUri.fsPath;
    store = new PackageStore(path.join(root, 'update'), path.join(root, 'basket'), () => scripts().get('GETSCRIPTGEN'));
  }
  const pkg = (ctx: CallCtx): UpdatePackage => store.get(ctx.project.code);

  reg.register('upd.state', async (_a, ctx) => stateOf(ctx, pkg(ctx)));

  // Thêm theo loại + mã.
  reg.register('upd.categoryCodes', (a, ctx) => categoryCodes(ctx, str(a.category)));
  reg.register('upd.addCategory', (a, ctx) => change(ctx, (p) => addCategory(ctx, p, a)));
  reg.register('upd.addObject', (a, ctx) => change(ctx, (p) => addObject(ctx, p, str(a.name), str(a.type), str(a.db), bool(a.alter), bool(a.quotedOff))));
  // Panel SQL "Thêm danh sách đang hiện vào Update": nhiều đối tượng một lần (items [{name, type}]), message = các dòng bị bỏ qua.
  reg.register('upd.addObjectList', (a, ctx) =>
    change(ctx, async (p) => {
      const notes: string[] = [];
      let added = 0;
      for (const it of (Array.isArray(a.items) ? a.items : []) as Array<Record<string, unknown>>) {
        const m = await addObject(ctx, p, str(it.name), str(it.type), str(a.db), bool(a.alter), bool(a.quotedOff));
        if (m === '') added++;
        else if (notes.length < 5) notes.push(`${str(it.name)}: ${m}`);
      }
      const skipped = (Array.isArray(a.items) ? a.items.length : 0) - added;
      return skipped > 0 ? `Thêm ${added}, bỏ qua ${skipped} (đã có hoặc không hỗ trợ)\n${notes.join('\n')}` : '';
    })
  );

  // File theo loại / chọn file / File Explorer.
  reg.register('upd.fileTypes', () => UPDATE_FILE_TYPES.map((t) => ({ text: t.sText.trim(), url: t.sUrl, ext: t.sExt })));
  reg.register('upd.typedFiles', (a) => typedFiles(str(a.type), str(a.root)));
  reg.register('upd.addTypedFile', (a, ctx) =>
    change(ctx, (p) => {
      const t = findFileType(str(a.type));
      if (!t) throw new Error(`Không có loại file ${str(a.type)} trong updatefile.`);
      return p.addFileRow(t, normalizeDir(str(a.root)) + t.sUrl, str(a.name));
    })
  );
  reg.register('upd.addFile', (a, ctx) =>
    change(ctx, async (p) => {
      const paths = await projectPaths(ctx);
      const errors: string[] = [];
      for (const f of (Array.isArray(a.paths) ? a.paths : []) as string[]) {
        const m = p.addFile(f, UPDATE_FILE_TYPES, paths, (x) => fs.existsSync(x) && fs.statSync(x).isFile());
        if (m !== '') errors.push(`${path.win32.basename(f)}: ${m}`);
      }
      return errors.join('\n');
    })
  );
  reg.register('upd.addExplorerFiles', (a, ctx) =>
    change(ctx, (p) => {
      const root = normalizeDir(str(a.root));
      for (const rel of (Array.isArray(a.files) ? a.files : []) as string[]) {
        const full = root + rel;
        p.addFileRow(undefined, path.win32.dirname(full), path.win32.basename(full));
      }
      return '';
    })
  );

  // Dữ liệu bảng (Other Gen) + SQL Content Declare.
  reg.register('upd.tables', (a, ctx) => tables(ctx, bool(a.sys)));
  reg.register('upd.addData', (a, ctx) => change(ctx, (p) => addData(ctx, p, a)));
  reg.register('upd.declare', (a, ctx) => contentDeclare(ctx, str(a.text)));
  reg.register('upd.addDeclare', (a, ctx) =>
    change(ctx, (p) => {
      for (const it of (Array.isArray(a.items) ? a.items : []) as Array<Record<string, unknown>>) p.addDeclare(str(it.db), str(it.tb), str(it.wh));
      return '';
    })
  );

  // SQL Explorer.
  reg.register('upd.sqlObjects', (_a, ctx) => sqlObjects(ctx));
  reg.register('upd.addObjects', (a, ctx) =>
    change(ctx, (p) => {
      for (const it of (Array.isArray(a.items) ? a.items : []) as Array<Record<string, unknown>>) p.addExplorerObject(str(it.name), str(it.type), str(it.db) === 'Sys');
      return '';
    })
  );

  // File Explorer + điền ô tìm theo menu.
  reg.register('upd.searchFiles', (a, ctx) => searchCmd(ctx, a));
  reg.register('upd.menuContext', (a) => menuContext(a));

  // Other SQL, xóa dòng, .upd.
  reg.register('upd.setOtherSql', (a, ctx) =>
    change(ctx, (p) => {
      if (a.app != null) p.otherAppSql = str(a.app);
      if (a.sys != null) p.otherSysSql = str(a.sys);
      return '';
    })
  );
  reg.register('upd.remove', (a, ctx) =>
    change(ctx, (p) => {
      p.removeAt((Array.isArray(a.indexes) ? a.indexes : []).map(Number));
      return '';
    })
  );
  reg.register('upd.clear', (_a, ctx) =>
    change(ctx, (p) => {
      p.clear();
      return '';
    })
  );
  reg.register('upd.load', (a, ctx) =>
    change(ctx, async (p) => {
      const paths = await projectPaths(ctx);
      const files = (Array.isArray(a.paths) ? a.paths : []).map(String);
      const r = loadUpdFiles(p, files, bool(a.merge), paths, paths.webRoot);
      if (bool(a.remember) && files.length === 1) await setOption('m_recent_upd', files[0]);
      lastMemo = r.memo;
      return r.message;
    })
  );
  reg.register('upd.save', async (a, ctx) => {
    const p = pkg(ctx);
    saveUpdFile(p, str(a.path));
    store.save(ctx.project.code);
    if (bool(a.remember)) await setOption('m_recent_upd', str(a.path));
    return stateOf(ctx, p);
  });

  // Tùy chọn dùng chung với 5.1 (đọc config.db, ghi nhớ riêng của extension): filesearch_exact (mặc định bật),
  // sqlsearch_exact (mặc định tắt), multisearch_autofind (mặc định bật).
  reg.register('upd.option', async (a) => {
    const key = str(a.name);
    if (!OPTION_NAMES.includes(key)) throw new Error(`Tùy chọn không hỗ trợ: ${key}`);
    if (a.value != null) await setOption(key, bool(a.value) ? '1' : '0');
    const v = await getOption(key);
    return key === 'sqlsearch_exact' ? v === '1' : v !== '0';
  });
  reg.register('upd.recent', async () => {
    const f = await getOption('m_recent_upd');
    return f !== '' && fs.existsSync(f) ? f : '';
  });

  // Theo menu: danh sách .upd của menu, xóa file .upd, lưu cặp .upd + folder.
  reg.register('upd.menuFiles', async (a, ctx) => menuFiles(await updateRoot(), ctx.project.code, str(a.menuId)));
  reg.register('upd.deleteUpdFile', (a) => {
    deleteUpdFile(str(a.path));
    return null;
  });
  reg.register('upd.saveMenu', (a, ctx) => saveMenu(ctx, a));

  // Tạo gói + thao tác trên cây gói vừa tạo.
  reg.register('upd.create', async (a, ctx) => {
    const p = pkg(ctx);
    if (p.rows.length === 0) throw new Error('Danh sách trống — thêm mục trước khi tạo Update.');
    const r = await createCore(ctx, p, str(a.workingDir), str(a.folderName), str(a.programPath), await projectPaths(ctx));
    return { folder: r.folder, missing: r.missing, files: r.files };
  });
  reg.register('upd.deletePackage', (a) => {
    deleteFolder(str(a.folder));
    return null;
  });
  reg.register('upd.fileOp', (a) => fileOp(str(a.op), str(a.path), str(a.name)));
  reg.register('upd.packageOf', (a) => packageOf(str(a.path)));

  // Script thêm vào Other App / Sys SQL của gói (DB đang chọn là DB Sys → Sys, còn lại App).
  reg.register('upd.appendSql', async (a, ctx) =>
    change(ctx, (p) => {
      p.appendOtherSql(isSysDb(str(a.db), ctx), str(a.sql));
      return '';
    })
  );

  // Cầu nối tab Update / Multi Search ⇄ view "Cây màn" ở sidebar (side.send, side.get).
  registerSide(reg);
}

// ===================== Lệnh VS Code (agent chính nối vào package.json / extension.ts) =====================

export interface BasketCommandOptions {
  /** Dự án đang dùng (tab đang mở / workspace). */
  currentProject: () => ProjectRecord | undefined;
  /** Sinh script thật cho một mục dữ liệu / đối tượng (nối vào sql.script / table.dataScript). Thiếu thì chỉ ghi chú định danh mục. */
  scriptOf?: (item: BasketItem, project: ProjectRecord) => Promise<string>;
  /** Báo cho webview cập nhật số đếm sau khi xóa (tùy chọn). */
  onChanged?: (project: ProjectRecord, count: number) => void;
}

interface BasketPick extends vscode.QuickPickItem {
  /** Vị trí trong rows; -1 = SQL thêm App, -2 = SQL thêm Sys. */
  index: number;
}

/** Dòng gen → mục giỏ (dữ liệu / đối tượng) để sinh script; loại khác (file, bảng cấu hình theo mã…) → undefined. */
function toBasketItem(r: ReturnType<typeof currentPackage>['rows'][number]): BasketItem | undefined {
  const t = txt(r, 'sType').trim();
  const db = txt(r, 'sDB') === 'Sys' ? 'sys' : 'app';
  if (t === 'O') return { kind: 'data', db, table: txt(r, 'sTbl'), key: txt(r, 'sKey') };
  if (t === 'T' || /^S\d*$/.test(t)) {
    const name = txt(r, 'name') || txt(r, 'sValue');
    const isTable = t === 'T';
    const view = txt(r, 'sView');
    const category = isTable ? (db === 'sys' ? 'Table Sys' : 'Table App') : /^Function/.test(view) ? 'Function' : /^View/.test(view) ? 'View' : /^Trigger/.test(view) ? 'Trigger' : 'Store';
    return { kind: 'object', db, category, name, type: isTable ? 'U' : 'P', alter: t.length > 1 && t[1] === '1', quotedOff: t.length > 2 && t[2] === '1' };
  }
  return undefined;
}

/**
 * Trả handler cho 3 lệnh: fsd.basketView (xem, xóa từng mục), fsd.basketCopy (copy toàn bộ script), fsd.basketClear (xóa hết).
 */
export function buildBasketCommands(opts: BasketCommandOptions): Record<'fsd.basketView' | 'fsd.basketCopy' | 'fsd.basketClear', () => Promise<void>> {
  const need = (): ProjectRecord | undefined => {
    const p = opts.currentProject();
    if (!p) void vscode.window.showWarningMessage('Chưa chọn dự án — mở một tab FSD hoặc file của dự án trước.');
    return p;
  };
  const notify = (p: ProjectRecord, s: UpdatePackage): void => {
    store.save(p.code);
    opts.onChanged?.(p, s.count());
  };

  return {
    'fsd.basketView': async () => {
      const p = need();
      if (!p) return;
      const s = store.get(p.code);
      const remove = { iconPath: new vscode.ThemeIcon('trash'), tooltip: 'Xóa khỏi danh sách Update' };
      const picks = (): BasketPick[] => {
        const list: BasketPick[] = s.rows.map((r, index) => ({ label: txt(r, 'sView'), description: `${txt(r, 'sType').trim()} · ${txt(r, 'sDB') || '-'}`, index, buttons: [remove] }));
        if (s.otherAppSql.trim() !== '') list.push({ label: 'SQL thêm App', description: `${s.otherAppSql.length} ký tự`, index: -1, buttons: [remove] });
        if (s.otherSysSql.trim() !== '') list.push({ label: 'SQL thêm Sys', description: `${s.otherSysSql.length} ký tự`, index: -2, buttons: [remove] });
        return list;
      };
      const qp = vscode.window.createQuickPick<BasketPick>();
      qp.title = `Danh sách Update ·${p.code}`;
      qp.placeholder = 'Nút thùng rác xóa từng mục';
      qp.items = picks();
      qp.onDidTriggerItemButton((e) => {
        if (e.item.index >= 0) s.removeAt([e.item.index]);
        else if (e.item.index === -1) s.otherAppSql = '';
        else s.otherSysSql = '';
        notify(p, s);
        qp.items = picks();
        if (qp.items.length === 0) qp.placeholder = 'Danh sách Update trống';
      });
      qp.onDidAccept(() => qp.hide());
      qp.onDidHide(() => qp.dispose());
      qp.show();
    },

    'fsd.basketCopy': async () => {
      const p = need();
      if (!p) return;
      const s = store.get(p.code);
      if (s.count() === 0) {
        void vscode.window.showInformationMessage('Danh sách Update đang trống.');
        return;
      }
      try {
        const items: BasketItem[] = [];
        const skipped: string[] = [];
        for (const r of s.rows) {
          const it = toBasketItem(r);
          if (it) items.push(it);
          else skipped.push(`-- (không sinh script ở lệnh này) ${txt(r, 'sView')}`);
        }
        const state: BasketState = { items, otherAppSql: s.otherAppSql, otherSysSql: s.otherSysSql };
        const scriptOf: ScriptOf | undefined = opts.scriptOf ? (item) => opts.scriptOf!(item, p) : undefined;
        const text = (await buildBasketScript(state, scriptOf)) + (skipped.length > 0 ? '\r\n' + skipped.join('\r\n') : '');
        await vscode.env.clipboard.writeText(text);
        void vscode.window.showInformationMessage(`Đã copy script Update (${s.count()} mục).`);
      } catch (e) {
        void vscode.window.showErrorMessage(`Không tạo được script Update: ${errText(e)}`);
      }
    },

    'fsd.basketClear': async () => {
      const p = need();
      if (!p) return;
      const s = store.get(p.code);
      if (s.count() === 0) {
        void vscode.window.showInformationMessage('Danh sách Update đang trống.');
        return;
      }
      const ok = await vscode.window.showWarningMessage(`Xóa hết ${s.count()} mục trong danh sách Update của ${p.code}?`, { modal: true }, 'Xóa hết');
      if (ok !== 'Xóa hết') return;
      s.clear();
      notify(p, s);
    }
  };
}
