// Port FSDStudio52\Features\Controllers\MenuStructure.vb (+ missing / staleF / stores).
// Dò file + bảng + store của một menu theo cấu trúc sysid (docs/v5.2/ba-ui.md mục 7): cách FBO nạp màn hình,
// không tìm theo tiền tố tên. MenuFile.path: .xml nếu có, không thì .f; đọc nội dung để dò vẫn .f trước (bản đang chạy).
// Chỉ đọc; nội dung đã giải chỉ dùng trong bộ nhớ để lấy tên.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CancelToken, MenuFile, MenuFileRole, MenuStructureResult } from '../types';
import type { FControllerCrypto } from './fCrypto';
import { readControllerWith } from './controllerReader';

const MAX_CONTROLLERS = 400;
const CACHE_TTL_MS = 5 * 60 * 1000;

const RX_ITEMS = /<items\b([^>]*)>/gi;
const RX_ATTR = /\b(\w+)\s*=\s*"([^"]*)"/gi;
const RX_SHOW_FORM = /show\$?Form\w*\s*\(\s*(?:\w+\s*,\s*)?['"]([^'"]+)['"]/gi;
const RX_TRANSFER_ID = /<!ENTITY\s+TransferID\s+"([^"&]+)"/i;
const RX_ROOT_TABLE = /<(?:dir|grid)\b[^>]*?\btable\s*=\s*"([^"]+)"/i;
const RX_REPORT_FILE = /<reportFile\b[^>]*\bvalue\s*=\s*"([^"]+)"|<reportFile>([^<]+)<\/reportFile>/gi;
const RX_TEMPLATE_FILE = /<templateFile\b[^>]*\bvalue\s*=\s*"([^"]+)"|<templateFile>([^<]+)<\/templateFile>/gi;
const RX_FORM = /<form\b([^>]*)>/gi;
const RX_NAME =/^[A-Za-z_][\w.-]*$/;
const RX_EXEC = /\bexec(?:ute)?\s+([\w.[\]$#@&%]+)/gi;

export interface ScanOptions {
  mobile: boolean;
  crypto?: FControllerCrypto;
  token?: CancelToken;
}

function dirKey(dir: string): string {
  return dir.toLowerCase();
}

// ---------- Danh sách tên file của từng thư mục gốc (Dir / Grid / …): đọc một lần, khỏi stat từng file không tồn tại ----------
// Mỗi lệnh stat trên share mạng chiếm một luồng threadpool của Node (mặc định chỉ 4), nên giảm số lệnh quan trọng hơn tăng số tác vụ song song.

const listingCache = new Map<string, { at: number; names: Promise<Set<string> | undefined> }>();

function folderListing(ctrl: string, folder: string): Promise<Set<string> | undefined> {
  const key = dirKey(ctrl) + '|' + folder.toLowerCase();
  const hit = listingCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.names;
  const names: Promise<Set<string> | undefined> = fs.promises.readdir(path.join(ctrl, folder)).then(
    (list) => new Set(list.map((n) => n.toLowerCase())),
    () => undefined
  );
  listingCache.set(key, { at: Date.now(), names });
  return names;
}

interface LoadedController {
  fM: number | undefined;
  xmlM: number | undefined;
  text?: string;
  fellBack: boolean;
}
const controllerCache = new Map<string, { at: number; p: Promise<LoadedController> }>();

/** Bỏ danh sách thư mục và nội dung controller đã nhớ (file được tạo / xóa / đổi / đổi tên). */
export function clearFolderListings(controllersDir?: string): void {
  controllerCache.clear();
  if (!controllersDir) return listingCache.clear();
  const prefix = dirKey(normDir(controllersDir)) + '|';
  for (const k of [...listingCache.keys()]) if (k.startsWith(prefix)) listingCache.delete(k);
}

// ---------- Tiện ích ----------

function normDir(dir: string): string {
  const d = (dir ?? '').trim();
  if (d === '') return '';
  return /[\\/]$/.test(d) ? d : d + path.sep;
}

async function statMtime(p: string): Promise<number | undefined> {
  try {
    const st = await fs.promises.stat(p);
    return st.isFile() ? Math.round(st.mtimeMs) : undefined;
  } catch {
    return undefined;
  }
}

const MIEN_GOC = (mobile: boolean): string[] => ['Dir', 'Grid', 'Filter', mobile ? 'Dashboards' : 'Report'];

/**
 * Chữ ký "file gốc" của một sysId: ngày sửa của Dir/Grid/Filter/Report(Dashboards) \ sysid (.f, .xml).
 * Dùng cho chỉ mục: chữ ký đổi thì quét lại.
 */
export async function rootSignature(controllersDir: string, sysId: string, mobile: boolean): Promise<string> {
  const dir = normDir(controllersDir);
  const parts: Promise<string>[] = [];
  for (const folder of MIEN_GOC(mobile)) {
    for (const ext of ['.f', '.xml']) {
      parts.push(statMtime(path.join(dir, folder, sysId + ext)).then((m) => `${folder}${ext}=${m ?? 0}`));
    }
  }
  return (await Promise.all(parts)).join(';');
}

/** Chữ ký file gốc suy từ kết quả quét (cùng định dạng rootSignature) — khỏi stat lại 8 file. */
export function signatureOf(result: MenuStructureResult, sysId: string, mobile: boolean): string {
  const id = sysId.trim().toLowerCase();
  const parts: string[] = [];
  for (const folder of MIEN_GOC(mobile)) {
    const f = result.files.find((x) => x.via === 'root' && x.name.toLowerCase() === (folder.toLowerCase() + '\\' + id));
    for (const ext of ['.f', '.xml']) {
      const m = ext === '.f' ? f?.fMtime : f?.xmlMtime;
      parts.push(`${folder}${ext}=${m ?? 0}`);
    }
  }
  return parts.join(';');
}

function roleOfFolder(folder: string): MenuFileRole {
  switch (folder) {
    case 'Dir':
      return 'dir';
    case 'Grid':
      return 'grid';
    case 'Filter':
      return 'filter';
    case 'Report':
      return 'report';
    case 'Dashboards':
      return 'dashboard';
    case 'Lookup':
      return 'lookup';
    default:
      return 'include';
  }
}

type Via = MenuFile['via'];

/**
 * Tên bảng hợp lệ để liệt kê: bỏ giá trị entity / biến (& @ % khoảng trắng) và bảng kỳ `<tên>$<kỳ>`;
 * giữ bảng gốc partition `<tên>$000000` (vd m11$000000). Không hợp lệ → undefined.
 */
export function normalizeTable(raw: string): string | undefined {
  const t = (raw ?? '').trim();
  if (t === '' || /[&@ %]/.test(t)) return undefined;
  const i = t.indexOf('$');
  if (i < 0) return t;
  return i > 0 && /^[^$]+\$000000$/.test(t) ? t : undefined;
}

/** Tên store sau exec/execute; bỏ biến / entity / store khung FastBusiness$. */
function extractStores(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(RX_EXEC)) {
    let tok = m[1];
    if (/[@&%]/.test(tok)) continue;
    tok = tok.replace(/[[\]]/g, '').replace(/^dbo\./i, '').replace(/[.;]+$/, '');
    if (tok === '' || /^FastBusiness\$/i.test(tok)) continue;
    // Chữ thường thuần như "the", "command" (lời văn trong comment) không phải tên store: store có _ $ . hoặc số.
    if (!/[_$.\d]/.test(m[1])) continue;
    if (/^sp_executesql$/i.test(tok)) continue;
    out.push(tok);
  }
  return out;
}

class Scanner {
  readonly ctrl: string;
  readonly files: MenuFile[] = [];
  readonly tables: string[] = [];
  readonly stores: string[] = [];
  readonly fellBack: string[] = [];
  private readonly seen = new Set<string>();
  private readonly filePaths = new Set<string>();

  constructor(
    controllersDir: string,
    private readonly opts: ScanOptions
  ) {
    this.ctrl = normDir(controllersDir);
  }

  private get cancelled(): boolean {
    return !!this.opts.token?.isCancellationRequested;
  }

  async scan(sysId: string): Promise<void> {
    sysId = (sysId ?? '').trim();
    if (sysId === '' || this.ctrl === '') return;
    try {
      if (!(await fs.promises.stat(this.ctrl)).isDirectory()) return;
    } catch {
      return;
    }
    for (const folder of MIEN_GOC(this.opts.mobile)) {
      await this.visit(folder, sysId, 'root');
    }
  }

  /** Controller folder\name: path ưu tiên .xml (không có mới .f); đọc nội dung để đi tiếp vẫn .f trước. */
  private async visit(folder: string, name: string, via: Via): Promise<void> {
    name = (name ?? '').trim();
    if (name === '' || !RX_NAME.test(name) || this.seen.size > MAX_CONTROLLERS || this.cancelled) return;
    if (this.seen.has((folder + '\\' + name).toLowerCase())) return;
    this.seen.add((folder + '\\' + name).toLowerCase());
    const basePath = path.join(this.ctrl, folder, name);
    const loaded = await this.load(folder, name, basePath);
    const { fM, xmlM } = loaded;
    const hasF = fM !== undefined;
    const hasXml = xmlM !== undefined;
    const role: MenuFileRole = via === 'import' ? 'import' : roleOfFolder(folder);
    if (!hasF && !hasXml) {
      // Gốc Dir/Grid/Filter/Report không có là bình thường; chỉ controller được khai báo mà thiếu mới đánh missing.
      if (via !== 'root') {
        this.pushFile({
          path: basePath + '.xml',
          role,
          name: folder + '\\' + name,
          via,
          hasF: false,
          hasXml: false,
          staleF: false,
          missing: true
        });
      }
      return;
    }
    this.pushFile({
      path: hasXml ? basePath + '.xml' : basePath + '.f',
      role,
      name: folder + '\\' + name,
      via,
      hasF,
      hasXml,
      fMtime: fM,
      xmlMtime: xmlM,
      staleF: hasF && hasXml && (fM as number) < (xmlM as number),
      missing: false
    });
    if (loaded.fellBack) this.fellBack.push(basePath + '.f');
    if (loaded.text !== undefined) await this.follow(folder, loaded.text);
  }

  /** Ngày sửa + nội dung của controller; nhiều menu dùng chung một Grid / Lookup thì chỉ đọc một lần (cache ngắn hạn). */
  private load(folder: string, name: string, basePath: string): Promise<LoadedController> {
    const key = dirKey(this.ctrl) + '|' + folder.toLowerCase() + '|' + name.toLowerCase();
    const hit = controllerCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.p;
    const p = (async (): Promise<LoadedController> => {
      const listing = await folderListing(this.ctrl, folder);
      const mt = (ext: string): Promise<number | undefined> =>
        listing && !listing.has((name + ext).toLowerCase()) ? Promise.resolve(undefined) : statMtime(basePath + ext);
      const [fM, xmlM] = await Promise.all([mt('.f'), mt('.xml')]);
      const out: LoadedController = { fM, xmlM, fellBack: false };
      if (fM === undefined && xmlM === undefined) return out;
      try {
        const ct = await readControllerWith(basePath, { f: fM !== undefined, xml: xmlM !== undefined }, this.opts.crypto);
        if (ct) {
          out.fellBack = !!ct.fellBackFromF;
          out.text = ct.text;
        }
      } catch {
        // lỗi đọc: giữ file trong danh sách, không đi tiếp
      }
      return out;
    })();
    controllerCache.set(key, { at: Date.now(), p });
    return p;
  }

  private async follow(folder: string, text: string): Promise<void> {
    const rt = RX_ROOT_TABLE.exec(text);
    if (rt) this.addTable(rt[1]);
    for (const s of extractStores(text)) this.addStore(s);

    for (const m of text.matchAll(RX_ITEMS)) {
      let style = '';
      let controller = '';
      for (const a of m[1].matchAll(RX_ATTR)) {
        const k = a[1].toLowerCase();
        if (k === 'style') style = a[2].trim().toLowerCase();
        else if (k === 'controller') controller = a[2].trim();
      }
      if (controller === '') continue;
      if (style === 'grid') await this.visit('Grid', controller, 'grid');
      if (style === 'autocomplete' || style === 'lookup') await this.visit('Lookup', controller, 'lookup');
    }
    for (const m of text.matchAll(RX_SHOW_FORM)) {
      await this.visit('Filter', m[1], 'showForm');
    }
    const t = RX_TRANSFER_ID.exec(text);
    if (t) {
      const up = t[1].trim();
      await this.visit('Filter', up + 'Import', 'import');
      await this.addIfExists(path.join('Templates', 'Upload', up + '.xml'), 'import', 'import');
      await this.addIfExists(path.join('Templates', 'Excel', up + '.xlsx'), 'import', 'import');
    }
    if (folder === 'Report' || folder === 'Dashboards') {
      for (const m of text.matchAll(RX_REPORT_FILE)) {
        const rep = path.win32.parse((m[1] ?? m[2] ?? '').trim()).name;
        if (rep === '') continue;
        for (const [sub, ext] of [['Frx', '.frx'], ['Rldc', '.rldc'], ['Rpt', '.rpt']]) {
          await this.addIfExists(path.join('Templates', sub, rep + ext), 'template', 'reportFile');
        }
      }
      for (const m of text.matchAll(RX_TEMPLATE_FILE)) {
        const x = (m[1] ?? m[2] ?? '').trim();
        if (x !== '') await this.addIfExists(path.join('Templates', 'Excel', path.win32.extname(x) !== '' ? x : x + '.xlsx'), 'template', 'templateFile');
      }
      // Dạng thật của Report: <form reportFile="…" templateFile="…" commandArgument="Pdf|Excel">.
      for (const m of text.matchAll(RX_FORM)) {
        const at: Record<string, string> = {};
        for (const a of m[1].matchAll(RX_ATTR)) at[a[1].toLowerCase()] = a[2].trim();
        const arg = (at.commandargument ?? '').toLowerCase();
        const rep = at.reportfile ?? '';
        const tpl = at.templatefile ?? '';
        if (rep !== '' && !/[&@%]/.test(rep) && (arg === 'pdf' || arg === '')) await this.reportTemplate(rep);
        if (tpl !== '' && !/[&@%]/.test(tpl) && (arg === 'excel' || arg === '')) {
          const rel = path.join('Templates', 'Excel', path.win32.extname(tpl) !== '' ? tpl : tpl + '.xlsx');
          await this.addTemplate(rel, 'templateFile', true);
        }
      }
    }
  }

  /** Mẫu in PDF: Frx / Rldc / Rpt cùng tên (mọi bản đang có); không có bản nào thì ghi một dòng thiếu (.rpt như 5.1). */
  private async reportTemplate(rep: string): Promise<void> {
    const parsed = path.win32.parse(rep);
    const base = parsed.name;
    if (base === '' || !RX_NAME.test(base)) return;
    let found = 0;
    for (const [sub, ext] of [['Frx', '.frx'], ['Rldc', '.rldc'], ['Rpt', '.rpt']]) {
      if (await this.addTemplate(path.join('Templates', sub, base + ext), 'reportFile', false)) found++;
    }
    if (found === 0) {
      const ext = ['.frx', '.rldc', '.rpt'].includes(parsed.ext.toLowerCase()) ? parsed.ext.toLowerCase() : '.rpt';
      const sub = ext === '.frx' ? 'Frx' : ext === '.rldc' ? 'Rldc' : 'Rpt';
      await this.addTemplate(path.join('Templates', sub, base + ext), 'reportFile', true);
    }
  }

  /** Thêm file mẫu; có thì ghi bình thường, không có và missingIfAbsent thì ghi missing. Trả true nếu file có. */
  private async addTemplate(rel: string, via: Via, missingIfAbsent: boolean): Promise<boolean> {
    const full = path.join(this.ctrl, rel);
    const exists = (await statMtime(full)) !== undefined;
    if (exists || missingIfAbsent) {
      this.pushFile({ path: full, role: 'template', name: rel.replace(/\//g, '\\'), via, hasF: false, hasXml: false, staleF: false, missing: !exists });
    }
    return exists;
  }

  private async addIfExists(rel: string, role: MenuFileRole, via: Via): Promise<void> {
    const full = path.join(this.ctrl, rel);
    if ((await statMtime(full)) === undefined) return;
    this.pushFile({ path: full, role, name: rel.replace(/\//g, '\\'), via, hasF: false, hasXml: false, staleF: false, missing: false });
  }

  private pushFile(f: MenuFile): void {
    const k = f.path.toLowerCase();
    if (this.filePaths.has(k)) return;
    this.filePaths.add(k);
    this.files.push(f);
  }

  private addTable(t: string): void {
    const name = normalizeTable(t);
    if (name === undefined) return;
    t = name;
    if (!this.tables.some((x) => x.toLowerCase() === t.toLowerCase())) this.tables.push(t);
  }

  private addStore(s: string): void {
    if (!this.stores.some((x) => x.toLowerCase() === s.toLowerCase())) this.stores.push(s);
  }
}

/**
 * Dò file / bảng / store của một menu theo sysid.
 * controllersDir = <web>\App_Data\Controllers\ (Mobile: …\Controllers\Mobile\).
 */
export async function scanMenu(controllersDir: string, sysId: string, opts: ScanOptions): Promise<MenuStructureResult> {
  const sc = new Scanner(controllersDir, opts);
  await sc.scan(sysId);
  return {
    sysId: (sysId ?? '').trim(),
    controllersDir: sc.ctrl,
    files: sc.files,
    tables: sc.tables,
    stores: sc.stores,
    fellBack: sc.fellBack
  };
}
