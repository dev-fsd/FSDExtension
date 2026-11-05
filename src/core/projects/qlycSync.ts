// Đồng bộ danh mục dự án chuẩn từ QLYC (port ProjectAdminService.vb: QlycConnection + Sync).
// Khác 5.2: không ghi config.db — trả danh sách dự án để gọi nơi lưu projects.json + SecretStorage.
// Không log chuỗi kết nối / mật khẩu.
import { decodeP, decodeText } from '../legacy/legacyText';
import { SqlClient, type SqlConfig } from '../sql/sqlClient';
import type { ProjectRecord } from '../types';
import { withSlash } from './configDb';

/** Chuỗi kết nối QLYC mã hóa sẵn (giống clsDatabase.GetConnectionQLYC của 5.1). */
const QLYC_ENCODED =
  'RAAAAGEAAAB0AAAAYQAAACAAAABTAAAAbwAAAHUAAAByAAAAYwAAAGUAAAA9AAAAMQAAADcAAAAyAAAALgAAADEAAAA2AAAAOAAAAC4AAAA1AAAALgAAADEAAAA0AAAAXAAAAHMAAABxAAAAbAAAADIAAAAwAAAAMQAAADQAAABlAAAAeAAAADsAAABJAAAAbgAAAGkAAAB0AAAAaQAAAGEAAABsAAAAIAAAAEMAAABhAAAAdAAAAGEAAABsAAAAbwAAAGcAAAA9AAAARgAAAFMAAABHAAAAXwAAAEEAAAA7AAAAQQAAAHAAAABwAAAAbAAAAGkAAABjAAAAYQAAAHQAAABpAAAAbwAAAG4AAAAgAAAATgAAAGEAAABtAAAAZQAAAD0AAABGAAAAUwAAAEQAAABUAAAAbwAAAG8AAABsAAAAOwAAAFUAAABpAAAAZAAAAD0AAABmAAAAcwAAAGQAAABzAAAAdAAAAHUAAABkAAAAaQAAAG8AAAA7AAAAUAAAAHcAAABkAAAAPQAAAEYAAABhAAAAQAAAACQAAAAqAAAAIwAAAEAAAABGAAAAbQAAAGIAAABoAAAAVAAAAG8AAABvAAAAbAAAADsAAAA';

/** Máy chủ thử lần lượt (thay IP trong chuỗi gốc). */
const QLYC_HOSTS = ['172.168.5.14', '20.20.20.14'];
const QLYC_ORIGINAL_HOST = '172.168.5.14';

/** Kết quả đồng bộ vào danh sách hiện có. */
export interface SyncResult {
  /** Danh sách dự án sau khi gộp (đưa vào projects.json). */
  projects: ProjectRecord[];
  /** Mật khẩu (đã giải) theo mã dự án — chỉ cho dự án có trong danh sách chuẩn. */
  passwords: Map<string, string>;
  updated: number;
  added: number;
  /** Số dòng danh sách chuẩn trả về. */
  total: number;
}

/** Tách "k=v;k=v" (khóa không phân biệt hoa thường). Giá trị mật khẩu có thể chứa ký tự lạ nhưng không có ';'. */
export function parseConnectionString(cs: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of cs.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    out.set(part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).trim());
  }
  return out;
}

/** Cấu hình SQL cho từng máy chủ QLYC (timeout kết nối ngắn nhờ "; Connect Timeout"). */
export function qlycConfigs(connectTimeoutSec = 2): SqlConfig[] {
  const map = parseConnectionString(decodeP(QLYC_ENCODED));
  const source = map.get('data source') ?? '';
  const user = map.get('uid') ?? map.get('user id') ?? '';
  const password = map.get('pwd') ?? map.get('password') ?? '';
  const database = map.get('initial catalog') ?? map.get('database') ?? '';
  return QLYC_HOSTS.map((ip) => ({
    server: `${source.replace(QLYC_ORIGINAL_HOST, ip)}; Connect Timeout = ${connectTimeoutSec}`,
    user,
    password,
    database,
    timeoutMs: 60000
  }));
}

/** Dòng ns_getListDept thô (tên cột như bản 5.1). */
export type QlycRow = Record<string, unknown>;

/** Thử các máy chủ đồng thời; máy nào trả kết quả trước thì dùng. Tất cả đều lỗi → ném lỗi. */
export async function fetchStandardProjects(currUser: string, connectTimeoutSec = 2): Promise<QlycRow[]> {
  const attempts = qlycConfigs(connectTimeoutSec).map(async (cfg) => {
    const client = new SqlClient(cfg);
    try {
      return await client.callAllowed<QlycRow>('ns_getListDept', [currUser]);
    } finally {
      try { await client.close(); } catch { /* bỏ qua */ }
    }
  });
  try {
    return await Promise.any(attempts);
  } catch (e) {
    // Thông báo lỗi tedious không chứa mật khẩu; chỉ giữ để báo chung.
    const first = (e as AggregateError).errors?.[0];
    const lastError = first instanceof Error ? first.message : '';
    throw new Error(`Không thể kết nối SQL2014ex${lastError ? ` (${lastError})` : ''}`);
  }
}

const str = (v: unknown): string => (v == null ? '' : String(v).trim());

/** Ánh xạ một dòng ns_getListDept sang các trường chung của dự án. Thiếu ma_da → undefined. */
export function rowToProject(r: QlycRow): { project: Omit<ProjectRecord, 'mobileDir' | 'active' | 'mode'>; password: string } | undefined {
  const code = str(r.ma_da);
  if (code === '') return undefined;
  return {
    project: {
      code,
      name: str(r.ten_da),
      menuType: str(r.loai_da) || '2',
      server: str(r.ten_server),
      user: str(r.xuser),
      sysDatabase: str(r.db_sys),
      webSource: withSlash(str(r.dir_src_web)),
      webProgramDir: withSlash(str(r.dir_pro_web)),
      webHost1: str(r.web_host1),
      webHost2: str(r.web_host2)
    },
    password: decodeText(str(r.xpass))
  };
}

/**
 * Gộp danh sách chuẩn vào danh sách hiện có (không ghi ra đâu cả):
 * dự án đã có và còn sử dụng → cập nhật trường chung (như 5.1: dự án tắt không đụng);
 * chưa có → thêm mới (active, mode '1', mobileDir rỗng).
 */
export function mergeStandard(current: ProjectRecord[], rows: QlycRow[]): SyncResult {
  const projects = current.map((p) => ({ ...p }));
  const passwords = new Map<string, string>();
  let updated = 0;
  let added = 0;
  for (const row of rows) {
    const m = rowToProject(row);
    if (!m) continue;
    const found = projects.find((p) => p.code.toLowerCase() === m.project.code.toLowerCase());
    if (found) {
      if (!found.active) continue;
      Object.assign(found, m.project, { code: found.code });
      passwords.set(found.code, m.password);
      updated++;
    } else {
      projects.push({ ...m.project, mobileDir: '', mode: '1', active: true });
      passwords.set(m.project.code, m.password);
      added++;
    }
  }
  return { projects, passwords, updated, added, total: rows.length };
}
