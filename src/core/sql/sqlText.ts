// Xử lý văn bản SQL thuần (không kết nối): bỏ chuỗi / comment, tách batch theo GO, dò câu ghi.
// Dùng cho Query (BA 6.5) và guard SELECT-only của SqlClient.

/** Bỏ chuỗi 'literal' (thay bằng '') và comment (thay bằng một khoảng trắng) để kiểm tra cấu trúc câu lệnh. */
export function stripLiteralsAndComments(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const n = sql[i + 1];
    if (c === '-' && n === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      out += ' ';
    } else if (c === '/' && n === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 2;
      out += ' ';
    } else if (c === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { i += 2; continue; }
          break;
        }
        i++;
      }
      i++;
      out += "''";
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export interface SqlBatch {
  /** Nội dung gửi lên server (không gồm dòng GO). */
  text: string;
  /** Dòng (1-based) của dòng đầu batch trong văn bản gốc; dòng lỗi gốc = line + lineNumber - 1. */
  line: number;
}

const RX_GO = /^\s*GO(?:\s+\d+)?\s*(?:--.*)?$/i;

/**
 * Tách batch như SSMS: dòng chỉ có GO (không phân biệt hoa thường, có thể kèm số lần và comment `--`) là dấu phân cách.
 * GO nằm trong chuỗi '…' hoặc comment /* … *\/ nhiều dòng thì không tính. Batch toàn khoảng trắng bị bỏ.
 * Số lần sau GO (GO 5) bị bỏ qua — vẫn chỉ chạy một lần.
 */
export function splitBatches(sql: string): SqlBatch[] {
  const lines = sql.split(/\r\n|\n|\r/);
  const out: SqlBatch[] = [];
  let cur: string[] = [];
  let curLine = 1;
  let depth = 0;
  let inStr = false;

  const flush = (nextLine: number): void => {
    const text = cur.join('\n');
    if (text.trim() !== '') out.push({ text, line: curLine });
    cur = [];
    curLine = nextLine;
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (depth === 0 && !inStr && RX_GO.test(ln)) {
      flush(i + 2);
      continue;
    }
    cur.push(ln);
    // Cập nhật trạng thái chuỗi / comment đến hết dòng.
    for (let j = 0; j < ln.length; j++) {
      const c = ln[j];
      const n = ln[j + 1];
      if (depth > 0) {
        if (c === '*' && n === '/') { depth--; j++; }
        else if (c === '/' && n === '*') { depth++; j++; }
      } else if (inStr) {
        if (c === "'") inStr = false; // '' liền nhau: đóng rồi mở lại ngay ở ký tự kế
      } else if (c === "'") {
        inStr = true;
      } else if (c === '-' && n === '-') {
        break;
      } else if (c === '/' && n === '*') {
        depth++;
        j++;
      }
    }
  }
  flush(lines.length + 1);
  return out;
}

/** Các từ khóa ghi cần xác nhận trước khi chạy (EXECUTE tính là EXEC). */
const RX_WRITE = /(?<![\w@#$.])(insert|update|delete|drop|alter|create|truncate|exec|execute|merge|use)(?![\w$#@])/gi;
/** SELECT … INTO bảng (bỏ INSERT INTO, MERGE INTO, FETCH … INTO @biến). */
const RX_SELECT_INTO = /(?<![\w@#$.])(?<!(?:insert|merge)\s+)into\s+(?!@)/i;
/** Từ đầu batch không phải gọi store: batch bắt đầu bằng tên khác là gọi store không có EXEC (T-SQL cho phép). */
const RX_NOT_PROC_CALL = /^(select|with|declare|set|print|if|begin|while|return|commit|rollback|waitfor|insert|update|delete|drop|alter|create|truncate|exec|execute|merge|use)$/i;

/**
 * Từ khóa cần xác nhận có trong câu SQL (INSERT UPDATE DELETE DROP ALTER CREATE TRUNCATE EXEC MERGE USE, SELECT INTO, gọi store không có EXEC), chữ hoa, không lặp.
 * Bỏ qua comment, chuỗi 'literal', tên [trong ngoặc] / "trong nháy kép", biến @x, tên có tiền tố (dbo.update, #delete).
 * Rỗng = câu chỉ đọc theo cách dò này.
 */
export function detectWrites(sql: string): string[] {
  const clean = stripLiteralsAndComments(sql).replace(/\[[^\]]*\]/g, ' ').replace(/"[^"]*"/g, ' ');
  const found: string[] = [];
  for (const m of clean.matchAll(RX_WRITE)) {
    const w = m[1].toUpperCase() === 'EXECUTE' ? 'EXEC' : m[1].toUpperCase();
    if (!found.includes(w)) found.push(w);
  }
  if (RX_SELECT_INTO.test(clean)) found.push('SELECT INTO');
  for (const b of splitBatches(clean)) {
    const first = /^\s*([A-Za-z_][\w.$#]*)/.exec(b.text)?.[1];
    if (first && !RX_NOT_PROC_CALL.test(first) && !found.includes('EXEC')) found.push('EXEC');
  }
  return found;
}
