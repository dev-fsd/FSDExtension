declare @strsql nvarchar(4000)
set @strsql = %strSQL
EXEC FastBusiness$Partition$Execute @strsql, '', 'ngay_ct', '%dfrom', '%dto', 1, 1
