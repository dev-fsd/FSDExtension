// Mẫu tên file của Multi Search (port clsFileSearchService + FileSearchTokenClassifier của FSD Studio 5.1, chế độ MultiSearch).
// Từ khóa: dấu phẩy = nhiều từ; "Dir\X" = thư mục cha phải đúng tên Dir; * ? = wildcard (khớp cả tên); có đuôi (X.xml) = chỉ đuôi đó.
// Thuần TypeScript, không phụ thuộc VS Code.

/** Ký tự Windows cấm trong tên file: lọt vào mẫu thì kết quả chắc chắn rỗng nên bỏ từ khóa đó (không ném lỗi). */
const INVALID_PATTERN_CHARS = /["<>|:\u0000]/;

export interface NameToken {
  /** Từ khóa gốc (đã trim). */
  raw: string;
  /** Khớp tên file (không phân biệt hoa thường). */
  name: RegExp;
  /** Các segment thư mục cha phải kết thúc đúng như vậy (rỗng = không ràng buộc). */
  folderHint: string[];
  /** Đuôi (không dấu chấm, chữ thường) được phép; undefined = mọi đuôi. */
  exts: string[] | undefined;
}

/** Tách đường dẫn thành các segment, bỏ segment rỗng, chấp nhận cả "\" lẫn "/". */
export function splitSegments(p: string): string[] {
  return (p ?? '').split(/[\\/]/).filter((s) => s.length > 0);
}

export function hasWildcard(s: string): boolean {
  return s.includes('*') || s.includes('?');
}

/** Mẫu wildcard → mảnh regex (không có ^ $); ký tự còn lại escape nguyên văn. */
export function wildcardFragment(keyword: string): string {
  let out = '';
  for (const ch of keyword) {
    if (ch === '*') out += '.*';
    else if (ch === '?') out += '.';
    else out += ch.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
  }
  return out;
}

/** Tách "a\b\ten" → tên "ten" + gợi ý thư mục ["a","b"]. */
export function parseKeywordToken(raw: string): { namePattern: string; folderHint: string[] } {
  const segs = splitSegments((raw ?? '').trim());
  if (segs.length === 0) return { namePattern: '', folderHint: [] };
  return { namePattern: segs[segs.length - 1], folderHint: segs.slice(0, -1) };
}

/** Các từ khóa phân tách bằng dấu phẩy (đã trim, bỏ rỗng). */
export function parseCommaTokens(text: string): string[] {
  return (text ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** Phần "đuôi" của tên trong từ khóa (không dấu chấm, chữ thường) hoặc ''. */
function extOfName(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

/**
 * Đuôi theo rule token chế độ MultiSearch (FileSearchTokenClassifier.ClassifyTokenExtensions):
 * có đuôi → đúng đuôi đó; không đuôi → mọi đuôi (undefined).
 */
export function classifyTokenExtensions(token: string): string[] | undefined {
  const { namePattern } = parseKeywordToken(token);
  const ext = extOfName(namePattern);
  return ext === '' ? undefined : [ext];
}

/** Giao đuôi theo token với bộ lọc loại file trên UI (IntersectWithUiFilter): rỗng → noMatch (token bị loại). */
export function intersectExts(plan: string[] | undefined, ui: string[] | undefined): { exts: string[] | undefined; noMatch: boolean } {
  if (!plan && !ui) return { exts: undefined, noMatch: false };
  if (!plan) return { exts: ui, noMatch: false };
  if (!ui) return { exts: plan, noMatch: false };
  const inter = plan.filter((p) => ui.some((u) => u === p));
  return inter.length === 0 ? { exts: [], noMatch: true } : { exts: inter, noMatch: false };
}

/**
 * Mảnh regex tên. Exact + không wildcard: stem hoặc tên đầy đủ (đuôi thật tùy chọn, không khớp tên dài hơn);
 * wildcard: khớp cả tên; còn lại: tên chứa từ khóa.
 */
function nameRegex(namePattern: string, exact: boolean): RegExp {
  const fragment = wildcardFragment(namePattern);
  let source: string;
  if (hasWildcard(namePattern)) source = `^${fragment}$`;
  else if (exact) source = `^${fragment}(?:\\.[^.]+)?$`;
  else source = fragment;
  return new RegExp(source, 'i');
}

/**
 * Dựng danh sách token từ chuỗi người dùng gõ. Bỏ trùng, bỏ token có ký tự cấm, token bị bộ lọc đuôi loại hết.
 * uiExts = đuôi tick trên UI (undefined = mọi đuôi).
 */
export function buildNameTokens(text: string, opts: { exact?: boolean; uiExts?: string[] }): NameToken[] {
  const tokens: NameToken[] = [];
  const seen = new Set<string>();
  for (const raw of parseCommaTokens(text)) {
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const { namePattern, folderHint } = parseKeywordToken(raw);
    if (namePattern === '' || INVALID_PATTERN_CHARS.test(namePattern) || folderHint.some((s) => INVALID_PATTERN_CHARS.test(s))) continue;
    const resolved = intersectExts(classifyTokenExtensions(raw), opts.uiExts);
    if (resolved.noMatch) continue;
    tokens.push({ raw, name: nameRegex(namePattern, opts.exact === true), folderHint, exts: resolved.exts });
  }
  return tokens;
}

/** Thư mục chứa file phải kết thúc đúng bằng hint, so từng segment trọn vẹn (Dir không khớp SubDir). */
export function folderSegmentsMatch(folderSegments: string[], hint: string[]): boolean {
  if (hint.length === 0) return true;
  if (hint.length > folderSegments.length) return false;
  const offset = folderSegments.length - hint.length;
  return hint.every((h, i) => folderSegments[offset + i].toLowerCase() === h.toLowerCase());
}

/** Token có khớp file (tên + thư mục cha + đuôi) không. fileName có đuôi; folderSegments là các segment thư mục cha. */
export function tokenMatches(t: NameToken, fileName: string, folderSegments: string[]): boolean {
  if (t.exts && t.exts.length > 0 && !t.exts.includes(extOfName(fileName))) return false;
  if (!t.name.test(fileName)) return false;
  return folderSegmentsMatch(folderSegments, t.folderHint);
}

export function fileExt(fileName: string): string {
  return extOfName(fileName);
}
