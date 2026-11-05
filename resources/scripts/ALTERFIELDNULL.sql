DECLARE @cTable VARCHAR(32), @strKey NVARCHAR(4000)
	DECLARE @strSQL NVARCHAR(4000), @cName VARCHAR(32), @cType VARCHAR(32)
	SELECT @cTable ='%tbl', @strKey = '1=1'
	SELECT  a.name , c.name as type
		INTO #report
		FROM     dbo.syscolumns a INNER JOIN
                      dbo.sysobjects b ON a.id = b.id INNER JOIN
                        dbo.systypes c ON a.xusertype = c.xusertype
	WHERE     (b.name = @cTable AND b.xtype = 'U')
	DECLARE z CURSOR FOR SELECT name, LOWER(type) FROM #report ORDER BY name
	OPEN z
	FETCH NEXT FROM z INTO @cName, @cType
	WHILE @@FETCH_STATUS = 0
		BEGIN
			SET @strSQL = 'UPDATE ' + @cTable + ' SET ' + @cName  + ' = '
			+ CASE WHEN @cType IN ('char','varchar','nchar','nvarchar') THEN ''''''
			WHEN @cType IN ('datetime','smalldatetime') THEN 'NULL'
			WHEN @cType IN ('uniqueidentifier') THEN  ''''''
			WHEN @cType IN ('text','ntext') THEN ''''''
			WHEN @cType IN ('binary','varbinary') THEN  'NULL'
			WHEN @cType IN ('tinyint','int','float','real','money','smallmoney','numeric','bit')THEN  '0'
        	ELSE 'NULL'
		END + ' WHERE ' + @cName + ' IS NULL AND ' + @strKey
		PRINT @strSQL
	EXEC sp_executesql @strSQL
	FETCH NEXT FROM z INTO  @cName, @cType
	END
	CLOSE z
	DEALLOCATE z
	DROP TABLE #report
