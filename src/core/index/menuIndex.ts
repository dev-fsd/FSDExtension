// Chỉ mục ngược file → menu. Mỗi (kind, sysId) quét một lần (nhiều menu trùng sysid dùng chung),
// lưu cấu trúc + chữ ký file gốc vào cacheFile (JSON); file gốc đổi ngày sửa thì quét lại sysId đó.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CancelToken, MenuFileRole, MenuItem, MenuKind, MenuRef, MenuStructureResult } from '../types';
import type { FControllerCrypto } from '../controllers/fCrypto';
import { clearFolderListings, rootSignature, scanMenu } from '../controllers/menuStructure';
import { runScanJob, type ScanJob, type ScanOut } from './scanJob';

const CACHE_VERSION = 4; // 4: bỏ Include khỏi cấu trúc menu; // 3: MenuFile.path ưu tiên .xml; 2: Include riêng bắt buộc có tiền tố trước sysid
const MAX_PARALLEL = 16;
/** Cache lưu chưa quá lâu thì tin luôn, không stat lại file gốc của từng sysId (file đổi vẫn được bắt khi mở / sửa qua invalidateFile). */
const TRUST_CACHE_MS = 10 * 60 * 1000;

interface Entry {
  sig: string;
  result: MenuStructureResult;
}

interface CacheFile {
  version: number;
  structures: Record<string, Entry>;
  menus: Record<string, MenuRef[]>;
  savedAt?: number;
}

export interface MenuIndexOptions {
  cacheFile: string;
  controllersDir: (kind: MenuKind) => string | undefined;
  crypto?: FControllerCrypto;
  /** Gọi khi dò một sysId lâu bất thường (chẩn đoán). */
  onSlow?: (kind: MenuKind, sysId: string, ms: number) => void;
  /**
   * Quét các việc ở nơi khác (tiến trình con): gọi apply cho mỗi kết quả đổi, progress(n) cho mỗi n việc xong.
   * Ném lỗi → chỉ mục tự quét lại phần còn thiếu trong tiến trình này.
   */
  scanJobs?: (jobs: ScanJob[], apply: (o: ScanOut) => void, progress: (n: number) => void, token?: CancelToken) => Promise<void>;
}

function structKey(kind: MenuKind, sysId: string): string {
  return `${kind}|${sysId.trim().toLowerCase()}`;
}

/** Khóa file: đường dẫn chữ thường, '/'→'\', bỏ đuôi .f / .xml. */
function fileKey(p: string): string {
  return p.trim().toLowerCase().replace(/\//g, '\\').replace(/\.(f|xml)$/, '');
}

export class MenuIndex {
  private structures = new Map<string, Entry>();
  private menus = new Map<string, MenuRef[]>();
  /** khóa file → các structKey có chứa file đó */
  private fileMap = new Map<string, Set<string>>();
  private _version = 0;
  private savedAt = 0;

  constructor(private readonly opts: MenuIndexOptions) {}

  /** Tăng mỗi khi bảng file → menu được dựng lại (nơi nghe, vd badge tab, biết lúc nào phải vẽ lại). */
  get version(): number {
    return this._version;
  }

  /** Số (kind, sysId) đã có cấu trúc trong chỉ mục. */
  get sysIdCount(): number {
    return this.structures.size;
  }

  /** Nạp cache (tin cache, không kiểm lại). Không có / hỏng thì chỉ mục rỗng. */
  async load(): Promise<void> {
    try {
      const raw = await fs.promises.readFile(this.opts.cacheFile, 'utf8');
      const data = JSON.parse(raw) as CacheFile;
      if (data.version !== CACHE_VERSION) return;
      this.structures = new Map(Object.entries(data.structures ?? {}));
      this.menus = new Map(Object.entries(data.menus ?? {}));
      this.savedAt = data.savedAt ?? 0;
      this.rebuildFileMap();
    } catch {
      // chưa có cache
    }
  }

  async save(): Promise<void> {
    const data: CacheFile = {
      version: CACHE_VERSION,
      structures: Object.fromEntries(this.structures),
      menus: Object.fromEntries(this.menus),
      savedAt: Date.now()
    };
    await fs.promises.mkdir(path.dirname(this.opts.cacheFile), { recursive: true });
    await fs.promises.writeFile(this.opts.cacheFile, JSON.stringify(data), 'utf8');
  }

  /**
   * Dựng chỉ mục cho danh sách menu: sysId chưa có hoặc file gốc đổi ngày sửa thì quét lại, còn lại dùng cache.
   * Song song tối đa 4.
   */
  async build(menus: MenuItem[], onProgress?: (done: number, total: number) => void, token?: CancelToken): Promise<void> {
    const refs = new Map<string, MenuRef[]>();
    const pairs = new Map<string, { kind: MenuKind; sysId: string }>();
    for (const m of menus) {
      const sysId = (m.sysId ?? '').trim();
      if (sysId === '') continue;
      const k = structKey(m.kind, sysId);
      if (!pairs.has(k)) pairs.set(k, { kind: m.kind, sysId });
      const list = refs.get(k) ?? [];
      list.push({ kind: m.kind, menuId: m.id, sysId, bar: m.bar });
      refs.set(k, list);
    }
    this.menus = refs;
    // Bỏ cấu trúc của sysId không còn menu nào.
    for (const k of [...this.structures.keys()]) {
      if (!pairs.has(k)) this.structures.delete(k);
    }

    clearFolderListings();
    // Việc cần làm: sysId chưa có cấu trúc, hoặc có nhưng cache đã cũ thì kiểm lại chữ ký file gốc.
    const jobs: ScanJob[] = [];
    let done = 0;
    for (const [k, p] of pairs) {
      const dir = this.opts.controllersDir(p.kind);
      if (!dir) continue;
      const old = this.structures.get(k);
      if (old && Date.now() - this.savedAt < TRUST_CACHE_MS) continue;
      jobs.push({ k, kind: p.kind, sysId: p.sysId, dir, oldSig: old?.sig });
    }
    const total = pairs.size;
    done = total - jobs.length;
    onProgress?.(done, total);
    const apply = (o: ScanOut): void => {
      if (!token?.isCancellationRequested) this.structures.set(o.k, { sig: o.sig, result: o.result });
    };
    const progress = (n: number): void => {
      done += n;
      onProgress?.(done, total);
    };
    if (this.opts.scanJobs) {
      try {
        await this.opts.scanJobs(jobs, apply, progress, token);
      } catch {
        // Tiến trình con lỗi: quét lại những việc còn thiếu ngay trong tiến trình này.
        await this.scanLocal(jobs.filter((j) => !this.doneKeys.has(j.k)), apply, progress, token);
      }
    } else {
      await this.scanLocal(jobs, apply, progress, token);
    }
    this.rebuildFileMap();
  }

  private readonly doneKeys = new Set<string>();

  private async scanLocal(jobs: ScanJob[], apply: (o: ScanOut) => void, progress: (n: number) => void, token?: CancelToken): Promise<void> {
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        if (token?.isCancellationRequested) return;
        const i = next++;
        if (i >= jobs.length) return;
        const out = await runScanJob(jobs[i], this.opts.crypto, token);
        if (out) apply(out);
        this.doneKeys.add(jobs[i].k);
        progress(1);
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, Math.max(1, jobs.length)) }, worker));
  }

  /** Đăng ký danh sách menu ngay khi nạp xong (trước khi dựng chỉ mục) để tra được file gốc tức thì. */
  setMenus(menus: MenuItem[]): void {
    const refs = new Map<string, MenuRef[]>();
    for (const m of menus) {
      const sysId = (m.sysId ?? '').trim();
      if (sysId === '') continue;
      const k = structKey(m.kind, sysId);
      const list = refs.get(k) ?? [];
      list.push({ kind: m.kind, menuId: m.id, sysId, bar: m.bar });
      refs.set(k, list);
    }
    this.menus = refs;
    this._version++;
  }

  /**
   * File gốc của menu (Dir / Grid / Filter / Report / Dashboards \ <sysId>): tên file chính là sysid nên tra thẳng,
   * không cần chờ quét. File dùng chung (Lookup, Include…) mới cần chỉ mục đầy đủ.
   */
  private rootOfFile(filePath: string): { refs: MenuRef[]; role: MenuFileRole } | undefined {
    const fk = fileKey(filePath);
    for (const kind of ['fbo', 'mob'] as MenuKind[]) {
      const dir = this.opts.controllersDir(kind);
      if (!dir) continue;
      const d = fileKey(dir.endsWith('\\') || dir.endsWith('/') ? dir : dir + '\\');
      if (!fk.startsWith(d)) continue;
      const rel = fk.slice(d.length).split('\\');
      if (rel.length !== 2) continue;
      const role = ({ dir: 'dir', grid: 'grid', filter: 'filter', report: 'report', dashboards: 'dashboard' } as Record<string, MenuFileRole>)[rel[0]];
      if (!role || (kind === 'fbo' && rel[0] === 'dashboards') || (kind === 'mob' && rel[0] === 'report')) continue;
      const refs = this.menus.get(structKey(kind, rel[1]));
      if (refs?.length) return { refs, role };
    }
    return undefined;
  }

  /** Các menu dùng file này (mở .xml hay .f đều ra cùng kết quả). */
  menusOfFile(filePath: string): MenuRef[] {
    const keys = this.fileMap.get(fileKey(filePath));
    if (!keys) return this.rootOfFile(filePath)?.refs ?? [];
    return this.refsOf(keys);
  }

  /** Các menu nhận file này làm file gốc (Dir / Grid / Filter / Report / Dashboards trùng sysid). File dùng chung → rỗng. */
  rootMenusOfFile(filePath: string): MenuRef[] {
    const fk = fileKey(filePath);
    const keys = [...(this.fileMap.get(fk) ?? [])].filter((k) =>
      this.structures.get(k)?.result.files.some((f) => f.via === 'root' && !f.missing && fileKey(f.path) === fk)
    );
    if (keys.length === 0) return this.rootOfFile(filePath)?.refs ?? [];
    return this.refsOf(keys);
  }

  /**
   * Vai trò của file trong chỉ mục (dir / grid / filter / report / dashboard / lookup / ...); file không thuộc chỉ mục → undefined.
   * Một file có thể vào nhiều menu với vai trò khác (vd Filter vừa là Filter gốc vừa là Import): ưu tiên vai trò không phải import / include / template.
   */
  roleOfFile(filePath: string): MenuFileRole | undefined {
    const fk = fileKey(filePath);
    const keys = this.fileMap.get(fk);
    if (!keys) return this.rootOfFile(filePath)?.role;
    let found: MenuFileRole | undefined;
    for (const k of keys) {
      for (const f of this.structures.get(k)?.result.files ?? []) {
        if (fileKey(f.path) !== fk) continue;
        if (f.role !== 'import' && f.role !== 'include' && f.role !== 'template') return f.role;
        found ??= f.role;
      }
    }
    return found;
  }

  structureOf(kind: MenuKind, sysId: string): MenuStructureResult | undefined {
    return this.structures.get(structKey(kind, sysId))?.result;
  }

  /** Có sẵn thì trả cache; chưa có thì quét (và nhớ vào chỉ mục). */
  async ensureStructure(kind: MenuKind, sysId: string): Promise<MenuStructureResult> {
    const k = structKey(kind, sysId);
    const have = this.structures.get(k);
    if (have) return have.result;
    return (await this.rescan(kind, sysId)).result;
  }

  /** File đổi: quét lại các sysId chứa file đó (kể cả file gốc mới tạo), trả các menu liên quan. */
  async invalidateFile(filePath: string): Promise<MenuRef[]> {
    clearFolderListings();
    const key = fileKey(filePath);
    const affected = new Set<string>(this.fileMap.get(key) ?? []);
    for (const kind of ['fbo', 'mob'] as MenuKind[]) {
      const dir = this.opts.controllersDir(kind);
      if (!dir) continue;
      const d = fileKey(dir.endsWith('\\') || dir.endsWith('/') ? dir : dir + '\\');
      if (!key.startsWith(d)) continue;
      const rel = key.slice(d.length).split('\\');
      // File gốc mới tạo: Dir|Grid|Filter|Report|Dashboards\<sysId>
      if (rel.length === 2) {
        const k = structKey(kind, rel[1]);
        if (this.structures.has(k) || this.menus.has(k)) affected.add(k);
      }
    }
    let changed = false;
    for (const k of affected) {
      const [kind, sysId] = this.splitKey(k);
      // Lớp VS Code gọi cả khi chỉ đổi tab: file không đổi ngày sửa thì không quét lại.
      if (await this.isUnchanged(k, key)) continue;
      await this.rescan(kind, this.structures.get(k)?.result.sysId ?? sysId);
      changed = true;
    }
    if (changed) {
      try {
        await this.save();
      } catch {
        // ghi cache lỗi không ảnh hưởng chỉ mục trong bộ nhớ
      }
    }
    return this.refsOf(affected);
  }

  // ---------- nội bộ ----------

  /**
   * File vẫn như lúc quét? Controller: .f/.xml cùng ngày sửa; file mẫu / Include: còn tồn tại như cũ;
   * chữ ký file gốc không đổi. Chưa có cấu trúc (file gốc mới) → coi là đã đổi.
   */
  private async isUnchanged(structK: string, fKey: string): Promise<boolean> {
    const e = this.structures.get(structK);
    if (!e) return false;
    const [kind, sysId] = this.splitKey(structK);
    const dir = this.opts.controllersDir(kind);
    if (!dir) return false;
    if ((await rootSignature(dir, e.result.sysId || sysId, kind === 'mob')) !== e.sig) return false;
    for (const f of e.result.files) {
      if (fileKey(f.path) !== fKey) continue;
      const base = f.path.replace(/\.(f|xml)$/i, '');
      if (f.role === 'template' || f.role === 'include' || (f.role === 'import' && !/\.(f|xml)$/i.test(f.path)) || (!f.hasF && !f.hasXml && !f.missing)) {
        const st = await fs.promises.stat(f.path).then((x) => x.isFile(), () => false);
        if (st === f.missing) return false;
        continue;
      }
      const m = async (p: string): Promise<number | undefined> => fs.promises.stat(p).then((x) => Math.round(x.mtimeMs), () => undefined);
      const [fm, xm] = await Promise.all([m(base + '.f'), m(base + '.xml')]);
      if (fm !== f.fMtime || xm !== f.xmlMtime) return false;
    }
    return true;
  }

  private splitKey(k: string): [MenuKind, string] {
    const i = k.indexOf('|');
    return [k.slice(0, i) as MenuKind, k.slice(i + 1)];
  }

  private async rescan(kind: MenuKind, sysId: string): Promise<Entry> {
    const dir = this.opts.controllersDir(kind);
    const mobile = kind === 'mob';
    if (!dir) {
      return { sig: '', result: { sysId, controllersDir: '', files: [], tables: [], stores: [], fellBack: [] } };
    }
    const sig = await rootSignature(dir, sysId, mobile);
    const result = await scanMenu(dir, sysId, { mobile, crypto: this.opts.crypto });
    const entry: Entry = { sig, result };
    this.structures.set(structKey(kind, sysId), entry);
    this.rebuildFileMap();
    return entry;
  }

  private rebuildFileMap(): void {
    const map = new Map<string, Set<string>>();
    for (const [k, e] of this.structures) {
      for (const f of e.result.files) {
        const fk = fileKey(f.path);
        let s = map.get(fk);
        if (!s) map.set(fk, (s = new Set()));
        s.add(k);
      }
    }
    this.fileMap = map;
    this._version++;
  }

  private refsOf(keys: Iterable<string>): MenuRef[] {
    const out: MenuRef[] = [];
    const seen = new Set<string>();
    for (const k of keys) {
      for (const r of this.menus.get(k) ?? []) {
        const id = `${r.kind}|${r.menuId}`;
        if (!seen.has(id)) {
          seen.add(id);
          out.push(r);
        }
      }
    }
    return out;
  }
}
