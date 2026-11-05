// Sửa menu trên DB Sys — port frmWCommandUpdate (FBO) / frmCommandUpdate (FB) / frmDVCommand (Mobile) / frmDuplicateUpdate của 5.1:
// nạp dòng theo mã, Lưu sửa / Lưu mới, tự cấp command (FBO) / menu_id (Mobile), menu trùng đường dẫn.
//
// NGUỒN SQL (xem docs\extension\sql-source-menuedit.md):
//   - 5.1 không lấy câu nào của Sửa menu từ system.db; mọi câu là chuỗi dựng trong VB hoặc do SqlS.GenSQLInsert / GenSQLUpdate sinh.
//   - Câu lõi dựng trong sql51.ts (cấu trúc chép từ VB, ghi file:dòng); hai script AUTO trong autoCommand.ts chép nguyên văn từ VB.
//   - Lớp bọc của extension (guard DB Sys, kiểm trong batch, kiểm dòng ảnh hưởng, SELECT kiểm lại, transaction, hộp xác nhận)
//     nằm riêng ở extWrap.ts và SaveIO — chỉ thêm câu trước / sau, không đổi chữ nào của câu lõi.
// Lõi thuần (không vscode, không tedious): nhận `MenuDb` (SqlSession hoặc bản giả khi test) và `SaveIO` (xác nhận + transaction).
import type { RawSet } from '../sql/sqlSession';
import type { ColumnInfo } from '../sql/sqlTypes';
import { AUTO_MAIN_SCRIPT, buildAutoNew } from './autoCommand';
import { forbidRow, guardDb, guardedScript, requireRow, wrapBatch } from './extWrap';
import { commandPrefix, left3, mobilePrefix, nextMenuId } from './ids';
import { type EditKind, type EditSpec, esc, lit, normalizeKind, pathColumn, specOf, txt } from './spec';
import {
  genSqlInsert, genSqlUpdate, isBinary, sqlCountById, sqlCountCommand88, sqlDupSelect, sqlDupUpdate, sqlMaxMenuId, sqlRenameCommand,
  sqlRenameWcommand, sqlSchema, sqlSelectRowById, sqlSetCommandExe, sqlSyncDvcommand
} from './sql51';

export { guardDb };

/** Phần của SqlSession mà lõi cần: chạy một batch, trả mọi bảng kết quả. */
export interface MenuDb {
  query(sql: string): Promise<RawSet[]>;
}

/** Cổng ra ngoài của Lưu: hộp xác nhận (ghi rõ dự án + DB) và transaction. */
export interface SaveIO {
  /** lines = tóm tắt việc sắp ghi, sql = toàn bộ câu sẽ chạy (cho người duyệt xem). false = không ghi. */
  confirm(lines: string[], sql: string): Promise<boolean>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  /** Tên DB Sys của dự án đang mở — guard trong batch từ chối chạy nếu kết nối không phải DB này. */
  sysDb: string;
}

export interface SaveInput {
  kind: EditKind;
  mode: 'Edit' | 'New';
  oldId: string;
  values: Record<string, unknown>;
  auto: boolean;
}

export interface SaveResult {
  cancelled?: boolean;
  message: string;
  notes: string[];
  id: string;
  menu_id: string;
}

function lastSet(sets: RawSet[]): RawSet | undefined {
  return sets.length > 0 ? sets[sets.length - 1] : undefined;
}

function objects(set: RawSet | undefined): Array<Record<string, unknown>> {
  if (!set) return [];
  return set.rows.map((r) => {
    const o: Record<string, unknown> = {};
    set.columns.forEach((c, i) => { o[c.name.toLowerCase()] = r[i]; });
    return o;
  });
}

async function rows(db: MenuDb, sql: string): Promise<Array<Record<string, unknown>>> {
  return objects(lastSet(await db.query(sql)));
}

async function count(db: MenuDb, sql: string): Promise<number> {
  const r = (await rows(db, sql))[0];
  return r ? Number(Object.values(r)[0] ?? 0) : 0;
}

/** Như count nhưng bảng không có (lỗi 208 Invalid object name) = 0 — 5.1 bọc Try/Catch ở các chỗ dò dvcommand. */
async function countOrZeroIfNoTable(db: MenuDb, sql: string): Promise<number> {
  try {
    return await count(db, sql);
  } catch (e) {
    const err = e as { number?: number; message?: string };
    if (err?.number === 208 || /invalid object name/i.test(err?.message ?? '')) return 0;
    throw e;
  }
}

async function scalar(db: MenuDb, sql: string): Promise<string> {
  const r = (await rows(db, sql))[0];
  return r ? txt(Object.values(r)[0]) : '';
}

/** Một dòng SELECT * kèm siêu dữ liệu cột (để sinh INSERT / UPDATE đúng kiểu như Me.Row của 5.1). */
interface RowSnapshot {
  cols: ColumnInfo[];
  row?: unknown[];
  index: Map<string, number>;
}

async function snapshot(db: MenuDb, sql: string): Promise<RowSnapshot> {
  const set = lastSet(await db.query(sql));
  const cols = set?.columns ?? [];
  const index = new Map<string, number>();
  cols.forEach((c, i) => { if (!index.has(c.name.toLowerCase())) index.set(c.name.toLowerCase(), i); });
  return { cols, row: set?.rows[0], index };
}

/** Dòng theo mã: [{name, value}] chỉ gồm cột có thật trong bảng (giá trị đã trim). */
export async function getRow(db: MenuDb, kindIn: unknown, id: string): Promise<{ fields: Array<{ name: string; value: string }> }> {
  const spec = specOf(normalizeKind(kindIn));
  const r = (await rows(db, sqlSelectRowById(spec.table, spec.key, id)))[0];
  if (!r) throw new Error(`Không có ${spec.table} ${id}`);
  return { fields: spec.fields.filter((f) => f in r).map((f) => ({ name: f, value: txt(r[f]) })) };
}

/**
 * Chữ trên ô form → giá trị đúng kiểu cột (việc DataColumn của .NET làm khi 5.1 gán Me.Row(cột) = ctr.Text.Trim).
 * Cột số để trống = 0 (5.1 chỉ riêng expl_icon được đổi "" → "0" rồi gán; cột số khác để trống thì 5.1 báo lỗi định dạng — extension bỏ qua lỗi này).
 */
export function coerceFormValue(raw: string, col: ColumnInfo): unknown {
  const t = raw.trim();
  switch (col.clr) {
    case 'System.String':
      return raw;
    case 'System.Boolean':
      if (t === '' || t === '0' || t.toLowerCase() === 'false') return false;
      if (t === '1' || t.toLowerCase() === 'true') return true;
      throw new Error(`Cột ${col.name} chỉ nhận 0/1 (đang là "${raw}").`);
    case 'System.Byte':
    case 'System.Int16':
    case 'System.Int32':
    case 'System.Int64':
      if (t === '') return 0;
      if (!/^[+-]?\d+$/.test(t)) throw new Error(`Cột ${col.name} phải là số nguyên (đang là "${raw}").`);
      return Number(t);
    case 'System.Decimal':
    case 'System.Double':
    case 'System.Single': {
      if (t === '') return 0;
      const n = Number(t);
      if (!Number.isFinite(n)) throw new Error(`Cột ${col.name} phải là số (đang là "${raw}").`);
      return n;
    }
    default:
      throw new Error(`Cột ${col.name} (${col.type}) không sửa được từ form.`);
  }
}

// --- Ghi ---

export interface MainWriteArgs {
  spec: EditSpec;
  mode: 'Edit' | 'New';
  oldId: string;
  id: string;
  parent: string;
  idLabel: string;
  /** Câu lõi chép từ 5.1: UPDATE (GenSQLUpdate) hoặc INSERT (GenSQLInsert). */
  core: string;
  sysDb: string;
}

/** Batch ghi dòng menu chính: [EXT guard + kiểm cha / mã trùng] → câu lõi 5.1 → [EXT kiểm dòng ảnh hưởng + SELECT kiểm lại]. */
export function buildMainWrite(a: MainWriteArgs): string {
  const { spec } = a;
  const checks: string[] = [];
  if (a.parent !== '') checks.push(requireRow(spec.table, spec.key, a.parent, spec.parent + ' Not Exists!'));
  if (a.mode === 'New' || a.oldId.toUpperCase() !== a.id.toUpperCase()) checks.push(forbidRow(spec.table, spec.key, a.id, a.idLabel + ' Exists!'));
  return wrapBatch({
    sysDb: a.sysDb,
    checks,
    core: [{ sql: a.core, mustAffect: a.mode === 'Edit' ? `Không có ${spec.table} ${a.oldId} để sửa.` : undefined }],
    verify: `SELECT ${spec.key} AS id FROM ${spec.table} WHERE ${spec.key} = ${lit(a.id)}`
  });
}

/** Xoá trắng menu_id lúc Sửa: đổi tên dòng command cũ sang mã mới và gán lại cho wcommand (2 câu lõi 5.1). */
export function buildRename(oldMenuId: string, newMenuId: string, wmenuId: string, sysDb: string): string {
  return wrapBatch({
    sysDb,
    checks: [forbidRow('command', 'menu_id', newMenuId, 'Menu_id ' + newMenuId + ' đã có trong command.')],
    core: [{ sql: sqlRenameCommand(newMenuId, oldMenuId) }, { sql: sqlRenameWcommand(newMenuId, wmenuId) }],
    verify: `SELECT menu_id FROM wcommand WHERE wmenu_id = ${lit(wmenuId)}`
  });
}

/**
 * Sau Lưu sửa FBO, dòng command đã có: đẩy MỌI cột trùng tên giữa dòng wcommand vừa ghi và bảng command (trừ cột nhị phân),
 * rồi exe = link — đúng PushWCommandRowToCommand của 5.1 (frmWCommandUpdate.vb:1175–1225).
 */
export function buildCommandSync(w: RowSnapshot, commandColumns: string[], target: string, finalMenuId: string, sysDb: string): string | null {
  const names = new Set(commandColumns.map((c) => c.toLowerCase()));
  const idx: number[] = [];
  w.cols.forEach((c, i) => { if (!isBinary(c) && names.has(c.name.toLowerCase())) idx.push(i); });
  const core: Array<{ sql: string }> = [];
  if (idx.length > 0) core.push({ sql: genSqlUpdate('command', idx.map((i) => w.cols[i]), idx.map((i) => w.row?.[i]), `menu_id = '${esc(target)}'`) });
  if (names.has('exe')) {
    const li = w.index.get('link');
    const link = li === undefined ? '' : txt(w.row?.[li]);
    core.push({ sql: sqlSetCommandExe(link, finalMenuId === '' ? target : finalMenuId) });
  }
  return core.length > 0 ? wrapBatch({ sysDb, core }) : null;
}

/**
 * Lưu sửa / Lưu mới (5.1 SetRowData). Kiểm cha có, mã không trùng (FB: 3 ký tự đầu cùng cha) trước khi hỏi; hỏi xác nhận (io.confirm)
 * rồi ghi trong 1 transaction. Không xác nhận → { cancelled: true }, chưa ghi gì.
 */
export async function saveMenu(db: MenuDb, input: SaveInput, io: SaveIO): Promise<SaveResult> {
  const kind = normalizeKind(input.kind);
  const spec = specOf(kind);
  const mode = input.mode === 'New' ? 'New' : 'Edit';
  const oldId = txt(input.oldId);
  const values: Record<string, string> = {};
  for (const [k, val] of Object.entries(input.values ?? {})) values[k.toLowerCase()] = txt(val);
  const v = (f: string): string => values[f] ?? '';
  const notes: string[] = [];
  const idLabel = kind === 'fb' ? 'Menu_id' : 'Wmenu_id';
  // 5.1 FBO "Save New" xoá ô Menu_id trước khi lưu (frmWCommandUpdate.vb:1706 txtMenu_id.Text = "") rồi mới cấp lại nếu tick tự cấp.
  if (kind === 'fbo' && mode === 'New') values.menu_id = '';

  const parent = v(spec.parent);
  const id = v(spec.key);
  if (id === '') throw new Error(spec.key + ' is Empty!');
  if (parent !== '' && (await count(db, sqlCountById(spec.table, spec.key, parent))) === 0) throw new Error(spec.parent + ' Not Exists!');
  if (kind === 'fb' && parent !== '' && left3(id) !== left3(parent)) throw new Error('Menu_id0 And Menu_id Not Exists!');
  if ((oldId.toUpperCase() !== id.toUpperCase() || mode === 'New') && (await count(db, sqlCountById(spec.table, spec.key, id))) > 0) throw new Error(idLabel + ' Exists!');

  const auto = input.auto === true && kind !== 'fb';
  // Mobile: tự cấp menu_id trước khi ghi (frmDVCommand.vb:799–810).
  if (kind === 'mob') {
    if (auto && (mode === 'New' || v('menu_id') === '')) {
      const prefix = mobilePrefix(v('xtype'));
      values.menu_id = nextMenuId(await scalar(db, sqlMaxMenuId('dvcommand', prefix)), prefix);
    }
    if (!auto && mode !== 'New' && v('menu_id') === '') throw new Error('Menu_id is Empty!');
  }
  // FBO Sửa không tick tự cấp mà để trống Menu_id: 5.1 kiểm SAU khi đã ghi (frmWCommandUpdate.vb:867) — ở đây kiểm TRƯỚC khi ghi.
  if (kind === 'fbo' && mode !== 'New' && !auto && v('menu_id') === '') throw new Error('Menu_id is Empty!');

  // Dòng gốc (Sửa) / dòng đang mở (Mới: bản sao) = Me.Row của 5.1; ô form ghi đè lên.
  const base = oldId === '' ? undefined : await snapshot(db, sqlSelectRowById(spec.table, spec.key, oldId));
  if (!base || !base.row) throw new Error(mode === 'New' ? 'Không có dòng mẫu (menu đang mở) để nhân bản.' : `Không có ${spec.table} ${oldId}`);
  const mi = base.index.get('menu_id');
  const oldMenuId = mi === undefined ? '' : txt(base.row[mi]);
  const overrides = new Map<number, unknown>();
  for (const f of spec.fields) {
    const i = base.index.get(f);
    if (i === undefined || !(f in values)) continue;
    let raw = v(f);
    if (kind === 'fbo' && f === 'expl_icon' && raw === '') raw = '0';   // frmWCommandUpdate.vb:812
    overrides.set(i, coerceFormValue(raw, base.cols[i]));
  }
  if (overrides.size === 0) throw new Error('Không có ô nào để ghi.');

  // Câu lõi 5.1: Sửa = UPDATE chỉ các cột trên form (5.1 UPDATE mọi cột của Me.Row — cột ngoài form giữ giá trị đã nạp nên kết quả như nhau,
  // chỉ khác là không ghi đè lại cột ngoài form); Mới = INSERT mọi cột của dòng đang mở với ô form ghi đè (đúng GenSQLInsert(Me.Row)).
  let core: string;
  if (mode === 'Edit') {
    const idx = [...overrides.keys()].sort((a, b) => a - b);
    core = genSqlUpdate(spec.table, idx.map((i) => base.cols[i]), idx.map((i) => overrides.get(i)), `${spec.key} = '${esc(oldId)}'`);
  } else {
    core = genSqlInsert(spec.table, base.cols, base.cols.map((_, i) => (overrides.has(i) ? overrides.get(i) : base.row?.[i])));
  }
  const mainSql = buildMainWrite({ spec, mode, oldId, id, parent, idLabel, core, sysDb: io.sysDb });
  const menuIdForm = mi !== undefined && 'menu_id' in values ? v('menu_id') : oldMenuId;

  // Phần command của FBO (đọc trước để biết sẽ làm gì; chưa ghi gì).
  let runAuto = kind === 'fbo' && auto;
  let rename = false;
  let renameId = '';
  let mobileSync = false;
  if (kind === 'fbo') {
    if (runAuto && mode === 'Edit' && oldMenuId !== '' && (await count(db, sqlCountById('command', 'menu_id', oldMenuId))) > 0) {
      runAuto = false;
      if (v('menu_id') === '') rename = true;
    }
    if (rename) {
      const prefix = commandPrefix(v('type'));
      renameId = nextMenuId(await scalar(db, sqlMaxMenuId('command', prefix)), prefix);
    }
    if (mode === 'Edit') mobileSync = oldId !== '' && (await countOrZeroIfNoTable(db, sqlCountById('dvcommand', 'wmenu_id', oldId))) > 0;
  }

  const lines = [
    `${mode === 'New' ? 'Thêm dòng' : 'Sửa dòng'} ${spec.table} [${id}]${mode === 'Edit' && oldId.toUpperCase() !== id.toUpperCase() ? ` (mã cũ ${oldId})` : ''}`
  ];
  if (rename) lines.push(`Đổi mã command [${oldMenuId}] → [${renameId}]`);
  if (runAuto) lines.push('Tự cấp command: tạo / cập nhật dòng command 88.xx và gán wcommand.menu_id (tạo nhóm 88.00.00 nếu chưa có)');
  if (mobileSync) lines.push(`Đồng bộ menu_id sang dvcommand (Mobile) của [${oldId}]`);
  if (kind === 'fbo' && mode === 'Edit') lines.push('Đẩy cột trùng + exe sang command (nếu menu đã có command)');
  if (!(await io.confirm(lines, mainSql))) return { cancelled: true, message: 'Chưa ghi: bạn không xác nhận.', notes, id, menu_id: '' };

  return io.transaction(async () => {
    const check = objects(lastSet(await db.query(mainSql)));
    if (check.length !== 1) throw new Error(`Ghi ${spec.table} [${id}] không thành công (kiểm lại không thấy dòng).`);
    let menuId = kind === 'fb' ? id : menuIdForm;

    if (kind === 'fbo') {
      let executed = false;
      if (rename) {
        const r = objects(lastSet(await db.query(buildRename(oldMenuId, renameId, id, io.sysDb))));
        menuId = txt(r[0]?.menu_id) || renameId;
        executed = true;
      }
      if (runAuto) {
        if ((await count(db, sqlCountCommand88())) === 0) await db.query(guardedScript(io.sysDb, AUTO_MAIN_SCRIPT));
        const sql = buildAutoNew({
          type: v('type'), wmenuId: id, menuId: mode === 'New' ? '' : v('menu_id'), bar: v('bar'), bar2: v('bar2'),
          link: v('link'), sysId: v('sysid'), sysCode: v('syscode')
        });
        const r = objects(lastSet(await db.query(guardedScript(io.sysDb, sql))));
        menuId = txt(r[0]?.menu_id);
        if (menuId === '') throw new Error('Tự cấp command không trả menu_id.');
        executed = true;
      }
      if (mode === 'Edit') {
        if (mobileSync) {
          await db.query(wrapBatch({ sysDb: io.sysDb, core: [{ sql: sqlSyncDvcommand(menuId, oldId) }] }));
          notes.push(`Đã đồng bộ menu_id [${menuId}] sang DVCommand (Mobile) cho menu [${oldId}].`);
          if (oldId.toUpperCase() !== id.toUpperCase()) {
            notes.push(`Menu FBO [${oldId}] đã đổi tên thành [${id}] — KHÔNG tự đổi wmenu_id liên kết bên Mobile, vào tab Mobile sửa tay nếu cần.`);
          }
        }
        const target = executed ? menuId : oldMenuId;
        if (target !== '' && (await count(db, sqlCountById('command', 'menu_id', target))) > 0) {
          const w = await snapshot(db, sqlSelectRowById('wcommand', 'wmenu_id', id));
          const cmdCols = (lastSet(await db.query(sqlSchema('command')))?.columns ?? []).map((c) => c.name);
          const sync = buildCommandSync(w, cmdCols, target, menuId, io.sysDb);
          if (sync) await db.query(sync);
        }
      }
    }
    // frmDVCommand.WarnIfWCommandNotUpdated: Sửa Mobile không ghi ngược wcommand — báo nếu FBO có cùng mã.
    if (kind === 'mob' && mode === 'Edit' && (await count(db, sqlCountById('wcommand', 'wmenu_id', oldId))) > 0) {
      notes.push(`Đã lưu menu Mobile (dvcommand). Không cập nhật menu FBO (wcommand) cùng mã [${oldId}]. Muốn đồng bộ FBO → Lưu sửa trên menu FBO.`);
    }
    return { message: mode === 'New' ? 'New Successful' : 'Edit Successful', notes, id, menu_id: menuId };
  });
}

// --- Menu trùng đường dẫn / sysid (5.1 frmDuplicateUpdate) ---

/** Dòng gửi sang màn: [cập nhật?, phân hệ, mã, bar (C), bar2 (C), đường dẫn mới, là dòng vừa sửa]. */
export type DupRow = [boolean, string, string, string, string, string, boolean];

export async function findDups(db: MenuDb, kindIn: unknown, id: string): Promise<DupRow[]> {
  const kind = normalizeKind(kindIn);
  const spec = specOf(kind);
  const p = pathColumn(kind);
  const w = kind === 'fb' ? '' : 'w';
  const cur = (await rows(db, sqlSelectRowById(spec.table, spec.key, id)))[0];
  if (!cur) return [];
  const path = txt(cur[p]);
  // Câu lõi 5.1 (getData) + [EXT] DROP TABLE #tmp: kết nối dùng chung được giữ lại giữa các lệnh nên phải dọn bảng tạm.
  const sql = sqlDupSelect(spec.table, p, w, path, txt(cur.sysid)) + '\nDROP TABLE #tmp';
  const t = objects(lastSet((await db.query(sql)).filter((s) => s.columns.length > 0)));
  if (t.length <= 1) return [];
  const head = path.split(' ')[0];
  const mark = (s: unknown): string => {
    const x = txt(s);
    return x.endsWith('(C)') ? x : x + ' (C)';
  };
  return t.map((r): DupRow => {
    const parts = txt(r[p]).split(' ');
    const rid = txt(r[w + 'menu_id']);
    return [false, txt(r.phan_he), rid, mark(r.bar), mark(r.bar2), parts.length > 1 ? head + ' ' + parts[1].trim() : head, rid.toUpperCase() === id.trim().toUpperCase()];
  });
}

/** Batch UPDATE bar, bar2, đường dẫn cho các dòng được tick (khác dòng vừa sửa) — mỗi dòng là một câu lõi 5.1. */
export function buildDupsApply(kindIn: unknown, rowsIn: unknown[][], sysDb: string): { sql: string; ids: string[] } {
  const kind = normalizeKind(kindIn);
  const spec = specOf(kind);
  const p = pathColumn(kind);
  const w = kind === 'fb' ? '' : 'w';
  const ids: string[] = [];
  const core: Array<{ sql: string; mustAffect: string }> = [];
  for (const r of rowsIn) {
    if (r[0] !== true || r[6] === true) continue;
    const rid = txt(r[2]);
    if (rid === '') continue;
    ids.push(rid);
    core.push({ sql: sqlDupUpdate(spec.table, p, w, txt(r[3]), txt(r[4]), txt(r[5]), rid), mustAffect: 'Không có ' + spec.table + ' ' + rid + ' để cập nhật.' });
  }
  return { sql: wrapBatch({ sysDb, core }), ids };
}

/** Áp dụng dòng đã tick; trả số menu đã cập nhật (0 nếu không tick hoặc không xác nhận). */
export async function applyDups(db: MenuDb, kindIn: unknown, rowsIn: unknown[][], io: SaveIO): Promise<number> {
  const { sql, ids } = buildDupsApply(kindIn, rowsIn, io.sysDb);
  if (ids.length === 0) return 0;
  if (!(await io.confirm([`Cập nhật bar, bar2, đường dẫn của ${ids.length} menu: ${ids.join(', ')}`], sql))) return 0;
  await io.transaction(async () => {
    await db.query(sql);
  });
  return ids.length;
}

