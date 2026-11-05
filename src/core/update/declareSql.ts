// SQL Content Declare (getOtherSqlInfo 5.1 / UpdateExplorer.ContentDeclareScripts 5.2): quét các bảng cấu hình khai sẵn theo danh sách mã.
// Chỉ SELECT (+ bảng #temp của phiên). Câu quét giữ nguyên văn 5.1.

const APP_DECLARE = `
declare @s nvarchar(max) = '', @i int, @n int, @stmp varchar(256), @wh varchar(256), @tb varchar(33)
declare @dcl table (id int identity(1,1), tb varchar(33), wh varchar(256))
create table #val (val varchar(33))
create table #kq (tb varchar(33), tong int, wh varchar(256))

|KeySearch|

insert into @dcl values ('dmct', 'ma_ct = ''{0}'' ')
insert into @dcl values ('dmct0', 'ma_ct = ''{0}'' ')
insert into @dcl values ('dmct4', 'ma_ct = ''{0}'' ')
insert into @dcl values ('dmct5', 'ma_ct = ''{0}'' ')
insert into @dcl values ('dmct6', 'ma_ct = ''{0}'' ')
insert into @dcl values ('dmct7', 'ma_ct = ''{0}'' ')
insert into @dcl values ('dmct8', 'ma_ct = ''{0}'' ')
insert into @dcl values ('dmct9', 'ma_ct = ''{0}'' ')
insert into @dcl values ('dmxlct', 'ma_ct = ''{0}'' ')
insert into @dcl values ('dmxlct2', 'ma_ct = ''{0}'' ')
insert into @dcl values ('dmttct', 'ma_ct = ''{0}'' ')
insert into @dcl values ('dmttct', 'ma_ct = ''{0}'' ')
insert into @dcl values ('dmmagd', 'ma_ct = ''{0}'' ')
insert into @dcl values ('dmloaict', 'ma_ct = ''{0}'' ')
insert into @dcl values ('syscredit', 'ma_ct = ''{0}'' ')
insert into @dcl values ('dmcttransfer', 'ma_ct = ''{0}'' ')
insert into @dcl values ('vouchertypeinfo', 'ma_ct = ''{0}'' ')
insert into @dcl values ('sysspmasterinfo', 'xid = ''{0}'' ')
insert into @dcl values ('dmctduyet', 'ma_ct = ''{0}'' ')

delete @dcl where object_id(tb) is null

select @i = 1, @n = max(id) from @dcl
while @i <= isnull(@n, 0) begin
	set @tb = ''
	select @wh = wh, @tb = tb from @dcl where id = @i
	if @tb > '' begin
		set @stmp = ''
		select @stmp += case when @stmp = '' then '' else ' or ' end + replace(@wh, '{0}', val)
			from #val

		select @s = 'insert into #kq select ''' + @tb + ''', count(*), ''(' + replace(@stmp, '''', '''''') + ')'' from ' + @tb + ' with(nolock) where (' + @stmp  +') '

		begin try
			exec (@s)
		end try
		begin catch
		end catch
	End
	set @i += 1
end

if object_id('dmct9') > 0 begin
	set @s = '
		select distinct rtrim(replace(substring(c$, 2, 10), ''$'', '''')) tb_sh, rtrim(a.m$) m$ into #sysgen from dmct9 a with(nolock) join #val b on a.ma_ct = b.val where c$ like ''%$''
		if exists (select 1 from #sysgen) begin
			insert into  #kq
				select distinct ''sysgendata'', 1, '' basetable = '''''' + basetable + '''''' '' from sysgendata a with(nolock) join #sysgen b on a.basetable like ''%'' + b.tb_sh + ''%''
		End

		insert into #sysgen
			select ''-'', val from #val
			'
	if object_id('systransfer') > 0 begin
		set @s += '
		insert into  #kq
			select distinct ''systransfer'', 1, '' xfile = '''''' + xfile + '''''' '' from systransfer a with(nolock) join #sysgen b on ((a.xfile like b.m$ + ''%'' and b.m$ like ''%$'') or b.m$ = a.xfile )

		drop table #sysgen
		'
	end

	begin try
		exec (@s)
	end try
	begin catch
	end catch
End
select 'App' db,* from #kq where tong > 0

drop table #kq, #val
`;

const SYS_DECLARE = `
declare @s nvarchar(max) = '', @i int, @n int, @stmp varchar(256), @wh varchar(256), @tb varchar(33)
declare @dcl table (id int identity(1,1), tb varchar(33), wh varchar(256))
create table #val (val varchar(33))
create table #kq (tb varchar(33), tong int, wh varchar(256))

|KeySearch|

insert into @dcl values ('voucherinfo', 'ma_ct = ''{0}'' ')
insert into @dcl values ('sysvouchertype', 'ma_ct = ''{0}'' ')
insert into @dcl values ('freecolumns', 'controller like ''{0}%'' ')
insert into @dcl values ('freefunctions', 'controller like ''{0}%'' ')
insert into @dcl values ('freelistcolumns', 'controller like ''{0}%'' ')
insert into @dcl values ('kbtruongngay', 'controller like ''{0}%'' ')
insert into @dcl values ('arrangementcolumns', 'controller like ''{0}%'' ')
insert into @dcl values ('functionfilters', 'controller like ''{0}%'' ')
insert into @dcl values ('columns', 'controller like ''{0}%'' ')
insert into @dcl values ('sysgridfield', 'controller like ''{0}%'' ')
insert into @dcl values ('sysfields', 'controller like ''{0}%'' ')
insert into @dcl values ('sysfilterdeclares', 'controller like ''{0}%'' ')

delete @dcl where object_id(tb) is null

update @dcl set tb = replace(tb, '''', '')
delete @dcl where object_id(tb) is null
select @i = 1, @n = max(id) from @dcl
while @i <= isnull(@n, 0) begin
	set @tb = ''
	select @wh = wh, @tb = tb from @dcl where id = @i
	if @tb <> '' begin
		set @stmp = ''
		select @stmp += case when @stmp = '' then '' else ' or ' end + replace(@wh, '{0}', val)
			from #val

		select @s = 'insert into #kq select ''' + @tb + ''', count(*), ''(' + replace(@stmp, '''', '''''') + ')'' from ' + @tb + ' with(nolock) where (' + @stmp  +') '

		begin try
			exec (@s)
		end try
		begin catch
		end catch
	end

	set @i += 1
End

select 'Sys' db,* from #kq where tong > 0

drop table #kq, #val
`;

/** Hai câu quét [App, Sys] cho danh sách mã cách phẩy; rỗng → []. */
export function contentDeclareScripts(text: string): [string, string] | [] {
  if ((text ?? '').trim() === '') return [];
  let keyInsert = '';
  for (const s of text.replace(/ /g, '').trim().split(',')) keyInsert += `insert into #val values('${s.replace(/'/g, '')}')\r\n`;
  return [APP_DECLARE.split('|KeySearch|').join(keyInsert), SYS_DECLARE.split('|KeySearch|').join(keyInsert)];
}

/** Câu liệt kê đối tượng SQL của SQL Explorer (Load_SQL_Explorer 5.1). */
export const SQL_OBJECTS_QUERY =
  "select name, rtrim(type) type, case when type = 'u' then 'tables' when type in ('v') then 'views' else 'stores - functions - triggers' end as tp " +
  "from sys.objects where type in ('u', 'v', 'p', 'tr', 'fn', 'tf') order by tp, modify_date desc";
