DECLARE @tbl VARCHAR(128),@key VARCHAR(256)
SELECT @tbl = '%tbl', @key = '%key'

DECLARE @colKeyName VARCHAR(128), @colKeyType VARCHAR(128), @strSQL NVARCHAR(4000)
SELECT TOP 1 @colKeyName = COLUMN_NAME
	, @colKeyType = b.name + CASE WHEN (b.name = 'bit' OR b.name = 'smalldatetime' OR  b.name = 'tinyint') THEN '' ELSE + ISNULL('('+LTRIM(a.prec) + ISNULL(','+LTRIM(a.scale),'') +')','') END
	FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE c
		LEFT JOIN syscolumns a ON a.id = object_id(@tbl)
		LEFT JOIN systypes b ON a.xtype=b.xtype
		WHERE c.table_name = @tbl

CREATE TABLE #t (txt NVARCHAR(4000))
SET @strSQL =					   'DECLARE crTmp CURSOR FOR SELECT DISTINCT '+@colKeyName +' FROM '+ @tbl +' WHERE ' + @key
SET @strSQL = @strSQL + CHAR(13) + 'OPEN crTmp'
SET @strSQL = @strSQL + CHAR(13) + 'DECLARE @skey ' + @colKeyType
SET @strSQL = @strSQL + CHAR(13) + '	FETCH NEXT FROM crTmp INTO @skey'
SET @strSQL = @strSQL + CHAR(13) + '	WHILE @@FETCH_STATUS = 0'
SET @strSQL = @strSQL + CHAR(13) + '		BEGIN'
SET @strSQL = @strSQL + CHAR(13) + '			INSERT INTO #t SELECT ''DELETE FROM '+ @tbl + ' WHERE '+ @colKeyName + ' = ''+ CHAR(39) + RTRIM(@skey) + CHAR(39) + '' '''
SET @strSQL = @strSQL + CHAR(13) + '			FETCH NEXT FROM crTmp INTO @skey'
SET @strSQL = @strSQL + CHAR(13) + '		END'
SET @strSQL = @strSQL + CHAR(13) + '	CLOSE crTmp'
SET @strSQL = @strSQL + CHAR(13) + 'DEALLOCATE crTmp'
print @strSQL
EXEC sp_executesql @strSQL
SELECT * FROM #t
DROP TABLE #t
