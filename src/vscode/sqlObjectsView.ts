// Panel "Đối tượng SQL" (fsd.sqlObjects) dạng WebviewView, nằm dưới panel MENU: cây bảng / view / store / function / trigger của DB dự án.
// Giao diện ở web/js/sqlobjects/main.js + web/css/sqlobjects.css (port panels/sql.js của 5.2); ở đây chỉ: lấy dự án đang mở, chuyển lệnh
// dữ liệu sang dịch vụ sql.* / upd.* qua ScreenHost.call (cùng đường với tab màn); mở / nạp tab Query – Select Table ở sqlObjectActions.ts
// (dùng chung với QuickPick sqlPicker.ts).
import * as vscode from 'vscode';
import type { App } from './app';
import type { Logger } from './log';
import { copyScript, customGen, focusedTab, openObject, toast } from './sqlObjectActions';
import { openQuery } from './screens/openScreens';
import { getScreenHost } from './screens/screenHost';
import { sqlObjectsHtml } from './webviewHtml';

/** Lệnh dữ liệu webview được gọi (đọc danh sách / tìm / thêm vào gói); mọi thứ khác phải qua thao tác có tên bên dưới. */
const ALLOWED_CALLS = new Set(['sql.objects', 'sql.objectsModified', 'sql.search', 'project.databases', 'upd.addObject', 'upd.addObjectList']);
/** Lệnh VS Code webview được gọi trực tiếp (trạng thái rỗng / khóa). */
const ALLOWED_COMMANDS = new Set(['fsd.changeProject', 'fsd.enterKey', 'fsd.copyMachineCode']);

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

export class SqlObjectsViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private app?: App;
  private lockedCode?: string;
  private timer?: NodeJS.Timeout;
  private lastState = '';

  constructor(private readonly extensionUri: vscode.Uri, private readonly log: Logger) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.lastState = '';
    const webRoot = vscode.Uri.joinPath(this.extensionUri, 'web');
    view.webview.options = { enableScripts: true, localResourceRoots: [webRoot] };
    view.webview.html = sqlObjectsHtml(view.webview, webRoot);
    view.webview.onDidReceiveMessage((m: Record<string, unknown>) => void this.onMessage(m));
    view.onDidChangeVisibility(() => {
      if (view.visible) this.render();
    });
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
  }

  /** Chưa có key hợp lệ: panel chỉ hiện hướng dẫn nhập key. */
  setLocked(machineCode: string): void {
    this.lockedCode = machineCode;
    this.app = undefined;
    this.refresh();
  }

  setApp(app: App): void {
    this.lockedCode = undefined;
    this.app = app;
    this.refresh();
  }

  /** Dự án đang mở đổi → báo webview (gộp các lần gọi dồn dập trong 50 ms). */
  refresh(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.render();
    }, 50);
  }

  /** Nút ⟳ trên đầu view: webview đọc lại danh sách đối tượng từ server. */
  reload(): void {
    this.post({ t: 'reload' });
  }

  /** Nút ＋ trên đầu view: Query mới theo DB đang chọn trong panel. */
  newQuery(): void {
    this.post({ t: 'newQuery' });
  }

  private post(msg: unknown): void {
    void this.view?.webview.postMessage(msg);
  }

  private render(): void {
    if (!this.view) return;
    const project = this.app?.ctx.state.project;
    const st =
      this.lockedCode !== undefined || !this.app
        ? { mode: 'locked', machineCode: this.lockedCode ?? '', project: null }
        : project
          ? { mode: 'project', machineCode: '', project: { code: project.code, name: project.name, sysDb: project.sysDatabase } }
          : { mode: 'projects', machineCode: '', project: null };
    const json = JSON.stringify(st);
    if (json === this.lastState) return;
    this.lastState = json;
    this.post({ t: 'state', ...st });
  }

  /* ===== Thao tác từ webview ===== */

  private async onMessage(m: Record<string, unknown>): Promise<void> {
    try {
      switch (m.t) {
        case 'ready':
          this.lastState = '';
          this.render();
          return;
        case 'cmd': {
          const id = text(m.id);
          if (ALLOWED_COMMANDS.has(id)) await vscode.commands.executeCommand(id);
          return;
        }
        case 'call':
          await this.onCall(m);
          return;
        case 'open':
          if (this.app) await openObject(this.app, text(m.name), text(m.type), text(m.db), { ctrl: m.ctrl === true });
          return;
        case 'copyScript':
          if (this.app) await copyScript(this.app, text(m.name), text(m.type), text(m.db));
          return;
        case 'customGen':
          if (this.app) await customGen(this.app, text(m.names), text(m.db), m.alter === true);
          return;
        case 'newQuery': {
          const project = this.app?.ctx.state.project;
          if (this.app && project) await openQuery(this.app, project, { db: text(m.db) || undefined });
          return;
        }
        case 'setFind': {
          const f = this.app ? focusedTab(this.app) : undefined;
          if (f?.screen === 'query') getScreenHost().emit(f.id, 'query.setFind', { text: text(m.text) });
          return;
        }
        case 'toast':
          toast(text(m.text), m.warn === true);
          return;
      }
    } catch (e) {
      this.log.error(`Thao tác panel SQL "${text(m.t)}" lỗi`, e);
      toast(e instanceof Error ? e.message : String(e), true);
    }
  }

  private async onCall(m: Record<string, unknown>): Promise<void> {
    const id = m.id;
    const cmd = text(m.cmd);
    const project = this.app?.ctx.state.project;
    if (!ALLOWED_CALLS.has(cmd) || !project) {
      this.post({ t: 'reply', id, ok: false, error: project ? `Lệnh không được phép: ${cmd}` : 'Chưa mở dự án.' });
      return;
    }
    const args = m.args && typeof m.args === 'object' ? (m.args as Record<string, unknown>) : {};
    try {
      this.post({ t: 'reply', id, ok: true, result: await getScreenHost().call(project, cmd, args) });
    } catch (e) {
      this.post({ t: 'reply', id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

}
