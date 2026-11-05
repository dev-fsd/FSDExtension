IF NOT EXISTS(SELECT 1 FROM syscolumns WHERE id IN (SELECT id FROM sysobjects WHERE name = '%tbl') AND name = '%col')
	ALTER TABLE %tbl ADD %col %datatype
