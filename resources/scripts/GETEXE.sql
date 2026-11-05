DECLARE @exe VARCHAR(100)
			SET @exe = ''
			SELECT DISTINCT RTRIM(SUBSTRING(exe, 0,  PATINDEX('% %',exe))) AS exe INTO #t FROM command WHERE sysid = '%sysid'
			SELECT @exe = @exe + ',' + exe FROM #t
			DROP TABLE #t
			SELECT SUBSTRING(@exe,2,LEN(@exe)) AS exeName
