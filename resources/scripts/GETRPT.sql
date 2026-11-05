DECLARE @rpt VARCHAR(100)
SET @rpt = ''
SELECT DISTINCT RTRIM(rep_file) AS rpt INTO #t FROM reports WHERE form='%sysid'
SELECT @rpt = @rpt + ',' + rpt + '.rpt' FROM #t
DROP TABLE #t
SELECT SUBSTRING(@rpt,2,LEN(@rpt)) AS rptName
