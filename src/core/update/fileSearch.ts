// File Explorer của Update Script: tìm file theo tên / nội dung trong thư mục Program.
// Port clsFileSearchService + FileSearchTokenClassifier + MultiSearchFileOptions (chế độ UpdateScript) + UpdateExplorer.SearchFiles 5.2.
// Khác 5.2: tìm nội dung đọc text thô (không mở entity SYSTEM của XML).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { decodeUpd } from './updFile';

export type MenuMode = 'fbo' | 'mob' | 'fb';

export interface SearchFolder {
  /** Đường dẫn con (có "\" cuối) dưới gốc; '' = chính gốc. */
  path: string;
  searchSub: boolean;
  /** Regex đường dẫn (tương đối thư mục quét) bị loại. */
  fileNotAllow: RegExp[];
}

export interface SearchHit {
  full: string;
  folder: string;
  name: string;
  mtime: string;
}

export interface SearchArgs {
  root: string;
  text: string;
  mode: MenuMode;
  mobile?: boolean;
  content?: boolean;
  exact?: boolean;
  /** Loại tick trên UI: form (.f), xml, dir, filter, grid, report, upload. undefined = không lọc. */
  types?: Record<string, boolean>;
  /** Path nằm dưới gốc của mode → quét theo danh sách thư mục cấu hình (UsesScopedProgramSearch). */
  scoped: boolean;
}

const TYPE_KEYS = ['form', 'xml', 'dir', 'filter', 'grid', 'report', 'upload'] as const;
const INVALID_PATTERN = /["<>|:\x00]/;
const MAX_PARALLEL = 8;

/** Tạo regex từ mẫu .NET: tiền tố (?i) → cờ i. */
function netRegex(p: string): RegExp {
  return p.startsWith('(?i)') ? new RegExp(p.slice(4), 'i') : new RegExp(p);
}

const folder = (p: string, sub: boolean, deny: string[] = []): SearchFolder => ({ path: p, searchSub: sub, fileNotAllow: deny.map(netRegex) });

/** Thư mục quét theo mode (_lstFolderFindAll 5.1). Không scoped → quét tự do cả path. */
export function scanFolders(mode: MenuMode, scoped: boolean): SearchFolder[] {
  if (!scoped) return [folder('', true)];
  if (mode === 'fbo') {
    return [
      folder('Main\\', true),
      folder('App_Data\\', true, ['Dir(?!\\\\.*\\\\).*\\.xml', 'Grid(?!\\\\.*\\\\).*\\.xml', 'Filter(?!\\\\.*\\\\).*\\.xml', '(?i)Structure\\\\', 'Grid\\\\Config\\\\Fields\\\\.*\\.xml', 'Options\\\\']),
      folder('App_Data\\', false),
      folder('Images\\', true), folder('ClientScript\\', true), folder('Css\\', true), folder('bin\\', true), folder('AppService\\', true), folder('AppHandler\\', true)
    ];
  }
  if (mode === 'mob') {
    return [folder('Main\\', true), folder('App_Data\\', true), folder('App_Data\\', false), folder('Images\\', true), folder('bin\\', true), folder('AppService\\', true), folder('AppHandler\\', true)];
  }
  return [folder('', false), folder('Rpt\\', false), folder('Templates\\', true)];
}

/** File cấu hình chung soi nội dung cho từ khóa "*x" (chỉ FBO scoped). */
function contentFiles(mode: MenuMode, scoped: boolean): Array<[string, string]> {
  if (!scoped || mode !== 'fbo') return [];
  return [
    ['App_Data\\Controllers\\Grid\\Config\\Include', '*control*'],
    ['App_Data\\Controllers\\Include', 'Extender.ent'],
    ['App_Data\\Controllers\\Post', 'Post.xml'],
    ['App_Data\\Controllers\\Grid\\Config', 'Aggregation.xml'],
    ['App_Data\\Controllers\\Filter\\Config', 'Initialize.xml']
  ];
}

/** Tách chuỗi tìm (phẩy) thành token + token bắt đầu "*". */
export function parseCommaSearchTokens(text: string): { tokens: string[]; starTokens: string[] } {
  const tokens: string[] = [];
  const starTokens: string[] = [];
  for (const raw of (text ?? '').split(',')) {
    const t = raw.trim();
    if (t.length === 0) continue;
    tokens.push(t);
    if (t.indexOf('*') === 0) starTokens.push(t);
  }
  return { tokens, starTokens };
}

// ===================== Tùy chọn loại (MultiSearchFileOptions) =====================

class FileOptions {
  extAll = true;
  extXml = false;
  extF = false;
  folderAll = true;
  folderDir = false;
  folderFilter = false;
  folderGrid = false;
  folderReport = false;
  folderUpload = false;

  constructor(readonly mobile: boolean, readonly searchContent: boolean, readonly exactName: boolean) {}

  setTypes(types: Record<string, boolean>): void {
    this.extF = types.form === true;
    this.extXml = types.xml === true;
    this.folderDir = types.dir === true;
    this.folderFilter = types.filter === true;
    this.folderGrid = types.grid === true;
    this.folderReport = types.report === true;
    this.folderUpload = types.upload === true;
    const all = TYPE_KEYS.every((k) => types[k] === true);
    this.extAll = all;
    this.folderAll = all;
  }

  private base(): string {
    return this.mobile ? 'App_Data\\Controllers\\Mobile\\' : 'App_Data\\Controllers\\';
  }

  extensionFilter(): string[] | null {
    if (this.extAll) return null;
    const l: string[] = [];
    if (this.extXml) l.push('xml');
    if (this.extF) l.push('f');
    return l.length === 0 ? null : l;
  }

  hasFolderSelection(): boolean {
    return this.folderDir || this.folderFilter || this.folderGrid || this.folderReport || this.folderUpload;
  }

  selectedFolders(): string[] {
    const b = this.base();
    const l: string[] = [];
    if (this.folderDir) l.push(b + 'Dir\\');
    if (this.folderFilter) l.push(b + 'Filter\\');
    if (this.folderGrid) l.push(b + 'Grid\\');
    if (this.folderReport) l.push(b + (this.mobile ? 'Dashboards' : 'Report') + '\\');
    if (this.folderUpload) l.push(b + 'Templates\\Upload\\');
    return l;
  }

  buildFolderScanList(def: SearchFolder[]): SearchFolder[] {
    if (this.folderAll || !this.hasFolderSelection()) return def;
    return this.selectedFolders().map((p) => folder(p, true));
  }

  matchesFolderFilter(rel: string): boolean {
    if (this.folderAll || !this.hasFolderSelection()) return true;
    let r = (rel ?? '').trim().replace(/\//g, '\\');
    if (r.length === 0) return false;
    if (!r.endsWith('\\')) r += '\\';
    return this.selectedFolders().some((p) => r.toLowerCase().startsWith(p.toLowerCase()));
  }

  shouldIncludeFile(fullPath: string, programRoot: string): boolean {
    const ext = this.extensionFilter();
    if (ext && !ext.includes(path.extname(fullPath).replace(/^\./, '').toLowerCase())) return false;
    if (!programRoot) return true;
    const root = programRoot.endsWith('\\') ? programRoot : programRoot + '\\';
    if (!fullPath.toLowerCase().startsWith(root.toLowerCase())) return true;
    return this.matchesFolderFilter(fullPath.substring(root.length));
  }
}

// ===================== Phân loại token =====================

interface TokenPlan {
  token: string;
  extensions: string[] | null;
  applyXmlExclude: boolean;
}

function hasDeployFolderHint(token: string): boolean {
  const parts = token.replace(/\//g, '\\').split('\\');
  for (let i = 0; i < parts.length - 1; i++) {
    const s = parts[i].trim().toLowerCase();
    if (s === 'dir' || s === 'grid' || s === 'filter') return true;
  }
  return false;
}

/** Một plan cho mỗi token (chế độ UpdateScript): có đuôi → đúng đuôi; Dir/Grid/Filter không đuôi → .f; còn lại mọi đuôi; giao với tick UI. */
function buildPlans(tokens: string[], opts: FileOptions): TokenPlan[] {
  const plans: TokenPlan[] = [];
  const seen = new Set<string>();
  const ui = opts.extensionFilter();
  for (const raw of tokens) {
    const token = raw.trim();
    if (token.length === 0 || seen.has(token.toLowerCase())) continue;
    seen.add(token.toLowerCase());
    const namePart = token.substring(token.lastIndexOf('\\') + 1);
    const ext = path.extname(namePart).replace(/^\./, '').toLowerCase();
    let exts: string[] | null = ext !== '' ? [ext] : hasDeployFolderHint(token) ? ['f'] : null;
    if (exts && ui) {
      exts = exts.filter((e) => ui.includes(e));
      if (exts.length === 0) continue;
    } else if (!exts) {
      exts = ui;
    }
    plans.push({ token, extensions: exts, applyXmlExclude: ext !== 'xml' });
  }
  return plans;
}

// ===================== Khớp tên =====================

const hasWildcard = (s: string): boolean => s.includes('*') || s.includes('?');
const escapeRx = (c: string): string => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function wildcardFragment(kw: string): string {
  let out = '';
  for (const ch of kw) out += ch === '*' ? '.*' : ch === '?' ? '.' : escapeRx(ch);
  return out;
}

interface Entry {
  nameRegex: RegExp;
  hint: string[];
  extensions: string[] | null;
  applyExclude: boolean;
}

const segments = (p: string): string[] => (p ?? '').split(/[\\/]/).filter((s) => s.length > 0);

function folderSegmentsMatch(hit: string[], hint: string[]): boolean {
  if (hint.length === 0) return true;
  if (hint.length > hit.length) return false;
  const off = hit.length - hint.length;
  return hint.every((h, i) => hit[off + i].toLowerCase() === h.toLowerCase());
}

function buildEntries(plans: TokenPlan[], opts: FileOptions, scoped: boolean): Entry[] {
  const entries: Entry[] = [];
  const exact = !opts.searchContent && opts.exactName;
  for (const plan of plans) {
    const segs = segments(plan.token.trim());
    if (segs.length === 0) continue;
    const name = segs[segs.length - 1];
    const hint = segs.slice(0, -1);
    if (INVALID_PATTERN.test(name) || hint.some((s) => INVALID_PATTERN.test(s))) continue;
    let frag = wildcardFragment(name);
    if (exact && !hasWildcard(name)) frag += '(?:\\.[^.]+)?';
    let rx = '^' + frag;
    if (exact && !hasWildcard(name)) rx += '$';
    entries.push({
      nameRegex: new RegExp(rx, 'i'),
      hint,
      extensions: plan.extensions,
      applyExclude: scoped && plan.applyXmlExclude && !opts.searchContent
    });
  }
  return entries;
}

// ===================== Duyệt đĩa =====================

async function walk(dir: string, sub: boolean, onFile: (abs: string) => void): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const dirs: string[] = [];
  for (const e of entries) {
    if (e.isDirectory()) dirs.push(path.join(dir, e.name));
    else if (e.isFile()) onFile(path.join(dir, e.name));
  }
  if (sub) for (const d of dirs) await walk(d, sub, onFile);
}

async function pool<T>(items: T[], limit: number, fn: (x: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  const run = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

const p2 = (n: number): string => String(n).padStart(2, '0');

export function formatMtime(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

function mtimeOf(abs: string): string {
  try {
    return formatMtime(fs.statSync(abs).mtime);
  } catch {
    return '';
  }
}

function addRow(rows: SearchHit[], base: string, abs: string): void {
  const full = abs.substring(base.length);
  const i = full.lastIndexOf('\\');
  rows.push({ full, folder: i >= 0 ? full.substring(0, i) : '', name: i >= 0 ? full.substring(i + 1) : full, mtime: mtimeOf(abs) });
}

function readText(file: string): string {
  try {
    return decodeUpd(fs.readFileSync(file));
  } catch {
    return '';
  }
}

async function scanNames(rows: SearchHit[], base: string, folders: SearchFolder[], entries: Entry[]): Promise<void> {
  if (entries.length === 0) return;
  const coarse = new RegExp('^(?:' + entries.map((e) => e.nameRegex.source.replace(/^\^/, '').replace(/\$$/, '')).join('|') + ')', 'i');
  const perFolder: SearchHit[][] = folders.map(() => []);
  await pool(folders, MAX_PARALLEL, async (c, idx) => {
    const sub = base + c.path;
    if (!fs.existsSync(sub)) return;
    await walk(sub, c.searchSub, (abs) => {
      const fileName = path.basename(abs);
      if (!coarse.test(fileName)) return;
      const rel = abs.substring(sub.length);
      const sepIdx = rel.lastIndexOf('\\');
      const folderOnly = sepIdx >= 0 ? rel.substring(0, sepIdx + 1) : '';
      const segs = segments(c.path + folderOnly);
      const ext = path.extname(abs).replace(/^\./, '').toLowerCase();
      const ok = entries.some((en) => {
        if (!en.nameRegex.test(fileName)) return false;
        if (!folderSegmentsMatch(segs, en.hint)) return false;
        if (en.extensions && en.extensions.length > 0 && !en.extensions.includes(ext)) return false;
        if (en.applyExclude && c.fileNotAllow.some((r) => r.test(rel))) return false;
        return true;
      });
      if (!ok) return;
      perFolder[idx].push({ full: abs.substring(base.length), folder: c.path + folderOnly, name: rel.substring(sepIdx + 1), mtime: mtimeOf(abs) });
    });
  });
  for (const list of perFolder) rows.push(...list);
}

async function scanContent(rows: SearchHit[], base: string, folders: SearchFolder[], opts: FileOptions, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const candidates = new Map<string, string>();
  for (const c of folders) {
    const dir = base + c.path;
    if (!fs.existsSync(dir)) continue;
    await walk(dir, c.searchSub, (abs) => {
      if (opts.shouldIncludeFile(abs, base)) candidates.set(abs.toLowerCase(), abs);
    });
  }
  await addMatches(rows, base, [...candidates.values()], (body) => keys.some((k) => body.toLowerCase().includes(k.toLowerCase())));
}

async function addMatches(rows: SearchHit[], base: string, files: string[], match: (body: string) => boolean): Promise<void> {
  const hit: boolean[] = new Array(files.length).fill(false);
  await pool(files, MAX_PARALLEL, async (f, i) => {
    const body = await fs.promises.readFile(f).then(decodeUpd, () => '');
    hit[i] = match(body);
  });
  files.forEach((f, i) => { if (hit[i]) addRow(rows, base, f); });
}

function globRegex(p: string): RegExp {
  return new RegExp('^' + p.split('*').map(escapeRx).join('.*') + '$', 'i');
}

async function scanConfigContent(rows: SearchHit[], base: string, token: string, opts: FileOptions, files: Array<[string, string]>): Promise<void> {
  const key = token.split('*').join('');
  if (key === '') return;
  const candidates: string[] = [];
  for (const [dir, pattern] of files) {
    if (!opts.matchesFolderFilter(dir) || !fs.existsSync(base + dir)) continue;
    const rx = globRegex(pattern);
    for (const n of fs.readdirSync(base + dir)) {
      const abs = path.join(base + dir, n);
      if (rx.test(n) && fs.statSync(abs).isFile() && opts.shouldIncludeFile(abs, base)) candidates.push(abs);
    }
  }
  await addMatches(rows, base, candidates, (body) => body.includes(key));
}

/** Cùng thư mục có Ten.f thì bỏ Ten.xml. */
function dedupPreferF(rows: SearchHit[]): SearchHit[] {
  const stems = new Set<string>();
  for (const r of rows) {
    const n = r.name.trim();
    if (n.toLowerCase().endsWith('.f')) stems.add(`${r.folder.trim()}|${n.slice(0, -2)}`.toLowerCase());
  }
  if (stems.size === 0) return rows;
  return rows.filter((r) => {
    const n = r.name.trim();
    return !(n.toLowerCase().endsWith('.xml') && stems.has(`${r.folder.trim()}|${n.slice(0, -4)}`.toLowerCase()));
  });
}

/**
 * Tìm file: theo tên (token phẩy, *, Dir\X, đuôi, đúng tên / gần đúng) hoặc nội dung; "*x" soi thêm các file cấu hình chung.
 * Trả {full (tương đối gốc), folder, name, mtime}.
 */
export async function searchFiles(a: SearchArgs): Promise<SearchHit[]> {
  const base = a.root.endsWith('\\') ? a.root : a.root + '\\';
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) throw new Error(`Không vào được thư mục ${base}`);
  const mobile = a.mobile === true || a.mode === 'mob';
  const mode: MenuMode = mobile ? 'mob' : a.mode;
  const opts = new FileOptions(mobile, a.content === true, a.exact !== false);
  if (a.types) opts.setTypes(a.types);
  const parsed = parseCommaSearchTokens(a.text);
  const folders = scanFolders(mode, a.scoped);
  const rows: SearchHit[] = [];
  if (parsed.tokens.length > 0) {
    if (opts.searchContent) {
      const keys: string[] = [];
      for (const token of parsed.tokens) {
        const k = token.substring(token.lastIndexOf('\\') + 1).replace(/^\*+/, '');
        if (k.length > 0) keys.push(k);
      }
      await scanContent(rows, base, opts.buildFolderScanList(folders), opts, keys);
    } else {
      const entries = buildEntries(buildPlans(parsed.tokens, opts), opts, a.scoped);
      await scanNames(rows, base, opts.buildFolderScanList(folders), entries);
    }
    for (const token of parsed.starTokens) await scanConfigContent(rows, base, token, opts, contentFiles(mode, a.scoped));
  }
  const seen = new Set<string>();
  return dedupPreferF(rows).filter((r) => !seen.has(r.full.toLowerCase()) && seen.add(r.full.toLowerCase()));
}

/** UsesScopedProgramSearch: path nằm dưới gốc của mode (Mobile / Web / FB) → quét theo danh sách thư mục cấu hình. */
export function isScoped(root: string, mode: MenuMode, mobile: boolean, roots: { web: string; mobile: string; fb: string }): boolean {
  if (!root) return true;
  const modeRoot = mobile || mode === 'mob' ? roots.mobile : mode === 'fbo' ? roots.web : roots.fb;
  const m = (modeRoot ?? '').replace(/\\*$/, '\\');
  if (m === '\\') return false;
  const r = root.replace(/\\*$/, '\\');
  return r.toLowerCase().startsWith(m.toLowerCase());
}
