declare @strsql nvarchar(4000)
select %field into #data FROM %table
set @strsql = 'insert #data select %field'
set @strsql = @strsql + ' from %rfirst%Partition with(nolock) where %[%key]%'
	EXEC FastBusiness$Partition$Execute @strsql, NULL, 'ngay_ct', '%dfrom', '%dto', 1, 1
select * from #data
drop table #data
