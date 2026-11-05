// Phiên làm việc theo dự án: kết nối SQL, nạp menu FBO + Mobile, chỉ mục file → menu.
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { FControllerCrypto } from '../core/controllers/fCrypto';
import { resolveKeyFile } from '../core/controllers/controllerReader';
import { MenuIndex } from '../core/index/menuIndex';
import { mobileRoot, webRoot } from '../core/projects/projectStore';
import { loadAppDatabases } from '../core/sql/appDatabases';
import { SqlClient, type SqlConfig } from '../core/sql/sqlClient';
import { loadMenus } from '../core/sql/menuRepo';
import { makeIndexRunner } from './indexRunner';
import type { MenuItem, MenuKind, MenuRef, ProjectRecord } from '../core/types';
import type { Logger } from './log';
import type { ProjectSecrets } from './secrets';

/** Dự án không còn file mở quá lâu thì đóng kết nối SQL. */
const IDLE_CLOSE_MS = 10 * 60 * 1000;
const SWEEP_MS = 60 * 1000;

export type SessionState = 'idle' | 'starting' | 'building' | 'ready' | 'error';

export interface SessionEnv {
  context: vscode.ExtensionContext;
  secrets: ProjectSecrets;
  log: Logger;
  onChange: () => void;
}

export class ProjectSession {
  state: SessionState = 'idle';
  error?: string;
  progress?: { done: number; total: number };
  menus: MenuItem[] = [];
  index?: MenuIndex;
  private client?: SqlClient;
  private starting?: Promise<void>;
  private fullIndex = false;
  /** Menu Mobile nạp xong (hoặc lỗi / không có); nút MOBILE chờ cái này, nút FBO không cần. */
  mobileReady: Promise<void> = Promise.resolve();
  private appDbs?: Promise<string[]>;
  private disposed = false;
  /** Lần cuối dự án có file đang được mở / xem. */
  lastUse = Date.now();

  constructor(readonly project: ProjectRecord, private readonly env: SessionEnv) {}

  /** Thư mục Controllers (có "\" cuối) theo loại menu; undefined nếu dự án không có. */
  controllersDir(kind: MenuKind): string | undefined {
    if (kind === 'fbo') {
      const root = webRoot(this.project);
      return root ? root + 'App_Data\\Controllers\\' : undefined;
    }
    const mroot = mobileRoot(this.project);
    return mroot ? mroot + 'App_Data\\Controllers\\Mobile\\' : undefined;
  }

  cacheFile(): string {
    const dir = this.env.context.globalStorageUri.fsPath;
    return path.join(dir, `${this.project.code.replace(/[^\w.-]+/g, '_')}.index.json`);
  }

  findMenu(ref: MenuRef): MenuItem | undefined {
    return this.menus.find((m) => m.kind === ref.kind && m.id === ref.menuId);
  }

  /** Khởi động một lần (nạp menu xong là trả; chỉ mục dựng nền tiếp). */
  start(): Promise<void> {
    if (!this.starting) this.starting = this.doStart();
    return this.starting;
  }

  private async doStart(): Promise<void> {
    const { log } = this.env;
    this.setState('starting');
    try {
      if (this.project.mode === '0') {
        throw new Error('Dự án dùng Windows auth — bản này chưa hỗ trợ.');
      }
      const password = await this.env.secrets.get(this.project.code);
      if (password === undefined) {
        throw new Error('Chưa có mật khẩu dự án — chạy "FSD: Nhập dự án" hoặc "FSD: Đồng bộ dự án".');
      }
      this.client ??= this.makeClient(password);
      const scriptsDir = path.join(this.env.context.extensionPath, 'resources', 'scripts');
      log.info(`[${this.project.code}] bắt đầu nạp menu (${this.project.server} / ${this.project.sysDatabase})`);
      fs.mkdirSync(this.env.context.globalStorageUri.fsPath, { recursive: true });
      this.index = new MenuIndex({
        cacheFile: this.cacheFile(),
        controllersDir: (kind) => this.controllersDir(kind),
        crypto: this.makeCrypto(),
        scanJobs: makeIndexRunner(this.env.context.extensionPath, this.keyFilePath())
      });
      // Đọc cache chỉ mục chạy song song với truy vấn SQL (không phụ thuộc nhau).
      const cacheLoad = this.index.load();
      const fbo = await loadMenus(this.client, 'fbo', scriptsDir);
      this.menus = fbo;
      this.index.setMenus(fbo);
      log.info(`[${this.project.code}] ${fbo.length} menu FBO`);
      await cacheLoad;
      // Menu FBO đã có → panel dùng được ngay (không đọc file nào); menu Mobile nạp nền (nút MOBILE chờ mobileReady).
      this.setState('ready');
      const client = this.client;
      this.mobileReady = (async () => {
        try {
          const mob = await loadMenus(client, 'mob', scriptsDir);
          this.menus = [...fbo, ...mob];
          this.index?.setMenus(this.menus);
          log.info(`[${this.project.code}] ${mob.length} menu Mobile`);
        } catch (e) {
          log.error(`[${this.project.code}] không nạp được menu Mobile`, e);
        }
        this.env.onChange();
      })();
    } catch (e) {
      await this.releaseConnection();
      this.fail(e);
      return;
    }
    // Chỉ mục file đầy đủ không tự dựng: danh sách menu đến từ SQL, file của menu đang chọn dò riêng khi chọn (ensureStructure).
    // Quét cả dự án chỉ chạy khi người dùng bấm "Quét lại" (rebuild).
    if (this.fullIndex) void this.mobileReady.then(() => this.buildIndex());
  }

  private makeClient(password: string): SqlClient {
    return new SqlClient({
      server: this.project.server,
      user: this.project.user,
      password,
      database: this.project.sysDatabase
    });
  }

  private async password(): Promise<string> {
    if (this.project.mode === '0') throw new Error('Dự án dùng Windows auth — bản này chưa hỗ trợ.');
    const password = await this.env.secrets.get(this.project.code);
    if (password === undefined) throw new Error('Chưa có mật khẩu dự án — chạy "FSD: Nhập dự án" hoặc "FSD: Đồng bộ dự án".');
    return password;
  }

  /** Chạy một câu SELECT trên DB Sys của dự án; kết nối đã đóng (nhàn rỗi / đóng dự án) thì mở lại. */
  async select<T = Record<string, unknown>>(sql: string, params?: Record<string, string | number>): Promise<T[]> {
    if (!this.client) this.client = this.makeClient(await this.password());
    return this.client.query<T>(sql, params);
  }

  /**
   * DB App của dự án — như 5.1 / 5.2: script GETLISTDATAAPP chạy trên DB Sys (bảng entity), dòng đầu là DB App mặc định.
   * Đọc một lần cho mỗi phiên (rebuild thì đọc lại).
   */
  appDatabases(): Promise<string[]> {
    if (!this.appDbs) {
      const script = fs.readFileSync(path.join(this.env.context.extensionPath, 'resources', 'scripts', 'GETLISTDATAAPP.sql'), 'utf8');
      const p = (async () => {
        if (!this.client) this.client = this.makeClient(await this.password());
        return loadAppDatabases(this.client, script);
      })();
      p.catch(() => {
        if (this.appDbs === p) this.appDbs = undefined;
      });
      this.appDbs = p;
    }
    return this.appDbs;
  }

  /** Cấu hình kết nối tới một DB của dự án cho Query (đường chạy riêng, không qua SqlClient chỉ-SELECT). */
  async queryConfig(database: string): Promise<SqlConfig> {
    return { server: this.project.server, user: this.project.user, password: await this.password(), database };
  }

  private keyFilePath(): string {
    return resolveKeyFile(vscode.workspace.getConfiguration('fsd').get<string>('fKeyFile', '') || undefined);
  }

  private makeCrypto(): FControllerCrypto | undefined {
    try {
      const configured = vscode.workspace.getConfiguration('fsd').get<string>('fKeyFile', '');
      const keys = FControllerCrypto.loadKeys(resolveKeyFile(configured || undefined));
      return keys.length > 0 ? new FControllerCrypto(keys) : undefined;
    } catch {
      this.env.log.info(`[${this.project.code}] không có file khóa — đọc .xml thay .f khi cần`);
      return undefined;
    }
  }

  private async buildIndex(): Promise<void> {
    const index = this.index;
    if (!index || this.disposed) return;
    this.progress = { done: 0, total: this.menus.length };
    this.setState('building');
    const t0 = Date.now();
    this.env.log.info(`[${this.project.code}] bắt đầu dựng chỉ mục (${this.menus.length} menu)`);
    try {
      await vscode.window.withProgress(
        { location: { viewId: 'fsd.menu' } },
        async (_progress, token) => {
          let last = 0;
          let lastNotify = 0;
          await index.build(
            this.menus,
            (done, total) => {
              this.progress = { done, total };
              // Báo đổi tối đa ~3 lần / giây: mỗi lần báo kéo theo vẽ lại panel, CodeLens, thanh trạng thái.
              const now = Date.now();
              if (done !== total && now - lastNotify < 350) return;
              lastNotify = now;
              if (done % 100 === 0) this.env.log.info(`[${this.project.code}] chỉ mục ${done}/${total} sau ${((Date.now() - t0) / 1000).toFixed(1)} s`);
              last = done;
              this.env.onChange();
            },
            token
          );
          await index.save();
        }
      );
      this.progress = undefined;
      this.env.log.info(`[${this.project.code}] xong chỉ mục: ${index.sysIdCount} sysId, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      this.setState('ready');
    } catch (e) {
      this.progress = undefined;
      this.fail(e);
    }
  }

  /** Xóa chỉ mục cũ và dựng lại từ đầu (kết nối lại luôn). */
  async rebuild(): Promise<void> {
    await this.close();
    try {
      fs.unlinkSync(this.cacheFile());
    } catch {
      /* chưa có cache */
    }
    this.disposed = false;
    this.fullIndex = true;
    this.starting = undefined;
    this.mobileReady = Promise.resolve();
    this.menus = [];
    this.index = undefined;
    this.appDbs = undefined;
    this.error = undefined;
    await this.start();
  }

  /** Đóng kết nối SQL (menu và chỉ mục đã nạp vẫn dùng được); phiên không bị hủy. */
  async releaseConnection(): Promise<void> {
    const c = this.client;
    this.client = undefined;
    if (!c) return;
    try {
      await c.close();
    } catch {
      /* bỏ qua */
    }
  }

  get hasConnection(): boolean {
    return this.client !== undefined;
  }

  async close(): Promise<void> {
    this.disposed = true;
    try {
      await this.client?.close();
    } catch {
      /* bỏ qua */
    }
    this.client = undefined;
  }

  private fail(e: unknown): void {
    this.error = e instanceof Error ? e.message : String(e);
    this.env.log.error(`[${this.project.code}] lỗi`, e);
    this.setState('error');
  }

  private setState(s: SessionState): void {
    this.state = s;
    this.env.onChange();
  }
}

export class SessionManager {
  private readonly sessions = new Map<string, ProjectSession>();
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private sweepTimer?: NodeJS.Timeout;

  constructor(private readonly base: Omit<SessionEnv, 'onChange'>) {}

  get(project: ProjectRecord): ProjectSession {
    let s = this.sessions.get(project.code);
    if (!s) {
      s = new ProjectSession(project, { ...this.base, onChange: () => this.emitter.fire() });
      this.sessions.set(project.code, s);
    }
    return s;
  }

  /** Bỏ phiên của các dự án có mã này (thông tin kết nối / đường dẫn đổi → lần xem sau tạo phiên mới). */
  async drop(codes: string[]): Promise<void> {
    const gone: ProjectSession[] = [];
    for (const code of codes) {
      const s = this.sessions.get(code);
      if (s) {
        gone.push(s);
        this.sessions.delete(code);
      }
    }
    await Promise.all(gone.map((s) => s.close()));
    if (gone.length > 0) this.emitter.fire();
  }

  /**
   * Mỗi phút: dự án còn file mở thì ghi nhận đang dùng; không còn file mở quá 10 phút thì đóng kết nối SQL
   * (kết nối chỉ cần lúc nạp menu; chỉ mục đã dựng vẫn giữ).
   */
  startIdleSweep(isInUse: (project: ProjectRecord) => boolean): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      const now = Date.now();
      for (const s of this.sessions.values()) {
        if (isInUse(s.project)) s.lastUse = now;
        else if (s.hasConnection && now - s.lastUse > IDLE_CLOSE_MS && s.state !== 'starting') {
          void s.releaseConnection();
        }
      }
    }, SWEEP_MS);
  }

  /** Bỏ mọi phiên (sau khi nhập lại dự án). */
  async reset(): Promise<void> {
    const all = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(all.map((s) => s.close()));
    this.emitter.fire();
  }

  dispose(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
    void this.reset();
    this.emitter.dispose();
  }
}
