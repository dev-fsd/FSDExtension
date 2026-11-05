// Quét file Multi Search: duyệt cây thư mục song song (8 luồng như 5.1), tìm theo tên hoặc nội dung, hủy được qua AbortSignal.
// Chỉ đọc đĩa; thuần Node (test được không cần VS Code).
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FControllerCrypto } from '../controllers/fCrypto';
import { buildContentMatcher } from './content';
import {
  BINARY_EXTS,
  MAX_CONTENT_BYTES,
  MAX_FILES,
  PARALLEL,
  SKIP_FOLDERS,
  buildTypeFilter,
  passesFolderFilter,
  type FileHit,
  type SearchProgress,
  type SearchRequest,
  type SearchResult
} from './options';
import { buildNameTokens, fileExt, splitSegments, tokenMatches } from './pattern';
import { formatTime, readSearchText } from './readText';

export interface RunOptions {
  signal?: AbortSignal;
  /** Báo tiến độ (tối đa vài lần mỗi giây). */
  onProgress?: (p: SearchProgress) => void;
  /** Có khóa thì .f được giải vùng mã hóa trong bộ nhớ khi so khớp nội dung. */
  crypto?: FControllerCrypto;
}

const PROGRESS_MS = 250;

const withSep = (p: string): string => (/[\\/]$/.test(p) ? p : p + path.sep);

/** Tìm file trong req.root theo tên (mặc định) hoặc nội dung. Cấm quét ngoài root — việc kiểm root thuộc lớp host. */
export async function runSearch(req: SearchRequest, opts: RunOptions = {}): Promise<SearchResult> {
  const text = (req.text ?? '').trim();
  if (text === '') throw new Error('Chưa nhập từ khóa.');
  const root = withSep((req.root ?? '').trim());
  let isDir = false;
  try {
    isDir = (await fs.promises.stat(root)).isDirectory();
  } catch {
    isDir = false;
  }
  if (root.trim() === '' || !isDir) throw new Error('Không vào được thư mục ' + root);

  const started = Date.now();
  const max = req.maxFiles && req.maxFiles > 0 ? req.maxFiles : MAX_FILES;
  const filter = buildTypeFilter(req);
  const uiExts = filter.exts.length > 0 ? filter.exts : undefined;
  const content = req.content === true;
  const matcher = content ? buildContentMatcher(text, req) : undefined;
  if (content && !matcher) throw new Error('Chưa nhập từ khóa.');
  const tokens = content ? [] : buildNameTokens(text, { exact: req.exact, uiExts });
  const signal = opts.signal;

  const hits: FileHit[] = [];
  let scanned = 0;
  let capped = false;
  let lastProgress = 0;
  const stop = (): boolean => signal?.aborted === true || capped;
  const report = (force: boolean): void => {
    if (!opts.onProgress) return;
    const now = Date.now();
    if (!force && now - lastProgress < PROGRESS_MS) return;
    lastProgress = now;
    opts.onProgress({ scanned, found: hits.length });
  };

  const addHit = async (full: string, name: string, lines: FileHit['lines']): Promise<void> => {
    if (hits.length >= max) {
      capped = true;
      return;
    }
    let modified = '';
    try {
      modified = formatTime((await fs.promises.stat(full)).mtime, false);
    } catch {
      /* file vừa bị xóa: vẫn báo, không có giờ sửa */
    }
    if (hits.length >= max) {
      capped = true;
      return;
    }
    hits.push({ path: full, rel: full.slice(root.length), name, modified, lines });
    if (hits.length >= max) capped = true;
  };

  const processDir = async (dir: string, queue: string[]): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return; // không đủ quyền / mất kết nối: bỏ qua thư mục này như 5.1
    }
    const relDir = dir.slice(root.length);
    const dirSegments = splitSegments(dir);
    const folderOk = passesFolderFilter(relDir, filter);
    for (const e of entries) {
      if (stop()) return;
      if (e.isDirectory()) {
        if (!SKIP_FOLDERS.includes(e.name.toLowerCase())) queue.push(path.join(dir, e.name));
        continue;
      }
      if (!e.isFile() || !folderOk) continue;
      scanned++;
      const ext = fileExt(e.name);
      if (filter.exts.length > 0 && !filter.exts.includes(ext)) continue;
      const full = path.join(dir, e.name);
      if (!content) {
        if (tokens.some((t) => tokenMatches(t, e.name, dirSegments))) await addHit(full, e.name, null);
      } else if (matcher) {
        if (filter.exts.length === 0 && BINARY_EXTS.has(ext)) continue;
        const body = await readSearchText(full, MAX_CONTENT_BYTES, opts.crypto);
        if (body === undefined || !matcher.matchesBody(body)) continue;
        await addHit(full, e.name, matcher.matchLines(body));
      }
      report(false);
    }
  };

  // Hồ công việc: tối đa PARALLEL thư mục xử lý cùng lúc, thư mục con đẩy vào hàng đợi.
  await new Promise<void>((resolve) => {
    const queue: string[] = [root.replace(/[\\/]+$/, '') + path.sep];
    let running = 0;
    const pump = (): void => {
      while (running < PARALLEL && queue.length > 0 && !stop()) {
        const dir = queue.pop() as string;
        running++;
        processDir(dir.replace(/[\\/]+$/, '') === '' ? dir : dir.replace(/[\\/]+$/, '') + path.sep, queue)
          .catch(() => undefined)
          .finally(() => {
            running--;
            pump();
          });
      }
      if (running === 0 && (queue.length === 0 || stop())) resolve();
    };
    pump();
  });

  // Mới sửa lên đầu (khóa yyyy-MM-dd HH:mm), cùng giờ thì theo đường dẫn.
  hits.sort((a, b) => (a.modified === b.modified ? a.path.localeCompare(b.path) : a.modified < b.modified ? 1 : -1));
  report(true);
  const result: SearchResult = { files: hits, capped, ms: Date.now() - started, root, scanned };
  if (signal?.aborted) result.cancelled = true;
  return result;
}
