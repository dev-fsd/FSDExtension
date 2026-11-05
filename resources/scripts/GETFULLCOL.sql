SELECT CAST(CASE WHEN b.column_name IS NULL THEN 0 ELSE 1 END AS BIT) AS pkey, a.COLUMN_NAME AS val, a.DATA_TYPE AS datatype, CAST('' AS NVARCHAR(128)) AS textname
		, a.DATA_TYPE + CASE WHEN a.DATA_TYPE IN ('char', 'varchar', 'nchar', 'nvarchar', 'binary', 'varbinary') THEN '(' + CASE WHEN a.CHARACTER_MAXIMUM_LENGTH = -1 THEN 'max' ELSE RTRIM(a.CHARACTER_MAXIMUM_LENGTH) END + ')' WHEN a.DATA_TYPE IN ('decimal', 'numeric') THEN '(' + RTRIM(a.NUMERIC_PRECISION) + ',' + RTRIM(a.NUMERIC_SCALE) + ')' WHEN a.DATA_TYPE IN ('datetime2', 'time', 'datetimeoffset') THEN '(' + RTRIM(a.DATETIME_PRECISION) + ')' ELSE '' END AS type
	INTO #t
	FROM INFORMATION_SCHEMA.COLUMNS a LEFT JOIN (SELECT b.column_name, b.table_name FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE b LEFT JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS c ON b.CONSTRAINT_NAME = c.CONSTRAINT_NAME WHERE c.CONSTRAINT_TYPE = 'PRIMARY KEY') b
		ON a.table_name = b.table_name AND a.column_name  = b.column_name
	WHERE a.TABLE_NAME='%tbl'
UPDATE #t SET type = datatype WHERE datatype IN ('ntext', 'smalldatetime', 'datetime', 'bit', 'tinyint', 'int', 'image', 'binary')
UPDATE #t SET type = 'ntext' WHERE type LIKE 'ntext%'
UPDATE #t SET type = REPLACE(type, '(-1)', '(max)')
UPDATE #t SET textname = val + ' [' + type + ']'
SELECT * FROM #t
SELECT val AS [key], 0 AS type, '' AS col, 0 AS r, 0 AS g, 0 AS b, 'ZZ' AS cus FROM #t
DROP TABLE #t
