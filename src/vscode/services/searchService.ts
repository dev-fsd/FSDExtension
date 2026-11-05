// Lệnh của màn Multi Search (cùng tên / dữ liệu trả về với SearchService.vb + MultiSearchService.vb của 5.2):
// search.roots · search.run (đẩy search.progress, hủy được) · search.cancel · file.read · file.openIde · file.reveal ·
// ms.save · ms.openIde · ms.openDefault · ms.copyFiles · ms.checkVoucher.
// Chỉ đọc / ghi trong các gốc của dự án đang mở; không bao giờ ghi file .f (server tự sinh từ .xml).
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { checkVoucher } from '../../core/search/voucher';
import { readForView } from '../../core/search/readText';
import { isUnderRoots, searchRoots } from '../../core/search/roots';
import { runSearch } from '../../core/search/scan';
import type { SearchRequest } from '../../core/search/options';
import type { CallCtx, Registry } from '../bridge/types';

/** Đuôi mở bằng ứng dụng của hệ điều hành thay vì editor (file nhị phân / Office / ảnh). */
const SYSTEM_OPEN_EXTS = new Set(['.xlsx', '.xls', '.rpt', '.docx', '.doc', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.zip', '.rar', '.7z', '.dll', '.exe', '.mp3']);

/** Lần tìm đang chạy: khóa = panelId + id lần tìm. */
const running = new Map<string, AbortController>();

const str = (v: unknown): string => (v == null ? '' : String(v));

/** Các gốc dự án được phép đọc / quét. */
function projectRoots(ctx: CallCtx): string[] {
  return searchRoots(ctx.project).map((r) => r.path);
}

/** Đường dẫn phải nằm trong gốc của dự án đang mở (chống đọc / quét ngoài phạm vi). */
function assertInProject(ctx: CallCtx, p: string, what = 'Đường dẫn'): string {
  const t = p.trim();
  if (t === '') throw new Error('Chưa có đường dẫn.');
  if (!isUnderRoots(t, projectRoots(ctx))) throw new Error(`${what} nằm ngoài các thư mục của dự án ${ctx.project.code}.`);
  return t;
}

/** Mở file ở editor của IDE (line 1-based, 0 = đầu file); file nhị phân / Office mở bằng ứng dụng hệ thống. Trả true nếu mở bằng editor. */
async function openFile(file: string, line: number): Promise<boolean> {
  const uri = vscode.Uri.file(file);
  if (SYSTEM_OPEN_EXTS.has(path.extname(file).toLowerCase())) {
    await vscode.env.openExternal(uri);
    return false;
  }
  const pos = new vscode.Position(Math.max(0, line - 1), 0);
  await vscode.commands.executeCommand('vscode.open', uri, { selection: new vscode.Range(pos, pos), preview: false });
  return true;
}

function runPowerShell(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000 }, (err, _out, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve();
    });
  });
}

/** Danh sách file vào clipboard (dán được trong Explorer) — Windows; nơi khác thì copy danh sách đường dẫn. */
async function copyFilesToClipboard(files: string[]): Promise<string> {
  if (process.platform === 'win32') {
    const list = files.map((f) => `'${f.replace(/'/g, "''")}'`).join(',');
    await runPowerShell(`Set-Clipboard -LiteralPath @(${list})`);
    return `Đã copy ${files.length} file vào clipboard`;
  }
  await vscode.env.clipboard.writeText(files.join('\n'));
  return `Đã copy đường dẫn ${files.length} file vào clipboard`;
}

export function register(reg: Registry): void {
  reg.register('search.roots', (_a, ctx) =>
    searchRoots(ctx.project, (dir) => {
      try {
        return fs.statSync(dir).isDirectory();
      } catch {
        return false;
      }
    }).map((r) => ({ id: r.id, name: r.name, path: r.path }))
  );

  // { id, root, text, content, exts, types, folders, mobile, exact, matchCase, wholeWord, regex } → { files, capped, ms, root, cancelled?, scanned }.
  reg.register('search.run', async (a, ctx) => {
    const root = assertInProject(ctx, str(a.root), 'Thư mục tìm');
    const id = str(a.id) || `s${Date.now()}`;
    const key = `${ctx.panelId}|${id}`;
    running.get(key)?.abort();
    const ac = new AbortController();
    running.set(key, ac);
    const req: SearchRequest = {
      root,
      text: str(a.text),
      content: a.content === true,
      exts: Array.isArray(a.exts) ? a.exts.map(str) : [],
      types: Array.isArray(a.types) ? a.types.map(str) : [],
      folders: Array.isArray(a.folders) ? a.folders.map(str) : [],
      mobile: a.mobile === true,
      exact: a.exact === true,
      matchCase: a.matchCase === true,
      wholeWord: a.wholeWord === true,
      regex: a.regex === true
    };
    try {
      return await runSearch(req, { signal: ac.signal, onProgress: (p) => ctx.emit('search.progress', { id, scanned: p.scanned, found: p.found }) });
    } finally {
      if (running.get(key) === ac) running.delete(key);
    }
  });

  reg.register('search.cancel', (a, ctx) => {
    running.get(`${ctx.panelId}|${str(a.id)}`)?.abort();
    return null;
  });

  // { path } → { path, text, modified, language }. File nhị phân bị từ chối; .f hiện nguyên văn (không giải mã).
  reg.register('file.read', (a, ctx) => readForView(assertInProject(ctx, str(a.path), 'File')));

  // { path, line } → mở ở editor của IDE tại dòng chỉ định.
  reg.register('file.openIde', async (a, ctx) => {
    const opened = await openFile(assertInProject(ctx, str(a.path), 'File'), Number(a.line) || 0);
    return opened ? 'Đã mở trong editor' : 'Đã mở bằng ứng dụng mặc định';
  });

  // { path } → chọn file trong Explorer của hệ điều hành.
  reg.register('file.reveal', async (a, ctx) => {
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(assertInProject(ctx, str(a.path), 'File')));
    return null;
  });

  // { path, text } → ghi UTF-8 có BOM (bỏ ReadOnly). Không ghi .f. "Lưu thành" cho phép đường dẫn người dùng chọn qua file.pick.
  reg.register('ms.save', async (a) => {
    const file = str(a.path).trim();
    if (file === '') throw new Error('Chưa có đường dẫn file.');
    if (path.extname(file).toLowerCase() === '.f') throw new Error('Không lưu file .f — sửa file .xml cùng tên, server tự sinh lại .f.');
    try {
      fs.chmodSync(file, 0o666);
    } catch {
      /* file mới hoặc không đổi được thuộc tính: ghi thử luôn */
    }
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(str(a.text), 'utf8')]));
    const d = fs.statSync(file).mtime;
    const p = (n: number): string => String(n).padStart(2, '0');
    return { path: file, modified: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` };
  });

  // { paths, root } → mở từng file ở editor (file Office / nhị phân mở bằng ứng dụng hệ thống). Không mở kèm .xsd như 5.1.
  reg.register('ms.openIde', async (a, ctx) => {
    const paths = (Array.isArray(a.paths) ? a.paths : []).map(str);
    if (paths.length === 0) throw new Error('Chưa chọn file.');
    for (const p of paths) {
      const f = assertInProject(ctx, p, 'File');
      if (!fs.existsSync(f)) throw new Error('Không có file ' + f);
    }
    let editor = 0;
    for (const p of paths) if (await openFile(p, 0)) editor++;
    return editor === paths.length ? `Đã mở ${paths.length} file trong editor` : `Đã mở ${paths.length} file (${editor} trong editor, còn lại bằng ứng dụng mặc định)`;
  });

  // { path } → thư mục: mở trong Explorer; file: editor (hoặc ứng dụng mặc định).
  reg.register('ms.openDefault', async (a, ctx) => {
    const p = assertInProject(ctx, str(a.path), 'File');
    let st: fs.Stats;
    try {
      st = fs.statSync(p);
    } catch {
      throw new Error('Không có file ' + p);
    }
    if (st.isDirectory()) await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(p));
    else await openFile(p, 0);
    return '';
  });

  // { paths } → file vào clipboard.
  reg.register('ms.copyFiles', async (a, ctx) => {
    const files = (Array.isArray(a.paths) ? a.paths : []).map(str).filter((p) => {
      try {
        return isUnderRoots(p, projectRoots(ctx)) && fs.statSync(p).isFile();
      } catch {
        return false;
      }
    });
    if (files.length === 0) throw new Error('Không có file nào để copy.');
    return copyFilesToClipboard(files);
  });

  // { root } → { errors: [{ a, name, b }], files: [rel] }.
  reg.register('ms.checkVoucher', (a, ctx) => checkVoucher(assertInProject(ctx, str(a.root), 'Thư mục')));
}
