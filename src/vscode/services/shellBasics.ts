// Lệnh nền cho mọi màn webview (cùng tên / dữ liệu trả về với 5.2: Shell\FileDialogs.vb, ShellForm.vb):
// file.open · file.save · file.pick · file.readDropped · setting.get · setting.set · clipboard.set · project.databases ·
// ui.toast · screen.open · screen.setTitle · file.openInEditor · folder.pick · shell.explore · shell.copyFile · menu.files.
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { scanMenu } from '../../core/controllers/menuStructure';
import { packageFileOf } from '../../core/update/menuContext';
import { normalizeDir } from '../../core/update/packagePaths';
import type { App } from '../app';
import type { CallCtx, Registry } from '../bridge/types';
import { getScreenHost } from '../screens/screenHost';
import { makeCrypto, projectPaths } from './updHost';

/** Dấu BOM ghi đầu file. */
const BOM_UTF16LE = Buffer.from([0xff, 0xfe]);
const BOM_UTF8 = Buffer.from([0xef, 0xbb, 0xbf]);

/** Đọc file theo BOM như File.ReadAllText của .NET: UTF-16 LE / BE, UTF-8 (bỏ BOM); không BOM → UTF-8. */
export function decodeText(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  return buf.toString('utf8');
}

/** 'utf16' → UTF-16 LE có BOM (file .sql của 5.1); còn lại → UTF-8 có BOM. */
export function encodeText(text: string, encoding: string | undefined): Buffer {
  if ((encoding ?? '').toLowerCase() === 'utf16') return Buffer.concat([BOM_UTF16LE, Buffer.from(text, 'utf16le')]);
  return Buffer.concat([BOM_UTF8, Buffer.from(text, 'utf8')]);
}

/** "sql" → { SQL: ['sql'], 'Mọi file': ['*'] }; "xsd;frx" → mỗi đuôi một dòng lọc. */
function dialogFilters(exts: unknown): Record<string, string[]> {
  const filters: Record<string, string[]> = {};
  for (const raw of String(exts ?? '').split(';')) {
    const ext = raw.trim().replace(/^\./, '');
    if (ext) filters[ext.toUpperCase()] = [ext];
  }
  filters['Mọi file'] = ['*'];
  return filters;
}

const uriOf = (p: unknown): vscode.Uri | undefined => (typeof p === 'string' && p !== '' ? vscode.Uri.file(p) : undefined);

/** Danh sách DB chọn được của dự án: các DB App rồi DB Sys — hình dữ liệu của project.databases (5.2). */
export async function projectDatabases(ctx: CallCtx): Promise<Array<{ name: string; kind: 'app' | 'sys' }>> {
  const apps = await ctx.session.appDatabases();
  const dbs: Array<{ name: string; kind: 'app' | 'sys' }> = apps.map((name) => ({ name, kind: 'app' as const }));
  const sys = ctx.project.sysDatabase;
  if (sys && !dbs.some((d) => d.name.toLowerCase() === sys.toLowerCase())) dbs.push({ name: sys, kind: 'sys' });
  return dbs;
}

const DB_PICK_KEYS = new Set(['SetDatabaseTab', 'SetDatabaseMain', 'SetDatabaseMainRF', 'ChangeDatabase']);

export function register(reg: Registry, app: App): void {
  const state = app.context.globalState;

  const settingKey = (a: Record<string, any>): string => {
    const section = String(a.section ?? '').trim();
    if (section === '' || /[\\/]/.test(section)) throw new Error('Tên mục tùy chọn không hợp lệ.');
    return `fsd.setting.${section}.${String(a.name ?? '')}`;
  };

  reg.register('file.open', async (a) => {
    const picked = await vscode.window.showOpenDialog({ canSelectMany: false, filters: dialogFilters(a.filter) });
    if (!picked || picked.length === 0) return null;
    const p = picked[0].fsPath;
    return { path: p, text: decodeText(fs.readFileSync(p)) };
  });

  reg.register('file.save', async (a) => {
    let path = typeof a.path === 'string' ? a.path : '';
    if (path === '' || a.saveAs === true) {
      const uri = await vscode.window.showSaveDialog({ defaultUri: uriOf(path), filters: dialogFilters(a.filter) });
      if (!uri) return null;
      path = uri.fsPath;
    }
    fs.writeFileSync(path, encodeText(typeof a.text === 'string' ? a.text : '', a.encoding));
    return { path };
  });

  reg.register('file.pick', async (a) => {
    if (a.save === true) {
      const uri = await vscode.window.showSaveDialog({ defaultUri: uriOf(a.path), filters: dialogFilters(a.filter) });
      return uri ? { path: uri.fsPath, paths: [uri.fsPath] } : null;
    }
    const picked = await vscode.window.showOpenDialog({ canSelectMany: a.multi === true, defaultUri: uriOf(a.path), filters: dialogFilters(a.filter) });
    if (!picked || picked.length === 0) return null;
    return { path: picked[0].fsPath, paths: picked.map((u) => u.fsPath) };
  });

  // { path? } → chọn thư mục: { path } | null (Update Script chọn thư mục làm việc, Explorer chọn Program).
  reg.register('folder.pick', async (a) => {
    const picked = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, defaultUri: uriOf(a.path) });
    if (!picked || picked.length === 0) return null;
    return { path: picked[0].fsPath };
  });

  // { path, select? } → thư mục: mở trong Explorer của hệ điều hành; file: select=true thì chọn file trong Explorer, không thì mở thư mục chứa.
  reg.register('shell.explore', async (a) => {
    const p = typeof a.path === 'string' ? a.path.trim() : '';
    if (p === '') throw new Error('Chưa có đường dẫn.');
    let st: fs.Stats;
    try {
      st = fs.statSync(p);
    } catch {
      throw new Error('Không có ' + p);
    }
    if (st.isDirectory()) await vscode.env.openExternal(vscode.Uri.file(p));
    else if (a.select === true) await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(p));
    else await vscode.env.openExternal(vscode.Uri.file(p.replace(/[\\/][^\\/]*$/, '')));
    return null;
  });

  // { path } → đưa file vào clipboard (dán được trong Explorer). Chỉ Windows (PowerShell Set-Clipboard).
  reg.register('shell.copyFile', async (a) => {
    const p = typeof a.path === 'string' ? a.path.trim() : '';
    if (p === '' || !fs.existsSync(p) || !fs.statSync(p).isFile()) throw new Error('Không có file ' + p);
    if (process.platform !== 'win32') throw new Error('Copy file vào clipboard chỉ hỗ trợ trên Windows.');
    const script = `Set-Clipboard -LiteralPath '${p.replace(/'/g, "''")}'`;
    await new Promise<void>((resolve, reject) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000 }, (err, _out, stderr) => {
        if (err) reject(new Error(stderr.trim() || err.message));
        else resolve();
      });
    });
    return null;
  });

  // { kind, sysid, link } → { files: [{ folder, name, path }] }: file của menu dò theo cấu trúc sysid (.f trước, không có mới .xml);
  // folder = thư mục đầu dưới Controllers (Dir / Grid / Filter…), file Main\<link> vào nhóm "Main". FB (desktop) không có controller → rỗng.
  reg.register('menu.files', async (a, ctx) => {
    const kind = String(a.kind ?? 'fbo');
    const sysid = String(a.sysid ?? '').trim();
    const link = String(a.link ?? '').trim();
    if (kind === 'fb' || sysid === '') return { files: [] };
    const root = normalizeDir((await projectPaths(ctx)).webRoot);
    if (root === '') return { files: [] };
    const mobile = kind === 'mob';
    const ctrl = root + (mobile ? 'App_Data\\Controllers\\Mobile\\' : 'App_Data\\Controllers\\');
    const scan = await scanMenu(ctrl, sysid, { mobile, crypto: makeCrypto() });
    const files: Array<{ folder: string; name: string; path: string }> = [];
    const seen = new Set<string>();
    const add = (full: string): void => {
      const key = full.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const rel = key.startsWith(ctrl.toLowerCase()) ? full.substring(ctrl.length) : full.substring(root.length);
      const parts = rel.split(/[\\/]/);
      files.push({ folder: parts.length > 1 ? parts[0] : 'Main', name: parts[parts.length - 1], path: full });
    };
    if (!mobile && link !== '' && fs.existsSync(root + 'Main\\' + link)) add(root + 'Main\\' + link);
    for (const f of scan.files) {
      const full = packageFileOf(f);
      if (full) add(full);
    }
    return { files };
  });

  // Webview không biết đường dẫn file kéo thả: nhận { name, text } (bridge.js đã đọc nội dung); path rỗng → Lưu sẽ hỏi nơi lưu.
  reg.register('file.readDropped', (a) => {
    const files = Array.isArray(a.files) ? (a.files as Array<{ name?: string; text?: string }>) : [];
    if (files.length === 0 || typeof files[0].text !== 'string') return null;
    return { path: '', name: files[0].name ?? '', text: files[0].text };
  });

  // Giá trị đúng/sai lưu 1/0 (DWORD như 5.2): màn đọc bằng +v === 1.
  reg.register('setting.get', (a) => state.get<string | number>(settingKey(a)) ?? null);
  reg.register('setting.set', async (a) => {
    const v = a.value;
    const stored = typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'number' && Number.isInteger(v) ? v : v === undefined || v === null ? '' : String(v);
    await state.update(settingKey(a), stored);
    return null;
  });

  reg.register('clipboard.set', async (a) => {
    await vscode.env.clipboard.writeText(typeof a.text === 'string' ? a.text : '');
    return null;
  });

  reg.register('project.databases', (_a, ctx) => projectDatabases(ctx));

  // kind: 'info' (mặc định, thanh trạng thái 4 giây) | 'notice' (hộp thông báo) | 'warn' | 'error'.
  reg.register('ui.toast', (a) => {
    const text = String(a.text ?? '').replace(/^⚠\s*/, '');
    if (text === '') return null;
    if (a.kind === 'warn') void vscode.window.showWarningMessage(text);
    else if (a.kind === 'error') void vscode.window.showErrorMessage(text);
    else if (a.kind === 'notice') void vscode.window.showInformationMessage(text);
    else vscode.window.setStatusBarMessage(`$(info) ${text}`, 4000);
    return null;
  });

  reg.register('screen.open', async (a, ctx) => {
    const key = String(a.key ?? '');
    const opts = a.opts && typeof a.opts === 'object' ? (a.opts as Record<string, unknown>) : {};
    if (key === 'Query') {
      getScreenHost().open('query', ctx.project, opts);
      return null;
    }
    if (key === 'SelectTable') {
      getScreenHost().open('select-table', ctx.project, opts);
      return null;
    }
    if (key === 'MultiSearch') {
      getScreenHost().open('multi-search', ctx.project, opts);
      return null;
    }
    if (key === 'UpdateScript') {
      getScreenHost().open('update-script', ctx.project, opts);
      return null;
    }
    if (key === 'MenuEdit') {
      getScreenHost().open('menu-edit', ctx.project, opts);
      return null;
    }
    if (DB_PICK_KEYS.has(key)) {
      const dbs = await projectDatabases(ctx);
      if (dbs.length === 0) {
        void vscode.window.showWarningMessage(`Dự án ${ctx.project.code}: không đọc được danh sách DB.`);
        return null;
      }
      const current = typeof a.currentDb === 'string' ? a.currentDb : '';
      const pick = await vscode.window.showQuickPick(
        dbs.map((d) => ({ label: d.name, description: d.kind === 'sys' ? 'DB Sys' : 'DB App', picked: d.name.toLowerCase() === current.toLowerCase() })),
        { title: `Chọn DB của tab · ${ctx.project.code}`, placeHolder: current || undefined }
      );
      if (pick) ctx.emit('db.changed', { db: pick.label });
      return null;
    }
    vscode.window.setStatusBarMessage(`$(warning) "${key}" chưa có trong extension`, 4000);
    return null;
  });

  reg.register('screen.setTitle', (a, ctx) => {
    getScreenHost().setTitle(ctx.panelId, String(a.title ?? ''));
    return null;
  });

  // line: 1-based (0 / bỏ trống = đầu file).
  reg.register('file.openInEditor', async (a) => {
    const uri = uriOf(a.path);
    if (!uri) throw new Error('Thiếu đường dẫn file.');
    const doc = await vscode.workspace.openTextDocument(uri);
    const line = Math.max(0, (Number(a.line) || 0) - 1);
    const pos = new vscode.Position(Math.min(line, Math.max(0, doc.lineCount - 1)), 0);
    await vscode.window.showTextDocument(doc, { preview: false, selection: new vscode.Range(pos, pos) });
    return null;
  });
}
