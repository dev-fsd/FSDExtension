// Danh sách dự án lưu ở %USERPROFILE%\.fsd\projects.json (không có mật khẩu) + khớp file đang mở với dự án.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DmdaRow, ProjectMatch, ProjectRecord } from '../types';

export class ProjectStore {
  constructor(private readonly filePath: string) {}

  static defaultPath(): string {
    return path.join(process.env.USERPROFILE || os.homedir(), '.fsd', 'projects.json');
  }

  /** Lần load gần nhất đọc file cũ chưa có webHost1 / webHost2 (cần đọc lại config.db một lần). */
  missingHosts = false;

  async load(): Promise<ProjectRecord[]> {
    this.missingHosts = false;
    let raw: string;
    try {
      raw = await fs.promises.readFile(this.filePath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
    const data: unknown = JSON.parse(raw.replace(/^\uFEFF/, ''));
    const list = Array.isArray(data) ? data : (data as { projects?: unknown }).projects;
    if (!Array.isArray(list)) return [];
    this.missingHosts = (list as Array<Partial<ProjectRecord>>).some((p) => p.webHost1 === undefined || p.webHost2 === undefined);
    return (list as ProjectRecord[]).map(toProjectRecord);
  }

  /** Ghi tạm rồi đổi tên để không hỏng file khi dừng giữa chừng. Mật khẩu (nếu lọt vào) bị loại. */
  async save(list: ProjectRecord[]): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(list.map(toProjectRecord), null, 2), 'utf8');
    await fs.promises.rename(tmp, this.filePath);
  }
}

/** Lấy các trường dự án (bỏ passwordEncoded và mọi trường lạ). */
export function toProjectRecord(row: DmdaRow | ProjectRecord): ProjectRecord {
  return {
    code: row.code,
    name: row.name,
    menuType: row.menuType || '2',
    server: row.server,
    user: row.user,
    mode: row.mode,
    sysDatabase: row.sysDatabase,
    webSource: row.webSource,
    webProgramDir: row.webProgramDir,
    webHost1: row.webHost1 ?? '',
    webHost2: row.webHost2 ?? '',
    mobileDir: row.mobileDir,
    active: row.active,
  };
}

const norm = (p: string): string => p.trim().replace(/\//g, '\\');

function dirWithSlash(p: string): string {
  const z = norm(p);
  return z !== '' && !z.endsWith('\\') ? z + '\\' : z;
}

/** Thư mục web: web_source, trống thì webprogram_dir; có "\" cuối. */
export function webRoot(p: ProjectRecord): string {
  return dirWithSlash(p.webSource.trim() !== '' ? p.webSource : p.webProgramDir);
}

/** Cha của thư mục (có "\" cuối) hoặc "" nếu không có (gốc ổ đĩa / gốc share UNC). */
function parentDir(dir: string): string {
  const t = dir.replace(/\\+$/, '');
  const i = t.lastIndexOf('\\');
  if (i <= 0) return '';
  // \\host\share\x → cha \\host\share; \\host\share → không có cha
  if (t.startsWith('\\\\') && t.substring(2).split('\\').length < 3) return '';
  return t.substring(0, i) + '\\';
}

const isFullPath = (v: string): boolean => /[\\/]/.test(v) || /^[A-Za-z]:/.test(v);

function isValidFolderName(name: string): boolean {
  const c = name.trim();
  return c.length >= 2 && !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(c) && !/[<>:"/\\|?*\x00-\x1f]/.test(c);
}

/** Quy tắc mobile_dir: đường dẫn đủ → dùng luôn; tên / rỗng → thư mục anh em với web (mặc định "MobileApp"). "" nếu không suy được. */
export function mobileRoot(p: ProjectRecord): string {
  const raw = p.mobileDir.trim();
  if (isFullPath(raw)) return dirWithSlash(raw);
  const web = webRoot(p);
  if (web === '') return '';
  const parent = parentDir(web);
  if (parent === '') return '';
  return parent + (isValidFolderName(raw) ? raw : 'MobileApp') + '\\';
}

/** Các gốc thư mục của dự án dùng để khớp folder workspace: web_source, webprogram_dir, mobile (chữ thường, có "\" cuối, bỏ trùng). */
function workspaceRoots(p: ProjectRecord): string[] {
  const all = [dirWithSlash(p.webSource), dirWithSlash(p.webProgramDir), mobileRoot(p)].filter((r) => r !== '').map((r) => r.toLowerCase());
  return [...new Set(all)];
}

/**
 * Dự án khớp các folder của workspace, theo thứ tự folder (bỏ trùng).
 * Mỗi folder: nằm trong (hoặc bằng) một gốc của dự án → lấy dự án có gốc dài nhất (bằng nhau ưu tiên dự án active);
 * không thì nếu folder là thư mục cha của gốc web / mobile và chỉ đúng một dự án như vậy → dự án đó.
 */
export function matchProjectsByWorkspace(projects: ProjectRecord[], folders: string[]): ProjectRecord[] {
  const out: ProjectRecord[] = [];
  for (const folder of folders) {
    const f = dirWithSlash(folder).toLowerCase();
    if (f === '') continue;
    let best: ProjectRecord | undefined;
    let bestLen = -1;
    for (const p of projects) {
      for (const r of workspaceRoots(p)) {
        if (!f.startsWith(r)) continue;
        if (r.length > bestLen || (r.length === bestLen && p.active && !best?.active)) {
          bestLen = r.length;
          best = p;
        }
      }
    }
    if (!best) {
      const parents = projects.filter((p) => workspaceRoots(p).some((r) => r.startsWith(f)));
      if (parents.length === 1) best = parents[0];
    }
    if (best && !out.some((p) => p.code === best!.code)) out.push(best);
  }
  return out;
}

/** Khớp file với dự án: không phân biệt hoa thường, "/" = "\"; gốc dài nhất thắng, bằng nhau thì ưu tiên dự án active. */
export function matchProjectByPath(projects: ProjectRecord[], filePath: string): ProjectMatch | undefined {
  const file = norm(filePath).toLowerCase();
  let best: ProjectMatch | undefined;
  let bestLen = -1;
  let bestActive = false;
  for (const project of projects) {
    const candidates: Array<{ area: 'web' | 'mobile'; root: string }> = [
      { area: 'web', root: webRoot(project) },
      { area: 'mobile', root: mobileRoot(project) },
    ];
    for (const { area, root } of candidates) {
      if (root === '') continue;
      const r = root.toLowerCase();
      if (!file.startsWith(r) && file + '\\' !== r) continue;
      if (r.length > bestLen || (r.length === bestLen && project.active && !bestActive)) {
        bestLen = r.length;
        bestActive = project.active;
        best = {
          project,
          area,
          root,
          controllersDir: root + 'App_Data\\Controllers\\' + (area === 'mobile' ? 'Mobile\\' : ''),
        };
      }
    }
  }
  return best;
}
