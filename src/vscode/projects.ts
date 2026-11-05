// Nạp danh sách dự án (projects.json); lần đầu chưa có thì nhập từ config.db của FSD Studio;
// đồng bộ từ danh sách chuẩn (QLYC); tự nạp lại khi config.db đổi. Mật khẩu chỉ ở SecretStorage.
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { readDmda, readOption } from '../core/projects/configDb';
import { ProjectStore, toProjectRecord } from '../core/projects/projectStore';
import { fetchStandardProjects, mergeStandard } from '../core/projects/qlycSync';
import { decodeText } from '../core/legacy/legacyText';
import type { ProjectRecord } from '../core/types';
import type { Logger } from './log';
import type { ProjectSecrets } from './secrets';

const STATE_CURR_USER = 'fsd.currUser';
const STATE_CONFIG_MTIME = 'fsd.configDbMtime';
const WATCH_INTERVAL_MS = 60_000;

export interface ImportSummary {
  total: number;
  added: number;
  updated: number;
}

export interface SyncSummary {
  updated: number;
  added: number;
  total: number;
}

/** Hai bản ghi có cùng thông tin dùng để kết nối / tìm file không (mã giống nhau). */
function sameProject(a: ProjectRecord, b: ProjectRecord): boolean {
  return JSON.stringify(toProjectRecord(a)) === JSON.stringify(toProjectRecord(b));
}

export class ProjectRegistry implements vscode.Disposable {
  private list: ProjectRecord[] = [];
  private readonly store = new ProjectStore(ProjectStore.defaultPath());
  private readonly emitter = new vscode.EventEmitter<string[]>();
  /** Bắn khi danh sách đổi; tham số = mã các dự án đã có và đổi thông tin (phiên đang mở cần làm mới). */
  readonly onDidChangeProjects = this.emitter.event;
  private timer?: NodeJS.Timeout;
  private checking = false;
  private isLoaded = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly secrets: ProjectSecrets,
    private readonly log: Logger
  ) {}

  projects(): ProjectRecord[] {
    return this.list;
  }

  /** Đã nạp xong danh sách dự án (panel chỉ báo "chưa có dự án" khi true mà vẫn rỗng). */
  get loaded(): boolean {
    return this.isLoaded;
  }

  /**
   * Đọc projects.json (cache, nhanh). Có dự án thì coi như đã nạp ngay; danh sách rỗng thì chờ
   * completeLoad (nhập từ config.db) rồi mới coi là nạp xong.
   */
  async load(): Promise<void> {
    try {
      this.list = await this.store.load();
    } catch (e) {
      this.log.error('Không đọc được projects.json', e);
      this.list = [];
    }
    if (this.list.length > 0) this.isLoaded = true;
  }

  /** Việc nền sau load: chưa có dự án mà có config.db thì tự nhập; projects.json cũ thiếu host thì bổ sung. */
  async completeLoad(): Promise<void> {
    try {
      await this.reconcile();
    } finally {
      this.isLoaded = true;
    }
  }

  private async reconcile(): Promise<void> {
    const dbPath = configDbPath();
    const hasDb = !!dbPath && fs.existsSync(dbPath);
    if (this.list.length === 0) {
      if (hasDb) await this.importFromConfigDb(false);
    } else if (this.store.missingHosts) {
      // projects.json cũ chưa có web host 1 / 2: đọc lại config.db một lần rồi ghi lại để có đủ trường.
      if (hasDb) await this.importFromConfigDb(false);
      try {
        await this.store.save(this.list);
      } catch (e) {
        this.log.error('Ghi lại projects.json lỗi', e);
      }
    }
  }

  /** Theo dõi ngày sửa config.db (kiểm ngay một lần rồi mỗi 60 giây). */
  startWatch(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.checkConfigDb(), WATCH_INTERVAL_MS);
    void this.checkConfigDb();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.emitter.dispose();
  }

  /**
   * config.db đổi ngày sửa (so với lần đã nạp) → đọc lại dmda, cập nhật dự án có trong đó (thêm mới / đổi thông tin);
   * không xóa dự án nào (dự án đồng bộ từ QLYC có thể không nằm trong config.db).
   */
  async checkConfigDb(force = false): Promise<void> {
    const dbPath = configDbPath();
    if (!dbPath || this.checking) return;
    this.checking = true;
    try {
      const mtime = Math.round((await fs.promises.stat(dbPath)).mtimeMs);
      const stamp = `${dbPath}|${mtime}`;
      if (!force && this.context.globalState.get<string>(STATE_CONFIG_MTIME) === stamp) return;
      const res = await this.upsertFromConfigDb(dbPath);
      await this.context.globalState.update(STATE_CONFIG_MTIME, stamp);
      if (res.updated + res.added > 0) this.log.info(`config.db đổi: cập nhật ${res.updated}, thêm ${res.added} dự án`);
    } catch (e) {
      // Không thấy file / đang bị khóa: thử lại lần sau.
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') this.log.error('Theo dõi config.db lỗi', e);
    } finally {
      this.checking = false;
    }
  }

  private async upsertFromConfigDb(dbPath: string): Promise<ImportSummary> {
    const rows = await readDmda(dbPath, this.wasmPath());
    const next = this.list.map((p) => ({ ...p }));
    const changedCodes: string[] = [];
    let added = 0;
    let touched = false;
    // Mật khẩu: đọc / ghi SecretStorage đồng thời cho mọi dòng (tuần tự rất chậm khi có hàng trăm dự án).
    const pwChangedSet = new Set<string>();
    await Promise.all(
      rows.map(async (row) => {
        const pw = row.passwordEncoded ? decodeText(row.passwordEncoded, 13) : undefined;
        const code = toProjectRecord(row).code;
        if (pw !== undefined && (await this.secrets.get(code)) !== pw) {
          await this.secrets.set(code, pw);
          pwChangedSet.add(code);
        }
      })
    );
    for (const row of rows) {
      const rec = toProjectRecord(row);
      const idx = next.findIndex((p) => p.code === rec.code);
      const pwChanged = pwChangedSet.has(rec.code);
      if (idx < 0) {
        next.push(rec);
        added++;
        touched = true;
      } else {
        const recChanged = !sameProject(next[idx], rec);
        if (recChanged) {
          next[idx] = rec;
          touched = true;
        }
        if (recChanged || pwChanged) changedCodes.push(rec.code);
      }
    }
    if (touched || changedCodes.length > 0) {
      if (touched) await this.store.save(next);
      this.list = next;
      this.emitter.fire(changedCodes);
    }
    return { total: rows.length, added, updated: changedCodes.length };
  }

  /**
   * Nhập dmda từ config.db (chỉ đọc) theo kiểu gộp: cập nhật + thêm, không xóa dự án nào;
   * mật khẩu vào SecretStorage. Trả undefined nếu không nhập được.
   */
  async importFromConfigDb(notify: boolean): Promise<ImportSummary | undefined> {
    const dbPath = configDbPath();
    if (!dbPath || !fs.existsSync(dbPath)) {
      const msg = `Không thấy config.db: ${dbPath || '(chưa đặt fsd.configDbPath)'}`;
      this.log.error(msg);
      if (notify) void vscode.window.showWarningMessage(msg);
      return undefined;
    }
    try {
      const res = await this.upsertFromConfigDb(dbPath);
      try {
        const mtime = Math.round((await fs.promises.stat(dbPath)).mtimeMs);
        await this.context.globalState.update(STATE_CONFIG_MTIME, `${dbPath}|${mtime}`);
      } catch {
        /* bỏ qua */
      }
      this.log.info(`Nhập từ config.db: ${res.total} dòng, cập nhật ${res.updated}, thêm ${res.added}`);
      if (notify) vscode.window.setStatusBarMessage(`$(check) Đã nhập dự án: thêm ${res.added}, cập nhật ${res.updated}`, 3000);
      return res;
    } catch (e) {
      this.log.error('Nhập dự án từ config.db lỗi', e);
      if (notify) this.log.notifyError('Nhập dự án lỗi.');
      return undefined;
    }
  }

  /**
   * Đồng bộ từ danh sách chuẩn QLYC (ns_getListDept <CurrUser>): cập nhật dự án đã có, thêm dự án mới.
   * Không ghi config.db. Trả undefined nếu người dùng bỏ qua việc nhập CurrUser.
   */
  async syncStandard(): Promise<SyncSummary | undefined> {
    const currUser = await this.getCurrUser();
    if (!currUser) return undefined;
    const rows = await fetchStandardProjects(currUser);
    const res = mergeStandard(this.list, rows);
    const changedCodes: string[] = [];
    await Promise.all(
      [...res.passwords].map(async ([code, pw]) => {
        if ((await this.secrets.get(code)) !== pw) {
          await this.secrets.set(code, pw);
          if (this.list.some((p) => p.code === code)) changedCodes.push(code);
        }
      })
    );
    for (const p of res.projects) {
      const old = this.list.find((x) => x.code === p.code);
      if (old && !sameProject(old, p) && !changedCodes.includes(p.code)) changedCodes.push(p.code);
    }
    await this.store.save(res.projects);
    this.list = res.projects;
    this.log.info(`Đồng bộ QLYC: ${res.total} dòng, cập nhật ${res.updated}, thêm ${res.added}`);
    this.emitter.fire(changedCodes);
    return { updated: res.updated, added: res.added, total: res.total };
  }

  /** CurrUser: option CurrUser trong config.db; không có thì lấy giá trị đã nhớ; chưa có nữa thì hỏi. */
  private async getCurrUser(): Promise<string | undefined> {
    const dbPath = configDbPath();
    if (dbPath && fs.existsSync(dbPath)) {
      try {
        const v = (await readOption(dbPath, 'CurrUser', this.wasmPath())).trim();
        if (v !== '') return v;
      } catch (e) {
        this.log.error('Không đọc được CurrUser từ config.db', e);
      }
    }
    const remembered = (this.context.globalState.get<string>(STATE_CURR_USER) ?? '').trim();
    if (remembered !== '') return remembered;
    const input = await vscode.window.showInputBox({
      title: 'Đồng bộ dự án',
      prompt: 'Tên người dùng (CurrUser) để lấy danh sách dự án chuẩn',
      ignoreFocusOut: true
    });
    const v = (input ?? '').trim();
    if (v === '') return undefined;
    await this.context.globalState.update(STATE_CURR_USER, v);
    return v;
  }

  private wasmPath(): string {
    return path.join(this.context.extensionPath, 'dist', 'sql-wasm.wasm');
  }
}

export function configDbPath(): string {
  const own = vscode.workspace.getConfiguration('fsd').get<string>('configDbPath', '').trim();
  return own || path.join(studioDir(), 'config.db');
}

/** Thư mục FSD Studio (fsd.studioDir): nơi đọc key.txt và config.db mặc định. */
export function studioDir(): string {
  return vscode.workspace.getConfiguration('fsd').get<string>('studioDir', '').trim() || 'D:\\SOFT\\FSDStudio';
}
