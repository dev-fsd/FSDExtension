// Script SQL xuất từ system.db của FSD Studio 5.2 (bảng `script`) vào resources/scripts/<TEN>.sql.
// Đọc một lần rồi giữ trong bộ nhớ; nội dung đã trim như ProjectService.SystemScript của 5.2.
import * as fs from 'fs';
import * as path from 'path';

/** Thay mọi chỗ khớp theo nghĩa đen (không hiểu "$&", "$1"… như String.replace — tên bảng kỳ có "$"). */
export function replaceAll(text: string, find: string, value: string): string {
  return text.split(find).join(value);
}

export class ScriptStore {
  private readonly cache = new Map<string, string>();

  constructor(readonly dir: string) {}

  /** Nội dung script; thiếu file → ném lỗi nêu tên (như "system.db thiếu script …" của 5.2). */
  get(id: string): string {
    let s = this.cache.get(id);
    if (s === undefined) {
      const file = path.join(this.dir, `${id}.sql`);
      if (!fs.existsSync(file)) throw new Error(`Thiếu script ${id} (resources/scripts/${id}.sql).`);
      s = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').trim();
      this.cache.set(id, s);
    }
    return s;
  }
}
