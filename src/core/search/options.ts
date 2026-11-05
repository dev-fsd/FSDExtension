// Tùy chọn Multi Search (port MultiSearchFileOptions 5.1: ô tick "Loại đối tượng" + các cờ tìm).
// Thuần TypeScript, không phụ thuộc VS Code.

/** Mục tick loại đối tượng (đúng thứ tự 5.1): form = .f, xml = .xml, còn lại là thư mục con của Controllers. */
export const TYPE_KEYS = ['form', 'xml', 'dir', 'filter', 'grid', 'report', 'upload'] as const;
export type TypeKey = (typeof TYPE_KEYS)[number];

export interface SearchRequest {
  /** Thư mục gốc quét (phải nằm trong các gốc của dự án — kiểm ở lớp host). */
  root: string;
  /** Chuỗi tìm: dấu phẩy = nhiều từ. */
  text: string;
  /** Tìm trong nội dung (mặc định tìm theo tên file). */
  content?: boolean;
  /** Đuôi file tùy chọn (".xml" hoặc "xml"); rỗng = mọi đuôi. */
  exts?: string[];
  /** Loại đối tượng tick (xem TYPE_KEYS); rỗng = tất cả. */
  types?: string[];
  /** Thư mục tùy chọn (tương đối từ gốc) thêm vào bộ lọc thư mục. */
  folders?: string[];
  /** Hệ Mobile: gốc controller là App_Data\Controllers\Mobile\, ô Report thành Dashboards. */
  mobile?: boolean;
  /** Tên: đúng tên (stem hoặc tên đủ). Tắt = tên chứa từ khóa. Bỏ qua khi tìm nội dung. */
  exact?: boolean;
  /** Nội dung: phân biệt hoa thường. */
  matchCase?: boolean;
  /** Nội dung: khớp nguyên từ. */
  wholeWord?: boolean;
  /** Nội dung: chuỗi tìm là biểu thức chính quy (không tách dấu phẩy). */
  regex?: boolean;
  /** Số file tối đa (mặc định MAX_FILES). */
  maxFiles?: number;
}

export interface FileHit {
  path: string;
  /** Đường dẫn tương đối từ gốc. */
  rel: string;
  name: string;
  /** yyyy-MM-dd HH:mm */
  modified: string;
  /** Tìm nội dung: các dòng khớp (tối đa MAX_LINES_PER_FILE). */
  lines: Array<{ n: number; text: string }> | null;
}

export interface SearchResult {
  files: FileHit[];
  capped: boolean;
  ms: number;
  root: string;
  cancelled?: boolean;
  /** Số file đã duyệt (để báo tiến độ / thống kê). */
  scanned: number;
}

export interface SearchProgress {
  scanned: number;
  found: number;
}

export const MAX_FILES = 2000;
export const MAX_LINES_PER_FILE = 50;
export const MAX_CONTENT_BYTES = 8 * 1024 * 1024;
export const PARALLEL = 8;
/** Thư mục không quét (5.1: Structure\*, Help\*). */
export const SKIP_FOLDERS = ['structure', 'help'];
/** Tìm nội dung bỏ file nhị phân theo đuôi (5.1 sFileRemove) — trừ khi chính đuôi đó được tick. */
export const BINARY_EXTS = new Set(['rpt', 'exe', 'dll', 'xlsx', 'xls', 'jpg', 'jpeg', 'gif', 'bmp', 'mp3', 'rar', 'zip', '7z', 'tmp', 'ico', 'docx', 'doc', 'pdb', 'png', 'pdf', 'woff', 'woff2', 'ttf', 'eot', 'bak', 'cache']);

/** Chuẩn hóa đuôi: bỏ dấu chấm đầu, chữ thường, bỏ rỗng / trùng. */
export function normalizeExts(exts: string[] | undefined): string[] {
  const out: string[] = [];
  for (const e of exts ?? []) {
    const t = String(e).trim().replace(/^\./, '').toLowerCase();
    if (t !== '' && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Gốc controller của hệ: FBO = App_Data\Controllers\, Mobile = App_Data\Controllers\Mobile\ (tương đối từ gốc quét). */
export function controllerBase(mobile: boolean): string {
  return mobile ? 'App_Data\\Controllers\\Mobile\\' : 'App_Data\\Controllers\\';
}

/** Thư mục vật lý của ô tick (Report ↔ Dashboards theo hệ). */
export function typeFolder(key: TypeKey, mobile: boolean): string | undefined {
  switch (key) {
    case 'dir': return 'Dir';
    case 'filter': return 'Filter';
    case 'grid': return 'Grid';
    case 'upload': return 'Upload';
    case 'report': return mobile ? 'Dashboards' : 'Report';
    default: return undefined;
  }
}

export interface TypeFilter {
  /** Đuôi được phép (rỗng = mọi đuôi). */
  exts: string[];
  /** Thư mục tương đối (chữ thường, kết thúc "\") được phép (rỗng = mọi thư mục). */
  folders: string[];
}

/**
 * Bộ lọc từ các ô tick + đuôi + thư mục tùy chọn. Như 5.1: không tick / tick đủ 7 mục = không giới hạn;
 * form/xml tạo bộ lọc đuôi, Dir/Filter/Grid/Report/Upload tạo bộ lọc thư mục.
 */
export function buildTypeFilter(req: Pick<SearchRequest, 'types' | 'exts' | 'folders' | 'mobile'>): TypeFilter {
  const types = new Set((req.types ?? []).map((t) => String(t).toLowerCase()).filter((t): t is TypeKey => (TYPE_KEYS as readonly string[]).includes(t)));
  const all = types.size === 0 || types.size === TYPE_KEYS.length;
  const exts = normalizeExts(req.exts);
  const folders: string[] = [];
  if (!all) {
    if (types.has('form') && !exts.includes('f')) exts.push('f');
    if (types.has('xml') && !exts.includes('xml')) exts.push('xml');
    const base = controllerBase(req.mobile === true).toLowerCase();
    for (const k of ['dir', 'filter', 'grid', 'report', 'upload'] as TypeKey[]) {
      const f = typeFolder(k, req.mobile === true);
      if (types.has(k) && f) folders.push(base + f.toLowerCase() + '\\');
    }
  }
  for (const raw of req.folders ?? []) {
    let t = String(raw).trim().replace(/\//g, '\\').toLowerCase();
    if (t === '') continue;
    if (!t.endsWith('\\')) t += '\\';
    if (!folders.includes(t)) folders.push(t);
  }
  return { exts, folders };
}

/** File (đường dẫn tương đối từ gốc, dùng "\") có qua bộ lọc thư mục không. */
export function passesFolderFilter(relDir: string, filter: TypeFilter): boolean {
  if (filter.folders.length === 0) return true;
  const d = relDir.toLowerCase().replace(/\//g, '\\');
  const dir = d === '' || d.endsWith('\\') ? d : d + '\\';
  return filter.folders.some((f) => dir.startsWith(f));
}
