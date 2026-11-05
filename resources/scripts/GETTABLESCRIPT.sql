SET NOCOUNT ON
DECLARE @cTable NVARCHAR(128), @strSQL NVARCHAR(MAX), @cFields NVARCHAR(MAX), @cRefFields NVARCHAR(MAX), @Max INT, @xOrder INT, @cName NVARCHAR(128), @cFileGroup NVARCHAR(128), @isCreateTable BIT, @isCreateIndex BIT, @isCreateTrigger BIT, @isCreateDF BIT, @cNewLine VARCHAR(5)
DECLARE @isPK BIT, @cTypeDesc NVARCHAR(60), @isUnique BIT, @cFilter NVARCHAR(MAX), @cInclude NVARCHAR(MAX), @cRefTable NVARCHAR(256), @xDelete TINYINT, @xUpdate TINYINT
SELECT @cTable = '%table', @isCreateTable = '%cretable', @isCreateIndex = '%index', @isCreateTrigger = '%trigger', @isCreateDF = '%createdf', @strSQL = '', @cNewLine = CHAR(13) + CHAR(10)

CREATE TABLE #result(id INT IDENTITY(1, 1), val NVARCHAR(MAX))

DECLARE @id INT
SELECT @id = OBJECT_ID(@cTable)
IF @id IS NULL
BEGIN
	SELECT val FROM #result
	DROP TABLE #result
	RETURN
END

IF @isCreateTable = '1'
BEGIN
	--Kiểu dữ liệu: chỉ char/binary có độ dài, decimal/numeric có (p,s), datetime2/time/datetimeoffset có (scale); int/bigint/money/float... không kèm (p,s)
	SELECT c.column_id AS xorder, c.name AS val
			, CASE WHEN t.is_user_defined = 1 AND t.is_assembly_type = 0 THEN TYPE_NAME(c.system_type_id) ELSE t.name END AS datatype
			, c.max_length, c.precision AS xprec, c.scale AS xscale, c.is_nullable, c.is_computed
			, CAST('' AS NVARCHAR(MAX)) AS type
		INTO #t
		FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
		WHERE c.object_id = @id

	UPDATE #t SET type = datatype + CASE
			WHEN datatype IN ('char', 'varchar', 'binary', 'varbinary') THEN '(' + CASE WHEN max_length = -1 THEN 'max' ELSE RTRIM(max_length) END + ')'
			WHEN datatype IN ('nchar', 'nvarchar') THEN '(' + CASE WHEN max_length = -1 THEN 'max' ELSE RTRIM(max_length / 2) END + ')'
			WHEN datatype IN ('decimal', 'numeric') THEN '(' + RTRIM(xprec) + ',' + RTRIM(xscale) + ')'
			WHEN datatype IN ('datetime2', 'time', 'datetimeoffset') THEN '(' + RTRIM(xscale) + ')'
			ELSE '' END

	UPDATE a SET type = type + ' identity(' + CONVERT(VARCHAR(40), b.seed_value) + ',' + CONVERT(VARCHAR(40), b.increment_value) + ')' + CASE WHEN b.is_not_for_replication = 1 THEN ' NOT FOR REPLICATION' ELSE '' END
		FROM #t a JOIN sys.identity_columns b ON b.object_id = @id AND a.val = b.name

	UPDATE a SET type = 'AS ' + b.definition + CASE WHEN b.is_persisted = 1 THEN ' PERSISTED' ELSE '' END
		FROM #t a JOIN sys.computed_columns b ON b.object_id = @id AND a.val = b.name

	SELECT @Max = MAX(xorder) FROM #t

	INSERT INTO #result(val) SELECT 'CREATE TABLE ' + @cTable + '(' + @cNewLine
	INSERT INTO #result(val)
		SELECT CHAR(9) + '[' + val + '] ' + type
				+ CASE WHEN is_computed = 1 THEN '' WHEN is_nullable = 0 THEN ' NOT NULL' ELSE ' NULL' END
				+ CASE WHEN xorder = @Max THEN @cNewLine + ')' ELSE ',' END + @cNewLine
			FROM #t ORDER BY xorder

	--PRIMARY KEY / UNIQUE constraint (cột theo key_ordinal, CLUSTERED/NONCLUSTERED và filegroup lấy từ chính index của constraint)
	DECLARE cr1 CURSOR LOCAL FAST_FORWARD FOR
		SELECT name, index_id, is_primary_key, type_desc, ISNULL(FILEGROUP_NAME(data_space_id), 'PRIMARY')
			FROM sys.indexes WHERE object_id = @id AND (is_primary_key = 1 OR is_unique_constraint = 1)
			ORDER BY is_primary_key DESC, index_id
	OPEN cr1
	FETCH NEXT FROM cr1 INTO @cName, @xOrder, @isPK, @cTypeDesc, @cFileGroup
	WHILE @@FETCH_STATUS = 0
	BEGIN
		SET @cFields = NULL
		SELECT @cFields = ISNULL(@cFields + ', ', '') + COL_NAME(@id, column_id) + CASE WHEN is_descending_key = 1 THEN ' DESC' ELSE '' END
			FROM sys.index_columns WHERE object_id = @id AND index_id = @xOrder AND is_included_column = 0 ORDER BY key_ordinal
		SET @strSQL = 'ALTER TABLE ' + @cTable + ' WITH NOCHECK ADD CONSTRAINT ' + @cName + CASE WHEN @isPK = 1 THEN ' PRIMARY KEY ' ELSE ' UNIQUE ' END + @cTypeDesc + '(' + @cFields + ') ON [' + @cFileGroup + ']'
		INSERT INTO #result(val) SELECT @strSQL + @cNewLine
		FETCH NEXT FROM cr1 INTO @cName, @xOrder, @isPK, @cTypeDesc, @cFileGroup
	END
	CLOSE cr1
	DEALLOCATE cr1

	--FOREIGN KEY (mọi FK, nhiều cột, đúng tên cột bảng tham chiếu)
	IF EXISTS(SELECT 1 FROM sys.foreign_keys WHERE parent_object_id = @id)
	BEGIN
		INSERT INTO #result(val) SELECT 'GO' + @cNewLine
		DECLARE cr4 CURSOR LOCAL FAST_FORWARD FOR
			SELECT name, object_id, OBJECT_NAME(referenced_object_id), delete_referential_action, update_referential_action
				FROM sys.foreign_keys WHERE parent_object_id = @id ORDER BY name
		OPEN cr4
		FETCH NEXT FROM cr4 INTO @cName, @xOrder, @cRefTable, @xDelete, @xUpdate
		WHILE @@FETCH_STATUS = 0
		BEGIN
			SELECT @cFields = NULL, @cRefFields = NULL
			SELECT @cFields = ISNULL(@cFields + ', ', '') + COL_NAME(parent_object_id, parent_column_id)
					, @cRefFields = ISNULL(@cRefFields + ', ', '') + COL_NAME(referenced_object_id, referenced_column_id)
				FROM sys.foreign_key_columns WHERE constraint_object_id = @xOrder ORDER BY constraint_column_id
			SET @strSQL = 'ALTER TABLE ' + @cTable + ' ADD CONSTRAINT ' + @cName + ' FOREIGN KEY (' + @cFields + ') REFERENCES ' + @cRefTable + '(' + @cRefFields + ')'
				+ CASE @xDelete WHEN 1 THEN ' ON DELETE CASCADE' WHEN 2 THEN ' ON DELETE SET NULL' WHEN 3 THEN ' ON DELETE SET DEFAULT' ELSE '' END
				+ CASE @xUpdate WHEN 1 THEN ' ON UPDATE CASCADE' WHEN 2 THEN ' ON UPDATE SET NULL' WHEN 3 THEN ' ON UPDATE SET DEFAULT' ELSE '' END
			INSERT INTO #result(val) SELECT @strSQL + @cNewLine
			FETCH NEXT FROM cr4 INTO @cName, @xOrder, @cRefTable, @xDelete, @xUpdate
		END
		CLOSE cr4
		DEALLOCATE cr4
	END

	DROP TABLE #t
END
--CREATE INDEX (gồm cả UNIQUE / CLUSTERED, DESC, INCLUDE, filter; bỏ index của PK/UNIQUE constraint)
IF @isCreateIndex = 1
BEGIN
	IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = @id AND is_primary_key = 0 AND is_unique_constraint = 0 AND is_hypothetical = 0 AND type IN (1, 2)) AND EXISTS (SELECT 1 FROM #result)
	BEGIN
		INSERT INTO #result(val) SELECT 'GO' + @cNewLine
	END
	DECLARE cr2 CURSOR LOCAL FAST_FORWARD FOR
		SELECT name, index_id, is_unique, type_desc, filter_definition, ISNULL(FILEGROUP_NAME(data_space_id), 'PRIMARY')
			FROM sys.indexes WHERE object_id = @id AND is_primary_key = 0 AND is_unique_constraint = 0 AND is_hypothetical = 0 AND type IN (1, 2)
			ORDER BY index_id
	OPEN cr2
	FETCH NEXT FROM cr2 INTO @cName, @xOrder, @isUnique, @cTypeDesc, @cFilter, @cFileGroup
	WHILE @@FETCH_STATUS = 0
	BEGIN
		SELECT @cFields = NULL, @cInclude = NULL
		SELECT @cFields = ISNULL(@cFields + ', ', '') + COL_NAME(@id, column_id) + CASE WHEN is_descending_key = 1 THEN ' DESC' ELSE '' END
			FROM sys.index_columns WHERE object_id = @id AND index_id = @xOrder AND is_included_column = 0 ORDER BY key_ordinal
		SELECT @cInclude = ISNULL(@cInclude + ', ', '') + COL_NAME(@id, column_id)
			FROM sys.index_columns WHERE object_id = @id AND index_id = @xOrder AND is_included_column = 1 ORDER BY index_column_id
		SET @strSQL = 'CREATE ' + CASE WHEN @isUnique = 1 THEN 'UNIQUE ' ELSE '' END + CASE WHEN @cTypeDesc = 'CLUSTERED' THEN 'CLUSTERED ' ELSE '' END
			+ 'INDEX [' + @cName + '] ON ' + @cTable + '(' + @cFields + ')' + ISNULL(' INCLUDE(' + @cInclude + ')', '') + ISNULL(' WHERE ' + @cFilter, '') + ' ON [' + @cFileGroup + ']'
		INSERT INTO #result(val) SELECT @strSQL + @cNewLine
		FETCH NEXT FROM cr2 INTO @cName, @xOrder, @isUnique, @cTypeDesc, @cFilter, @cFileGroup
	END
	CLOSE cr2
	DEALLOCATE cr2
END

IF @isCreateTrigger = 1
BEGIN
	IF EXISTS (SELECT 1 FROM sys.triggers WHERE parent_id = @id) AND EXISTS (SELECT 1 FROM #result)
	BEGIN
		INSERT INTO #result(val) SELECT 'GO' + @cNewLine
	END
	CREATE TABLE #txt(id INT IDENTITY(1, 1), val NVARCHAR(MAX))
	DECLARE cr3 CURSOR LOCAL FAST_FORWARD FOR SELECT QUOTENAME(OBJECT_SCHEMA_NAME(object_id)) + '.' + QUOTENAME(name) FROM sys.triggers WHERE parent_id = @id ORDER BY name
	OPEN cr3
	FETCH NEXT FROM cr3 INTO @cName
	WHILE @@FETCH_STATUS = 0
	BEGIN
		INSERT INTO #txt(val) EXEC sp_helptext @cName
		INSERT INTO #txt(val) SELECT @cNewLine + 'GO' + @cNewLine
		FETCH NEXT FROM cr3 INTO @cName
	END
	CLOSE cr3
	DEALLOCATE cr3
	INSERT INTO #result(val) SELECT val FROM #txt ORDER BY id
	DROP TABLE #txt
END

IF @isCreateDF = 1
BEGIN
	INSERT INTO #result(val)
		SELECT 'ALTER TABLE ' + @cTable + ' ADD CONSTRAINT [' + name + ']  DEFAULT ' + definition + ' FOR ' + COL_NAME(@id, parent_column_id) + @cNewLine
			FROM sys.default_constraints WHERE parent_object_id = @id ORDER BY parent_column_id
END
SELECT val FROM #result ORDER BY id

DROP TABLE #result
