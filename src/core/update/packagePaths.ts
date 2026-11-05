// Gốc thư mục dự án khi sinh gói update và phân loại file vào Web\ / MobileApp\ / Other\ (port PackagePaths.vb 5.2).
// Chỉ đọc đĩa; truy cập đĩa đi qua PathEnv để test thay bằng bản giả.
import * as fs from 'node:fs';
import * as path from 'node:path';

const MOBILE_FOLDER_DEFAULT = 'MobileApp';
const WEB_APP_MARKER = 'App_Data\\Controllers';

/** Truy cập đĩa dùng bởi PackagePaths. */
export interface PathEnv {
  dirExists(p: string): boolean;
  fileExists(p: string): boolean;
  /** Đường dẫn đầy đủ các thư mục con; lỗi → []. */
  subDirs(p: string): string[];
  /** Share UNC tới được không (đã dò trước, đồng bộ). Đường dẫn local luôn true. */
  reachable(p: string): boolean;
}

export const nodePathEnv: PathEnv = {
  dirExists: (p) => {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
  },
  fileExists: (p) => {
    try { return fs.statSync(p).isFile(); } catch { return false; }
  },
  subDirs: (p) => {
    try {
      return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.win32.join(p, d.name));
    } catch {
      return [];
    }
  },
  reachable: () => true
};

/** Các cột dmda cần cho PackagePaths. */
export interface PackageSource {
  webSource: string;
  webProgramDir: string;
  mobileDir: string;
  updateDir: string;
  fbProgramDir: string;
}

export function normalizeDir(p: string | undefined): string {
  const z = (p ?? '').trim();
  return z !== '' && !z.endsWith('\\') ? z + '\\' : z;
}

const bs = (s: string): string => s.replace(/\//g, '\\');

function isFullPath(v: string): boolean {
  const z = (v ?? '').trim();
  return z.includes('\\') || z.includes('/') || /^[A-Za-z]:/.test(z);
}

function isValidFolderName(name: string): boolean {
  const c = (name ?? '').trim();
  return c.length >= 2 && !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(c) && !/[<>:"/\\|?*\x00-\x1f]/.test(c);
}

function mobileFolderName(raw: string): string {
  if (isFullPath(raw)) {
    const leaf = path.win32.basename(raw.replace(/[\\/]+$/, ''));
    return isValidFolderName(leaf) ? leaf : MOBILE_FOLDER_DEFAULT;
  }
  return isValidFolderName(raw) ? raw.trim() : MOBILE_FOLDER_DEFAULT;
}

function parentOf(dir: string): string {
  const t = dir.replace(/\\+$/, '');
  const i = t.lastIndexOf('\\');
  if (i <= 0) return '';
  if (t.startsWith('\\\\') && t.substring(2).split('\\').length < 3) return '';
  return t.substring(0, i);
}

function isUnder(full: string, root: string): boolean {
  if (root === '' || full === '') return false;
  const p = bs(full).replace(/\\+$/, '').toLowerCase();
  const r = bs(root).replace(/\\+$/, '').toLowerCase();
  return p.startsWith(r + '\\') || p === r;
}

function relativeUnder(root: string, full: string): string {
  const p = bs(full).replace(/\\+$/, '');
  const r = bs(root).replace(/\\+$/, '');
  if (p.toLowerCase() === r.toLowerCase()) return '';
  if (p.toLowerCase().startsWith(r.toLowerCase() + '\\')) return p.substring(r.length + 1);
  return path.win32.basename(p);
}

function isMobileRelative(rel: string): boolean {
  const l = rel.toLowerCase();
  return l.includes('app_data\\controllers\\mobile\\') || l.startsWith('controllers\\mobile\\');
}

function isWebRelative(rel: string): boolean {
  if (rel === '' || path.win32.isAbsolute(rel) || isMobileRelative(rel)) return false;
  const l = rel.toLowerCase();
  return ['app_data\\', 'main\\', 'clientscript\\', 'images\\', 'css\\', 'bin\\', 'appservice\\', 'apphandler\\'].some((p) => l.startsWith(p));
}

export class PackagePaths {
  readonly webRoot: string;
  readonly mobileRoot: string;
  readonly otherRoot: string;
  readonly fbRoot: string;
  readonly updateDir: string;

  constructor(src: PackageSource, private readonly env: PathEnv = nodePathEnv) {
    const web = src.webSource.trim() !== '' ? src.webSource : src.webProgramDir;
    this.webRoot = this.resolveWebAppRoot(web, mobileFolderName(src.mobileDir));
    this.mobileRoot = normalizeDir(this.resolveMobileDir(this.webRoot, src.mobileDir));
    this.updateDir = normalizeDir(src.updateDir);
    this.fbRoot = normalizeDir(src.fbProgramDir);
    const webParent = this.webRoot === '' ? '' : parentOf(this.webRoot);
    this.otherRoot = webParent !== '' ? normalizeDir(webParent) : this.webRoot;
  }

  private resolveMobileDir(webDir: string, raw: string): string {
    if (isFullPath(raw)) return normalizeDir(raw);
    if (webDir === '') return '';
    const parent = parentOf(webDir);
    return parent === '' ? '' : parent + '\\' + mobileFolderName(raw) + '\\';
  }

  private hasMarker(dir: string): boolean {
    const z = normalizeDir(dir);
    return z !== '' && this.env.reachable(z) && this.env.dirExists(z + WEB_APP_MARKER);
  }

  /** Đường dẫn là thư mục cha dự án → chọn thư mục con có App_Data\Controllers (bỏ thư mục Mobile). */
  private resolveWebAppRoot(dir: string, mobileFolder: string): string {
    const z = normalizeDir(dir);
    if (z === '' || this.hasMarker(z) || !this.env.reachable(z)) return z;
    const skip = new Set([MOBILE_FOLDER_DEFAULT.toLowerCase(), mobileFolder.toLowerCase()]);
    let fallback = '';
    for (const sub of this.env.subDirs(z.replace(/\\+$/, ''))) {
      const cand = normalizeDir(sub);
      if (!this.hasMarker(cand)) continue;
      if (skip.has(path.win32.basename(cand.replace(/\\+$/, '')).toLowerCase())) {
        if (fallback === '') fallback = cand;
        continue;
      }
      return cand;
    }
    return fallback !== '' ? fallback : z;
  }

  /** Đường lưu trong gói: Web\… / MobileApp\… / FB (tương đối gốc FB) / Other\… theo đường dẫn tuyệt đối của file nguồn. */
  savePath(sourceFullPath: string): string {
    const n = bs(sourceFullPath ?? '');
    if (n.trim() === '') return 'Web\\';
    if (isUnder(n, this.webRoot)) return 'Web\\' + relativeUnder(this.webRoot, n);
    if (isUnder(n, this.mobileRoot)) return 'MobileApp\\' + relativeUnder(this.mobileRoot, n);
    if (isUnder(n, this.fbRoot)) return relativeUnder(this.fbRoot, n);
    const other = this.otherRoot !== '' ? this.otherRoot : this.webRoot;
    if (other === '') return n.replace(/^\\+/, '');
    return 'Other\\' + relativeUnder(other, n);
  }

  /** Tìm file nguồn của một dòng (folder + tên). Folder tuyệt đối → thử trực tiếp; tương đối → dò theo các gốc. */
  findSource(folder: string, fileName: string, programPath: string): string {
    const rel = bs(folder ?? '');
    if (path.win32.isAbsolute(rel)) {
      const cand = fileName === '' ? rel : normalizeDir(rel) + fileName;
      if (this.env.fileExists(cand)) return cand;
    }
    const program = normalizeDir(programPath);
    let roots: string[];
    if (isMobileRelative(rel)) roots = [this.mobileRoot, program, this.webRoot];
    else if (isWebRelative(rel)) roots = [this.webRoot, program, this.mobileRoot];
    else roots = [program, this.webRoot, this.mobileRoot];
    roots.push(this.otherRoot, this.fbRoot);
    const seen = new Set<string>();
    for (const root of roots) {
      if (root === '' || seen.has(root.toLowerCase())) continue;
      seen.add(root.toLowerCase());
      const full = root + rel + fileName;
      if (this.env.fileExists(full)) return full;
    }
    return '';
  }

  /** .upd cũ lưu folder tương đối (App_Data\…, Web\…, MobileApp\…, Other\…) → folder tuyệt đối. */
  absoluteFolder(saved: string, programPath: string): string {
    const v = bs(saved ?? '').trim();
    if (v === '') return '';
    if (path.win32.isAbsolute(v)) return normalizeDir(v);
    let root: string;
    let rel = v;
    const l = v.toLowerCase();
    if (l.startsWith('mobileapp\\')) { root = this.mobileRoot; rel = v.substring(10); }
    else if (l.startsWith('web\\')) { root = this.webRoot; rel = v.substring(4); }
    else if (l.startsWith('other\\')) { root = this.otherRoot; rel = v.substring(6); }
    else if (isMobileRelative(v)) root = this.mobileRoot;
    else if (isWebRelative(v)) root = this.webRoot;
    else root = this.otherRoot;
    if (root === '') root = normalizeDir(programPath);
    if (root === '') root = this.fbRoot;
    return normalizeDir(normalizeDir(root) + rel.replace(/^\\+/, ''));
  }
}
