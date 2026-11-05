// Phần thuần của view "Cây màn" ở sidebar trái (fsd.screenTree): hiện cây "trái" của màn nào, lệnh dữ liệu view được gọi,
// và kho chia sẻ giữa view ⇄ tab màn (thư mục chương trình đang chọn, tin chờ khi view chưa mở).
// Không phụ thuộc vscode để test được (test/side/side.test.ts).

/** Hai màn có cây "trái" đã dời ra sidebar. */
export const SIDE_SCREENS = ['update-script', 'multi-search'] as const;
export type SideScreen = (typeof SIDE_SCREENS)[number];

export function isSideScreen(s: unknown): s is SideScreen {
  return typeof s === 'string' && (SIDE_SCREENS as readonly string[]).includes(s);
}

export interface PickInput {
  /** Màn của tab được focus gần nhất (còn hiện); undefined = không có / không phải tab màn. */
  focusedScreen?: string;
  /** Màn của mọi tab đang mở của dự án. */
  tabScreens: readonly string[];
  /** Màn cuối cùng đã hiện cây (để giữ khi focus sang tab khác như Query). */
  last: SideScreen | '';
  /** Người dùng bấm nút chuyển nhanh (giữ tới khi focus sang tab khác). */
  forced: SideScreen | '';
}

export interface PickResult {
  /** '' = không màn nào mở và chưa chọn → trạng thái rỗng. */
  screen: SideScreen | '';
  /** true khi chọn theo tab đang focus (view ghi nhớ làm "màn cuối"). */
  fromFocus: boolean;
}

/**
 * Chọn màn mà view hiện cây: nút chuyển nhanh > tab đang focus > màn cuối nếu còn tab > màn đầu tiên đang mở > rỗng.
 * Nút chuyển nhanh thắng tab đang focus; view tự bỏ "forced" khi tab được focus đổi.
 */
export function pickSideScreen(i: PickInput): PickResult {
  if (i.forced) return { screen: i.forced, fromFocus: false };
  if (isSideScreen(i.focusedScreen)) return { screen: i.focusedScreen, fromFocus: true };
  if (i.last && i.tabScreens.includes(i.last)) return { screen: i.last, fromFocus: false };
  const first = SIDE_SCREENS.find((s) => i.tabScreens.includes(s));
  return { screen: first ?? '', fromFocus: false };
}

/** Lệnh dữ liệu (registry) view được gọi: tìm / thêm vào Update / thao tác file; mọi thứ khác phải qua thao tác `side.*`. */
export const SIDE_CALLS: ReadonlySet<string> = new Set([
  'clipboard.set', 'ui.toast', 'file.openInEditor', 'file.pick', 'folder.pick', 'shell.explore', 'shell.copyFile',
  'upd.state', 'upd.option', 'upd.searchFiles', 'upd.menuContext', 'upd.declare', 'upd.addDeclare', 'upd.addExplorerFiles',
  'upd.addFile', 'upd.sqlObjects', 'upd.addObjects',
  'sql.columns', 'sql.script',
  'search.roots', 'ms.openDefault', 'ms.openIde', 'ms.copyFiles', 'ms.checkVoucher', 'file.reveal'
]);

/** Thao tác riêng của view (không qua registry). */
export const SIDE_OPS: ReadonlySet<string> = new Set(['side.ready', 'side.mode', 'side.toTab', 'side.share', 'side.openScreen', 'side.cmd']);

/** Lệnh VS Code view được gọi trực tiếp (trạng thái khóa / chưa chọn dự án). */
export const SIDE_COMMANDS: ReadonlySet<string> = new Set(['fsd.changeProject', 'fsd.enterKey', 'fsd.copyMachineCode', 'fsd.openUpdateScript', 'fsd.openMultiSearch']);

/** Sự kiện tab gửi sang view mà nếu view chưa mở thì giữ lại (chỉ cái mới nhất mỗi màn): menu mở kèm tab. */
const HOLD_EVENTS: ReadonlySet<string> = new Set(['menu']);

export interface SideProgram {
  program: string;
  mode: string;
}

export interface HeldEvent {
  screen: SideScreen;
  event: string;
  data: unknown;
}

/** Kho chia sẻ giữa view ⇄ tab màn (trong bộ nhớ extension, theo dự án). */
export class SideShare {
  private readonly programs = new Map<string, SideProgram>();
  private readonly held = new Map<string, Map<string, HeldEvent>>();

  setProgram(project: string, screen: SideScreen, program: string, mode: string): void {
    this.programs.set(`${project}|${screen}`, { program, mode });
  }

  getProgram(project: string, screen: SideScreen): SideProgram | undefined {
    return this.programs.get(`${project}|${screen}`);
  }

  /** Giữ sự kiện tab → view khi view chưa nhận được; trả true nếu đã giữ (sự kiện không thuộc loại giữ thì bỏ). */
  hold(project: string, screen: SideScreen, event: string, data: unknown): boolean {
    if (!HOLD_EVENTS.has(event)) return false;
    let m = this.held.get(project);
    if (!m) this.held.set(project, (m = new Map()));
    m.set(`${screen}|${event}`, { screen, event, data });
    return true;
  }

  /** Lấy và xóa các sự kiện đang giữ của dự án. */
  take(project: string): HeldEvent[] {
    const m = this.held.get(project);
    if (!m) return [];
    this.held.delete(project);
    return [...m.values()];
  }
}
