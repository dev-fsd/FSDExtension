DECLARE @ngay_ct1 smalldatetime, @ngay_ct2 smalldatetime
SELECT @ngay_ct1 = ngay_gh1, @ngay_ct2 = ngay_gh2 from dmstt

IF NOT EXISTS(SELECT 1 FROM syscolumns WHERE id IN (SELECT id FROM sysobjects WHERE name = '%tbl000000') AND name = '%col')
BEGIN
	ALTER TABLE %tbl000000 ADD %col %datatype
	DECLARE @strsql NVARCHAR(4000)
	SET @strsql = 'alter table %tbl%Partition add %col %datatype'
	EXEC FastBusiness$Partition$Execute @strsql, '', 'ngay_ct', @ngay_ct1, @ngay_ct2, 1, 1
	SET @strsql = 'update %tbl%Partition set %col = %valnull where %[%col is null]%'
	EXEC FastBusiness$Partition$Execute @strsql, '', 'ngay_ct', @ngay_ct1, @ngay_ct2, 1, 1
END
