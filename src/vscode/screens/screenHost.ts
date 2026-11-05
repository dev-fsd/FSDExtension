// Tab màn webview (Query, Select Table…): mỗi màn một WebviewPanel trong vùng editor, trang web/screen.html nạp web/js/screens/<màn>.js.
// Tin nhắn: webview gửi { id, cmd, args } → CommandRegistry.dispatch → trả { id, ok, result | error }; sự kiện đẩy { event, data }.
import * as vscode from 'vscode';
import type { ProjectRecord } from '../../core/types';
import type { App } from '../app';
import type { CommandRegistry } from '../bridge/registry';
import type { CallCtx } from '../bridge/types';
import { screenHtml } from '../webviewHtml';

export const SCREEN_VIEW_TYPE = 'fsd.screen';

const TITLES: Record<string, string> = {
  query: 'Query', 'select-table': 'Select Table', 'update-script': 'Update', 'multi-search': 'Multi Search', 'menu-edit': 'Sửa menu', _demo: 'Demo'
};

/** Lệnh không dùng phiên SQL: chạy ngay, không chờ phiên của dự án nạp xong. */
const NO_SESSION = new Set([
  'ui.toast', 'clipboard.set', 'setting.get', 'setting.set', 'screen.setTitle', 'project.databases', 'file.open', 'file.save', 'file.pick',
  'file.readDropped', 'file.openInEditor', 'memory.add', 'memory.get',
  // Multi Search (quét đĩa), thao tác file / thư mục dùng chung.
  'search.roots', 'search.run', 'search.cancel', 'file.read', 'file.openIde', 'file.reveal',
  'ms.save', 'ms.openIde', 'ms.openDefault', 'ms.copyFiles', 'ms.checkVoucher',
  'folder.pick', 'shell.explore', 'shell.copyFile', 'shell.deleteStructApp', 'shell.openVoucher', 'menu.files',
  // Tab Update / Multi Search ⇄ view "Cây màn" ở sidebar.
  'side.send', 'side.get', 'side.focus'
]);

/** Trạng thái webview tự lưu bằng vscode.setState (screen.js) — VS Code đưa lại cho serializer khi mở lại IDE. */
interface PersistedState {
  screen?: string;
  project?: { code?: string };
  opts?: Record<string, unknown>;
  saved?: unknown;
}

interface ScreenPanel {
  id: string;
  panel: vscode.WebviewPanel;
  screen: string;
  projectCode: string;
  /** Bản ghi dự án lúc mở, dùng khi dự án biến khỏi danh sách. */
  fallback: ProjectRecord;
  disposed: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class ScreenHost implements vscode.Disposable {
  private readonly panels = new Map<string, ScreenPanel>();
  private readonly closed = new vscode.EventEmitter<string>();
  /** Bắn khi một tab màn đóng (tham số = panelId) — service hủy việc đang chạy của tab đó (vd query.cancel). */
  readonly onDidClosePanel = this.closed.event;
  private readonly listChanged = new vscode.EventEmitter<void>();
  /** Bắn khi danh sách tab màn đổi (mở / đóng / đổi tên / đổi tab đang xem) — panel MENU vẽ lại dải tab. */
  readonly onDidChangeList = this.listChanged.event;
  private readonly webRoot: vscode.Uri;
  private seq = 0;
  /** Tab màn được focus gần nhất (panel SQL Objects ở sidebar lấy làm "tab đang mở" khi focus đã rời tab). */
  private lastActiveId = '';
  /** Lần cuối mỗi tab được focus / tạo (số tăng dần) — view "Cây màn" gửi lệnh tới tab mới nhất của một màn. */
  private readonly stamp = new Map<string, number>();
  private clock = 0;

  constructor(private readonly app: App, private readonly registry: CommandRegistry) {
    this.webRoot = vscode.Uri.joinPath(app.context.extensionUri, 'web');
  }

  private options(): vscode.WebviewOptions {
    return { enableScripts: true, localResourceRoots: [this.webRoot] };
  }

  private newId(): string {
    return `p${Date.now().toString(36)}${(++this.seq).toString(36)}`;
  }

  private titleFor(screen: string, project: ProjectRecord): string {
    return `${TITLES[screen] ?? screen} · ${project.code}`;
  }

  /** Mở tab màn mới (ViewColumn hiện tại); trả panelId. */
  open(screen: string, project: ProjectRecord, opts: Record<string, unknown> = {}): string {
    const id = this.newId();
    const panel = vscode.window.createWebviewPanel(SCREEN_VIEW_TYPE, this.titleFor(screen, project), vscode.ViewColumn.Active, {
      ...this.options(),
      retainContextWhenHidden: true
    });
    this.attach(id, panel, screen, project, opts, undefined);
    return id;
  }

  /** Khôi phục tab sau khi mở lại IDE (WebviewPanelSerializer). */
  async revive(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
    const s = (state ?? {}) as PersistedState;
    const code = s.project?.code;
    if (typeof s.screen !== 'string' || !code) {
      panel.dispose();
      return;
    }
    panel.webview.options = this.options();
    const id = this.newId();
    const project = await this.waitProject(code);
    if (!project) {
      this.attachError(id, panel, `Dự án ${code} không còn trong danh sách — đóng tab này.`);
      return;
    }
    this.attach(id, panel, s.screen, project, s.opts ?? {}, s.saved);
  }

  /** Danh sách dự án nạp nền sau khi bật extension: chờ tới 15 giây. */
  private async waitProject(code: string): Promise<ProjectRecord | undefined> {
    for (let i = 0; i < 150; i++) {
      const p = this.app.registry.projects().find((x) => x.code === code);
      if (p) return p;
      await sleep(100);
    }
    return undefined;
  }

  private projectInfo(project: ProjectRecord): Record<string, string> {
    // db (DB App mặc định) để trống: screen.js hỏi project.databases ngay khi mở.
    return { code: project.code, name: project.name, db: '', sysDb: project.sysDatabase, kind: project.menuType || '2' };
  }

  private attach(id: string, panel: vscode.WebviewPanel, screen: string, project: ProjectRecord, opts: Record<string, unknown>, saved: unknown): void {
    const sp: ScreenPanel = { id, panel, screen, projectCode: project.code, fallback: project, disposed: false };
    this.panels.set(id, sp);
    this.stamp.set(id, ++this.clock);
    if (panel.active) this.lastActiveId = id;
    const subs: vscode.Disposable[] = [
      panel.onDidChangeViewState(() => {
        if (panel.active) {
          this.lastActiveId = id;
          this.stamp.set(id, ++this.clock);
        }
        this.listChanged.fire();
      })
    ];
    this.listChanged.fire();
    subs.push(panel.webview.onDidReceiveMessage((m: unknown) => void this.onMessage(sp, m)));
    panel.onDidDispose(() => {
      sp.disposed = true;
      subs.forEach((d) => d.dispose());
      this.panels.delete(id);
      this.stamp.delete(id);
      this.closed.fire(id);
      this.listChanged.fire();
    });
    panel.webview.html = screenHtml(panel.webview, this.webRoot, panel.title, {
      panelId: id,
      screen,
      opts,
      project: this.projectInfo(project),
      saved
    });
    // Làm nóng phiên SQL của dự án trong lúc trang nạp.
    void this.app.sessions.get(project).start().catch(() => undefined);
  }

  private attachError(id: string, panel: vscode.WebviewPanel, message: string): void {
    const sp: ScreenPanel = { id, panel, screen: '', projectCode: '', fallback: undefined as unknown as ProjectRecord, disposed: false };
    panel.onDidDispose(() => {
      sp.disposed = true;
    });
    panel.webview.html = screenHtml(panel.webview, this.webRoot, panel.title, { error: message });
  }

  private projectOf(sp: ScreenPanel): ProjectRecord {
    return this.app.registry.projects().find((p) => p.code === sp.projectCode) ?? sp.fallback;
  }

  private post(sp: ScreenPanel, msg: unknown): void {
    if (sp.disposed) return;
    try {
      void Promise.resolve(sp.panel.webview.postMessage(msg)).catch(() => undefined);
    } catch {
      /* panel vừa đóng */
    }
  }

  private async onMessage(sp: ScreenPanel, m: unknown): Promise<void> {
    const msg = m as { id?: number; cmd?: unknown; args?: Record<string, any> } | undefined;
    if (!msg || typeof msg.cmd !== 'string') return;
    const cmd = msg.cmd;
    const project = this.projectOf(sp);
    const session = this.app.sessions.get(project);
    if (!NO_SESSION.has(cmd)) {
      try {
        await session.start();
      } catch (e) {
        this.app.log.error(`[${project.code}] khởi động phiên cho lệnh ${cmd} lỗi`, e);
      }
    }
    const ctx: CallCtx = {
      project,
      session,
      panelId: sp.id,
      emit: (event, data) => this.post(sp, { event, data })
    };
    const r = await this.registry.dispatch(cmd, msg.args, ctx);
    this.post(sp, { id: msg.id, ...r });
  }

  /** Đặt tên tab (ctx.setTitle của màn). */
  setTitle(panelId: string, title: string): void {
    const sp = this.panels.get(panelId);
    if (!sp || sp.disposed || !title) return;
    sp.panel.title = `${title} · ${sp.projectCode}`;
    this.listChanged.fire();
  }

  /** Các tab màn đang mở (Query / Select Table…) của một dự án, theo thứ tự mở. */
  list(projectCode: string): { id: string; screen: string; title: string; active: boolean }[] {
    const out: { id: string; screen: string; title: string; active: boolean }[] = [];
    for (const sp of this.panels.values()) {
      if (sp.disposed || !sp.screen || sp.projectCode !== projectCode) continue;
      out.push({ id: sp.id, screen: sp.screen, title: sp.panel.title.replace(` · ${sp.projectCode}`, ''), active: sp.panel.active });
    }
    return out;
  }

  /** Tab màn được focus gần nhất của dự án, còn đang hiện trên màn hình (không thì undefined). */
  focused(projectCode: string): { id: string; screen: string } | undefined {
    const sp = this.panels.get(this.lastActiveId);
    if (!sp || sp.disposed || !sp.screen || sp.projectCode !== projectCode || !sp.panel.visible) return undefined;
    return { id: sp.id, screen: sp.screen };
  }

  /** Tab mới được focus nhất của một màn trong dự án (kể cả đang bị tab khác che); không có thì undefined. */
  latest(projectCode: string, screen: string): { id: string; screen: string } | undefined {
    let best: ScreenPanel | undefined;
    for (const sp of this.panels.values()) {
      if (sp.disposed || sp.screen !== screen || sp.projectCode !== projectCode) continue;
      if (!best || (this.stamp.get(sp.id) ?? 0) > (this.stamp.get(best.id) ?? 0)) best = sp;
    }
    return best ? { id: best.id, screen: best.screen } : undefined;
  }

  /** Đẩy một sự kiện tới mọi tab của một màn trong dự án (vd upd.changed khi thêm vào Update từ sidebar). Trả số tab nhận. */
  broadcast(projectCode: string, screen: string, event: string, data: unknown): number {
    let n = 0;
    for (const sp of this.panels.values()) {
      if (sp.disposed || sp.screen !== screen || sp.projectCode !== projectCode) continue;
      this.post(sp, { event, data });
      n++;
    }
    return n;
  }

  /** Gọi một lệnh bridge như một tab của dự án gọi (panel ở sidebar dùng chung dịch vụ với tab màn). Lỗi → ném Error. */
  async call(project: ProjectRecord, cmd: string, args: Record<string, any> = {}): Promise<unknown> {
    const session = this.app.sessions.get(project);
    if (!NO_SESSION.has(cmd)) await session.start();
    // Không có tab gọi nên không có nơi nhận sự kiện: riêng upd.changed (đổi danh sách Update) báo cho các tab Update của dự án.
    const emit = (event: string, data: unknown): void => {
      if (event === 'upd.changed') this.broadcast(project.code, 'update-script', event, data);
    };
    const ctx: CallCtx = { project, session, panelId: '', emit };
    const r = await this.registry.dispatch(cmd, args, ctx);
    if (!r.ok) throw new Error(r.error);
    return r.result;
  }

  close(panelId: string): void {
    this.panels.get(panelId)?.panel.dispose();
  }

  /** Đẩy sự kiện về một tab (vd db.changed). */
  emit(panelId: string, event: string, data: unknown): void {
    const sp = this.panels.get(panelId);
    if (sp) this.post(sp, { event, data });
  }

  /** Đưa tab lên trước; preserveFocus = true giữ focus ở nơi gọi (sidebar) để phím mũi tên vẫn đi tiếp trong cây. */
  reveal(panelId: string, preserveFocus = false): void {
    this.panels.get(panelId)?.panel.reveal(undefined, preserveFocus);
  }

  dispose(): void {
    for (const sp of [...this.panels.values()]) sp.panel.dispose();
    this.panels.clear();
    this.closed.dispose();
    this.listChanged.dispose();
  }
}

let current: ScreenHost | undefined;

export function setScreenHost(host: ScreenHost | undefined): void {
  current = host;
}

export function getScreenHost(): ScreenHost {
  if (!current) throw new Error('Màn chưa sẵn sàng (cần key hợp lệ).');
  return current;
}

/** Mở tab màn 'query' | 'select-table' (hoặc tên file trong web/js/screens) cho một dự án. Trả panelId. */
export function openScreen(screen: 'query' | 'select-table' | (string & {}), project: ProjectRecord, opts: Record<string, unknown> = {}): string {
  return getScreenHost().open(screen, project, opts);
}
