// Lưu giỏ update theo dự án: một file JSON mỗi dự án trong thư mục cho trước (globalStorage/basket).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { emptyBasket, type BasketCategory, type BasketState } from './basket';

/** Tên file an toàn từ mã dự án. */
export function basketFileName(projectCode: string): string {
  return projectCode.replace(/[^\w.-]+/g, '_') + '.basket.json';
}

/** Chuẩn hóa dữ liệu đọc từ đĩa (file hỏng / thiếu trường → giỏ rỗng hoặc bỏ mục lỗi). */
export function parseBasket(raw: unknown): BasketState {
  const s = emptyBasket();
  if (!raw || typeof raw !== 'object') return s;
  const o = raw as Record<string, unknown>;
  if (typeof o.otherAppSql === 'string') s.otherAppSql = o.otherAppSql;
  if (typeof o.otherSysSql === 'string') s.otherSysSql = o.otherSysSql;
  if (Array.isArray(o.items)) {
    for (const x of o.items) {
      if (!x || typeof x !== 'object') continue;
      const i = x as Record<string, unknown>;
      const db = i.db === 'sys' ? 'sys' : 'app';
      if (i.kind === 'data' && typeof i.table === 'string' && typeof i.key === 'string') {
        s.items.push({ kind: 'data', db, table: i.table, key: i.key });
      } else if (i.kind === 'object' && typeof i.name === 'string' && typeof i.category === 'string') {
        s.items.push({
          kind: 'object',
          db,
          category: i.category as BasketCategory,
          name: i.name,
          type: typeof i.type === 'string' ? i.type : '',
          alter: i.alter === true,
          quotedOff: i.quotedOff === true
        });
      }
    }
  }
  return s;
}

export class BasketStore {
  private readonly cache = new Map<string, BasketState>();

  /** dir = thư mục lưu; undefined = chỉ giữ trong bộ nhớ (chưa có globalStorage). */
  constructor(private readonly dir?: string) {}

  /** Giỏ của dự án (nạp từ đĩa lần đầu); sửa trực tiếp rồi gọi save(). */
  get(projectCode: string): BasketState {
    let s = this.cache.get(projectCode);
    if (!s) {
      s = this.read(projectCode);
      this.cache.set(projectCode, s);
    }
    return s;
  }

  save(projectCode: string): void {
    const s = this.get(projectCode);
    if (!this.dir) return;
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, basketFileName(projectCode)), JSON.stringify(s, null, 2), 'utf8');
  }

  private read(projectCode: string): BasketState {
    if (!this.dir) return emptyBasket();
    try {
      return parseBasket(JSON.parse(fs.readFileSync(path.join(this.dir, basketFileName(projectCode)), 'utf8')));
    } catch {
      return emptyBasket();
    }
  }
}
