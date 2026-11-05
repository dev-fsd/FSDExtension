// Các lệnh của extension (đăng ký ở extension.ts; chỉ chạy khi có key hợp lệ).
import * as fs from 'fs';
import * as vscode from 'vscode';
import { buildAiContext } from '../core/aiContext';
import { buildRowScript } from '../core/menuScript';
import { mobileRoot, webRoot } from '../core/projects/projectStore';
import { buildTree, groupMenusByBranch, isOpenableMenu } from '../core/sql/menuRepo';
import type { MenuItem, MenuKind, MenuRef, ProjectRecord } from '../core/types';
import type { ActiveContext } from './activeContext';
import type { App } from './app';
import type { ProjectSession } from './projectSession';
import { buildScreenCommandHandlers } from './screens/openScreens';
import { pickSqlObject } from './sqlPicker';
import { normText, refKey } from './util';

export type Handler = (...args: any[]) => unknown;

function isRef(v: unknown): v is MenuRef {
  const r = v as Partial<MenuRef> | undefined;
  return !!r && typeof r === 'object' && typeof r.menuId === 'string' && (r.kind === 'fbo' || r.kind === 'mob');
}

/** item = menu; clear = mục "Xóa danh sách gần đây". */
type FindPick = vscode.QuickPickItem & { item?: MenuItem; clear?: boolean };

/** Hộp xác nhận modal rồi xóa Gần đây (menu của dự án đang chọn và/hoặc dự án). Ghim không bị xóa. */
export async function confirmClearRecent(ctx: ActiveContext, scope: 'menus' | 'projects' | 'all'): Promise<boolean> {
  const what = scope === 'menus' ? 'menu' : scope === 'projects' ? 'dự án' : 'menu và dự án';
  const pick = await vscode.window.showWarningMessage(`Xóa toàn bộ danh sách ${what} gần đây? (Menu đã ghim được giữ lại.)`, { modal: true }, 'Xóa');
  if (pick !== 'Xóa') return false;
  if (scope !== 'projects') ctx.clearRecentMenus();
  if (scope !== 'menus') ctx.clearRecentProjects();
  return true;
}

/** Nút cuối dòng trong QuickPick tìm menu. */
const WEB_BTN: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('globe'), tooltip: 'Mở web host 2' };
const PIN_BTN: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('pin'), tooltip: 'Ghim menu' };
const PINNED_BTN: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('pinned'), tooltip: 'Bỏ ghim' };

/** Danh sách QuickPick dựng sẵn cho một loại menu (giữ trong bộ nhớ tới khi chỉ mục / danh sách menu đổi) để bấm FBO / MOBILE ra ngay. */
interface FindCache {
  /** Lần này dùng lại danh sách dựng sẵn. */
  hit: boolean;
  /** Chữ để tìm theo mã menu (chữ thường): buildTree sao chép menu nên không khóa theo đối tượng được. */
  hay: Map<string, string>;
  row(m: MenuItem, alwaysShow: boolean, pinned?: boolean): FindPick;
  /** Cả danh sách theo khối nhánh, chưa lọc. */
  all(): FindPick[];
  /** Danh sách theo khối nhánh, chỉ menu thỏa keep. */
  build(keep?: (m: MenuItem) => boolean): FindPick[];
}
const findCaches = new WeakMap<MenuItem[], Partial<Record<MenuKind, Omit<FindCache, 'hit'>>>>();

function findCacheOf(session: ProjectSession, kind: MenuKind, project: ProjectRecord): FindCache {
  let perKind = findCaches.get(session.menus);
  if (!perKind) {
    perKind = {};
    findCaches.set(session.menus, perKind);
  }
  const cached = perKind[kind];
  if (cached) return { ...cached, hit: true };

  const menus = session.menus.filter((m: MenuItem) => m.kind === kind);
  const groups = groupMenusByBranch(buildTree(menus));
  const icon = kind === 'mob' ? '$(device-mobile)' : '$(list-tree)';
  const webBtns: vscode.QuickInputButton[] = [];
  if (kind === 'fbo' && project.webHost2.trim() !== '') webBtns.push(WEB_BTN);
  const make = (m: MenuItem, alwaysShow: boolean, pinned: boolean): FindPick => ({
    label: `${icon} ${m.bar || m.id}`,
    description: `${m.id} · ${m.sysId}`,
    alwaysShow,
    item: m,
    buttons: [...webBtns, pinned ? PINNED_BTN : PIN_BTN]
  });
  const rows = new Map<MenuItem, [FindPick, FindPick]>();
  const row = (m: MenuItem, alwaysShow: boolean, pinned = false): FindPick => {
    if (pinned) return make(m, alwaysShow, true);
    let pair = rows.get(m);
    if (!pair) {
      pair = [make(m, false, false), make(m, true, false)];
      rows.set(m, pair);
    }
    return pair[alwaysShow ? 1 : 0];
  };
  const build = (keep?: (m: MenuItem) => boolean): FindPick[] => {
    const out: FindPick[] = [];
    for (const g of groups) {
      const items = keep ? g.items.filter(keep) : g.items;
      if (items.length === 0) continue;
      out.push({ label: g.title, kind: vscode.QuickPickItemKind.Separator });
      for (const m of items) out.push(row(m, !!keep));
    }
    return out;
  };
  let allList: FindPick[] | undefined;
  const entry = {
    hay: new Map(menus.map((m) => [m.id.toLowerCase(), normText(`${m.bar} ${m.id} ${m.sysId}`)] as [string, string])),
    row,
    all: () => (allList ??= build()),
    build
  };
  perKind[kind] = entry;
  return { ...entry, hit: false };
}

/** Thêm "\" cuối cho đường dẫn thư mục. */
export const dirSlash = (p: string): string => (p !== '' && !/[\\/]$/.test(p) ? p + '\\' : p);

export function buildHandlers(app: App): Record<string, Handler> {
  /** Menu mục tiêu: menu truyền vào (CodeLens, thẻ menu) hoặc menu đang chọn trong panel. */
  function target(arg?: unknown): { session: ProjectSession; ref: MenuRef } | undefined {
    const session = app.ctx.state.session;
    const ref = isRef(arg) ? arg : app.ctx.state.selected;
    if (!session || !ref) {
      void vscode.window.showInformationMessage('Chọn một menu trong panel MENU trước.');
      return undefined;
    }
    return { session, ref };
  }

  /** Chọn dự án bằng QuickPick (mở gần đây xếp đầu, tìm được theo mã hoặc tên). Chưa có dự án nào → tự nhập từ config.db. */
  async function chooseProject(): Promise<ProjectRecord | undefined> {
    if (app.registry.projects().length === 0) {
      await app.registry.importFromConfigDb(true);
      app.ctx.refresh();
    }
    const all = app.registry.projects();
    if (all.length === 0) return undefined;
    const cur = app.ctx.state.project;
    type Pick = vscode.QuickPickItem & { project?: ProjectRecord };
    const row = (p: ProjectRecord): Pick => ({ label: p.code, description: p.name, project: p });
    const find = (codes: string[]): ProjectRecord[] => codes.map((c) => all.find((p) => p.code === c)).filter((p): p is ProjectRecord => !!p);
    // Dự án của folder workspace đứng đầu, rồi gần đây, rồi tất cả (mỗi dự án chỉ xuất hiện một lần).
    const workspaceList = find(app.ctx.workspaceProjectCodes());
    const recentList = find(app.ctx.recentProjectCodes()).filter((p) => !workspaceList.includes(p));
    const shown = new Set([...workspaceList, ...recentList].map((p) => p.code));
    const rest = all.filter((p) => !shown.has(p.code));
    const section = (title: string, list: ProjectRecord[]): Pick[] =>
      list.length ? [{ label: title, kind: vscode.QuickPickItemKind.Separator }, ...list.map(row)] : [];
    const items: Pick[] =
      workspaceList.length || recentList.length
        ? [...section('Workspace này', workspaceList), ...section('Gần đây', recentList), ...section('Tất cả', rest)]
        : rest.map(row);
    const pick =
      all.length === 1
        ? { project: all[0] }
        : await vscode.window.showQuickPick(items, { title: 'Chọn dự án', placeHolder: 'Mã hoặc tên dự án', matchOnDescription: true });
    if (!pick?.project) return undefined;
    if (pick.project.code !== cur?.code) app.ctx.selectProject(pick.project);
    return pick.project;
  }

  /** Dự án đang chọn; chưa có thì hỏi. */
  async function ensureProject(): Promise<ProjectRecord | undefined> {
    return app.ctx.state.project ?? chooseProject();
  }

  async function readySession(project: ProjectRecord): Promise<ProjectSession | undefined> {
    const s = app.sessions.get(project);
    await s.start();
    if (s.state === 'error') {
      app.log.notifyError(s.error ?? 'Không đọc được menu.');
      return undefined;
    }
    return s;
  }

  async function structure(session: ProjectSession, ref: Pick<MenuRef, 'kind' | 'sysId'>) {
    const index = session.index;
    if (!index) return undefined;
    return index.structureOf(ref.kind, ref.sysId) ?? (await index.ensureStructure(ref.kind, ref.sysId));
  }

  const done = (text: string, ms = 3000): void => void vscode.window.setStatusBarMessage(`$(check) ${text}`, ms);
  const warn = (text: string): void => void vscode.window.showWarningMessage(text);

  async function openAll(t: { session: ProjectSession; ref: MenuRef }): Promise<void> {
    const roles = vscode.workspace.getConfiguration('fsd').get<string[]>('openAllRoles', ['dir', 'grid', 'filter']);
    const res = await structure(t.session, t.ref);
    if (!res) return;
    const files = res.files.filter((f) => !f.missing && roles.includes(f.role));
    for (const f of files) {
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(f.path));
        await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
      } catch (e) {
        app.log.error(`Không mở được ${f.path}`, e);
      }
    }
    if (files.length === 0) void vscode.window.showInformationMessage('Menu không có file thuộc các loại trong fsd.openAllRoles.');
  }

  async function copyAi(t: { session: ProjectSession; ref: MenuRef }): Promise<void> {
    const res = await structure(t.session, t.ref);
    if (!res) return;
    const text = buildAiContext({ project: t.session.project, ref: t.ref, item: t.session.findMenu(t.ref), structure: res });
    await vscode.env.clipboard.writeText(text);
    done('Đã copy menu cho AI');
  }

  async function browseWeb(t: { session: ProjectSession; ref: MenuRef }, n: 1 | 2): Promise<void> {
    const p = t.session.project;
    const item = t.session.findMenu(t.ref);
    if (t.ref.kind === 'mob') return warn('Menu Mobile không mở bằng trang web.');
    if (!item?.link) return warn('Menu không có link.');
    const host = (n === 1 ? p.webHost1 : p.webHost2).trim();
    if (!host) return warn(`Dự án chưa khai Web host ${n}.`);
    const base = /^[a-z][a-z0-9+.-]*:\/\//i.test(host) ? host : `http://${host}`;
    await vscode.env.openExternal(vscode.Uri.parse(`${base.replace(/\/?$/, '/')}Main/${item.link}?id=${encodeURIComponent(t.ref.menuId)}`));
  }

  async function openFolder(dir: string): Promise<void> {
    if (!dir) return warn('Dự án chưa khai thư mục.');
    try {
      await fs.promises.stat(dir);
    } catch {
      return warn(`Không có thư mục ${dir}`);
    }
    await vscode.env.openExternal(vscode.Uri.file(dir));
  }

  /** Script DELETE + INSERT dòng menu (chỉ SELECT), mở tài liệu SQL mới. */
  async function viewScript(t: { session: ProjectSession; ref: MenuRef }): Promise<void> {
    const table = t.ref.kind === 'mob' ? 'dvcommand' : 'wcommand';
    const rows = await t.session.select(`SELECT * FROM ${table} WHERE wmenu_id = @id`, { id: t.ref.menuId });
    if (rows.length === 0) return warn(`Không thấy dòng ${t.ref.menuId} trong ${table}.`);
    const parts = [buildRowScript(table, 'wmenu_id', rows)];
    if (table === 'wcommand') {
      // Như FSD Studio: FBO kèm dòng bảng command (cùng menu_id).
      const menuId = String(rows[0].menu_id ?? '').trim();
      if (menuId !== '') {
        try {
          const cmd = await t.session.select('SELECT * FROM command WHERE menu_id = @id', { id: menuId });
          if (cmd.length) parts.push(buildRowScript('command', 'menu_id', cmd));
        } catch (e) {
          app.log.error('Đọc bảng command lỗi', e);
        }
      }
    }
    const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: parts.join('\n') + '\n' });
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  /** Thư mục Controllers (hoặc gốc Mobile) của dự án theo loại menu đang xem — việc chung, không cần chọn menu. */
  async function openControllers(project: ProjectRecord, mob: boolean): Promise<void> {
    return openFolder(mob ? mobileRoot(project) : webRoot(project) ? webRoot(project) + 'App_Data\\Controllers\\' : '');
  }

  async function openWebConfig(project: ProjectRecord, mob: boolean): Promise<void> {
    const root = mob ? mobileRoot(project) : dirSlash(project.webProgramDir) || webRoot(project);
    const file = root ? root + 'Web.config' : '';
    if (!file || !fs.existsSync(file)) return warn(`Không thấy Web.config${file ? ': ' + file : ''}`);
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));
  }

  /** Chỉ chọn menu trong panel (thẻ menu + cây file); KHÔNG mở file nào — người dùng tự bấm file / "Mở tất cả". */
  function selectOnly(m: MenuItem): void {
    app.ctx.selectMenu({ kind: m.kind, menuId: m.id, sysId: m.sysId, bar: m.bar });
  }

  async function menuAction(action: string, arg?: unknown): Promise<void> {
    const t = target(arg);
    if (!t) return;
    switch (action) {
      case 'openAll':
        return openAll(t);
      case 'ai':
        return copyAi(t);
      case 'web1':
        return browseWeb(t, 1);
      case 'web2':
        return browseWeb(t, 2);
      case 'script':
        return viewScript(t);
    }
  }

  /** Lệnh chung theo dự án + loại menu đang xem (FBO / Mobile) — nút trong khối Công cụ. */
  async function projectFolderCommand(run: (project: ProjectRecord, mob: boolean) => Promise<void>): Promise<void> {
    const project = await ensureProject();
    if (project) await run(project, app.ctx.state.kind === 'mob');
  }

  return {
    // arg = 'fbo' | 'mob' (hai icon tìm trong panel): chuyển loại rồi tìm trong loại đó; không có arg = loại đang xem.
    'fsd.findMenu': async (arg?: unknown) => {
      const t0 = Date.now();
      const project = await ensureProject();
      if (!project) return;
      const session = await readySession(project);
      if (!session) return;
      // Nút FBO / MOBILE truyền loại; Ctrl+Alt+P theo loại của menu đang chọn (chưa chọn = FBO).
      const kind: MenuKind = arg === 'fbo' || arg === 'mob' ? arg : app.ctx.state.kind;
      if (kind === 'mob') await session.mobileReady;
      const label = kind === 'mob' ? 'Mobile' : 'FBO';
      const menus = session.menus.filter((m: MenuItem) => m.kind === kind);
      if (!menus.some(isOpenableMenu)) return warn(`Dự án ${project.code} không có menu ${label}.`);
      const cache = findCacheOf(session, kind, project);
      /** Ghim + Gần đây đứng đầu khi chưa gõ gì (dựng mới mỗi lần mở / ghim vì đổi theo người dùng). */
      const quick = (): FindPick[] => {
        const byId = new Map(menus.filter(isOpenableMenu).map((m) => [refKey({ kind, menuId: m.id }), m]));
        const of = (keys: string[]): MenuItem[] => keys.map((k) => byId.get(k)).filter((m): m is MenuItem => !!m);
        const pins = of(app.ctx.pins());
        const recents = of(app.ctx.recentMenus()).filter((m) => !pins.includes(m)).slice(0, 5);
        const section = (title: string, list: MenuItem[], pinned: boolean): FindPick[] =>
          list.length ? [{ label: title, kind: vscode.QuickPickItemKind.Separator }, ...list.map((m) => cache.row(m, false, pinned))] : [];
        const clearRow: FindPick[] = recents.length ? [{ label: '$(trash) Xóa danh sách gần đây', alwaysShow: true, clear: true }] : [];
        return [...section('Ghim', pins, true), ...section('Gần đây', recents, false), ...clearRow];
      };
      const itemsFor = (v: string): FindPick[] => {
        const q = normText(v.trim());
        if (q === '') return [...quick(), ...cache.all()];
        if (q.startsWith('#')) return cache.build((m) => m.link.toLowerCase().includes(q.slice(1)));
        const tokens = q.split(/\s+/);
        return cache.build((m) => tokens.every((t) => cache.hay.get(m.id.toLowerCase())?.includes(t)));
      };
      const qp = vscode.window.createQuickPick<FindPick>();
      qp.title = `Menu ${label} · ${project.code}`;
      qp.placeholder = 'Tên (có dấu hay không đều được), mã menu hoặc sysid  (thêm # để tìm theo link)';
      qp.matchOnDescription = true;
      qp.items = itemsFor('');
      qp.onDidChangeValue((v) => {
        qp.items = itemsFor(v);
      });
      // Nút cuối dòng: 🌐 web host 2, 📌 ghim / bỏ ghim (QuickPick không có nhấp đúp). Giữ ô tìm mở để làm tiếp.
      qp.onDidTriggerItemButton(async (e) => {
        const m = e.item.item;
        if (!m) return;
        if (e.button === WEB_BTN) {
          await browseWeb({ session, ref: { kind: m.kind, menuId: m.id, sysId: m.sysId, bar: m.bar } }, 2);
        } else {
          app.ctx.togglePin({ kind: m.kind, menuId: m.id });
          const pinned = app.ctx.isPinned({ kind: m.kind, menuId: m.id });
          vscode.window.setStatusBarMessage(`$(check) ${pinned ? 'Đã ghim' : 'Đã bỏ ghim'} ${m.bar || m.id}`, 2000);
          qp.items = itemsFor(qp.value);
        }
      });
      qp.onDidAccept(async () => {
        const sel = qp.selectedItems[0];
        if (sel?.clear) {
          // Đóng QuickPick rồi hỏi bằng hộp modal.
          qp.hide();
          if (await confirmClearRecent(app.ctx, 'menus')) done('Đã xóa danh sách menu gần đây');
          return;
        }
        qp.hide();
        if (sel?.item) {
          // Chỉ chọn menu (không mở file); mở panel MENU để thấy thẻ menu + cây file.
          selectOnly(sel.item);
          await vscode.commands.executeCommand('fsd.menu.focus');
        }
      });
      qp.onDidHide(() => qp.dispose());
      qp.show();
      app.log.info(`[perf] bấm ${label} → QuickPick: ${Date.now() - t0} ms (${cache.hit ? 'dùng danh sách dựng sẵn' : 'dựng danh sách lần đầu'}, ${menus.length} menu)`);
    },

    // Chọn menu trong panel (KHÔNG mở file). Id lệnh giữ nguyên cho tương thích.
    'fsd.openMenu': (arg?: unknown) => {
      const session = app.ctx.state.session;
      if (!session || !isRef(arg)) return;
      const item = session.findMenu(arg);
      if (item) selectOnly(item);
    },

    // Xóa Gần đây (menu của dự án đang chọn + dự án); Ghim giữ nguyên.
    'fsd.clearRecent': async () => {
      if (await confirmClearRecent(app.ctx, app.ctx.state.project ? 'all' : 'projects')) done('Đã xóa danh sách gần đây');
    },

    'fsd.openAllOfMenu': async (arg?: unknown) => {
      const t = target(arg);
      if (t) await openAll(t);
    },

    'fsd.copyAiContext': async (arg?: unknown) => {
      const t = target(arg);
      if (t) await copyAi(t);
    },

    'fsd.menuAction': (action: string, arg?: unknown) => menuAction(action, arg),

    // Khối Công cụ của panel MENU (việc chung, không cần chọn menu).
    'fsd.openWebConfig': () => projectFolderCommand(openWebConfig),
    'fsd.openControllers': () => projectFolderCommand(openControllers),

    // Nút SQL cạnh FBO / MOBILE: QuickPick đối tượng SQL của DB dự án (sqlPicker.ts).
    'fsd.pickSqlObject': async () => {
      if (await ensureProject()) await pickSqlObject(app);
    },

    // Gộp (cập nhật + thêm, không xóa): dự án chỉ có từ đồng bộ QLYC vẫn giữ.
    'fsd.importProjects': async () => {
      const res = await app.registry.importFromConfigDb(true);
      if (res) app.ctx.refresh();
    },

    'fsd.syncProjects': async () => {
      try {
        const res = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Đồng bộ dự án từ danh sách chuẩn…' },
          () => app.registry.syncStandard()
        );
        if (!res) return;
        done(`Đồng bộ: cập nhật ${res.updated}, thêm ${res.added} dự án`);
        app.ctx.refresh();
      } catch (e) {
        app.log.error('Đồng bộ dự án lỗi', e);
        app.log.notifyError(`Đồng bộ dự án lỗi — ${e instanceof Error ? e.message : String(e)}`);
      }
    },

    'fsd.rebuildIndex': async () => {
      const project = await ensureProject();
      if (!project) return;
      const session = app.sessions.get(project);
      void session.rebuild().then(() => app.ctx.recompute());
      app.ctx.recompute();
    },

    'fsd.changeProject': () => chooseProject(),

    'fsd.closeProject': () => app.ctx.closeProject(),

    // CodeLens truyền menu của file → chọn menu đó trong panel; Ctrl+Alt+M không truyền → theo file đang xem.
    'fsd.focusMenuOfFile': async (arg?: unknown) => {
      if (isRef(arg)) app.ctx.selectMenu(arg);
      else app.ctx.update();
      await vscode.commands.executeCommand('fsd.menu.focus');
    },

    ...buildScreenCommandHandlers(app, { ensureProject })
  };
}
