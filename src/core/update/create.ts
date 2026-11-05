// Tạo gói update ra đĩa (port UpdatePackage.Create / Build 5.2): thư mục gói, script Sys / App (UTF-16), Other SQL, copy file / exe / rpt.
// SQL đi qua ScriptSource (host cấp, chỉ đọc); đĩa dùng fs đồng bộ như 5.2.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { txt, type UpdatePackage } from './package';
import { normalizeDir, type PackagePaths } from './packagePaths';

/** Nguồn sinh script cho dòng gen — host nối vào objectScript / dataScript của extension. Lỗi SQL thì ném Error. */
export interface ScriptSource {
  /** Script đối tượng (isTable = dòng T). */
  objectScript(db: 'app' | 'sys', name: string, alter: boolean, quotedOff: boolean, isTable: boolean): Promise<string>;
  /** Script dữ liệu: deleteMode 0 = DELETE theo điều kiện, 1 = GETSCRIPTGENDEL (chứng từ). Không có dòng → ''. */
  insertScript(db: 'app' | 'sys', table: string, key: string, deleteMode: number): Promise<string>;
  /** Ô đầu của kết quả đầu tiên ('' nếu không có). */
  scalar(db: 'app' | 'sys', sql: string): Promise<string>;
}

/** Script hệ thống (system.db) dùng khi tạo gói. */
export interface CreateScripts {
  folderUpdate: string;
  updateSysFile: string;
  updateAppFile: string;
  getExe: string;
  getRpt: string;
}

export interface CreateResult {
  folder: string;
  missing: string[];
  files: string[];
}

export interface CreateOptions {
  workingDir: string;
  folderName: string;
  /** exact: dùng đúng tên folder (Save theo menu đã chọn tên không trùng); false: trùng thì thêm yyMMdd_HHmmss. */
  exact?: boolean;
  paths: PackagePaths;
  programPath: string;
  source: ScriptSource;
  scripts: CreateScripts;
  /** Giờ hiện tại (test). */
  now?: Date;
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** yyMMdd_HHmmss */
export function stampShort(d: Date): string {
  return `${pad(d.getFullYear() % 100)}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** yyyyMMdd_HHmmss */
export function stampLong(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Thư mục con của gói theo FOLDERUPDATE: mục có tiền tố "1" là thư mục tạo. */
export function packageFolders(folderUpdate: string): string[] {
  return folderUpdate.split(',').filter((x) => x.length > 1 && x[0] === '1').map((x) => x.substring(1));
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function isDirEmpty(d: string): boolean {
  return fs.readdirSync(d).length === 0;
}

/** Xóa các thư mục con rỗng trực tiếp (không đệ quy). */
function removeEmpty(dir: string): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const d = path.join(dir, e.name);
    if (isDirEmpty(d)) fs.rmdirSync(d);
  }
}

/** Ghi script: thêm .sql, UTF-16 LE có BOM (Encoding.Unicode); rỗng hoặc thư mục cha không có → bỏ qua. */
export function writeScript(text: string, file: string): void {
  if (text === '') return;
  if (!fs.existsSync(path.dirname(file))) return;
  if (!file.toLowerCase().endsWith('.sql')) file += '.sql';
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
}

function copyTo(source: string, dest: string): void {
  if (fs.existsSync(dest)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest);
  // Copy từ share giữ ReadOnly — gỡ để lần sau ghi đè / xóa gói không bị từ chối.
  try { fs.chmodSync(dest, 0o666); } catch { /* bỏ qua */ }
}

function listFilesRel(root: string, dir = root, out: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) if (e.isFile()) out.push(path.join(dir, e.name).substring(root.length + 1));
  for (const e of entries) if (e.isDirectory()) listFilesRel(root, path.join(dir, e.name), out);
  return out;
}

/** Tạo gói. Lỗi giữa chừng: xóa folder gói vừa tạo rồi ném lại. */
export async function createPackage(pkg: UpdatePackage, o: CreateOptions): Promise<CreateResult> {
  if (!fs.existsSync(o.workingDir) || !fs.statSync(o.workingDir).isDirectory()) throw new Error(`Không có thư mục làm việc: ${o.workingDir}`);
  if (pkg.rows.length === 0 && pkg.otherAppSql.trim() === '' && pkg.otherSysSql.trim() === '') throw new Error('Gói chưa có mục nào.');
  let main = normalizeDir(o.workingDir.replace(/\//g, '\\')) + o.folderName.trim();
  if (fs.existsSync(main) && !o.exact) main += stampShort(o.now ?? new Date());
  fs.mkdirSync(main, { recursive: true });
  try {
    return await build(pkg, o, main);
  } catch (e) {
    try { fs.rmSync(main, { recursive: true, force: true }); } catch { /* bỏ qua */ }
    throw e;
  }
}

async function build(pkg: UpdatePackage, o: CreateOptions, main: string): Promise<CreateResult> {
  for (const f of packageFolders(o.scripts.folderUpdate)) fs.mkdirSync(path.join(main, f), { recursive: true });
  fs.mkdirSync(path.join(main, 'Web'), { recursive: true });

  const result: CreateResult = { folder: main, missing: [], files: [] };
  let scrSys = '';
  let scrApp = '';
  let exe = '';
  let rpt = '';
  for (const row of pkg.rows) {
    const t = txt(row, 'sType').trim();
    const db: 'app' | 'sys' = txt(row, 'sDB') === 'Sys' ? 'sys' : 'app';
    if (t === 'E' || t === 'P' || t === 'X') {
      copyFile(txt(row, 'sUrl'), txt(row, 'sValue'), main, o, result);
      continue;
    }
    try {
      switch (t) {
        case 'R': case 'L': case 'V': case 'M': {
          const values = txt(row, 'sValue').split(',');
          scrSys += await appendCodes(o.source, 'sys', txt(row, 'sysSqlCode'), values, t === 'V', result);
          scrApp += await appendCodes(o.source, 'app', txt(row, 'appSqlCode'), values, false, result);
          const sysid = t === 'V' ? values[1] ?? '' : txt(row, 'sValue');
          if (t === 'V' || t === 'R' || t === 'L') {
            rpt += ',' + (await scalarText(o.source, o.scripts.getRpt.split('%sysid').join(sysid), result));
            exe += ',' + (await scalarText(o.source, o.scripts.getExe.split('%sysid').join(sysid), result));
          }
          break;
        }
        case 'S': case 'S00': case 'S11': case 'S01': case 'S10': {
          const alter = t === 'S11' || t === 'S10';
          const quoted = t === 'S11' || t === 'S01';
          const s = await o.source.objectScript(db, txt(row, 'name'), alter, quoted, false);
          if (db === 'sys') scrSys += s; else scrApp += s;
          break;
        }
        case 'T': {
          const s = await o.source.objectScript(db, txt(row, 'sValue'), false, false, true);
          if (db === 'sys') scrSys += s; else scrApp += s;
          break;
        }
        case 'O': {
          const s = await o.source.insertScript(db, txt(row, 'sTbl'), txt(row, 'sKey'), 0);
          if (db === 'sys') scrSys += s; else scrApp += s;
          break;
        }
        default:
          break;
      }
    } catch (e) {
      // Một dòng lỗi SQL (bảng cấu hình không có ở loại dự án này, đối tượng đã xóa…) không làm hỏng cả gói — báo lại.
      result.missing.push(`${txt(row, 'sView')}: ${errText(e)}`);
    }
  }
  copyListed(exe, '', main, o, result, false);
  copyListed(rpt, 'Rpt\\', main, o, result, true);

  writeScript(scrSys, main + o.scripts.updateSysFile);
  writeScript(scrApp, main + o.scripts.updateAppFile);
  if (pkg.otherAppSql.trim() !== '' && fs.existsSync(main + '\\Script\\App')) writeScript(pkg.otherAppSql, main + '\\Script\\App\\00.OtherSQL_app');
  if (pkg.otherSysSql.trim() !== '' && fs.existsSync(main + '\\Script\\Sys')) writeScript(pkg.otherSysSql, main + '\\Script\\Sys\\00.OtherSQL_sys');

  if (fs.existsSync(main + '\\Script')) removeEmpty(main + '\\Script');
  removeEmpty(main);
  result.files = listFilesRel(main);
  return result;
}

/** sysSqlCode / appSqlCode: "bảng,điều kiện#…" với %sysid (mã) / %form (mã thứ 2 của chứng từ). Bảng lỗi → báo, các bảng khác vẫn sinh. */
async function appendCodes(source: ScriptSource, db: 'app' | 'sys', codes: string, values: string[], voucherDelete: boolean, result: CreateResult): Promise<string> {
  if (codes.trim() === '') return '';
  let out = '';
  for (const part of codes.split('#')) {
    const s = part.split(',');
    if (s.length < 2) continue;
    try {
      if (!s[1].includes('%form')) out += await source.insertScript(db, s[0], s[1].split('%sysid').join(values[0]), voucherDelete ? 1 : 0);
      else out += await source.insertScript(db, s[0], s[1].split('%form').join(values[1] ?? ''), 0);
    } catch (e) {
      result.missing.push(`${s[0]} (${values[0]}): ${errText(e)}`);
    }
  }
  return out;
}

async function scalarText(source: ScriptSource, sql: string, result: CreateResult): Promise<string> {
  try {
    return await source.scalar('sys', sql);
  } catch (e) {
    result.missing.push(errText(e));
    return '';
  }
}

function copyFile(folder: string, fileName: string, main: string, o: CreateOptions, result: CreateResult): void {
  const source = o.paths.findSource(folder, fileName, o.programPath);
  if (source === '') { result.missing.push(folder + fileName); return; }
  copyTo(source, main + '\\' + o.paths.savePath(source));
}

/** Danh sách ",a,b" từ GETEXE / GETRPT: exe phân loại theo đường dẫn; rpt vào Rpt\ (chỉ khi gói có Rpt\). */
function copyListed(list: string, folder: string, main: string, o: CreateOptions, result: CreateResult, isRpt: boolean): void {
  if (isRpt && !fs.existsSync(main + '\\Rpt')) return;
  for (const item of list.split(',')) {
    if (item.trim() === '') continue;
    const source = o.paths.findSource(folder, item, o.programPath);
    if (source === '') { result.missing.push(folder + item); continue; }
    copyTo(source, isRpt ? main + '\\Rpt\\' + item : main + '\\' + o.paths.savePath(source));
  }
}

/** Xóa folder gói: xóa đệ quy (thử lại 1 lần); vẫn còn (Explorer giữ handle) → đổi tên *_trash_yyyyMMdd_HHmmss. */
export function deleteFolder(folder: string): void {
  if (!folder || !fs.existsSync(folder)) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { fs.rmSync(folder, { recursive: true, force: true, maxRetries: 2, retryDelay: 150 }); } catch { /* thử lại / đổi tên */ }
    if (!fs.existsSync(folder)) return;
  }
  const clean = folder.replace(/[\\/]+$/, '');
  const parent = path.dirname(clean);
  const leaf = path.basename(clean);
  const stamp = stampLong(new Date());
  let trash = path.join(parent, `${leaf}_trash_${stamp}`);
  for (let n = 2; fs.existsSync(trash); n++) trash = path.join(parent, `${leaf}_trash_${stamp}_${n}`);
  try {
    fs.renameSync(folder, trash);
  } catch (e) {
    throw new Error(`Không xóa/đổi tên được folder gói cũ:\r\n${folder}\r\n${errText(e)}`);
  }
}
