// Điền sẵn ô tìm khi chọn menu (UpdateExplorer.ForMenu 5.2): file dò theo cấu trúc sysid (.f trước, không có .f mới .xml),
// ô SQL, ô Content Declare. FB (desktop) giữ cách điền của 5.1 _MenuChange.
import type { MenuFile, MenuStructureResult } from '../types';
import { normalizeDir } from './packagePaths';

export interface MenuContextArgs {
  /** fbo / mob / fb */
  kind: string;
  sysid: string;
  syscode: string;
  /** D danh mục, V chứng từ, rỗng = báo cáo. */
  xtype: string;
  /** .aspx của FBO, .exe của FB. */
  link: string;
  /** Thư mục Program. */
  root: string;
}

export interface MenuContextDeps {
  /** Dò controller của menu (scanMenu của core/controllers). */
  scan(controllersDir: string, sysid: string, mobile: boolean): Promise<MenuStructureResult>;
  fileExists(p: string): boolean;
}

export interface MenuSearch {
  sql: string;
  other: string;
  file: string;
  /** FBO / Mobile: file dò được (đường dẫn đầy đủ); FB: null. */
  files: string[] | null;
  fellBack: string[];
}

/** File đưa vào gói: controller có .f thì lấy .f, không thì .xml; file mẫu giữ nguyên; file khai báo mà thiếu thì bỏ. */
export function packageFileOf(f: MenuFile): string | undefined {
  if (f.missing) return undefined;
  if (!f.hasF && !f.hasXml) return f.path;
  const stem = f.path.replace(/\.(xml|f)$/i, '');
  return f.hasF ? stem + '.f' : stem + '.xml';
}

export async function forMenu(a: MenuContextArgs, deps: MenuContextDeps): Promise<MenuSearch> {
  const sysid = (a.sysid ?? '').trim();
  const syscode = (a.syscode ?? '').trim();
  const xtype = (a.xtype ?? '').trim();
  const link = (a.link ?? '').trim();
  const root = normalizeDir(a.root);
  const r: MenuSearch = { sql: '', other: '', file: '', files: null, fellBack: [] };

  if (a.kind === 'fb') {
    let key = sysid;
    if (xtype === 'V' && syscode !== '' && key.length > 4) key = key.substring(0, key.length - 4);
    if (syscode !== '') key += ',' + syscode;
    if (xtype === 'V') r.other = key;
    if (xtype === '' && sysid !== '') {
      key = sysid;
      if (key.toLowerCase().startsWith('zc')) key = key.slice(0, 2) + '_' + key.slice(2);
      r.sql = key;
    }
    if (link !== '') {
      key = link;
      if (key.indexOf('.') > -1) key = key.substring(0, key.indexOf('.'));
      if (key.toLowerCase().startsWith('zc')) key = '*' + key.substring(2);
      r.file = key;
    }
    return r;
  }

  const mobile = a.kind === 'mob';
  const ctrl = root + (mobile ? 'App_Data\\Controllers\\Mobile\\' : 'App_Data\\Controllers\\');
  const s = await deps.scan(ctrl, sysid, mobile);
  const files: string[] = [];
  if (!mobile && link !== '' && deps.fileExists(root + 'Main\\' + link)) files.push(root + 'Main\\' + link);
  for (const f of s.files) {
    const p = packageFileOf(f);
    if (p && !files.some((x) => x.toLowerCase() === p.toLowerCase())) files.push(p);
  }
  r.files = files;
  r.fellBack = s.fellBack;
  r.file = files.map((f) => (f.toLowerCase().startsWith(ctrl.toLowerCase()) ? f.substring(ctrl.length) : f.substring(root.length))).join(', ');
  if (mobile) return r;

  if (xtype === 'D') {
    if (s.tables.length > 0) r.sql = s.tables.join(', ');
    else if (sysid.toLowerCase().startsWith('zc') && sysid.length > 2) r.sql = sysid.substring(2);
  }
  // Báo cáo (xtype rỗng): rptSalesOrderList → *tSalesOrderList
  if (xtype === '' && sysid.length > 2) r.sql = '*' + sysid.substring(2);
  let k = sysid;
  if (xtype === 'V' && syscode !== '' && k.length > 4) k = k.substring(0, k.length - 4);
  if (syscode !== '') r.other = k + (k === '' ? '' : ',') + syscode;
  return r;
}
