SELECT name AS val, type AS xtype, *--, create_date, modify_date
	FROM sys.objects
	WHERE modify_date > (SELECT MAX(crdate) FROM master..sysdatabases WHERE name = DB_NAME())
		AND object_id IN (SELECT id FROM sysobjects WHERE xtype IN ('U', 'V', 'P', 'TR', 'F', 'FN','IF','TF'))
	ORDER BY modify_date desc
