// Hai script "Tự cấp command" của FBO — CHÉP NGUYÊN VĂN từ khối XML literal trong 5.1:
//   FSDStudioSrc\UI\Dialogs\frmWCommandUpdate.vb  dòng 933–989  (AUTO_MAIN_SCRIPT: tạo nhóm 88.00.00 / 88.01.00 / 88.02.00)
//   FSDStudioSrc\UI\Dialogs\frmWCommandUpdate.vb  dòng 998–1098 (AUTO_NEW_SCRIPT : cấp menu_id 88.01.xx / 88.02.xx, tạo dòng command)
// Chỉ đổi hai chỗ cho hợp TypeScript: "&lt;" của XML trả về "<", và bỏ khoảng trắng / dòng trống đầu - cuối khối.
// Test (test\menuedit\vbSource.test.ts) đọc lại chính file VB trên và so từng dòng, nên sửa chữ ở đây sẽ làm test đỏ.
//
// LƯU Ý nguồn: system.db của FSD Studio cũng có script tên AUTOMAINCOMMAND / AUTOCREATENEWCOMMAND, nhưng đó là bản CŨ — 5.1 đã
// comment bỏ lời gọi xCmd.GetScript("AUTOMAINCOMMAND") (frmWCommandUpdate.vb:991) và xCmd.GetScript("AUTOCREATENEWCOMMAND") (:996)
// để dùng bản nhúng tại chỗ này, nên extension chạy đúng bản 5.1 đang chạy thật. Chi tiết: docs\extension\sql-source-menuedit.md.

/** Tạo nhóm 88.00.00 / 88.01.00 / 88.02.00 trong command khi chưa có dòng nào 88% (frmWCommandUpdate.vb:933–989). */
export const AUTO_MAIN_SCRIPT = `SELECT *
INTO #tmp
FROM (
	SELECT N'88.00.00' menu_id, N'' menu_id0, N'Chỉnh sửa (C)' bar, N'Customize' bar2, N'2' edition, 0 expl_icon
	UNION ALL
	SELECT N'88.01.00', N'88.00.00', N'Đầu vào (C)', N'???', N'2', 0
	UNION ALL
	SELECT N'88.02.00', N'88.00.00', N'Báo cáo và khác (C)', N'???', N'2', 0
) a

SELECT *
INTO #command
FROM command
WHERE 1 = 0

DECLARE @cols NVARCHAR(MAX)
DECLARE @vals NVARCHAR(MAX)
DECLARE @sql NVARCHAR(MAX)

SELECT @cols = STUFF((
	SELECT ',[' + c.name + ']'
	FROM tempdb.sys.columns c
	WHERE c.object_id = OBJECT_ID('tempdb..#command')
	FOR XML PATH('')
), 1, 1, '')

SELECT @vals = STUFF((
	SELECT ',' +
		CASE
			WHEN EXISTS (
				SELECT 1
				FROM tempdb.sys.columns t
				WHERE t.object_id = OBJECT_ID('tempdb..#tmp')
					AND t.name = c.name
			)
				THEN '[' + c.name + ']'
			WHEN ty.name IN ('bigint', 'int', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money', 'smallmoney', 'bit')
				THEN '0'
			ELSE 'N'''''''
		END
	FROM tempdb.sys.columns c
		JOIN tempdb.sys.types ty ON c.user_type_id = ty.user_type_id
	WHERE c.object_id = OBJECT_ID('tempdb..#command')
	FOR XML PATH('')
), 1, 1, '')

SET @sql = '
INSERT INTO #command(' + @cols + ')
SELECT ' + @vals + '
FROM #tmp'

EXEC(@sql)

INSERT INTO command SELECT * FROM #command`;

/**
 * Cấp menu_id 88.01.xx (Type D / V) / 88.02.xx (còn lại) theo mẫu SVTran / Customer / SysLog, tạo dòng command,
 * gán wcommand.menu_id; kết quả cuối là SELECT menu_id (frmWCommandUpdate.vb:998–1098).
 */
export const AUTO_NEW_SCRIPT = `DECLARE @strSQL NVARCHAR(4000)
IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'ff_Dec2Seq')
BEGIN
	SET @strSQL = '
	CREATE FUNCTION ff_Dec2Seq(@nDec AS BIGINT)
	RETURNS VARCHAR(128)
	AS
	BEGIN
		DECLARE @nQuot BIGINT, @sHex VARCHAR(128), @nRem AS BIGINT, @cHex VARCHAR(1)
		SELECT @sHex = '''', @nQuot = @nDec
		WHILE @nQuot > 0
			BEGIN
				SELECT @nRem=@nQuot%36
				SELECT @nQuot=@nQuot/36
				SELECT @cHex = CASE WHEN @nRem <10 THEN CAST(@nRem AS VARCHAR) ELSE CHAR(@nRem + 55) END
				SET @sHex = @cHex + @sHex
			END
		RETURN @sHex
	END'
	EXEC sp_executesql @strSQL
END

If NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'ff_Seq2Dec')
BEGIN
	SET @strSQL = '
	CREATE FUNCTION ff_Seq2Dec(@sHex VARCHAR(128))
	RETURNS BIGINT
	AS
	BEGIN
		DECLARE @i AS INT, @nLen INT, @cHex VARCHAR(1), @nRem INT, @nDec AS BIGINT
		SELECT @nDec = 0, @i = 1, @nLen = LEN(@sHex)
		WHILE @i <= @nLen
            BEGIN
                SELECT @cHex= SUBSTRING(@sHex, @i, 1)
				SELECT @nRem = ASCII(@cHex)

				SELECT @nRem = @nRem - CASE WHEN @nRem <58 THEN  48 ELSE 55 END
                SELECT @nDec= @nDec*36 + @nRem, @i = @i + 1
			END
		RETURN @nDec
	END'
	EXEC sp_executesql @strSQL
END

If NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'ff_IncreaseSeq')
BEGIN
	SET @strSQL = '
	CREATE FUNCTION ff_IncreaseSeq(@sHex VARCHAR(128))
	RETURNS VARCHAR(128)
	AS
	BEGIN
		RETURN dbo.ff_Dec2Seq(dbo.ff_Seq2Dec(@sHex) + 1)
	END'
	EXEC sp_executesql @strSQL
END

DECLARE @Type CHAR(1), @Bar NVARCHAR(128), @Bar2 NVARCHAR(128), @Exe VARCHAR(128), @SysID VARCHAR(128), @SysCode VARCHAR(3), @BaseID VARCHAR(128), @WMenuID VARCHAR(8), @MenuID VARCHAR(8), @MenuID0 VARCHAR(8), @iChild INT, @cChild VARCHAR(2)
SELECT @Type = '[%Type]', @WMenuID = N'[%WMenu_id]', @MenuID = N'[%Menu_id]', @Bar = N'[%Bar]', @Bar2 = N'[%Bar2]', @Exe = '[%Exe]', @SysID = '[%SysID]', @SysCode = '[%SysCode]'
SELECT TOP 0 * INTO #cmm FROM command WHERE 1=0
-- @MenuID rỗng nghĩa là "chưa có mã, cần cấp mới" — KHÔNG được coi rỗng là "đã tồn tại" dù trong command
-- lỡ có dòng rác menu_id = '' (dữ liệu hỏng từ trước), nếu không sẽ tái sử dụng dòng rác đó và không bao
-- giờ cấp được mã 88.xx mới (menu_id vẫn trắng sau khi Save).
IF @MenuID = '' OR NOT EXISTS(SELECT 1 FROM command WHERE menu_id = @MenuID)
BEGIN
	SET @BaseID = CASE WHEN @Type = 'V' THEN 'SVTran' WHEN @Type = 'D' THEN 'Customer' ELSE 'SysLog' END

    INSERT INTO #cmm SELECT TOP 1 * FROM command WHERE sysid = @BaseID

    --Nếu không có menu nào thì lấy tạm 1 menu bất kỳ để làm mẫu, sau đó sẽ update lại menu_id, sysid, syscode
    IF NOT EXISTS (SELECT 1 FROM #cmm)
       INSERT INTO #cmm SELECT TOP 1 * FROM command
    IF @Type IN ('D', 'V') SET @MenuID0 = '88.01.' ELSE SET @MenuID0 = '88.02.'

    SELECT @MenuID = MAX(menu_id) FROM command WHERE menu_id like @MenuID0 + '%'
	IF @MenuID IS NULL SET @MenuID = LEFT(@MenuID0, 6) + '01'
	ELSE
	BEGIN
		SET @cChild = RIGHT(@MenuID, 2)
		IF @cChild < '99'
		BEGIN
			SET @iChild = CAST(@cChild AS INT)
			SET @iChild = @iChild + 1
			SET @cChild = RTRIM(@iChild)
		END
		ELSE
			SET @cChild = dbo.ff_IncreaseSeq(@cChild)
		SET @MenuID = LEFT(@MenuID0, 6) + RIGHT('0' + RTRIM(@cChild), 2)
	END
END
ELSE
BEGIN
	--SELECT @MenuID0 = menu_id0 FROM command WHERE menu_id = @MenuID
	INSERT INTO #cmm SELECT * FROM command WHERE menu_id = @MenuID
END
UPDATE #cmm SET menu_id = @MenuID, sysID = @SysID, SysCode = @SysCode -- , menu_id0 = @MenuID0, [type] = @Type, bar = @Bar, bar2 = @Bar2, exe = @Exe
DELETE command WHERE menu_id IN (SELECT menu_id FROM #cmm)
INSERT INTO command SELECT * FROM #cmm
UPDATE wcommand SET menu_id = @MenuID WHERE wmenu_id = @WMenuID
DROP TABLE #cmm
SELECT @MenuID AS menu_id`;

export interface AutoNewArgs {
  type: string;
  wmenuId: string;
  /** Mã command hiện có (Sửa); rỗng (hoặc chưa có trong command) = cấp mã mới. */
  menuId: string;
  bar: string;
  bar2: string;
  link: string;
  sysId: string;
  sysCode: string;
}

/**
 * Thay [%…] như 5.1 (frmWCommandUpdate.vb:1100–1101: Replace lần lượt Type, WMenu_id, Menu_id, Bar2, Bar, Exe, SysID, SysCode).
 * Khác 5.1 có chủ ý: giá trị được nhân đôi nháy đơn (5.1 để nguyên nên tên có dấu ' làm hỏng câu) và thay một lượt
 * (giá trị chứa "[%Bar]" không bị thay lại). Vị trí [%…] nằm sẵn trong nháy đơn của script nên chỉ cần nhân đôi nháy.
 */
export function buildAutoNew(a: AutoNewArgs): string {
  const map: Record<string, string> = {
    '[%Type]': a.type,
    '[%WMenu_id]': a.wmenuId,
    '[%Menu_id]': a.menuId,
    '[%Bar2]': a.bar2,
    '[%Bar]': a.bar,
    '[%Exe]': a.link,
    '[%SysID]': a.sysId,
    '[%SysCode]': a.sysCode
  };
  return AUTO_NEW_SCRIPT.replace(/\[%(Type|WMenu_id|Menu_id|Bar2|Bar|Exe|SysID|SysCode)\]/g, (m) => (map[m] ?? '').replace(/'/g, "''"));
}
