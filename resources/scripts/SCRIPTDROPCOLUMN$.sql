DECLARE @ngay_ct1 smalldatetime, @ngay_ct2 smalldatetime
SELECT @ngay_ct1 = ngay_gh1, @ngay_ct2 = ngay_gh2 from dmstt
IF EXISTS(SELECT 1 FROM syscolumns WHERE id IN (SELECT id FROM sysobjects WHERE name = '%tbl000000') AND name = '%col')
BEGIN
	ALTER TABLE %tbl000000 DROP COLUMN %col
	DECLARE @strsql NVARCHAR(4000)
	SET @strsql = 'alter table %tbl%Partition drop column %col'
	EXEC FastBusiness$Partition$Execute @strsql, '', 'ngay_ct', @ngay_ct1, @ngay_ct2, 1, 1
END
