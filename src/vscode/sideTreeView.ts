// View "Cây màn" (fsd.screenTree) ở sidebar trái, cùng khu với cây menu hệ thống: hiện phần "trái" của màn đang focus —
// Update Script (Đối tượng SQL · File · Dữ liệu khai báo) hoặc Multi Search (File · Dữ liệu khai báo) — của dự án đang mở.
// Giao diện ở web/js/sidebar/*.js + web/css/sidebar.css; ở đây chỉ: chọn màn để hiện (src/core/side/sideMode.ts), chuyển lệnh dữ liệu sang
// dịch vụ upd.* / ms.* qua ScreenHost.call (cùng đường với tab màn), và chuyển sự kiện giữa view ⇄ tab màn.
// Trạng thái tick / danh sách Update vẫn nằm ở host (lệnh upd.*) và ở tab; view không giữ bản sao.
//
// Giao thức webview ⇄ extension giống tab màn: webview gửi { id, cmd, args } (bridge.js), extension trả { id, ok, result | error }
// và đẩy { event, data }. Lệnh `side.*` do view này xử lý; lệnh khác phải nằm trong SIDE_CALLS rồi chuyển cho registry.
import * as vscode from 'vscode';
import { isSideScreen, pickSideScreen, SIDE_CALLS, SIDE_COMMANDS, SIDE_OPS, type SideScreen } from '../core/side/sideMode';
import type { App } from './app';
import type { Logger } from './log';
import { getScreenHost, type ScreenHost } from './screens/screenHost';
import { setSideSink, sideShare } from './services/sideService';
import { sidebarHtml } from './sidebarHtml';

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** Trả ScreenHost nếu đã có (sau khi bật extension có key), không thì undefined. */
function tryHost(): ScreenHost | undefined {
  try {
    return getScreenHost();
  } catch {
    return undefined;
  }
}

export class SideTreeViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private app?: App;
  private lockedCode?: string;
  private timer?: NodeJS.Timeout;
  private lastState = '';
  private hostSub?: vscode.Disposable;
  private subscribedTo?: ScreenHost;
  /** Màn người dùng bấm nút chuyển nhanh (giữ tới khi tab được focus đổi). */
  private forced: SideScreen | '' = '';
  /** Màn cuối đã hiện cây (giữ khi focus sang tab khác như Query). */
  private last: SideScreen | '' = '';
  private lastFocusId = '';

  constructor(private readonly extensionUri: vscode.Uri, private readonly log: Logger) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.lastState = '';
    const webRoot = vscode.Uri.joinPath(this.extensionUri, 'web');
    view.webview.options = { enableScripts: true, localResourceRoots: [webRoot] };
    view.webview.html = sidebarHtml(view.webview, webRoot);
    view.webview.onDidReceiveMessage((m: unknown) => void this.onMessage(obj(m)));
    view.onDidChangeVisibility(() => {
      if (view.visible) this.render();
    });
    view.onDidDispose(() => {
      if (this.view === view) {
        this.view = undefined;
        setSideSink(undefined);
      }
    });
    // Tin từ tab màn gửi sang view này (vd menu mở kèm tab, Check Voucher).
    setSideSink((project, screen, event, data) => {
      if (!this.view || this.app?.ctx.state.project?.code !== project) return false;
      this.post({ event: 'side.fromTab', data: { screen, event, data } });
      return true;
    });
  }

  /** Chưa có key hợp lệ: view chỉ hiện hướng dẫn nhập key. */
  setLocked(machineCode: string): void {
    this.lockedCode = machineCode;
    this.app = undefined;
    this.refresh();
  }

  setApp(app: App): void {
    this.lockedCode = undefined;
    this.app = app;
    this.watchHost();
    this.refresh();
  }

  /** Danh sách tab đổi (mở / đóng / đổi tab đang xem) → chọn lại màn để hiện. */
  private watchHost(): void {
    const host = tryHost();
    if (!host || host === this.subscribedTo) return;
    this.hostSub?.dispose();
    this.subscribedTo = host;
    this.hostSub = host.onDidChangeList(() => this.refresh());
  }

  dispose(): void {
    this.hostSub?.dispose();
    if (this.timer) clearTimeout(this.timer);
  }

  /** Dự án / tab đang mở đổi → báo webview (gộp các lần gọi dồn dập trong 50 ms). */
  refresh(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.render();
    }, 50);
  }

  private post(msg: unknown): void {
    void this.view?.webview.postMessage(msg);
  }

  private render(): void {
    if (!this.view) return;
    this.watchHost();
    const project = this.app?.ctx.state.project;
    let st: Record<string, unknown>;
    if (this.lockedCode !== undefined || !this.app) {
      st = { mode: 'locked', machineCode: this.lockedCode ?? '', project: null, screen: '', tabs: {} };
    } else if (!project) {
      st = { mode: 'projects', machineCode: '', project: null, screen: '', tabs: {} };
    } else {
      const host = tryHost();
      const tabs = host ? host.list(project.code) : [];
      const f = host?.focused(project.code);
      const fid = f?.id ?? '';
      // Focus sang tab khác → bỏ lựa chọn thủ công của nút chuyển nhanh.
      if (fid !== this.lastFocusId) {
        this.lastFocusId = fid;
        if (fid) this.forced = '';
      }
      const pick = pickSideScreen({ focusedScreen: f?.screen, tabScreens: tabs.map((t) => t.screen), last: this.last, forced: this.forced });
      if (pick.fromFocus && pick.screen) this.last = pick.screen;
      const count = (s: string): number => tabs.filter((t) => t.screen === s).length;
      st = {
        mode: 'project',
        machineCode: '',
        project: { code: project.code, name: project.name, sysDb: project.sysDatabase, kind: project.menuType || '2' },
        screen: pick.screen,
        tabs: { 'update-script': count('update-script'), 'multi-search': count('multi-search') }
      };
    }
    const json = JSON.stringify(st);
    if (json !== this.lastState) {
      this.lastState = json;
      this.post({ event: 'side.state', data: st });
    }
    // Tin chờ từ tab (menu mở kèm tab lúc view chưa mở / đang ở dự án khác).
    if (project && this.app) {
      for (const h of sideShare.take(project.code)) this.post({ event: 'side.fromTab', data: { screen: h.screen, event: h.event, data: h.data } });
    }
  }

  /* ===== Thao tác từ webview ===== */

  private async onMessage(m: Record<string, unknown>): Promise<void> {
    const id = m.id;
    const cmd = text(m.cmd);
    if (!cmd) return;
    try {
      const result = await this.dispatch(cmd, obj(m.args));
      this.post({ id, ok: true, result });
    } catch (e) {
      if (!SIDE_OPS.has(cmd)) this.log.error(`Lệnh view Cây màn "${cmd}" lỗi`, e);
      this.post({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  private async dispatch(cmd: string, args: Record<string, unknown>): Promise<unknown> {
    const project = this.app?.ctx.state.project;
    if (cmd === 'side.ready') {
      this.lastState = '';
      this.render();
      return null;
    }
    if (cmd === 'side.cmd') {
      const id = text(args.id);
      if (SIDE_COMMANDS.has(id)) await vscode.commands.executeCommand(id, args.arg);
      return null;
    }
    if (!project) throw new Error('Chưa mở dự án.');
    const host = getScreenHost();
    switch (cmd) {
      case 'side.mode': {
        const screen = text(args.screen);
        this.forced = isSideScreen(screen) ? screen : '';
        this.render();
        return null;
      }
      case 'side.toTab': {
        // Gửi sự kiện tới tab mới nhất của màn; chưa có tab: mở tab (kèm opts) nếu view yêu cầu.
        const screen = text(args.screen);
        if (!isSideScreen(screen)) throw new Error(`Màn không hợp lệ: ${screen}`);
        const tab = host.latest(project.code, screen);
        if (tab) {
          host.emit(tab.id, text(args.event), args.data);
          if (args.reveal === true) host.reveal(tab.id, true);
          return { delivered: true };
        }
        if (args.open && typeof args.open === 'object') {
          host.open(screen, project, args.open as Record<string, unknown>);
          return { delivered: false, opened: true };
        }
        return { delivered: false, opened: false };
      }
      case 'side.share': {
        const screen = text(args.screen);
        if (!isSideScreen(screen)) throw new Error(`Màn không hợp lệ: ${screen}`);
        const program = text(args.program);
        const mode = text(args.mode);
        sideShare.setProgram(project.code, screen, program, mode);
        host.broadcast(project.code, screen, 'side.program', { program, mode });
        return null;
      }
      case 'side.openScreen': {
        // Mở tab: hai màn của view này, hoặc Query / Select Table để xem mã / bảng của đối tượng SQL (view không dùng Monaco).
        const screen = text(args.screen);
        if (!isSideScreen(screen) && screen !== 'query' && screen !== 'select-table') throw new Error(`Màn không hợp lệ: ${screen}`);
        host.open(screen, project, obj(args.opts));
        return null;
      }
    }
    if (!SIDE_CALLS.has(cmd)) throw new Error(`Lệnh không được phép: ${cmd}`);
    return host.call(project, cmd, args);
  }
}
