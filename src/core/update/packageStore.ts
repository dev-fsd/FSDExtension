// Lưu giỏ update theo dự án (mỗi dự án một gói đang soạn): JSON trong thư mục cho trước (globalStorage/update).
// Thay BasketStore cũ (items data / object): nội dung cũ nếu còn thì đổi sang dòng gen kiểu 5.2.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { type BasketState } from '../basket/basket';
import { parseBasket } from '../basket/basketStore';
import { UPD_COLUMNS, type UpdRow } from './updFile';
import { UpdatePackage } from './package';
import { findCategory } from './catalog';

export function packageFileName(projectCode: string): string {
  return projectCode.replace(/[^\w.-]+/g, '_') + '.package.json';
}

/** Dữ liệu đọc từ đĩa → gói; file hỏng / thiếu trường thì bỏ phần lỗi. */
export function parsePackage(raw: unknown): UpdatePackage {
  const p = new UpdatePackage();
  if (!raw || typeof raw !== 'object') return p;
  const o = raw as Record<string, unknown>;
  if (typeof o.otherAppSql === 'string') p.otherAppSql = o.otherAppSql;
  if (typeof o.otherSysSql === 'string') p.otherSysSql = o.otherSysSql;
  if (typeof o.filePath === 'string') p.filePath = o.filePath;
  if (Array.isArray(o.rows)) {
    for (const x of o.rows) {
      if (!x || typeof x !== 'object') continue;
      const r: UpdRow = {};
      for (const c of UPD_COLUMNS) {
        const v = (x as Record<string, unknown>)[c];
        if (typeof v === 'string') r[c] = v;
      }
      p.rows.push(r);
    }
  }
  return p;
}

/** Giỏ cũ (BasketState) → gói kiểu 5.2. */
export function fromBasket(b: BasketState, scriptGen: string = 'SELECT * FROM %tbl WHERE %key'): UpdatePackage {
  // scriptGen = script GETSCRIPTGEN của system.db; runtime luôn truyền (PackageStore). Mặc định chỉ cho test / khi chưa có.
  const p = new UpdatePackage();
  p.otherAppSql = b.otherAppSql;
  p.otherSysSql = b.otherSysSql;
  for (const i of b.items) {
    if (i.kind === 'data') {
      p.addDataRow(i.table, i.key, i.db === 'sys', scriptGen);
    } else {
      const cat = findCategory(i.category);
      if (cat) p.addCategory(cat, i.name, i.alter, i.quotedOff, i.name, i.type);
      if (i.db === 'sys' && p.rows.length > 0 && cat?.sDatabase !== 'Sys') p.rows[p.rows.length - 1].sDB = 'Sys';
    }
  }
  return p;
}

export class PackageStore {
  private readonly cache = new Map<string, UpdatePackage>();

  /** dir = thư mục lưu; undefined = chỉ giữ trong bộ nhớ. legacyDir = thư mục giỏ cũ (globalStorage/basket) để đổi sang. */
  constructor(private readonly dir?: string, private readonly legacyDir?: string, private readonly scriptGen?: () => string) {}

  get(projectCode: string): UpdatePackage {
    let p = this.cache.get(projectCode);
    if (!p) {
      p = this.read(projectCode);
      this.cache.set(projectCode, p);
    }
    return p;
  }

  save(projectCode: string): void {
    const p = this.get(projectCode);
    if (!this.dir) return;
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, packageFileName(projectCode)), JSON.stringify({ rows: p.rows, otherAppSql: p.otherAppSql, otherSysSql: p.otherSysSql, filePath: p.filePath }, null, 2), 'utf8');
  }

  private read(projectCode: string): UpdatePackage {
    if (!this.dir) return new UpdatePackage();
    try {
      return parsePackage(JSON.parse(fs.readFileSync(path.join(this.dir, packageFileName(projectCode)), 'utf8')));
    } catch {
      /* chưa có / hỏng: thử giỏ cũ */
    }
    if (this.legacyDir) {
      try {
        const name = projectCode.replace(/[^\w.-]+/g, '_') + '.basket.json';
        const b = parseBasket(JSON.parse(fs.readFileSync(path.join(this.legacyDir, name), 'utf8')));
        if (b.items.length > 0 || b.otherAppSql !== '' || b.otherSysSql !== '') return fromBasket(b, this.scriptGen?.());
      } catch {
        /* không có giỏ cũ */
      }
    }
    return new UpdatePackage();
  }
}
