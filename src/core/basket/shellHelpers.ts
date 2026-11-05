// Phần thuần của plugin.profiler / shell.deleteStructApp (port PluginService, ShellService.DeleteStructApp 5.2).
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProjectRecord } from '../types';

/** Lọc theo tiền tố DB (bỏ hậu tố _S / _A…) để thấy cả DB App lẫn Sys: cắt từ dấu "_" cuối. */
export function profilerDbName(sysDatabase: string): string {
  const i = sysDatabase.lastIndexOf('_');
  return i > -1 ? sysDatabase.slice(0, i) : sysDatabase;
}

/** Phần server trước dấu ";" (bỏ "; Connect Timeout = …"). */
function serverHost(server: string): string {
  const i = server.indexOf(';');
  return i > -1 ? server.slice(0, i) : server;
}

/** Tham số dòng lệnh FSDProfiler; server .14 dùng tài khoản profile riêng như 5.1. Mỗi phần tử là một đối số (không tự thêm nháy). */
export function profilerArgs(project: Pick<ProjectRecord, 'server' | 'user'>, password: string, db: string): string[] {
  const on14 = project.server.includes('172.168.5.14');
  return [
    '-start',
    '-server', serverHost(project.server),
    '-user', on14 ? 'profile' : project.user,
    '-password', on14 ? 'fsd' : password,
    '-databasename', 'like', db
  ];
}

/** Thư mục cache cấu trúc cần xóa: <web_source> và <webprogram_dir> (khác nhau) + App_Data\Controllers\Structure\App. */
export function structAppDirs(project: Pick<ProjectRecord, 'webSource' | 'webProgramDir'>): string[] {
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const raw of [project.webSource, project.webProgramDir]) {
    let root = raw.trim().replace(/\//g, '\\');
    if (root === '') continue;
    if (!root.endsWith('\\')) root += '\\';
    const key = root.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    dirs.push(root + 'App_Data\\Controllers\\Structure\\App');
  }
  return dirs;
}

/** Xóa các FILE ngay trong từng thư mục (không đệ quy, không xóa thư mục) như 5.2; thư mục không có thì bỏ qua. */
export function deleteFilesIn(dirs: string[]): { deleted: string[]; failed: Array<{ file: string; error: string }> } {
  const deleted: string[] = [];
  const failed: Array<{ file: string; error: string }> = [];
  for (const dir of dirs) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile()) continue;
      const file = path.join(dir, e.name);
      try {
        fs.unlinkSync(file);
        deleted.push(file);
      } catch (err) {
        failed.push({ file, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return { deleted, failed };
}
