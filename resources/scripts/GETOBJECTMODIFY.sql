SELECT name AS val, type AS xtype--, create_date, modify_date
	FROM sys.objects
	WHERE modify_date BETWEEN '%dfrom 00:00:00' AND '%dto 23:59:00'
		AND object_id IN (SELECT id FROM sysobjects WHERE xtype IN ('U', 'V', 'P', 'TR', 'F', 'FN','IF','TF'))
	ORDER BY modify_date desc
