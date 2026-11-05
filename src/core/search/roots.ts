// Các gốc tìm file theo dự án (5.2 SearchService.Roots): Controllers / Web / Mobile / thư mục dự án (Other).
// Chỉ tính đường dẫn từ bản ghi dự án — không chạm đĩa; host lọc thêm gốc nào truy cập được.
import * as path from 'node:path';
import { mobileRoot, webRoot } from '../projects/projectStore';
import type { ProjectRecord } from '../types';

export interface SearchRoot {
  id: 'ctl' | 'web' | 'mobile' | 'other';
  name: string;
  /** Có "\" cuối. */
  path: string;
}

const withSlash = (p: string): string => (p !== '' && !/[\\/]$/.test(p) ? p + '\\' : p);

/** Cha của thư mục web (5.2 PackagePaths.OtherRoot); không có cha thì chính thư mục web. */
function otherRoot(web: string): string {
  if (web === '') return '';
  const parent = path.win32.dirname(web.replace(/[\\/]+$/, ''));
  return parent !== '' && parent !== '.' ? withSlash(parent) : web;
}

/** webRoot = web_source (trống thì webprogram_dir). */
export function searchRoots(p: ProjectRecord, mobileReachable: (dir: string) => boolean = () => true): SearchRoot[] {
  const list: SearchRoot[] = [];
  const web = webRoot(p);
  if (web !== '') {
    list.push({ id: 'ctl', name: 'Controllers', path: web + 'App_Data\\Controllers\\' });
    list.push({ id: 'web', name: 'Web', path: web });
  }
  const mob = mobileRoot(p);
  if (mob !== '' && mobileReachable(mob)) list.push({ id: 'mobile', name: 'Mobile', path: mob });
  const other = otherRoot(web);
  if (other !== '') list.push({ id: 'other', name: 'Dự án', path: other });
  return list;
}

/** Chuẩn hóa (bỏ "..", "/" → "\", có "\" cuối, chữ thường) để so sánh đường dẫn. */
const norm = (p: string): string => withSlash(path.win32.normalize(p.trim().replace(/\//g, '\\'))).toLowerCase();

/** target nằm trong (hoặc bằng) một gốc cho phép. */
export function isUnderRoots(target: string, roots: string[]): boolean {
  const t = norm(target);
  const bare = t.replace(/\\+$/, '');
  return roots.some((r) => {
    const n = norm(r);
    return t.startsWith(n) || bare === n.replace(/\\+$/, '');
  });
}
