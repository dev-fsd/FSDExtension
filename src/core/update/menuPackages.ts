// Gói update theo menu (Save / Load Update của 5.2): cặp {menu}_{user}_{yyyyMMdd}_{Memo}.upd + folder cùng tên
// dưới m_updatefile_dir\<dự án>\. Đọc / ghi .upd, liệt kê, xóa (đổi đuôi .delele), lưu cặp.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createPackage, deleteFolder, stampLong, type CreateOptions, type CreateResult } from './create';
import { memoOf, UpdatePackage } from './package';
import { type PackagePaths } from './packagePaths';
import { decodeUpd, parseUpd, serializeUpd } from './updFile';

const p2 = (n: number): string => String(n).padStart(2, '0');

/** dd/MM/yyyy HH:mm:ss */
export function formatDmy(d: Date): string {
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

export function yyyymmdd(d: Date): string {
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
}

/** Ghi .upd (UTF-8 không BOM, như DataSet.WriteXml) và nhớ đường dẫn. */
export function saveUpdFile(pkg: UpdatePackage, file: string): void {
  fs.writeFileSync(file, serializeUpd(pkg.toContent()), 'utf8');
  pkg.filePath = file;
}

/** Nạp một / nhiều .upd: một file không merge = thay giỏ; nhiều file = gộp bỏ dòng trùng. Trả {skipped, memo}. */
export function loadUpdFiles(pkg: UpdatePackage, files: string[], merge: boolean, paths: PackagePaths, programPath: string): { skipped: number; memo: string; message: string } {
  let skipped = 0;
  const memos: string[] = [];
  files.forEach((f, i) => {
    skipped += pkg.load(parseUpd(decodeUpd(fs.readFileSync(f))), f, paths, programPath, merge || i > 0);
    const m = memoOf(f);
    if (m !== '' && !memos.includes(m)) memos.push(m);
  });
  if (files.length > 1) pkg.filePath = '';
  const message =
    files.length > 1
      ? `Đã gộp ${files.length} update vào danh sách${skipped > 0 ? ` (bỏ qua ${skipped} dòng trùng)` : ''} — kiểm tra rồi bấm Create.`
      : skipped > 0 ? `Bỏ ${skipped} dòng trùng.` : '';
  return { skipped, memo: memos.join('_'), message };
}

export interface UpdListItem {
  name: string;
  path: string;
  modified: string;
  memo: string;
}

/** Danh sách .upd của menu (menu gốc 01.00.00 = tất cả), mới tạo trước. */
export function menuFiles(updateRoot: string, projectCode: string, menuId: string): UpdListItem[] {
  const dir = updateRoot + projectCode + '\\';
  if (updateRoot === '' || !fs.existsSync(dir)) throw new Error(`Thư mục ${dir} không tồn tại.`);
  const isAll = menuId === '01.00.00';
  const prefix = (menuId + '_').toLowerCase();
  return fs
    .readdirSync(dir)
    .filter((n) => n.toLowerCase().endsWith('.upd') && (isAll || n.toLowerCase().startsWith(prefix)))
    .map((n) => ({ n, st: fs.statSync(path.join(dir, n)) }))
    .filter((x) => x.st.isFile())
    .sort((a, b) => b.st.birthtimeMs - a.st.birthtimeMs)
    .map((x) => ({ name: x.n, path: path.join(dir, x.n), modified: formatDmy(x.st.mtime), memo: memoOf(x.n) }));
}

/** Xóa tệp gói: chép sang .delele rồi xóa (5.1 vẫn giữ lại bản .delele). */
export function deleteUpdFile(file: string): void {
  if (!fs.existsSync(file)) return;
  fs.copyFileSync(file, file.split('.upd').join('.delele'));
  fs.unlinkSync(file);
}

/** Folder gói cùng tên cạnh .upd (cặp {name}.upd + {name}\) → {folder, files, missing}; không có → null. */
export function packageOf(updPath: string): { folder: string; files: string[]; missing: string[] } | null {
  if (!updPath || updPath.trim() === '') return null;
  const folder = path.join(path.dirname(updPath), path.basename(updPath, path.extname(updPath)));
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return null;
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(p.substring(folder.length + 1));
    }
  };
  walk(folder);
  files.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return { folder, files, missing: [] };
}

/** Stem (không đuôi) của cặp .upd + folder theo menu. */
export function menuStem(updateRoot: string, projectCode: string, user: string, menuId: string, memo: string, now = new Date()): string {
  return `${updateRoot}${projectCode}\\${menuId}_${user}_${yyyymmdd(now)}_${memo}`;
}

export interface SaveAsk {
  ask: 'same' | 'memo' | 'exists' | 'confirm';
  old?: string;
  oldTime?: string;
  proposed: string;
  user?: string;
  root: boolean;
}

/** Bước hỏi trước khi lưu theo menu (chưa có decision): đè / giữ / xác nhận. */
export function planSaveMenu(pkg: UpdatePackage, stem: string, memo: string, menuId: string, user: string): SaveAsk {
  const leaf = path.basename(stem);
  const root = menuId === '01.00.00';
  const old = pkg.filePath !== '' && fs.existsSync(pkg.filePath) ? pkg.filePath : '';
  if (old !== '') {
    const st = fs.statSync(old);
    return {
      ask: memoOf(path.basename(old)).toLowerCase() === memo.toLowerCase() ? 'same' : 'memo',
      old: path.basename(old),
      oldTime: formatDmy(st.mtime),
      proposed: leaf,
      root
    };
  }
  if (fs.existsSync(stem + '.upd') || fs.existsSync(stem)) return { ask: 'exists', proposed: leaf, root };
  return { ask: 'confirm', proposed: leaf, user, root };
}

export type PairOptions = Omit<CreateOptions, 'workingDir' | 'folderName' | 'exact'>;

/**
 * Ghi cặp stem.upd + folder stem. overwrite: xóa folder cũ rồi tạo lại; không đè mà tên đã có → thêm _yyyyMMdd_HHmmss (_2, _3…).
 */
export async function savePair(pkg: UpdatePackage, stem: string, overwrite: boolean, updateRoot: string, opts: PairOptions): Promise<{ updFile: string; result: CreateResult }> {
  if (updateRoot === '' || !fs.existsSync(updateRoot)) throw new Error(`Thư mục gói (m_updatefile_dir) ${updateRoot} không tồn tại.`);
  if (!overwrite && (fs.existsSync(stem + '.upd') || fs.existsSync(stem))) {
    const baseStem = `${stem}_${stampLong(opts.now ?? new Date())}`;
    let cand = baseStem;
    for (let n = 2; fs.existsSync(cand + '.upd') || fs.existsSync(cand); n++) cand = `${baseStem}_${n}`;
    stem = cand;
  }
  fs.mkdirSync(path.dirname(stem), { recursive: true });
  if (overwrite && fs.existsSync(stem)) deleteFolder(stem);
  const result = await createPackage(pkg, { ...opts, workingDir: path.dirname(stem) + '\\', folderName: path.basename(stem), exact: true });
  saveUpdFile(pkg, stem + '.upd');
  return { updFile: stem + '.upd', result };
}

/** Cây gói vừa tạo: đổi tên file. */
export function renameFile(target: string, name: string): string {
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error('Chỉ đổi tên được file.');
  if ((name ?? '').trim() === '') throw new Error('Tên mới rỗng.');
  const dest = path.join(path.dirname(target), name.trim());
  fs.renameSync(target, dest);
  return dest;
}

/** Xóa file / thư mục trong cây gói. */
export function removePath(target: string): void {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}
