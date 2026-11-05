// FSD Menu — điểm vào. Không có key hợp lệ thì không nạp dự án / SQL / chỉ mục / CodeLens.
import * as vscode from 'vscode';
import { checkLicense, defaultKeyFiles } from '../core/license/license';
import { matchProjectByPath } from '../core/projects/projectStore';
import { ActiveContext } from './activeContext';
import type { App } from './app';
import { MenuCodeLensProvider } from './codeLens';
import { buildHandlers, type Handler } from './commands';
import { FileBadgeProvider } from './fileBadge';
import { Logger } from './log';
import { MenuViewProvider } from './menuView';
import { SideTreeViewProvider } from './sideTreeView';
import { ProjectRegistry, studioDir } from './projects';
import { SessionManager } from './projectSession';
import { setupScreens } from './screens/setup';
import { ProjectSecrets } from './secrets';
import { MenuStatusBar } from './statusBar';

const KEY_STATE = 'fsd.key';
const commandIds = [
  'fsd.findMenu',
  'fsd.openAllOfMenu',
  'fsd.copyAiContext',
  'fsd.importProjects',
  'fsd.syncProjects',
  'fsd.rebuildIndex',
  'fsd.focusMenuOfFile',
  'fsd.menuAction',
  'fsd.changeProject',
  'fsd.closeProject',
  'fsd.openMenu',
  'fsd.clearRecent',
  'fsd.openQuery',
  'fsd.selectTable',
  'fsd.openUpdateScript',
  'fsd.openMultiSearch',
  'fsd.openMenuEdit',
  'fsd.openWebConfig',
  'fsd.openControllers',
  'fsd.pickSqlObject',
  'fsd.viewMemory',
  'fsd.basketView',
  'fsd.basketCopy',
  'fsd.basketClear'
];

let app: App | undefined;
let sideTree: SideTreeViewProvider | undefined;
let handlers: Record<string, Handler> = {};
let appSubs: vscode.Disposable[] = [];
let machineCode = '';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = new Logger();
  const view = new MenuViewProvider(context.extensionUri, log);
  sideTree = new SideTreeViewProvider(context.extensionUri, log);
  context.subscriptions.push(
    sideTree,
    vscode.window.registerWebviewViewProvider('fsd.screenTree', sideTree, { webviewOptions: { retainContextWhenHidden: true } }),
    { dispose: () => log.dispose() },
    vscode.window.registerWebviewViewProvider('fsd.menu', view, { webviewOptions: { retainContextWhenHidden: true } })
  );

  // Lệnh đăng ký một lần; chưa có key thì mọi lệnh (trừ nhập key) yêu cầu nhập key.
  for (const id of commandIds) {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, (...args: unknown[]) => {
        if (!app || !handlers[id]) {
          void vscode.commands.executeCommand('fsd.enterKey');
          return undefined;
        }
        return handlers[id](...args);
      })
    );
  }

  const start = (): void => startApp(context, log, view);

  /** Kiểm key theo thứ tự: setting fsd.licenseKey → file key FSD Studio; đồng thời ghi mã máy vào fsd.machineId. */
  const verify = async (): Promise<boolean> => {
    const cfg = vscode.workspace.getConfiguration('fsd');
    const lic = await checkLicense(cfg.get<string>('licenseKey')?.trim() || undefined, defaultKeyFiles(studioDir()));
    machineCode = lic.machineCode;
    if (lic.machineCode && cfg.get<string>('machineId') !== lic.machineCode) {
      try {
        await cfg.update('machineId', lic.machineCode, vscode.ConfigurationTarget.Global);
      } catch (e) {
        log.error('Ghi fsd.machineId lỗi', e);
      }
    }
    if (lic.ok) {
      if (!app) start();
      return true;
    }
    if (!app) {
      view.setLocked(lic.machineCode);
      sideTree?.setLocked(lic.machineCode);
    }
    return false;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('fsd.enterKey', () => vscode.commands.executeCommand('workbench.action.openSettings', 'fsd.licenseKey')),
    vscode.commands.registerCommand('fsd.copyMachineCode', async () => {
      await vscode.env.clipboard.writeText(machineCode);
      vscode.window.setStatusBarMessage('$(check) Đã copy mã máy', 3000);
    }),
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (!e.affectsConfiguration('fsd.licenseKey')) return;
      const had = !!app;
      const ok = await verify();
      if (!ok && !had) vscode.window.setStatusBarMessage('$(error) Key không hợp lệ', 4000);
    })
  );

  // Key cũ lưu trong globalState: chuyển một lần sang setting rồi xóa.
  const oldKey = context.globalState.get<string>(KEY_STATE);
  if (oldKey) {
    try {
      if (!vscode.workspace.getConfiguration('fsd').get<string>('licenseKey')) {
        await vscode.workspace.getConfiguration('fsd').update('licenseKey', oldKey, vscode.ConfigurationTarget.Global);
      }
    } catch (e) {
      log.error('Chuyển key cũ sang setting lỗi', e);
    }
    await context.globalState.update(KEY_STATE, undefined);
  }

  await verify();
}

/** Context key cho when-clause của view/title: hiện nút ⇄ ⟳ ⋯ chỉ khi đã có key; ⟳ / Đóng dự án chỉ khi đang mở dự án. */
function setKey(key: string, value: boolean): void {
  void vscode.commands.executeCommand('setContext', key, value);
}

function startApp(context: vscode.ExtensionContext, log: Logger, view: MenuViewProvider): void {
  if (app) return;
  const startedAt = Date.now();
  const secrets = new ProjectSecrets(context.secrets);
  const registry = new ProjectRegistry(context, secrets, log);
  const sessions = new SessionManager({ context, secrets, log });
  const ctx = new ActiveContext(registry, sessions, log, context.globalState, context.workspaceState);
  setKey('fsd.licensed', true);
  let hadProject: boolean | undefined;
  const a: App = { context, log, registry, sessions, ctx, view };
  app = a;
  handlers = buildHandlers(a);

  const lens = new MenuCodeLensProvider(a);
  const status = new MenuStatusBar(ctx);
  appSubs = [
    ctx,
    status,
    new FileBadgeProvider(ctx),
    setupScreens(a),
    registry,
    { dispose: () => sessions.dispose() },
    vscode.languages.registerCodeLensProvider({ scheme: 'file', pattern: '**/*.{xml,f}' }, lens),
    ctx.onDidChange(() => {
      const has = !!ctx.state.project;
      if (has !== hadProject) {
        hadProject = has;
        setKey('fsd.hasProject', has);
      }
      view.refresh();
      sideTree?.refresh();
    }),
    sessions.onDidChange(() => view.refresh()),
    // Folder workspace đổi: cập nhật danh sách dự án của workspace; chưa chọn dự án thì mở luôn dự án khớp.
    vscode.workspace.onDidChangeWorkspaceFolders(() => ctx.openWorkspaceProject()),
    // Danh sách dự án đổi (config.db / đồng bộ): bỏ phiên của dự án đổi thông tin để lần xem sau kết nối lại.
    registry.onDidChangeProjects((codes) => {
      log.info(`Danh sách dự án đổi (${registry.projects().length} dự án, ${codes.length} đổi thông tin)`);
      void sessions
        .drop(codes)
        .catch((e) => log.error('Bỏ phiên dự án lỗi', e))
        .then(() => ctx.refresh());
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('fsd.codeLens')) lens.refresh();
      if (e.affectsConfiguration('fsd.statusBar')) status.render();
      if (e.affectsConfiguration('fsd.menuButtons')) view.refresh();
      if (e.affectsConfiguration('fsd.configDbPath') || e.affectsConfiguration('fsd.studioDir')) void registry.checkConfigDb(true);
    }),
    // Chỉ dò lại khi lưu file; đổi tab chỉ tra chỉ mục (không quét share).
    vscode.workspace.onDidSaveTextDocument((doc) => void invalidate(a, doc.uri.fsPath))
  ];
  sessions.startIdleSweep((project) => ctx.isInUse(project));
  context.subscriptions.push({
    dispose: () => {
      appSubs.forEach((d) => d.dispose());
      appSubs = [];
      app = undefined;
      setKey('fsd.licensed', false);
      setKey('fsd.hasProject', false);
    }
  });

  view.setApp(a);
  sideTree?.setApp(a);
  // Thứ tự mở dự án (BA mục 4): folder workspace khớp → file đang xem → dự án cuối của workspace này → chưa chọn.
  // Chạy ngay sau khi nạp danh sách dự án (projects.json), không chờ SQL / chỉ mục.
  void registry
    .load()
    .catch((e) => log.error('Nạp danh sách dự án lỗi', e))
    .then(() => {
      ctx.openWorkspaceProject(startedAt);
      ctx.update();
      ctx.restoreLastProject();
      view.refresh();
      // Việc nền (nhập config.db khi rỗng / bổ sung host), sau đó mới theo dõi config.db.
      return registry
        .completeLoad()
        .catch((e) => log.error('Hoàn tất nạp danh sách dự án lỗi', e))
        .then(() => {
          ctx.openWorkspaceProject(startedAt);
          ctx.update();
          ctx.restoreLastProject();
          view.refresh();
          registry.startWatch();
        });
    });
}

/** File vừa lưu: dò lại menu liên quan rồi làm mới view. */
async function invalidate(a: App, filePath: string): Promise<void> {
  const match = matchProjectByPath(a.registry.projects(), filePath);
  if (!match) return;
  const session = a.sessions.get(match.project);
  if (!session.index) return;
  try {
    await session.index.invalidateFile(filePath);
  } catch (e) {
    a.log.error('Dò lại menu của file lỗi', e);
  }
  a.ctx.recompute();
}

export function deactivate(): void {
  appSubs.forEach((d) => d.dispose());
  appSubs = [];
  app = undefined;
}
