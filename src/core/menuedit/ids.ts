// Cấp mã menu_id kế tiếp — port AllocateNextFboCommandMenuId (frmWCommandUpdate.vb:1232–1255) và
// AllocateNextMobileMenuId (frmDVCommand.vb:747–770): MAX theo tiền tố + 1; hai ký tự cuối không phải số < 99 → ff_IncreaseSeq.
// ff_IncreaseSeq trong 5.1 là hàm T-SQL do script tự cấp tạo (autoCommand.ts, dòng ff_Dec2Seq / ff_Seq2Dec / ff_IncreaseSeq);
// ở đây port từng dòng sang số học JS (không phụ thuộc hàm đã có trong DB) — test\menuedit\ids.test.ts đối chiếu với bản chuyển
// nguyên văn các vòng lặp T-SQL trên toàn bộ mã 1–2 ký tự [0-9A-Z].
import { txt } from './spec';

/** ff_Seq2Dec: mỗi ký tự = ASCII - (ASCII < 58 ? 48 : 55), cộng dồn theo hệ 36. */
export function seq2Dec(seq: string): number {
  let n = 0;
  for (let i = 0; i < seq.length; i++) {
    const a = seq.charCodeAt(i);
    n = n * 36 + (a - (a < 58 ? 48 : 55));
  }
  return n;
}

/** ff_Dec2Seq: chia 36 lặp; dư < 10 → chữ số, còn lại CHAR(dư + 55). Số ≤ 0 → chuỗi rỗng (vòng WHILE không chạy). */
export function dec2Seq(dec: number): string {
  let out = '';
  let q = dec;
  while (q > 0) {
    const rem = q % 36;
    q = Math.floor(q / 36);
    out = (rem < 10 ? String(rem) : String.fromCharCode(rem + 55)) + out;
  }
  return out;
}

/** ff_IncreaseSeq = ff_Dec2Seq(ff_Seq2Dec(s) + 1). */
export function increaseSeq(seq: string): string {
  return dec2Seq(seq2Dec(seq) + 1);
}

/** VB Strings.Right(s, n). */
function right(s: string, n: number): string {
  return s.length <= n ? s : s.slice(s.length - n);
}

/** Integer.TryParse mặc định của VB: cho phép khoảng trắng hai đầu và dấu +/- đầu. */
function tryParseInt(s: string): number | undefined {
  return /^\s*[+-]?\d+\s*$/.test(s) ? parseInt(s, 10) : undefined;
}

/**
 * Mã kế tiếp theo tiền tố 6 ký tự (vd "88.01.", "M1.01."): chưa có mã nào → <tiền tố>01; hai ký tự cuối là số < 99 → +1 (đệm 2 chữ số);
 * ngược lại tăng theo ff_IncreaseSeq và lấy 2 ký tự cuối (Strings.Right("0" + x, 2) của 5.1). `max` = MAX(menu_id) LIKE '<tiền tố>%'.
 */
export function nextMenuId(max: string | null | undefined, prefix: string): string {
  const head = prefix.slice(0, 6);
  const cur = txt(max);
  if (cur === '') return head + '01';
  const child = right(cur, 2);
  const n = tryParseInt(child);
  if (n !== undefined && n < 99) return head + right('0' + String(n + 1), 2);
  const next = increaseSeq(child).trim();
  if (next === '') throw new Error(`Không tăng được menu_id sau [${cur}].`);
  return head + right('0' + next, 2);
}

/** FB: 3 ký tự đầu của mã (Microsoft.VisualBasic.Left(s, 3)). */
export function left3(s: string): string {
  return s.length > 3 ? s.slice(0, 3) : s;
}

/** Tiền tố command theo loại menu FBO: D / V → 88.01., còn lại 88.02. (frmWCommandUpdate.vb:1233–1234). */
export function commandPrefix(type: string): string {
  const t = type.trim().toUpperCase();
  return t === 'D' || t === 'V' ? '88.01.' : '88.02.';
}

/** Tiền tố menu_id Mobile theo xtype: D / V → M1.01., còn lại M1.02. (frmDVCommand.vb:748–749). */
export function mobilePrefix(xtype: string): string {
  const t = xtype.trim().toUpperCase();
  return t === 'D' || t === 'V' ? 'M1.01.' : 'M1.02.';
}
