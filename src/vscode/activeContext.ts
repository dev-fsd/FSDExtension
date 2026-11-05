// Trạng thái của panel MENU: dự án đang chọn, loại (FBO / Mobile), menu đang chọn, ghim / gần đây,
// và theo dõi file đang mở (đổi tab thì dự án + menu đi theo file).
import * as vscode from 'vscode';
import { pickMenuForFile } from '../core/menuSelect';
import { matchProjectByPath, matchProjectsByWorkspace, mobileRoot, webRoot } from '../core/projects/projectStore';
import type { MenuKind, MenuRef, ProjectMatch, ProjectRecord } from '../core/types';
import type { Logger } from './log';
import type { ProjectRegistry } from './projects';
import type { ProjectSession, SessionManager } from './projectSession';
import { fileKey, refKey, sameRef } from './util';

const KEY_LAST_PROJECT = 'fsd.lastProject';
const KEY_RECENT_PROJECTS = 'fsd.recentProjects';
const MAX_RECENT_PROJECTS = 8;
const MAX_RECENT_MENUS = 10;

export interface ActiveState {
  /** File đang xem thuộc một dự án (giữ lại khi chuyển sang file ngoài dự án). */
  filePath?: string;
  match?: ProjectMatch;
  /** Dự án đang chọn (undefined = chưa chọn). */
  project?: ProjectRecord;
  session?: ProjectSession;
  /** Loại đang xem: FBO hoặc Mobile (chọn bằng hai icon tìm trong panel). */
  kind: MenuKind;
  /** Các menu dùng file đang xem (theo chỉ mục). */
  menus: MenuRef[];
  /** Menu đang chọn của loại đang xem — luôn tối đa một. */
  selected?: MenuRef;
}

export class ActiveContext implements vscode.Disposable {
  state: ActiveState = { kind: 'fbo', menus: [] };
  private openKeys = new Set<string>();
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private readonly subs: vscode.Disposable[] = [];
  /** Khóa "file|dự án" đã ghi log lần trước (tránh ghi lặp khi update() gọi nhiều lần). */
  private lastLogged = '';
  /** File đã quyết định menu đang chọn (chọn tay hoặc theo chỉ mục); đổi file thì quyết định lại. */
  private resolvedFile = '';
  /** File đang xem lúc đóng dự án: mở file khác mới tự chọn lại dự án. */
  private ignoreFile?: string;
  /** Menu đã chọn của loại còn lại (FBO / Mobile): đổi qua lại không mất. Chỉ chứa loại không phải state.kind. */
  private otherKindSelected: Partial<Record<MenuKind, MenuRef>> = {};
  /** Dự án khớp folder workspace (theo thứ tự folder); dự án đầu được mở, các dự án còn lại đưa lên đầu QuickPick đổi dự án. */
  private wsProjects: string[] = [];
  /** Mốc thời gian đo tốc độ ([perf]): lấy một lần bằng takePerf. */
  private readonly perf: Partial<Record<'project' | 'menu', number>> = {};

  constructor(
    private readonly registry: ProjectRegistry,
    private readonly sessions: SessionManager,
    private readonly log: Logger,
    private readonly memo: vscode.Memento,
    /** Bộ nhớ theo workspace: dự án cuối của cửa sổ này. */
    private readonly wsMemo: vscode.Memento
  ) {
    this.subs.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.update()),
      // File không mở được bằng trình soạn thảo văn bản (.f nhị phân, file không tồn tại) không bắn
      // onDidChangeActiveTextEditor — đổi tab đang xem vẫn phải cập nhật.
      vscode.window.tabGroups.onDidChangeTabs((e) => {
        this.collectOpen();
        if (e.changed.some((t) => t.isActive) || e.opened.some((t) => t.isActive)) this.update();
        else this.emitter.fire();
      }),
      sessions.onDidChange(() => this.recompute())
    );
    this.collectOpen();
  }

  /** Số ms từ lúc đặt mốc (mở dự án / chọn menu) tới nay; chỉ trả một lần cho mỗi mốc. */
  takePerf(kind: 'project' | 'menu'): number | undefined {
    const t = this.perf[kind];
    if (t === undefined) return undefined;
    delete this.perf[kind];
    return Date.now() - t;
  }

  hasProjects(): boolean {
    return this.registry.projects().length > 0;
  }

  projectsLoaded(): boolean {
    return this.registry.loaded;
  }

  projects(): ProjectRecord[] {
    return this.registry.projects();
  }

  isOpen(path: string): boolean {
    return this.openKeys.has(fileKey(path));
  }

  /** Dự án có file đang mở trong tab nào không (so theo gốc web / mobile, chỉ so chuỗi — không chạm share). */
  hasOpenFileOf(project: ProjectRecord): boolean {
    const roots = [webRoot(project), mobileRoot(project)].filter((r) => r !== '').map((r) => r.toLowerCase());
    if (roots.length === 0) return false;
    for (const key of this.openKeys) {
      if (roots.some((r) => key.startsWith(r))) return true;
    }
    return false;
  }

  /** Dự án đang dùng: đang chọn hoặc còn file mở (để không đóng kết nối nhàn rỗi). */
  isInUse(project: ProjectRecord): boolean {
    return this.state.project?.code === project.code || this.hasOpenFileOf(project);
  }

  /* ===== Dự án ===== */

  /** Mã dự án mở gần đây (mới nhất trước), chỉ lấy mã còn trong danh sách. */
  recentProjectCodes(): string[] {
    const known = new Set(this.registry.projects().map((p) => p.code));
    return this.memo.get<string[]>(KEY_RECENT_PROJECTS, []).filter((c) => known.has(c));
  }

  /** Xóa toàn bộ danh sách dự án mở gần đây (không đụng Ghim). */
  clearRecentProjects(): void {
    void this.memo.update(KEY_RECENT_PROJECTS, []);
    this.emitter.fire();
  }

  /** Xóa một dự án khỏi danh sách mở gần đây. */
  removeRecentProject(code: string): void {
    void this.memo.update(
      KEY_RECENT_PROJECTS,
      this.memo.get<string[]>(KEY_RECENT_PROJECTS, []).filter((c) => c !== code)
    );
    this.emitter.fire();
  }

  /** Chọn dự án (không cần file đang mở): mở phiên SQL + chỉ mục, nhớ làm dự án cuối. */
  selectProject(project: ProjectRecord, kind: MenuKind = 'fbo', startedAt: number = Date.now()): void {
    this.perf.project = startedAt;
    const session = this.sessions.get(project);
    session.lastUse = Date.now();
    this.ignoreFile = undefined;
    this.state = { ...this.state, project, session, kind, menus: [], selected: undefined };
    this.otherKindSelected = {};
    this.resolvedFile = '';
    const recent = [project.code, ...this.memo.get<string[]>(KEY_RECENT_PROJECTS, []).filter((c) => c !== project.code)];
    void this.memo.update(KEY_RECENT_PROJECTS, recent.slice(0, MAX_RECENT_PROJECTS));
    void this.wsMemo.update(KEY_LAST_PROJECT, project.code);
    session.start().catch((e) => this.log.error(`[${project.code}] khởi động phiên lỗi`, e));
    this.recompute();
  }

  /** Đóng dự án: đóng kết nối SQL, về màn chọn dự án; không đóng tab file. */
  closeProject(): void {
    const session = this.state.session;
    this.ignoreFile = this.state.filePath;
    this.state = { kind: 'fbo', menus: [] };
    this.otherKindSelected = {};
    this.resolvedFile = '';
    void this.wsMemo.update(KEY_LAST_PROJECT, undefined);
    if (session) void session.releaseConnection();
    this.emitter.fire();
  }

  /** Danh sách dự án vừa đổi: lấy lại bản ghi + phiên của dự án đang chọn (nếu còn), không đổi lựa chọn của người dùng. */
  refresh(): void {
    const cur = this.state.project;
    if (!cur) {
      this.update();
      return;
    }
    {
      const fresh = this.registry.projects().find((p) => p.code === cur.code);
      if (!fresh) {
        this.closeProject();
        return;
      }
      const session = this.sessions.get(fresh);
      this.state.project = fresh;
      this.state.session = session;
      session.start().catch((e) => this.log.error(`[${fresh.code}] khởi động phiên lỗi`, e));
    }
    this.recompute();
  }

  /** Mở lại dự án cuối (sau khi khởi động, nếu file đang xem chưa chọn dự án nào). */
  restoreLastProject(): void {
    if (this.state.project) return;
    const code = this.wsMemo.get<string>(KEY_LAST_PROJECT);
    const project = code ? this.registry.projects().find((p) => p.code === code) : undefined;
    if (project) this.selectProject(project);
    else this.emitter.fire();
  }

  /** Mã các dự án khớp folder workspace (dự án đầu là dự án đã mở lúc bật). */
  workspaceProjectCodes(): string[] {
    return this.wsProjects;
  }

  /**
   * Mở dự án theo folder của workspace (BA mục 4): chạy ngay khi bật, không chờ chỉ mục.
   * Trả true nếu có dự án khớp và đã mở dự án đầu (chỉ khi chưa chọn dự án nào).
   */
  openWorkspaceProject(startedAt: number = Date.now()): boolean {
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    const found = matchProjectsByWorkspace(this.registry.projects(), folders);
    this.wsProjects = found.map((p) => p.code);
    if (found.length === 0 || this.state.project) return false;
    this.log.info(`Workspace khớp dự án: ${this.wsProjects.join(', ')}`);
    this.selectProject(found[0], 'fbo', startedAt);
    return true;
  }

  /* ===== Menu ===== */

  /** Đổi loại đang xem, nhớ menu đang chọn của loại cũ và lấy lại menu đã chọn của loại mới (không bắn sự kiện). */
  private applyKind(kind: MenuKind): void {
    const st = this.state;
    if (st.kind === kind) return;
    if (st.selected) this.otherKindSelected[st.kind] = st.selected;
    else delete this.otherKindSelected[st.kind];
    st.kind = kind;
    st.selected = this.otherKindSelected[kind];
    delete this.otherKindSelected[kind];
  }

  /** Chuyển loại xem (FBO / Mobile) từ hai nút trên panel; lấy lại menu đã chọn của loại đó nếu có. */
  setKind(kind: MenuKind): void {
    this.applyKind(kind);
    this.emitter.fire();
  }

  /** Chọn tay một menu (Tìm menu, thẻ "Cũng dùng ở"…): giữ menu này cho file đang xem và ghi vào Gần đây. */
  selectMenu(ref: MenuRef): void {
    this.perf.menu = Date.now();
    this.applyKind(ref.kind);
    this.state.selected = ref;
    if (this.state.filePath) this.resolvedFile = fileKey(this.state.filePath);
    this.pushRecentMenu(ref);
    this.emitter.fire();
  }

  /** Bỏ chọn menu (nút ✕ trên thẻ): về Ghim / Gần đây; file đang xem không tự chọn lại menu. */
  deselectMenu(): void {
    this.state.selected = undefined;
    if (this.state.filePath) this.resolvedFile = fileKey(this.state.filePath);
    this.emitter.fire();
  }

  pins(): string[] {
    return this.memoList('fsd.pins');
  }

  isPinned(ref: Pick<MenuRef, 'kind' | 'menuId'>): boolean {
    return this.pins().includes(refKey(ref));
  }

  togglePin(ref: Pick<MenuRef, 'kind' | 'menuId'>): void {
    const key = refKey(ref);
    const pins = this.pins();
    this.setMemoList('fsd.pins', pins.includes(key) ? pins.filter((k) => k !== key) : [...pins, key]);
    this.emitter.fire();
  }

  recentMenus(): string[] {
    return this.memoList('fsd.recentMenus');
  }

  /** Xóa danh sách menu gần đây của dự án đang chọn (Ghim giữ nguyên). */
  clearRecentMenus(): void {
    this.setMemoList('fsd.recentMenus', []);
    this.emitter.fire();
  }

  /** Xóa một menu khỏi Gần đây của dự án đang chọn. */
  removeRecentMenu(ref: Pick<MenuRef, 'kind' | 'menuId'>): void {
    const key = refKey(ref);
    this.setMemoList('fsd.recentMenus', this.recentMenus().filter((k) => k !== key));
    this.emitter.fire();
  }

  private pushRecentMenu(ref: MenuRef): void {
    const key = refKey(ref);
    this.setMemoList('fsd.recentMenus', [key, ...this.recentMenus().filter((k) => k !== key)].slice(0, MAX_RECENT_MENUS));
  }

  private memoList(prefix: string): string[] {
    const code = this.state.project?.code;
    return code ? this.memo.get<string[]>(`${prefix}.${code}`, []) : [];
  }

  private setMemoList(prefix: string, list: string[]): void {
    const code = this.state.project?.code;
    if (code) void this.memo.update(`${prefix}.${code}`, list);
  }

  /* ===== File đang xem ===== */

  /**
   * Đọc lại file đang mở (đổi tab, hoặc buộc làm mới).
   * File thuộc dự án khác dự án đang chọn → chuyển sang dự án đó. File ngoài mọi dự án → giữ nguyên.
   */
  update(): void {
    const filePath = this.activeFilePath();
    if (filePath && filePath !== this.ignoreFile) this.ignoreFile = undefined;
    if (filePath) {
      const match = matchProjectByPath(this.registry.projects(), filePath);
      const logKey = `${filePath}|${match?.project.code ?? ''}`;
      if (logKey !== this.lastLogged) {
        this.lastLogged = logKey;
        this.log.info(
          match
            ? `File đang xem thuộc dự án ${match.project.code}: ${filePath}`
            : `File đang xem không khớp dự án nào (${this.registry.projects().length} dự án): ${filePath}`
        );
      }
      if (match && filePath !== this.ignoreFile) {
        const kind: MenuKind = match.area === 'mobile' ? 'mob' : 'fbo';
        const fileChanged = this.state.filePath !== filePath;
        if (this.state.project?.code !== match.project.code) {
          this.state.filePath = filePath;
          this.state.match = match;
          this.selectProject(match.project, kind);
          return;
        }
        this.state.filePath = filePath;
        this.state.match = match;
        if (fileChanged) this.applyKind(kind);
        if (this.state.session) this.state.session.lastUse = Date.now();
      }
    }
    // Không có editor file (đang ở view / Output) → giữ ngữ cảnh cũ.
    this.recompute();
  }

  /**
   * Đường dẫn file đang xem: ưu tiên tab đang chọn (kể cả .f nhị phân / file chưa tồn tại — không có
   * text editor), rồi mới tới text editor đang active. Không phải file trên đĩa (scheme khác) → undefined.
   */
  private activeFilePath(): string | undefined {
    const input = vscode.window.tabGroups.activeTabGroup?.activeTab?.input as { uri?: vscode.Uri; modified?: vscode.Uri } | undefined;
    const uri = input?.uri ?? input?.modified ?? vscode.window.activeTextEditor?.document.uri;
    return uri && uri.scheme === 'file' ? uri.fsPath : undefined;
  }

  /** Tính lại danh sách menu của file từ chỉ mục; quyết định menu đang chọn khi file đổi. */
  recompute(): void {
    const st = this.state;
    const filePath = st.filePath;
    const inProject = !!filePath && !!st.project && st.match?.project.code === st.project.code;
    if (inProject && st.session?.index) {
      st.menus = [...st.session.index.menusOfFile(filePath!)];
      const key = fileKey(filePath!);
      // Chỉ tự đổi menu khi file là file gốc của menu khác; file dùng chung giữ menu đang chọn (BA 6.3).
      // Chưa chọn thì lấy menu nhận file làm gốc, không có thì không chọn. Tự chọn không ghi vào Gần đây.
      if (st.menus.length > 0 && this.resolvedFile !== key) {
        const pick = pickMenuForFile(st.session.index.rootMenusOfFile(filePath!), st.selected, st.menus);
        if (pick && !sameRef(pick, st.selected)) {
          this.applyKind(pick.kind);
          st.selected = pick;
        }
        this.resolvedFile = key;
      }
    } else {
      st.menus = [];
    }
    this.emitter.fire();
  }

  private collectOpen(): void {
    const keys = new Set<string>();
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const uri = (tab.input as { uri?: vscode.Uri } | undefined)?.uri;
        if (uri && uri.scheme === 'file') keys.add(fileKey(uri.fsPath));
      }
    }
    this.openKeys = keys;
  }

  dispose(): void {
    this.subs.forEach((s) => s.dispose());
    this.emitter.dispose();
  }
}
