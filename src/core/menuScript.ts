// Dựng script DELETE + INSERT của dòng menu (lệnh "Xem script menu", tương đương ViewScriptMenu của FSD Studio).
// Hàm thuần, không dùng vscode. Giá trị rỗng (SqlClient đổi NULL thành '') được ghi là chuỗi rỗng.

/** Một giá trị cột → literal T-SQL. */
export function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (v instanceof Date) {
    const p = (n: number, w = 2): string => String(n).padStart(w, '0');
    return `'${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())} ${p(v.getUTCHours())}:${p(v.getUTCMinutes())}:${p(v.getUTCSeconds())}.${p(v.getUTCMilliseconds(), 3)}'`;
  }
  if (v instanceof Uint8Array) return '0x' + Buffer.from(v).toString('hex');
  return `N'${String(v).replace(/'/g, "''")}'`;
}

/** DELETE theo cột khóa + INSERT từng dòng. */
export function buildRowScript(table: string, keyColumn: string, rows: Array<Record<string, unknown>>): string {
  const out: string[] = [];
  for (const r of rows) {
    const cols = Object.keys(r);
    out.push(`DELETE FROM ${table} WHERE ${keyColumn} = ${sqlLiteral(r[keyColumn])}`);
    out.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => sqlLiteral(r[c])).join(', ')})`);
  }
  return out.join('\n');
}
