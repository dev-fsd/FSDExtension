// QuickPick "Đối tượng SQL" (mở từ nút SQL cạnh FBO / MOBILE; lệnh fsd.pickSqlObject do commands.ts đăng ký).
// Thay panel webview cũ (sqlObjectsView.ts): bảng / view / store / function / trigger của DB dự án, lọc "a b" = AND, "a, b" = OR.
// Nút thanh tiêu đề: lọc loại, sắp xếp, làm mới, ⋯ (hành động), đổi DB. Nút cuối dòng: → Update, Copy script, DROP + CREATE.
// Phần thuần (lọc, sắp, đếm, nhãn) ở core/sql/sqlPickerModel.ts (có test); mở tab / script ở sqlObjectActions.ts.
import * as vscode from 'vscode';
import type { ObjectRow } from '../core/sql/sqlObjects';
import {
  TYPE_FILTERS,
  buildView,
  countText,
  descriptionOf,
  formatDay,
  iconOf,
  isKnownType,
  isSearchType,
  parseDay,
  prepare,
  rangeLabel,
  SEARCH_HINT,
  sortObjects,
  typeLabel,
  typeOk,
  type PickObj
} from '../core/sql/sqlPickerModel';
import type { ProjectRecord } from '../core/types';
import type { App } from './app';
import { getScreenHost } from './screens/screenHost';
import { copyScript, customGen, focusedTab, openObject, toast } from './sqlObjectActions';

/** Số dòng dựng tối đa vào QuickPick một lần (cắt im lặng; số đếm ở title luôn là số thật). */
const MAX_SHOW = 3000;
const RECENT_MAX = 5;

type ActId = 'refresh' | 'filterDate' | 'allCustomize' | 'clearCustom' | 'gen' | 'genCurrent' | 'addList' | 'db' | 'back' | 'more';

interface PickItem extends vscode.QuickPickItem {
  obj?: PickObj;
  act?: ActId;
  /** Dòng gợi ý "Tìm … — Enter" của chế độ Tìm cột / nội dung. */
  search?: boolean;
}

interface DbInfo {
  name: string;
  kind: 'app' | 'sys';
}

interface State {
  project: ProjectRecord;
  dbs: DbInfo[];
  db: string;
  type: string;
  sort: 'date' | 'name';
  list: PickObj[];
  /** Đang lọc "đã sửa" (5.1 Filter / Get All Object Customize). */
  custom: { label: string; list: PickObj[] } | null;
  /** Kết quả Tìm cột / nội dung (null = chưa tìm) và chuỗi đã tìm. */
  found: PickObj[] | null;
  searched: string;
  value: string;
  loading: boolean;
  error: string;
  /** Đang hiện danh sách hành động (nút ⋯). */
  actions: boolean;
  inited: boolean;
  token: number;
  /** Việc làm sau khi QuickPick đóng; trả true = mở lại QuickPick. */
  next?: () => Promise<boolean>;
  /** Vẽ lại QuickPick đang mở (undefined khi đã đóng). */
  render?: () => void;
}

/* ===== Nút ===== */
const typeIcon: Record<string, string> = { '': 'list-flat', P: 'symbol-method', FN: 'symbol-function', V: 'eye', U: 'symbol-class', TR: 'zap', COL: 'symbol-field', CONTENT: 'search' };
const tbtn = (icon: string, tip: string, active = false): vscode.QuickInputButton => ({
  iconPath: new vscode.ThemeIcon(icon, active ? new vscode.ThemeColor('textLink.foreground') : undefined),
  tooltip: tip
});
const BTN_REFRESH = tbtn('refresh', 'Làm mới (đọc lại từ server, bỏ lọc đã sửa)');
const BTN_MORE = tbtn('ellipsis', 'Hành động: lọc đã sửa, Custom Gen, thêm danh sách vào Update…');
const BTN_DB = tbtn('database', 'Đổi DB (App trước, Sys sau)');
const BTN_SORT_DATE = tbtn('history', 'Sắp theo: Ngày sửa — bấm để đổi sang Tên');
const BTN_SORT_NAME = tbtn('sort-precedence', 'Sắp theo: Tên — bấm để đổi sang Ngày sửa');
const typeButtons = new Map<vscode.QuickInputButton, string>();
function typeButton(type: string, active: boolean): vscode.QuickInputButton {
  const b = tbtn(typeIcon[type] ?? 'list-flat', `${active ? '● ' : ''}Loại: ${typeLabel(type)}`, active);
  typeButtons.set(b, type);
  return b;
}

const ROW_UPD: vscode.QuickInputButton = tbtn('add', '→ Update (CREATE; bảng = script tạo bảng)');
const ROW_UPD_ALTER: vscode.QuickInputButton = tbtn('edit', '→ Update (ALTER)');
const ROW_COPY: vscode.QuickInputButton = tbtn('copy', 'Copy script (bảng: CREATE đủ cột; khác: ALTER)');
const ROW_DC: vscode.QuickInputButton = tbtn('debug-rerun', 'DROP + CREATE + QUOTED OFF vào tab Query (bảng: CREATE TABLE)');
const ROW_BTNS_TABLE = [ROW_UPD, ROW_COPY, ROW_DC];
const ROW_BTNS_OTHER = [ROW_UPD, ROW_UPD_ALTER, ROW_COPY, ROW_DC];

/** Dòng QuickPick của một đối tượng (dựng một lần cho mỗi đối tượng, dùng lại giữa các lần lọc). */
const itemCache = new WeakMap<PickObj, PickItem>();
function itemOf(o: PickObj): PickItem {
  let it = itemCache.get(o);
  if (!it) {
    it = {
      label: `$(${iconOf(o.type)}) ${o.name}`,
      description: descriptionOf(o),
      alwaysShow: true, // tự lọc trong onDidChangeValue (QuickPick không hiểu "a, b")
      buttons: o.type === 'U' ? ROW_BTNS_TABLE : ROW_BTNS_OTHER,
      obj: o
    };
    itemCache.set(o, it);
  }
  return it;
}

const call = (S: State, cmd: string, args: Record<string, unknown> = {}): Promise<unknown> => getScreenHost().call(S.project, cmd, args);
const gs = (app: App) => app.context.globalState;
const KEY = (what: string, code = ''): string => `fsd.sqlPicker.${what}${code ? '.' + code : ''}`;

/* ===== Dữ liệu ===== */
let lastSortSrc: PickObj[] | null = null;
let lastSortBy = '';
let lastSorted: PickObj[] = [];
/** Nguồn đã sắp: chỉ sắp lại khi nguồn hoặc cách sắp đổi. */
function sortedBase(S: State): PickObj[] {
  const base = S.custom ? S.custom.list : S.list;
  if (lastSortSrc !== base || lastSortBy !== S.sort) {
    lastSortSrc = base;
    lastSortBy = S.sort;
    lastSorted = sortObjects(base, S.sort);
  }
  return lastSorted;
}

async function init(app: App, S: State): Promise<void> {
  const token = ++S.token;
  S.loading = true;
  S.render?.();
  try {
    const dbs = ((await call(S, 'project.databases')) as DbInfo[]) ?? [];
    if (token !== S.token) return;
    S.dbs = dbs;
    const want = gs(app).get<string>(KEY('db', S.project.code));
    S.db = (dbs.find((d) => d.name === want) ?? dbs.find((d) => d.kind === 'app') ?? dbs[0] ?? { name: '' }).name;
    S.inited = true;
  } catch (e) {
    if (token !== S.token) return;
    S.loading = false;
    S.error = e instanceof Error ? e.message : String(e);
    S.render?.();
    return;
  }
  await load(S, false);
}

/** Đọc danh sách đối tượng của DB đang chọn (refresh = bỏ cache, đọc lại từ server). */
async function load(S: State, refresh: boolean): Promise<void> {
  const token = ++S.token;
  S.loading = true;
  S.error = '';
  S.found = null;
  S.searched = '';
  S.render?.();
  try {
    const rows = ((await call(S, 'sql.objects', { db: S.db, refresh })) as ObjectRow[]) ?? [];
    if (token !== S.token) return;
    S.list = prepare(rows);
  } catch (e) {
    if (token !== S.token) return;
    S.list = [];
    S.error = e instanceof Error ? e.message : String(e);
  }
  S.loading = false;
  S.render?.();
}

function setFindText(app: App, text: string): void {
  const f = focusedTab(app);
  if (f?.screen === 'query') getScreenHost().emit(f.id, 'query.setFind', { text });
}

/** Tìm cột / nội dung: chỉ chạy khi Enter (5.1 PerformSearchColumn / PerformSearchContent). Chỉ giữ loại liệt kê được. */
async function runSearch(app: App, S: State, text: string): Promise<void> {
  const col = S.type === 'COL';
  toast((col ? 'Đang tìm cột: ' : 'Đang tìm nội dung: ') + text + '…', false);
  const token = ++S.token;
  S.loading = true;
  S.render?.();
  try {
    const found = ((await call(S, 'sql.search', { db: S.db, mode: col ? 'col' : 'content', text })) as ObjectRow[]) ?? [];
    if (token !== S.token) return;
    S.found = prepare(found).filter((o) => isKnownType(o.type));
    S.searched = text;
  } catch (e) {
    S.loading = false;
    S.render?.();
    toast('Lỗi khi tìm kiếm: ' + (e instanceof Error ? e.message : String(e)), true);
    return;
  }
  S.loading = false;
  S.render?.();
  const n = S.found.length;
  toast(n ? `Tìm thấy ${n} ${col ? 'bảng có chứa cột' : 'object có chứa'} '${text}'` : (col ? 'Không tìm thấy bảng nào có cột: ' : 'Không tìm thấy object nào có chứa: ') + text, false);
  setFindText(app, text);
}

function setType(app: App, S: State, type: string): void {
  if (type === S.type) return;
  // 5.1 cboFilterBy: đổi chế độ tìm → xóa ô Tìm của tab Query, bỏ kết quả tìm cũ.
  if (isSearchType(S.type) || isSearchType(type)) {
    setFindText(app, '');
    S.found = null;
    S.searched = '';
  }
  S.type = type;
  void gs(app).update(KEY('type'), type);
  S.render?.();
}

/* ===== Gần đây ===== */
const recentKey = (S: State): string => KEY('recent', `${S.project.code}.${S.db.toLowerCase()}`);
function recentsOf(app: App, S: State): PickObj[] {
  const names = gs(app).get<string[]>(recentKey(S), []);
  const byKey = new Map(S.list.map((o) => [`${o.type}|${o.name}`, o] as [string, PickObj]));
  return names.map((k) => byKey.get(k)).filter((o): o is PickObj => !!o);
}
function pushRecent(app: App, S: State, o: PickObj): void {
  const k = `${o.type}|${o.name}`;
  const cur = gs(app).get<string[]>(recentKey(S), []);
  void gs(app).update(recentKey(S), [k, ...cur.filter((x) => x !== k)].slice(0, 20));
}

/* ===== Hành động (nút ⋯) ===== */
function actionItems(S: State, shown: number): PickItem[] {
  const a = (label: string, act: ActId, description?: string): PickItem => ({ label, act, description, alwaysShow: true });
  const out: PickItem[] = [a('$(arrow-left) Về danh sách', 'back'), a('$(refresh) Làm mới', 'refresh', 'đọc lại từ server')];
  out.push(a('$(calendar) Lọc object đã sửa theo ngày…', 'filterDate'), a('$(history) Lấy tất cả object customize', 'allCustomize'));
  if (S.custom) out.push(a(`$(clear-all) Bỏ lọc "${S.custom.label}"`, 'clearCustom'));
  out.push(
    a('$(code) Custom Gen…', 'gen', 'nhập danh sách tên'),
    a('$(code) Custom Gen danh sách đang hiện…', 'genCurrent', `${shown} đối tượng`),
    a('$(package) Thêm danh sách đang hiện vào Update…', 'addList', `${shown} đối tượng`),
    a('$(database) Đổi DB…', 'db', S.db)
  );
  return out;
}

/** Hỏi Alter / Create cho Custom Gen. undefined = hủy. */
async function askAlter(): Promise<boolean | undefined> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: 'Alter', description: 'ALTER từng đối tượng', alter: true },
      { label: 'Create', description: 'DROP + CREATE từng đối tượng', alter: false }
    ],
    { title: 'Custom Gen — dạng script' }
  );
  return pick?.alter;
}

async function actionCustomGen(app: App, S: State, current: boolean, shownNames: string[]): Promise<void> {
  let names = shownNames.join('\n');
  if (!current) {
    const v = await vscode.window.showInputBox({ title: 'Custom Gen', prompt: 'Tên đối tượng, cách nhau bằng dấu phẩy', placeHolder: 'rs_banhang, dmkh, fn_abc' });
    if (!v || !v.trim()) return;
    names = v;
  }
  const alter = await askAlter();
  if (alter === undefined) return;
  toast('Đang sinh script…', false);
  await customGen(app, names, S.db, alter);
}

async function actionAddList(S: State, rows: PickObj[]): Promise<void> {
  const mode = await vscode.window.showQuickPick(
    [
      { label: 'ALTER', mode: 'alter' },
      { label: 'CREATE (DROP + CREATE)', mode: 'create' },
      { label: 'ALTER, QUOTED OFF', mode: 'qoff' }
    ],
    { title: `Thêm ${rows.length} đối tượng vào Update — dạng script` }
  );
  if (!mode) return;
  try {
    const res = (await call(S, 'upd.addObjectList', {
      items: rows.map((o) => ({ name: o.name, type: o.type })),
      db: S.db,
      alter: mode.mode !== 'create',
      quotedOff: mode.mode === 'qoff'
    })) as { message?: string } | undefined;
    toast(res?.message ? res.message : `Đã thêm ${rows.length} đối tượng vào Update`, !!res?.message);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), true);
  }
}

/** 5.1 FilterStoreCustomize (Từ = hôm qua, Đến = hôm nay): đối tượng sửa trong khoảng ngày. */
async function actionFilterDate(app: App, S: State): Promise<void> {
  const now = new Date();
  const validate = (v: string): string | undefined => (parseDay(v) ? undefined : 'Nhập ngày dạng dd/MM/yyyy.');
  const f = await vscode.window.showInputBox({ title: 'Lọc object đã sửa — Từ ngày', prompt: 'dd/MM/yyyy', value: formatDay(new Date(now.getTime() - 864e5)), validateInput: validate });
  if (f === undefined) return;
  const t = await vscode.window.showInputBox({ title: 'Lọc object đã sửa — Đến ngày', prompt: 'dd/MM/yyyy', value: formatDay(now), validateInput: validate });
  if (t === undefined) return;
  const from = parseDay(f)!;
  const to = parseDay(t)!;
  if (from > to) {
    toast('Từ ngày phải trước hoặc bằng Đến ngày.', true);
    return;
  }
  await applyModified(app, S, { from: from.replace(/-/g, ''), to: to.replace(/-/g, '') }, 'đã sửa ' + rangeLabel(from, to));
}

async function applyModified(app: App, S: State, args: Record<string, unknown>, label: string): Promise<void> {
  toast('Đang lấy object customize…', false);
  let rows: ObjectRow[];
  try {
    rows = ((await call(S, 'sql.objectsModified', { db: S.db, ...args })) as ObjectRow[]) ?? [];
  } catch (e) {
    toast('Lỗi khi lọc object đã sửa: ' + (e instanceof Error ? e.message : String(e)), true);
    return;
  }
  // 5.1: về "All", giữ chữ trong ô lọc.
  if (isSearchType(S.type)) {
    setFindText(app, '');
    S.found = null;
    S.searched = '';
  }
  S.type = '';
  void gs(app).update(KEY('type'), '');
  S.custom = { label, list: prepare(rows) };
  toast(rows.length ? `Có ${rows.length} object ${label}` : `Không có object nào ${label}`, false);
}

async function changeDb(app: App, S: State): Promise<void> {
  if (S.dbs.length === 0) return;
  const pick = await vscode.window.showQuickPick(
    S.dbs.map((d) => ({ label: d.name + (d.kind === 'sys' ? ' (Sys)' : ''), description: d.name === S.db ? 'đang chọn' : '', db: d.name })),
    { title: `Đổi DB — ${S.project.code}`, placeHolder: 'DB App trước, DB Sys sau' }
  );
  if (!pick || pick.db === S.db) return;
  S.db = pick.db;
  void gs(app).update(KEY('db', S.project.code), S.db);
  S.list = [];
  S.custom = null;
  S.found = null;
  S.searched = '';
  S.value = '';
  void load(S, false);
}

/* ===== QuickPick ===== */
function showOnce(app: App, S: State): Promise<void> {
  return new Promise<void>((resolve) => {
    const qp = vscode.window.createQuickPick<PickItem>();
    qp.matchOnDescription = false;
    qp.matchOnDetail = false;
    qp.value = S.value;
    let shownRows: PickObj[] = [];
    let btnKey = '';

    const searching = (): boolean => isSearchType(S.type);
    const later = (fn: () => Promise<boolean>): void => {
      S.next = fn;
      qp.hide();
    };

    const render = (): void => {
      const filter = qp.value;
      const view = buildView({ base: sortedBase(S), found: S.found, searching: searching(), type: S.type, filter });
      shownRows = view.rows;
      const ready = !S.error && S.inited;

      // Thanh tiêu đề: nút loại (đang chọn tô màu) + sắp xếp + làm mới + ⋯ + đổi DB. Gán lại chỉ khi trạng thái nút đổi.
      const bk = `${S.type}|${S.sort}`;
      if (bk !== btnKey) {
        btnKey = bk;
        qp.buttons = [...TYPE_FILTERS.map((t) => typeButton(t.type, t.type === S.type)), S.sort === 'date' ? BTN_SORT_DATE : BTN_SORT_NAME, BTN_REFRESH, BTN_MORE, BTN_DB];
      }
      const parts = [`Đối tượng SQL · ${S.project.code}`];
      if (S.db) parts.push(S.db);
      if (S.type) parts.push(typeLabel(S.type));
      if (S.custom && !searching()) parts.push(S.custom.label);
      if (S.loading) parts.push('đang đọc…');
      else if (ready && !(searching() && !S.found)) parts.push(countText(view, searching()));
      qp.title = parts.join(' · ');
      qp.placeholder = SEARCH_HINT[S.type] ?? 'Lọc tên: a b = có cả hai · a, b = một trong hai  ·  nút cuối dòng: → Update, Copy, DROP + CREATE';
      qp.busy = S.loading;
      qp.items = itemsFor(view, filter);
    };
    S.render = render;

    const itemsFor = (view: ReturnType<typeof buildView>, filter: string): PickItem[] => {
      if (S.actions) return actionItems(S, view.count);
      if (S.error) return [{ label: `$(error) ${S.error}`, alwaysShow: true }];
      if (!S.inited || (S.loading && S.list.length === 0 && !S.found)) return [{ label: '$(loading~spin) Đang đọc…', alwaysShow: true }];
      const out: PickItem[] = [];
      const text = filter.trim();
      if (searching()) {
        if (text && text !== S.searched) out.push({ label: `$(search) Tìm ${S.type === 'COL' ? 'cột' : 'nội dung'} "${text}" — nhấn Enter`, alwaysShow: true, search: true });
        else if (!S.found) out.push({ label: `$(info) ${SEARCH_HINT[S.type]}`, alwaysShow: true });
        else if (view.rows.length === 0) out.push({ label: '$(info) Không tìm thấy.', alwaysShow: true });
      } else if (text === '') {
        // Đầu danh sách: mục hành động / bỏ lọc, rồi Gần đây.
        if (S.custom) out.push({ label: `$(filter) Đang lọc: ${S.custom.label} · ${S.custom.list.length} — bỏ lọc`, alwaysShow: true, act: 'clearCustom' });
        out.push({ label: '$(ellipsis) Hành động…', description: 'lọc đã sửa, Custom Gen, thêm vào Update', alwaysShow: true, act: 'more' });
        const recents = recentsOf(app, S)
          .filter((o) => typeOkRecent(S, o))
          .slice(0, RECENT_MAX);
        if (recents.length) out.push({ label: 'Gần đây', kind: vscode.QuickPickItemKind.Separator }, ...recents.map((o) => ({ ...itemOf(o) })));
        if (view.rows.length) out.push({ label: 'Đối tượng', kind: vscode.QuickPickItemKind.Separator });
      }
      if (!searching() && view.rows.length === 0) out.push({ label: '$(info) Không có đối tượng khớp.', alwaysShow: true });
      const n = Math.min(view.rows.length, MAX_SHOW);
      for (let i = 0; i < n; i++) out.push(itemOf(view.rows[i]));
      return out;
    };

    qp.onDidChangeValue((v) => {
      S.value = v;
      if (S.actions && v !== '') S.actions = false;
      render();
    });

    qp.onDidTriggerButton((b) => {
      const type = typeButtons.get(b);
      if (type !== undefined) return setType(app, S, type);
      if (b === BTN_SORT_DATE || b === BTN_SORT_NAME) {
        if (searching()) return toast('Kết quả tìm cột / nội dung xếp theo tên máy chủ trả về — không đổi được cách sắp.', false);
        S.sort = S.sort === 'date' ? 'name' : 'date';
        void gs(app).update(KEY('sort'), S.sort);
        return render();
      }
      if (b === BTN_REFRESH) {
        S.custom = null;
        return void load(S, true);
      }
      if (b === BTN_MORE) {
        S.actions = !S.actions;
        return render();
      }
      if (b === BTN_DB) later(async () => (await changeDb(app, S), true));
    });

    // Nút cuối dòng: giữ ô tìm mở để làm tiếp (trừ DROP + CREATE: mở vào tab Query).
    qp.onDidTriggerItemButton(async (e) => {
      const o = e.item.obj;
      if (!o) return;
      try {
        if (e.button === ROW_UPD || e.button === ROW_UPD_ALTER) {
          const r = (await call(S, 'upd.addObject', { name: o.name, type: o.type, db: S.db, alter: e.button === ROW_UPD_ALTER })) as { message?: string } | undefined;
          toast(r?.message ? r.message : `Đã thêm ${o.name} vào Update`, !!r?.message);
        } else if (e.button === ROW_COPY) {
          await copyScript(app, o.name, o.type, S.db);
        } else if (e.button === ROW_DC) {
          pushRecent(app, S, o);
          later(async () => (await openObject(app, o.name, o.type, S.db, { ctrl: true, forceQuery: true }), false));
        }
      } catch (err) {
        app.log.error('Thao tác dòng đối tượng SQL lỗi', err);
        toast(err instanceof Error ? err.message : String(err), true);
      }
    });

    qp.onDidAccept(() => {
      const sel = qp.selectedItems[0];
      if (!sel) return;
      if (sel.search) return void runSearch(app, S, qp.value.trim());
      if (sel.act) return runAct(sel.act);
      if (sel.obj) {
        const o = sel.obj;
        pushRecent(app, S, o);
        later(async () => (await openObject(app, o.name, o.type, S.db, {}), false));
      }
    });

    const runAct = (act: ActId): void => {
      switch (act) {
        case 'more':
          S.actions = true;
          return render();
        case 'back':
          S.actions = false;
          return render();
        case 'refresh':
          S.actions = false;
          S.custom = null;
          return void load(S, true);
        case 'clearCustom':
          S.custom = null;
          S.actions = false;
          return render();
        case 'filterDate':
          return later(async () => (await actionFilterDate(app, S), true));
        case 'allCustomize':
          return later(async () => (await applyModified(app, S, { all: true }, 'tất cả object customize'), true));
        case 'gen':
          return later(async () => (await actionCustomGen(app, S, false, []), false));
        case 'genCurrent': {
          const names = shownRows.map((o) => o.name);
          return later(async () => (await actionCustomGen(app, S, true, names), false));
        }
        case 'addList': {
          const rows = shownRows.slice();
          return later(async () => (await actionAddList(S, rows), true));
        }
        case 'db':
          return later(async () => (await changeDb(app, S), true));
      }
    };

    qp.onDidHide(() => {
      if (S.render === render) S.render = undefined;
      qp.dispose();
      resolve();
    });
    // Mở các lần sau từ hành động: không còn ở chế độ hành động.
    S.actions = false;
    qp.show();
    render();
    if (!S.inited && !S.loading) void init(app, S);
  });
}

/** Dòng "Gần đây" chỉ hiện khi khớp loại đang lọc (chế độ tìm thì không hiện). */
const typeOkRecent = (S: State, o: PickObj): boolean => !isSearchType(S.type) && typeOk(S.type, o);

/** Lệnh fsd.pickSqlObject: nút SQL cạnh FBO / MOBILE. Chưa có dự án → hỏi chọn dự án (fsd.changeProject). */
export async function pickSqlObject(app: App): Promise<void> {
  let project = app.ctx.state.project;
  if (!project) {
    await vscode.commands.executeCommand('fsd.changeProject');
    project = app.ctx.state.project;
  }
  if (!project) return;
  const g = gs(app);
  const S: State = {
    project,
    dbs: [],
    db: '',
    type: g.get<string>(KEY('type'), 'P'),
    sort: g.get<string>(KEY('sort'), 'date') === 'name' ? 'name' : 'date',
    list: [],
    custom: null,
    found: null,
    searched: '',
    value: '',
    loading: false,
    error: '',
    actions: false,
    inited: false,
    token: 0
  };
  if (!TYPE_FILTERS.some((t) => t.type === S.type)) S.type = '';
  // Mở QuickPick; hành động cần hộp nhập thì QuickPick đóng, làm xong mở lại (giữ nguyên trạng thái).
  for (;;) {
    S.next = undefined;
    await showOnce(app, S);
    const next = S.next as State['next'];
    if (!next) break;
    try {
      if (!(await next())) break;
    } catch (e) {
      app.log.error('Đối tượng SQL: thao tác lỗi', e);
      toast(e instanceof Error ? e.message : String(e), true);
      break;
    }
  }
}
