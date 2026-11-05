// Bảng log (*$log): tên, câu đồng bộ cột khi Add / Alter / Drop cột bảng gốc, kiểm tình trạng, script sắp xếp lại cột.
// Port từ FSDStudioSrc\Features\LogTable\LogTableScript.vb — giữ nguyên chuỗi SQL sinh ra (gói update 5.1 / 5.2 phải giống nhau).

const NL = '\r\n';

export interface LogTableStatus {
  exists: boolean;
  /** Số cột bảng gốc mà bảng log chưa có. */
  missingCount: number;
  /** Số cột bảng log đang đứng sai vị trí. */
  misorderedCount: number;
}

export function needReorder(s: LogTableStatus): boolean {
  return s.exists && (s.missingCount > 0 || s.misorderedCount > 0);
}

function lit(value: string): string {
  return value.trim().replace(/'/g, "''");
}

function quote(name: string): string {
  return `[${name.trim().replace(/]/g, ']]')}]`;
}

/** Tên bảng log từ tên bảng gốc (bảng phân kỳ truyền dạng m46$): m46$ → m46$log; dmkh → dmkh$log. */
export function getLogTableName(baseTable: string): string {
  const name = baseTable.trim();
  if (name === '') return '';
  if (name.endsWith('$')) return name + 'log';
  const i = name.indexOf('$');
  if (i >= 0) return name.slice(0, i + 1) + 'log';
  return name + '$log';
}

/** Tên bảng log kiểu cũ (không có $): m52$ → m52log; dmtk → dmtklog. */
export function getLegacyLogTableName(baseTable: string): string {
  let name = baseTable.trim();
  if (name === '') return '';
  const i = name.indexOf('$');
  if (i >= 0) name = name.slice(0, i);
  return name + 'log';
}

/** Bảng đang chọn đã là bảng log (không sinh log cho log). */
export function isLogTable(tableName: string): boolean {
  return tableName.trim().toLowerCase().endsWith('$log');
}

/** Bỏ phần ràng buộc (NOT NULL, DEFAULT, IDENTITY…) — bảng log luôn để cột cho phép NULL. */
export function getLogDataType(dataType: string): string {
  return dataType.trim().replace(/\s+(NOT\s+NULL|NULL|DEFAULT|CONSTRAINT|IDENTITY|PRIMARY|UNIQUE|CHECK)\b[\s\S]*$/i, '').trim();
}

export function addColumnSql(logTable: string, column: string, dataType: string): string {
  return `IF OBJECT_ID(N'${lit(logTable)}') IS NOT NULL AND COL_LENGTH(N'${lit(logTable)}', N'${lit(column)}') IS NULL${NL}\tALTER TABLE ${quote(logTable)} ADD ${quote(column)} ${getLogDataType(dataType)}`;
}

export function alterColumnSql(logTable: string, column: string, dataType: string): string {
  return `IF COL_LENGTH(N'${lit(logTable)}', N'${lit(column)}') IS NOT NULL${NL}\tALTER TABLE ${quote(logTable)} ALTER COLUMN ${quote(column)} ${getLogDataType(dataType)}`;
}

export function dropColumnSql(logTable: string, column: string): string {
  return `IF COL_LENGTH(N'${lit(logTable)}', N'${lit(column)}') IS NOT NULL${NL}\tALTER TABLE ${quote(logTable)} DROP COLUMN ${quote(column)}`;
}

/** Điều kiện SQL (dùng biến @base, @log): 2 bảng tồn tại và chung ≥ 1/2 số cột mỗi bảng. */
function logGuardCondition(): string {
  return (
    'OBJECT_ID(@base, N\'U\') IS NOT NULL AND OBJECT_ID(@log, N\'U\') IS NOT NULL' +
    ' AND (SELECT COUNT(*) FROM sys.columns c WHERE c.object_id = OBJECT_ID(@base) AND COL_LENGTH(@log, c.name) IS NOT NULL) * 2 >= (SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID(@base))' +
    ' AND (SELECT COUNT(*) FROM sys.columns c WHERE c.object_id = OBJECT_ID(@base) AND COL_LENGTH(@log, c.name) IS NOT NULL) * 2 >= (SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID(@log))'
  );
}

/** Câu kiểm bảng log có trên DB và đúng là log của bảng gốc: trả 1 dòng 1 cột (1 / 0). */
export function isLogOfSql(baseTable: string, logTable: string): string {
  return `DECLARE @base SYSNAME, @log SYSNAME${NL}SELECT @base = N'${lit(baseTable)}', @log = N'${lit(logTable)}'${NL}SELECT CASE WHEN ${logGuardCondition()} THEN 1 ELSE 0 END`;
}

function appendDeclare(lines: string[], baseTable: string, logTable: string): void {
  lines.push('DECLARE @base SYSNAME, @log SYSNAME, @tmp SYSNAME, @kq NVARCHAR(2048), @thieu INT, @lech INT, @first INT');
  lines.push('DECLARE @lc TABLE (name SYSNAME, cur_pos INT, base_pos INT, grp INT)');
  lines.push('DECLARE @lw TABLE (name SYSNAME, want_pos INT)');
  lines.push(`SELECT @base = N'${lit(baseTable)}', @log = N'${lit(logTable)}', @tmp = N'${lit(logTable)}_sx', @kq = N'', @thieu = 0, @lech = 0`);
}

/**
 * Tính vị trí mong muốn của từng cột log → @lech = số cột đang sai vị trí.
 * Nhóm 1: cột riêng của log đứng trước cột chung đầu tiên (idlog, datetime_log) · 2: cột chung theo thứ tự bảng gốc · 3: cột riêng còn lại.
 */
function appendOrderBlock(lines: string[], indent: string): void {
  const t = '\t';
  lines.push(`${indent}INSERT INTO @lc (name, cur_pos, base_pos)`);
  lines.push(`${indent}${t}SELECT c.name, ROW_NUMBER() OVER (ORDER BY c.column_id), b.column_id`);
  lines.push(`${indent}${t}${t}FROM sys.columns c LEFT JOIN sys.columns b ON b.object_id = OBJECT_ID(@base) AND b.name = c.name`);
  lines.push(`${indent}${t}${t}WHERE c.object_id = OBJECT_ID(@log)`);
  lines.push(`${indent}SELECT @first = MIN(cur_pos) FROM @lc WHERE base_pos IS NOT NULL`);
  lines.push(`${indent}UPDATE @lc SET grp = CASE WHEN base_pos IS NOT NULL THEN 2 WHEN cur_pos < @first THEN 1 ELSE 3 END`);
  lines.push(`${indent}INSERT INTO @lw (name, want_pos)`);
  lines.push(`${indent}${t}SELECT name, ROW_NUMBER() OVER (ORDER BY grp, CASE WHEN grp = 2 THEN base_pos ELSE cur_pos END) FROM @lc`);
  lines.push(`${indent}SELECT @lech = COUNT(*) FROM @lc a JOIN @lw b ON a.name = b.name WHERE a.cur_pos <> b.want_pos`);
}

/** SQL chỉ đọc trả 1 dòng: co_log, thieu, lech. */
export function statusSql(baseTable: string, logTable: string): string {
  const lines: string[] = [];
  appendDeclare(lines, baseTable, logTable);
  lines.push('IF ' + logGuardCondition());
  lines.push('BEGIN');
  lines.push('\tSELECT @thieu = COUNT(*) FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id');
  lines.push("\t\tWHERE c.object_id = OBJECT_ID(@base) AND c.is_computed = 0 AND t.name <> 'timestamp' AND COL_LENGTH(@log, c.name) IS NULL");
  appendOrderBlock(lines, '\t');
  lines.push('\tSELECT 1 AS co_log, @thieu AS thieu, @lech AS lech');
  lines.push('END');
  lines.push('ELSE');
  lines.push('\tSELECT 0 AS co_log, 0 AS thieu, 0 AS lech');
  return lines.join(NL);
}

/**
 * Script sắp xếp lại cột bảng log (1 batch, không GO): thêm bù cột bảng gốc còn thiếu, rồi dựng lại bảng log
 * theo thứ tự đúng (SELECT INTO → DROP → sp_rename → tạo lại index/default/check) trong 1 transaction.
 * selectResult: true = kết thúc bằng SELECT thông báo (chạy trực tiếp); false = PRINT (gói update).
 */
export function reorderColumnsSql(baseTable: string, logTable: string, selectResult: boolean): string {
  const t = '\t';
  const lines: string[] = [];
  appendDeclare(lines, baseTable, logTable);
  lines.push('DECLARE @add NVARCHAR(MAX), @cols NVARCHAR(MAX), @idx NVARCHAR(MAX), @df NVARCHAR(MAX), @q NVARCHAR(MAX)');
  lines.push("SELECT @add = N'', @cols = N'', @idx = N'', @df = N''");
  lines.push('IF OBJECT_ID(@base) IS NULL OR OBJECT_ID(@log) IS NULL');
  lines.push('BEGIN');
  lines.push(`${t}SET @kq = N'Bỏ qua: không có bảng ' + @base + N' hoặc ' + @log`);
  lines.push(`${t}GOTO ket_thuc`);
  lines.push('END');
  lines.push('IF NOT (' + logGuardCondition() + ')');
  lines.push('BEGIN');
  lines.push(`${t}SET @kq = N'Bỏ qua: ' + @log + N' không giống bảng log của ' + @base + N' (chung dưới 1/2 số cột)'`);
  lines.push(`${t}GOTO ket_thuc`);
  lines.push('END');
  lines.push('IF EXISTS (SELECT 1 FROM sys.triggers WHERE parent_id = OBJECT_ID(@log))');
  lines.push(`${t}OR EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id = OBJECT_ID(@log) OR referenced_object_id = OBJECT_ID(@log))`);
  lines.push(`${t}OR EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(@log) AND is_computed = 1)`);
  lines.push(`${t}OR OBJECT_ID(@tmp) IS NOT NULL`);
  lines.push('BEGIN');
  lines.push(`${t}SET @kq = N'Bỏ qua: ' + @log + N' có trigger / khóa ngoại / cột tính toán, hoặc đã tồn tại bảng ' + @tmp`);
  lines.push(`${t}GOTO ket_thuc`);
  lines.push('END');

  // Cột bảng gốc còn thiếu trong log (thêm vào cuối, bước dựng lại sẽ đưa về đúng vị trí)
  lines.push("SELECT @add = ISNULL((SELECT N'ALTER TABLE ' + QUOTENAME(@log) + N' ADD ' + QUOTENAME(c.name) + N' '");
  lines.push(`${t}${t}+ CASE WHEN t.name IN ('char', 'varchar', 'binary', 'varbinary') THEN t.name + '(' + CASE WHEN c.max_length = -1 THEN 'max' ELSE RTRIM(c.max_length) END + ')'`);
  lines.push(`${t}${t}${t}WHEN t.name IN ('nchar', 'nvarchar') THEN t.name + '(' + CASE WHEN c.max_length = -1 THEN 'max' ELSE RTRIM(c.max_length / 2) END + ')'`);
  lines.push(`${t}${t}${t}WHEN t.name IN ('decimal', 'numeric') THEN t.name + '(' + RTRIM(c.precision) + ', ' + RTRIM(c.scale) + ')'`);
  lines.push(`${t}${t}${t}WHEN t.name IN ('datetime2', 'time', 'datetimeoffset') THEN t.name + '(' + RTRIM(c.scale) + ')'`);
  lines.push(`${t}${t}${t}ELSE t.name END + N'; '`);
  lines.push(`${t}FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id`);
  lines.push(`${t}WHERE c.object_id = OBJECT_ID(@base) AND c.is_computed = 0 AND t.name <> 'timestamp' AND COL_LENGTH(@log, c.name) IS NULL`);
  lines.push(`${t}ORDER BY c.column_id`);
  lines.push(`${t}FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), N'')`);
  lines.push('SELECT @thieu = COUNT(*) FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id');
  lines.push(`${t}WHERE c.object_id = OBJECT_ID(@base) AND c.is_computed = 0 AND t.name <> 'timestamp' AND COL_LENGTH(@log, c.name) IS NULL`);

  lines.push('BEGIN TRY');
  lines.push(`${t}BEGIN TRAN`);
  lines.push(`${t}IF @add <> N'' EXEC (@add)`);
  appendOrderBlock(lines, t);
  lines.push(`${t}IF @lech = 0`);
  lines.push(`${t}BEGIN`);
  lines.push(`${t}${t}COMMIT`);
  lines.push(`${t}${t}SET @kq = @log + CASE WHEN @thieu > 0 THEN N': đã thêm ' + RTRIM(@thieu) + N' cột, thứ tự cột đã đúng' ELSE N': thứ tự cột đã đúng, không cần sắp xếp' END`);
  lines.push(`${t}END`);
  lines.push(`${t}ELSE`);
  lines.push(`${t}BEGIN`);
  lines.push(`${t}${t}SELECT @cols = STUFF((SELECT N', ' + QUOTENAME(name) FROM @lw ORDER BY want_pos FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 2, N'')`);

  // Index + PK/Unique của log cũ (dựng lại sau khi đổi tên)
  lines.push(`${t}${t}SELECT @idx = ISNULL((SELECT CASE WHEN i.is_primary_key = 1 OR i.is_unique_constraint = 1`);
  lines.push(`${t}${t}${t}${t}THEN N'ALTER TABLE ' + QUOTENAME(@log) + N' ADD CONSTRAINT ' + QUOTENAME(i.name) + CASE WHEN i.is_primary_key = 1 THEN N' PRIMARY KEY ' ELSE N' UNIQUE ' END + i.type_desc`);
  lines.push(`${t}${t}${t}${t}ELSE N'CREATE ' + CASE WHEN i.is_unique = 1 THEN N'UNIQUE ' ELSE N'' END + i.type_desc + N' INDEX ' + QUOTENAME(i.name) + N' ON ' + QUOTENAME(@log) END`);
  lines.push(`${t}${t}${t}+ N' (' + STUFF((SELECT N', ' + QUOTENAME(c.name) + CASE WHEN ic.is_descending_key = 1 THEN N' DESC' ELSE N'' END`);
  lines.push(`${t}${t}${t}${t}FROM sys.index_columns ic JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id`);
  lines.push(`${t}${t}${t}${t}WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.key_ordinal > 0`);
  lines.push(`${t}${t}${t}${t}ORDER BY ic.key_ordinal FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 2, N'') + N')'`);
  lines.push(`${t}${t}${t}+ ISNULL(N' INCLUDE (' + STUFF((SELECT N', ' + QUOTENAME(c.name)`);
  lines.push(`${t}${t}${t}${t}FROM sys.index_columns ic JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id`);
  lines.push(`${t}${t}${t}${t}WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 1`);
  lines.push(`${t}${t}${t}${t}ORDER BY ic.index_column_id FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 2, N'') + N')', N'')`);
  lines.push(`${t}${t}${t}+ CASE WHEN i.has_filter = 1 THEN N' WHERE ' + i.filter_definition ELSE N'' END + N'; '`);
  lines.push(`${t}${t}${t}FROM sys.indexes i`);
  lines.push(`${t}${t}${t}WHERE i.object_id = OBJECT_ID(@log) AND i.type IN (1, 2) AND i.is_hypothetical = 0`);
  lines.push(`${t}${t}${t}ORDER BY i.index_id FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), N'')`);

  // Default + Check của log cũ
  lines.push(`${t}${t}SELECT @df = ISNULL((SELECT N'ALTER TABLE ' + QUOTENAME(@log) + N' ADD CONSTRAINT ' + QUOTENAME(d.name) + N' DEFAULT ' + d.definition + N' FOR ' + QUOTENAME(c.name) + N'; '`);
  lines.push(`${t}${t}${t}FROM sys.default_constraints d JOIN sys.columns c ON d.parent_object_id = c.object_id AND d.parent_column_id = c.column_id`);
  lines.push(`${t}${t}${t}WHERE d.parent_object_id = OBJECT_ID(@log)`);
  lines.push(`${t}${t}${t}FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), N'')`);
  lines.push(`${t}${t}${t}+ ISNULL((SELECT N'ALTER TABLE ' + QUOTENAME(@log) + N' ADD CONSTRAINT ' + QUOTENAME(k.name) + N' CHECK ' + k.definition + N'; '`);
  lines.push(`${t}${t}${t}FROM sys.check_constraints k`);
  lines.push(`${t}${t}${t}WHERE k.parent_object_id = OBJECT_ID(@log)`);
  lines.push(`${t}${t}${t}FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), N'')`);

  lines.push(`${t}${t}SET @q = N'SELECT ' + @cols + N' INTO ' + QUOTENAME(@tmp) + N' FROM ' + QUOTENAME(@log) + N' WITH (TABLOCKX)'`);
  lines.push(`${t}${t}EXEC (@q)`);
  lines.push(`${t}${t}SET @q = N'DROP TABLE ' + QUOTENAME(@log)`);
  lines.push(`${t}${t}EXEC (@q)`);
  lines.push(`${t}${t}EXEC sp_rename @tmp, @log`);
  lines.push(`${t}${t}IF @idx <> N'' EXEC (@idx)`);
  lines.push(`${t}${t}IF @df <> N'' EXEC (@df)`);
  lines.push(`${t}${t}COMMIT`);
  lines.push(`${t}${t}SET @kq = @log + N': đã sắp xếp lại ' + RTRIM(@lech) + N' cột lệch' + CASE WHEN @thieu > 0 THEN N', thêm ' + RTRIM(@thieu) + N' cột thiếu' ELSE N'' END`);
  lines.push(`${t}END`);
  lines.push('END TRY');
  lines.push('BEGIN CATCH');
  lines.push(`${t}IF @@TRANCOUNT > 0 ROLLBACK`);
  lines.push(`${t}SET @kq = N'Lỗi sắp xếp cột ' + @log + N': ' + ERROR_MESSAGE()`);
  lines.push(`${t}RAISERROR (N'%s', 16, 1, @kq)`);
  lines.push('END CATCH');
  lines.push('ket_thuc:');
  lines.push(selectResult ? 'SELECT @kq AS ket_qua' : 'PRINT @kq');
  return lines.join(NL);
}
