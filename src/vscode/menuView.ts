// Panel MENU (fsd.menu) dạng WebviewView: hàng tiện ích, trạng thái rỗng, thẻ menu đang chọn, danh sách file / store / bảng.
// Giao diện ở web/js/menu/main.js + web/css/menu.css; ở đây chỉ dựng dữ liệu (ViewModel) gửi sang theo diff và nhận thao tác từ webview.
// Đầu view (mã + tên dự án, nút ⇄ ⟳ ⋯) do VS Code vẽ: view.title / view.description + view/title trong package.json.
import * as vscode from 'vscode';
import { fileTypeOf, type FileType } from '../core/fileType';
import { mobileRoot, webRoot } from '../core/projects/projectStore';
import { buildTree, isOpenableMenu } from '../core/sql/menuRepo';
import type { MenuFile, MenuItem, MenuKind, MenuNode, MenuRef } from '../core/types';
import type { ActiveContext } from './activeContext';
import type { App } from './app';
import { confirmClearRecent, dirSlash } from './commands';
import type { Logger } from './log';
import { openObjectScript, openSelectTable } from './screens/openScreens';
import { getScreenHost } from './screens/screenHost';
import { groupLabel, relativeTime, roleGroups, shortName } from './util';
import { menuHtml } from './webviewHtml';

/** Lệnh webview được phép gọi trực tiếp. */
const ALLOWED_COMMANDS = new Set([
  'fsd.changeProject',
  'fsd.openQuery',
  'fsd.selectTable',
  'fsd.openMultiSearch',
  'fsd.openUpdateScript',
  'fsd.openWebConfig',
  'fsd.openControllers',
  'fsd.pickSqlObject',
  'fsd.importProjects',
  'fsd.syncProjects',
  'fsd.rebuildIndex',
  'fsd.closeProject',
  'fsd.enterKey',
  'fsd.copyMachineCode'
]);

/** Thao tác của thẻ / dòng menu (fsd.menuAction). */
const ALLOWED_ACTIONS = new Set(['openAll', 'web1', 'web2', 'ai', 'script']);

/** Nút để sẵn trên thẻ menu (setting fsd.menuButtons), theo thứ tự mặc định. search / update = Multi Search / Update Script điền sẵn menu (webview gửi menuTool). */
const BUTTON_IDS = ['openAll', 'web2', 'search', 'update', 'script'];
/** Nút được phép khai trong setting (ngoài mặc định còn "ai"). */
const BUTTON_CHOICES = [...BUTTON_IDS, 'ai'];
/** Hai nút theo menu luôn hiện trên thẻ (không tắt được bằng setting). */
const BUTTON_REQUIRED = ['search', 'update'];
const QUICK_MAX = 8;
const RECENT_FILE_MS = 7 * 24 * 3600 * 1000;
const RECENT_PROJECTS_MAX = 5;

interface FileVM {
  path: string;
  name: string;
  /** Loại file hiển thị ở cuối dòng ('' = icon chung). */
  ft: FileType | '';
  time: string;
  open: boolean;
  stale: boolean;
  missing: boolean;
  tip: string;
}

interface GroupVM {
  key: string;
  label: string;
  collapsed: boolean;
  files?: FileVM[];
  leaves?: string[];
}

interface RefLite {
  kind: MenuKind;
  id: string;
  bar: string;
}

interface CardVM extends RefLite {
  sysId: string;
  trail: string;
  pinned: boolean;
  also: RefLite[];
  /** Giá trị để bấm-là-copy trên thẻ ('' = không có → webview ẩn chip). */
  aspx: string;
  fullPath: string;
  srcDir: string;
  progPath: string;
}

interface QuickRowVM extends RefLite {
  pinned: boolean;
}

/** Lý do file nằm trong menu (MenuFile.via). */
const viaLabels: Record<MenuFile['via'], string> = {
  root: 'menu trỏ thẳng tới file này',
  grid: 'Grid của controller',
  lookup: 'Lookup được khai báo',
  showForm: 'mở bằng showForm',
  import: 'Import của controller',
  reportFile: 'file báo cáo',
  templateFile: 'mẫu in',
  include: 'Include dùng chung'
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const kindOf = (v: unknown): MenuKind => (v === 'mob' ? 'mob' : 'fbo');

export class MenuViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private app?: App;
  private ctx?: ActiveContext;
  private lockedCode?: string;
  private timer?: NodeJS.Timeout;
  private readonly loadingStructures = new Set<string>();
  private trailCache?: { menus: MenuItem[]; kind: MenuKind; trails: Map<string, string> };
  /** JSON từng khóa của ViewModel lần gửi trước — chỉ gửi khóa đổi (webview vẽ lại đúng vùng đó). */
  private lastSent = new Map<string, string>();

  constructor(private readonly extensionUri: vscode.Uri, private readonly log: Logger) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.lastSent.clear();
    const webRoot = vscode.Uri.joinPath(this.extensionUri, 'web');
    view.webview.options = { enableScripts: true, localResourceRoots: [webRoot] };
    view.webview.html = menuHtml(view.webview, webRoot);
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
    this.ctx = undefined;
    this.refresh();
  }

  setApp(app: App): void {
    this.lockedCode = undefined;
    this.app = app;
    this.ctx = app.ctx;
    this.refresh();
  }

  /** Làm mới panel (gộp các lần gọi dồn dập trong 50 ms). */
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

  /* ===== Dựng dữ liệu gửi sang webview ===== */

  /** Đầu view: mã dự án + tên khi đang xem một dự án, không thì về "Menu". */
  private setHeader(code?: string, name?: string): void {
    const v = this.view;
    if (!v) return;
    const title = code || 'Menu';
    if (v.title !== title) v.title = title;
    if (v.description !== (code ? name : undefined)) v.description = code ? name : undefined;
    if (code) {
      const ms = this.ctx?.takePerf('project');
      if (ms !== undefined) this.log.info(`[perf] mở dự án ${code} → đầu view: ${ms} ms`);
    }
  }

  private buttons(): string[] {
    const cfg = vscode.workspace.getConfiguration('fsd').get<unknown>('menuButtons');
    if (!Array.isArray(cfg)) return BUTTON_IDS;
    const seen = new Set<string>();
    const list = cfg.filter((b): b is string => typeof b === 'string' && BUTTON_CHOICES.includes(b) && !seen.has(b) && !!seen.add(b));
    // Setting cũ (trước khi có search / update) không được làm mất hai nút này.
    for (const id of BUTTON_REQUIRED) if (!seen.has(id)) list.push(id);
    return list;
  }

  private render(): void {
    if (!this.view) return;
    const t0 = Date.now();
    const vm = this.buildVM();
    const changed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(vm)) {
      const json = JSON.stringify(v ?? null);
      if (this.lastSent.get(k) === json) continue;
      this.lastSent.set(k, json);
      changed[k] = v ?? null;
    }
    this.sendTree();
    if (Object.keys(changed).length > 0) this.post({ t: 'patch', d: changed });
    const ms = Date.now() - t0;
    if (ms > 30) this.log.info(`[perf] dựng dữ liệu panel ${ms} ms (${Object.keys(changed).join(',')})`);
  }

  private buildVM(): Record<string, unknown> {
    const vm: Record<string, unknown> = {
      mode: 'locked',
      machineCode: this.lockedCode ?? '',
      noProjects: false,
      loading: false,
      recents: [],
      project: null,
      kind: 'fbo',
      hasMobile: false,
      hosts: { h1: false, h2: false },
      buttons: this.buttons(),
      scan: null,
      screens: [],
      pinIds: [],
      err: null,
      sel: null,
      groups: null,
      quick: null
    };
    const ctx = this.ctx;
    if (this.lockedCode !== undefined || !ctx) {
      this.setHeader();
      return vm;
    }
    const st = ctx.state;
    const session = st.session;
    if (!st.project || !session) {
      this.setHeader();
      vm.mode = 'projects';
      // Chưa nạp xong danh sách dự án: chỉ hiện thanh tiến độ, không báo "chưa có dự án".
      vm.loading = !ctx.projectsLoaded() && ctx.projects().length === 0;
      vm.noProjects = !vm.loading && ctx.projects().length === 0;
      vm.recents = ctx
        .recentProjectCodes()
        .slice(0, RECENT_PROJECTS_MAX)
        .map((c) => ctx.projects().find((p) => p.code === c))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => ({ code: p.code, name: p.name }));
      return vm;
    }

    this.setHeader(st.project.code, st.project.name);
    const kind = st.kind;
    vm.mode = 'project';
    vm.project = { code: st.project.code, name: st.project.name };
    vm.kind = kind;
    vm.hasMobile = session.menus.some((m) => m.kind === 'mob');
    vm.screens = this.screensOf(st.project.code);
    vm.pinIds = ctx.pins();
    vm.hosts = { h1: st.project.webHost1.trim() !== '', h2: st.project.webHost2.trim() !== '' };
    if (session.state === 'error') vm.err = (session.error ?? 'Không đọc được menu.').slice(0, 400);
    else if (session.state === 'building' && session.progress) vm.scan = { done: session.progress.done, total: session.progress.total };
    else if (session.state === 'idle' || session.state === 'starting') vm.scan = { done: 0, total: 0 };

    if (st.selected && st.selected.kind === kind) {
      const { card, groups } = this.selectedVM(st.selected, this.trailsOf(session.menus, kind));
      vm.sel = card;
      vm.groups = groups;
      if (!groups.loading) {
        const ms = ctx.takePerf('menu');
        if (ms !== undefined) this.log.info(`[perf] chọn menu ${card.id} → danh sách file: ${ms} ms`);
      }
    } else if (session.menus.length > 0) {
      vm.quick = this.quickVM(session.menus);
    }
    return vm;
  }

  private treeKey = '';

  /** Cây menu của loại đang xem, gửi một lần mỗi khi danh sách menu hoặc loại đổi (không nằm trong các mảnh patch vì lớn). */
  private sendTree(): void {
    const st = this.ctx?.state;
    const session = st?.session;
    if (!st?.project || !session || session.menus.length === 0) return;
    const key = `${st.project.code}|${st.kind}|${session.menus.length}|${session.menus[0]?.id}`;
    if (key === this.treeKey) return;
    this.treeKey = key;
    const nodes: Array<Record<string, unknown>> = [];
    const walk = (list: MenuNode[], parent: string): void => {
      for (const n of list) {
        nodes.push({ id: n.id, p: parent, b: n.bar, s: n.sysId, l: n.link, o: isOpenableMenu(n) ? 1 : 0, n: n.children?.length ?? 0 });
        if (n.children?.length) walk(n.children, n.id);
      }
    };
    walk(buildTree(session.menus.filter((m) => m.kind === st.kind)), '');
    this.post({ t: 'tree', kind: st.kind, nodes });
  }

  /** Tab Query / Select Table đang mở của dự án (cho dải "Đang mở" của panel). */
  private screensOf(code: string): { id: string; screen: string; title: string; active: boolean }[] {
    try {
      return getScreenHost().list(code);
    } catch {
      return []; // chưa có key / màn chưa sẵn sàng
    }
  }

  /** Ghim + Gần đây (tối đa 8 mỗi nhóm) cho trạng thái chưa chọn menu; chỉ giữ menu còn trong danh sách. */
  private quickVM(menus: MenuItem[]): { pins: QuickRowVM[]; recents: QuickRowVM[] } {
    const ctx = this.ctx!;
    const byKey = new Map(menus.filter(isOpenableMenu).map((m) => [`${m.kind}:${m.id}`, m]));
    const rows = (keys: string[], skip?: Set<string>): QuickRowVM[] => {
      const out: QuickRowVM[] = [];
      for (const k of keys) {
        const m = byKey.get(k);
        if (!m || skip?.has(k)) continue;
        out.push({ kind: m.kind, id: m.id, bar: m.bar, pinned: ctx.isPinned({ kind: m.kind, menuId: m.id }) });
        if (out.length >= QUICK_MAX) break;
      }
      return out;
    };
    const pinKeys = ctx.pins();
    return { pins: rows(pinKeys), recents: rows(ctx.recentMenus(), new Set(pinKeys)) };
  }

  /** Đường nhánh tới cha của từng menu ("Bán hàng › Chứng từ"), cache theo mảng menu. */
  private trailsOf(menus: MenuItem[], kind: MenuKind): Map<string, string> {
    const c = this.trailCache;
    if (c && c.menus === menus && c.kind === kind) return c.trails;
    const trails = new Map<string, string>();
    const walk = (list: MenuNode[], trail: string[]): void => {
      for (const n of list) {
        trails.set(n.id, trail.join(' › '));
        if (n.children?.length) walk(n.children, [...trail, n.bar]);
      }
    };
    walk(buildTree(menus.filter((m) => m.kind === kind)), []);
    this.trailCache = { menus, kind, trails };
    return trails;
  }

  private selectedVM(ref: MenuRef, trails: Map<string, string>): { card: CardVM; groups: { loading: boolean; list: GroupVM[] } } {
    const ctx = this.ctx!;
    const session = ctx.state.session!;
    const sys = ref.sysId.toLowerCase();
    const also = session.menus
      .filter((m) => m.kind === ref.kind && m.id !== ref.menuId && m.sysId.toLowerCase() === sys && isOpenableMenu(m))
      .map((m) => ({ kind: m.kind, id: m.id, bar: m.bar }));
    const p = session.project;
    const mob = ref.kind === 'mob';
    const trail = trails.get(ref.menuId) ?? '';
    const card: CardVM = {
      kind: ref.kind,
      id: ref.menuId,
      bar: ref.bar,
      sysId: ref.sysId,
      trail,
      pinned: ctx.isPinned(ref),
      also,
      aspx: session.findMenu(ref)?.link ?? '',
      // Đường dẫn menu đầy đủ "Bán hàng\Chứng từ\Hóa đơn" (trail dùng " › " để hiển thị).
      fullPath: [...(trail ? trail.split(' › ') : []), ref.bar].join('\\'),
      srcDir: mob ? mobileRoot(p) : webRoot(p),
      progPath: mob ? mobileRoot(p) : dirSlash(p.webProgramDir) || webRoot(p)
    };
    const groups: { loading: boolean; list: GroupVM[] } = { loading: false, list: [] };
    const index = session.index;
    if (!index) {
      groups.loading = true;
      return { card, groups };
    }
    const skey = `${ref.kind}:${ref.sysId}`;
    const res = index.structureOf(ref.kind, ref.sysId);
    if (!res) {
      groups.loading = true;
      if (!this.loadingStructures.has(skey)) {
        this.loadingStructures.add(skey);
        index
          .ensureStructure(ref.kind, ref.sysId)
          .catch((e) => {
            this.log.error(`Dò file của menu ${ref.menuId} lỗi`, e);
          })
          .finally(() => {
            this.loadingStructures.delete(skey);
            this.refresh();
          });
      }
      return { card, groups };
    }
    for (const g of roleGroups) {
      const files = res.files.filter((f) => g.roles.includes(f.role));
      if (files.length) groups.list.push({ key: g.key, label: groupLabel(g, ref.kind), collapsed: g.collapsed, files: files.map((f) => this.fileVM(f)) });
    }
    if (res.stores.length) groups.list.push({ key: 'store', label: 'Store', collapsed: true, leaves: res.stores });
    if (res.tables.length) groups.list.push({ key: 'table', label: 'Bảng', collapsed: true, leaves: res.tables });
    return { card, groups };
  }

  private fileVM(f: MenuFile): FileVM {
    const mtime = f.fMtime ?? f.xmlMtime;
    const times = [f.fMtime ? `.f sửa ${formatTime(f.fMtime)}` : '', f.xmlMtime ? `.xml sửa ${formatTime(f.xmlMtime)}` : ''].filter(Boolean);
    return {
      path: f.path,
      name: shortName(f.name),
      ft: fileTypeOf(f),
      // Chỉ file sửa trong 7 ngày mới hiện tuổi ở cuối dòng (đầy đủ trong tooltip).
      time: mtime && Date.now() - mtime < RECENT_FILE_MS ? relativeTime(mtime) : '',
      open: !f.missing && !!this.ctx?.isOpen(f.path),
      stale: f.staleF,
      missing: f.missing,
      tip: [f.path, times.join(' · ') || 'không có file', `Vào menu vì: ${viaLabels[f.via] ?? f.via}`, 'Bấm: mở · Ctrl+bấm: copy đường dẫn'].join('\n')
    };
  }

  /* ===== Thao tác từ webview ===== */

  /** Menu theo kind + id của webview (không tin dữ liệu webview: phải có trong danh sách menu của dự án). */
  private menuOf(m: Record<string, unknown>): MenuItem | undefined {
    return this.ctx?.state.session?.menus.find((x) => x.kind === kindOf(m.kind) && x.id === text(m.id));
  }

  private async onMessage(m: Record<string, unknown>): Promise<void> {
    const ctx = this.ctx;
    switch (m.t) {
      case 'ready':
        this.lastSent.clear();
        this.treeKey = '';
        this.render();
        return;
      case 'setKind': {
        const kind = kindOf(m.kind);
        if (kind === 'mob') await this.ctx?.state.session?.mobileReady;
        if (kind === 'mob' && !this.ctx?.state.session?.menus.some((x) => x.kind === 'mob')) return;
        this.ctx?.setKind(kind);
        return;
      }
      case 'perf':
        this.log.info(`[perf] panel vẽ lại chậm: ${text(m.what)} ${Number(m.ms) || 0} ms`);
        return;
      case 'cmd': {
        const id = text(m.id);
        if (ALLOWED_COMMANDS.has(id)) await vscode.commands.executeCommand(id);
        return;
      }
    }
    if (!ctx) return;
    try {
      await this.onProjectMessage(ctx, m);
    } catch (e) {
      this.log.error(`Thao tác panel "${text(m.t)}" lỗi`, e);
    }
  }

  private async onProjectMessage(ctx: ActiveContext, m: Record<string, unknown>): Promise<void> {
    switch (m.t) {
      case 'pickProject': {
        const p = ctx.projects().find((x) => x.code === text(m.code));
        if (p) ctx.selectProject(p);
        return;
      }
      case 'findMenu': {
        // Hai nút FBO / MOBILE: mở QuickPick tìm menu của loại đó.
        const kind = kindOf(m.kind);
        if (kind === 'mob' && !ctx.state.session?.menus.some((x) => x.kind === 'mob')) return;
        await vscode.commands.executeCommand('fsd.findMenu', kind);
        return;
      }
      case 'selectMenu': {
        // Dòng Ghim / Gần đây / cây menu / "Cũng dùng ở": chỉ chọn menu (thẻ + cây file), KHÔNG mở file.
        const item = this.menuOf(m);
        if (item) ctx.selectMenu({ kind: item.kind, menuId: item.id, sysId: item.sysId, bar: item.bar });
        return;
      }
      case 'clearRecent':
        // Nút thùng rác ở mục Gần đây: menu (dự án đang chọn) hoặc dự án.
        await confirmClearRecent(ctx, m.scope === 'projects' ? 'projects' : 'menus');
        return;
      case 'removeRecent': {
        // Nút ✕ / chuột phải "Xóa khỏi gần đây" trên một dòng.
        if (m.what === 'project') ctx.removeRecentProject(text(m.code));
        else {
          const item = this.menuOf(m);
          if (item) ctx.removeRecentMenu({ kind: item.kind, menuId: item.id });
        }
        return;
      }
      case 'prefetch': {
        // Rê chuột lên một dòng menu: dò sẵn file của menu đó để bấm vào là có ngay (không làm mới panel).
        const item = this.menuOf(m);
        const index = ctx.state.session?.index;
        if (!item || !index || !item.sysId) return;
        const skey = `${item.kind}:${item.sysId}`;
        if (index.structureOf(item.kind, item.sysId) || this.loadingStructures.has(skey)) return;
        this.loadingStructures.add(skey);
        index
          .ensureStructure(item.kind, item.sysId)
          .catch(() => undefined)
          .finally(() => {
            this.loadingStructures.delete(skey);
            this.refresh(); // nếu đã bấm vào menu này trong lúc dò thì hiện ngay
          });
        return;
      }
      case 'togglePin': {
        const item = this.menuOf(m);
        if (item) ctx.togglePin({ kind: item.kind, menuId: item.id });
        return;
      }
      case 'deselect':
        ctx.deselectMenu();
        return;
      case 'screenFocus':
        if (text(m.id)) getScreenHost().reveal(text(m.id));
        return;
      case 'screenClose':
        if (text(m.id)) getScreenHost().close(text(m.id));
        return;
      case 'open': {
        const p = text(m.path);
        if (p) await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(p));
        return;
      }
      case 'openSide': {
        // Chuột phải dòng file: mở ở cột bên cạnh.
        const p = text(m.path);
        if (p) await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(p), { viewColumn: vscode.ViewColumn.Beside, preview: false });
        return;
      }
      case 'reveal': {
        // Chuột phải dòng file: mở thư mục chứa trong Explorer của hệ điều hành.
        const p = text(m.path);
        if (p) await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(p));
        return;
      }
      case 'copy': {
        // what = tên giá trị vừa copy ("tên menu", "aspx"…) để báo ở thanh trạng thái.
        const t = text(m.text);
        if (t) {
          await vscode.env.clipboard.writeText(t);
          const what = text(m.what).replace(/[^\p{L}\p{N} ]/gu, '').slice(0, 40);
          vscode.window.setStatusBarMessage(`$(check) Đã copy${what ? ' ' + what : ''}`, 2000);
        }
        return;
      }
      case 'action': {
        const a = text(m.action);
        if (!ALLOWED_ACTIONS.has(a)) return;
        // Có id = dòng menu khác (Ghim / Gần đây); không có = menu đang chọn.
        const item = m.id !== undefined ? this.menuOf(m) : undefined;
        if (m.id !== undefined && !item) return;
        const ref: MenuRef | undefined = item ? { kind: item.kind, menuId: item.id, sysId: item.sysId, bar: item.bar } : undefined;
        await vscode.commands.executeCommand('fsd.menuAction', a, ref);
        return;
      }
      case 'menuTool': {
        // Mở màn khác theo menu: sửa menu / Update Script / Multi Search. Có id = dòng menu khác; không có = menu đang chọn.
        const sel = ctx.state.selected;
        const item = m.id !== undefined ? this.menuOf(m) : sel ? ctx.state.session?.findMenu(sel) : undefined;
        if (!item) return;
        const menu = { kind: item.kind, id: item.id, t: item.bar, sys: item.sysId, type: item.type, link: item.link };
        const tool = text(m.tool);
        if (tool === 'edit') await vscode.commands.executeCommand('fsd.openMenuEdit', { kind: item.kind, id: item.id, t: item.bar, link: item.link });
        else if (tool === 'update') await vscode.commands.executeCommand('fsd.openUpdateScript', { menu });
        else if (tool === 'search') await vscode.commands.executeCommand('fsd.openMultiSearch', { menu });
        return;
      }
      case 'addToPackage': {
        // Store / Bảng của menu → Update (cùng lệnh upd.addObject của panel Đối tượng SQL; store = P, bảng = U, DB App).
        const project = ctx.state.project;
        const name = text(m.name);
        if (!project || !name) return;
        const r = await getScreenHost().call(project, 'upd.addObject', { name, type: m.leaf === 'store' ? 'P' : 'U', db: '' });
        const msg = String((r as { message?: string } | undefined)?.message ?? '');
        if (msg) void vscode.window.showWarningMessage(msg);
        else vscode.window.setStatusBarMessage(`$(check) Đã thêm ${name} vào Update`, 3000);
        return;
      }
      case 'openStore':
      case 'openTable': {
        const project = ctx.state.project;
        const name = text(m.name);
        if (!project || !this.app || !name) return;
        const ctrl = m.ctrl === true;
        if (m.t === 'openStore' || ctrl) await openObjectScript(this.app, project, name, ctrl);
        else await openSelectTable(this.app, project, { table: name });
        return;
      }
    }
  }
}
