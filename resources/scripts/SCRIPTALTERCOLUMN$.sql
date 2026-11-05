DECLARE @ngay_ct1 smalldatetime, @ngay_ct2 smalldatetime
SELECT @ngay_ct1 = ngay_gh1, @ngay_ct2 = ngay_gh2 from dmstt
ALTER TABLE %tbl000000 AlTER COLUMN %col %datatype
DECLARE @strsql NVARCHAR(4000)
SET @strsql = 'alter table %tbl%Partition alter column %col %datatype'
EXEC FastBusiness$Partition$Execute @strsql, '', 'ngay_ct', @ngay_ct1, @ngay_ct2, 1, 1
