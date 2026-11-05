// ===== PHẦN THÊM CỦA EXTENSION (không có trong 5.1) =====
// 5.1 ghi thẳng từng câu qua SqlS.Execute, không guard, không transaction, không kiểm lại. Extension ghi vào DB thật từ VS Code
// nên bọc quanh các câu "lõi" (chép từ 5.1, xem sql51.ts / autoCommand.ts) một lớp an toàn:
//   - guard đầu batch: kết nối phải đang ở đúng DB Sys của dự án (đúng quy tắc IF … RAISERROR … RETURN cùng batch);
//   - kiểm trong batch (cha có, mã không trùng…) để chặn cả khi dữ liệu đổi giữa lúc kiểm và lúc ghi;
//   - sau câu lõi cần có dòng bị ảnh hưởng: IF @@ROWCOUNT = 0 báo lỗi (5.1 im lặng khi UPDATE không trúng dòng nào);
//   - SELECT kiểm lại sau khi ghi.
// QUY ƯỚC: lớp này chỉ THÊM câu trước / sau, KHÔNG sửa chữ nào của câu lõi — câu lõi đi nguyên văn vào batch.
import { esc } from './spec';

const lit = (s: string): string => `N'${esc(s)}'`;

/** Guard đầu mọi batch ghi: kết nối phải đang ở đúng DB Sys của dự án. */
export function guardDb(sysDb: string): string {
  return `SET NOCOUNT ON\nIF DB_NAME() <> ${lit(sysDb)} BEGIN RAISERROR(N'Sai DB: câu ghi chỉ chạy trên DB Sys của dự án.', 16, 1) RETURN END`;
}

/** Báo lỗi rồi thoát batch (dùng sau IF …). */
export const raise = (msg: string): string => `BEGIN RAISERROR(${lit(msg)}, 16, 1) RETURN END`;

/** IF NOT EXISTS (dòng có mã) → báo lỗi. */
export const requireRow = (table: string, keyCol: string, id: string, msg: string): string =>
  `IF NOT EXISTS (SELECT 1 FROM ${table} WHERE ${keyCol} = ${lit(id)}) ${raise(msg)}`;

/** IF EXISTS (dòng có mã) → báo lỗi. */
export const forbidRow = (table: string, keyCol: string, id: string, msg: string): string =>
  `IF EXISTS (SELECT 1 FROM ${table} WHERE ${keyCol} = ${lit(id)}) ${raise(msg)}`;

/** Sau câu lõi: không dòng nào bị ảnh hưởng → báo lỗi. */
export const requireAffected = (msg: string): string => `IF @@ROWCOUNT = 0 ${raise(msg)}`;

/** Một câu lõi (nguyên văn 5.1) kèm yêu cầu kiểm dòng bị ảnh hưởng của extension. */
export interface CoreStatement {
  sql: string;
  /** Có giá trị = thêm IF @@ROWCOUNT = 0 báo lỗi với câu này. */
  mustAffect?: string;
}

export interface WrapArgs {
  sysDb: string;
  /** Kiểm trước (IF … RAISERROR). */
  checks?: string[];
  /** Câu lõi chép từ 5.1, chạy đúng thứ tự. */
  core: CoreStatement[];
  /** SELECT kiểm lại sau khi ghi. */
  verify?: string;
}

/** Ghép batch: guard → kiểm → câu lõi (kèm kiểm dòng ảnh hưởng) → verify. */
export function wrapBatch(a: WrapArgs): string {
  const out: string[] = [guardDb(a.sysDb), ...(a.checks ?? [])];
  for (const c of a.core) {
    out.push(c.sql);
    if (c.mustAffect) out.push(requireAffected(c.mustAffect));
  }
  if (a.verify) out.push(a.verify);
  return out.join('\n');
}

/** Script lớn của 5.1 (AUTO_MAIN / AUTO_NEW) chạy sau guard — nguyên văn, không chèn gì vào giữa. */
export function guardedScript(sysDb: string, script: string): string {
  return `${guardDb(sysDb)}\n${script}`;
}
