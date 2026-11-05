// Danh mục loại thêm vào gói update (bảng updatecategory / updatefile trong system.db của FSD Studio, xuất tĩnh).
// Giữ nguyên nội dung 5.2; system.db đổi thì cập nhật lại file này.

/** Một dòng updatecategory (thêm theo loại + mã). */
export interface UpdCategory {
  sText: string;
  sType: string;
  sView: string;
  /** 'Sys' | 'App' */
  sDatabase: string;
  sGetSysID: string;
  sGetSysID2: string;
  sysSqlCode: string;
  appSqlCode: string;
}

/** Một dòng updatefile (loại file). */
export interface UpdFileType {
  sType: string;
  sView: string;
  sText: string;
  sUrl: string;
  sExt: string;
  sUrlSaveTo: string;
}

const cat = (
  sText: string, sType: string, sView: string, sDatabase: string, sGetSysID: string, sGetSysID2: string, sysSqlCode: string, appSqlCode: string
): UpdCategory => ({ sText, sType, sView, sDatabase, sGetSysID, sGetSysID2, sysSqlCode, appSqlCode });

const simpleSys = (name: string, table: string, col: string, label: string): UpdCategory =>
  cat(name, 'M', `${label}: sysid='%code'`, 'Sys', `SELECT DISTINCT ${col} AS val, '' AS name, '' AS type FROM ${table}`, '', `${table},${col === 'code' ? 'code' : 'form'} = '%sysid'`, '');

const objects = (sql: string): string => `SELECT name,name AS val, xtype AS type FROM sysobjects where xtype IN (${sql}) and status >= 0  ORDER BY name`;

// Sắp theo sText kiểu so sánh thứ tự mã (như SQLite BINARY): 5.2 đọc "SELECT * FROM updatecategory ORDER BY sText".
export const UPDATE_CATEGORIES: UpdCategory[] = ([
  cat('REPORT', 'R', "REPORT: sysid='%code'", 'Sys', "SELECT DISTINCT form AS val, '' AS name, '' AS type FROM reports", '',
    "command,sysid = '%sysid'#reports,form = '%sysid'#message,form = '%sysid'#repinfo,form = '%sysid'#v20exrepinfo,form = '%sysid'", "sysrpoptions,form='%sysid'"),
  cat('LIST', 'L', "LIST: sysid='%code'", 'Sys', "SELECT DISTINCT code AS val, '' AS name, '' AS type FROM dir", '',
    "command,sysid = '%sysid'#dir,code='%sysid'#message,form = '%sysid'#repinfo,form = '%sysid'#v20exrepinfo,form = '%sysid'", ''),
  cat('VOUCHER', 'V', "VOUCHER: ma_ct='%code'", 'App', "SELECT ma_ct AS val, '' AS name, '' AS type FROM dmct", 'SELECT DISTINCT sysid FROM command WHERE syscode=\'%sysid\'',
    "command,syscode = '%sysid'#voucherinfo,ma_ct = '%sysid'#sysuserdef,ma_ct='%sysid'#sysstatusinfo,ma_ct='%sysid'#grid,code IN (SELECT sysid FROM sysgridinfo WHERE ma_ct='%sysid')#reports,form='%form'#message,form = '%form'#repinfo,form = '%form'#v20exrepinfo,form = '%form'",
    "dmct,ma_ct='%sysid'#dmloaict,ma_ct='%sysid'#dmmagd,ma_ct='%sysid'#dmxlct,ma_ct='%sysid'#dmttct,ma_ct='%sysid'#sysflowinfo,ma_ct='%sysid'"),
  cat('REPORT_FORM', 'R', "REPORT_FORM: sysid='%code'", 'Sys', "SELECT DISTINCT form AS val, '' AS name, '' AS type FROM reports", '',
    "command,sysid = '%sysid'#reports,form = '%sysid'#dir,code = '%sysid'#grid,code = '%sysid'#message,form = '%sysid'#repinfo,form = '%sysid'#v20exrepinfo,form = '%sysid'",
    "sysrpoptions,form='%sysid'#v20dmmaubc,ma_maubc='%sysid'"),
  cat('Store', 'S', 'Store: %code (%kind)', 'App', objects("'P'"), '', '', ''),
  cat('Function', 'S', 'Function: %code (%kind)', 'App', objects("'FN','IF','TF'"), '', '', ''),
  cat('Table App', 'T', 'Table: %code', 'App', objects("'U'"), '', '', ''),
  cat('Table Sys', 'T', 'Table: %code', 'Sys', objects("'U'"), '', '', ''),
  cat('View', 'S', 'View: %code (%kind)', 'App', objects("'V'"), '', '', ''),
  cat('Trigger', 'S', 'Trigger: %code (%kind)', 'App', objects("'TR'"), '', '', ''),
  cat('Command', 'M', "Command Table: sysid='%code'", 'Sys', "SELECT DISTINCT RTRIM(menu_id)+' '+bar AS val, menu_id AS value ,'' AS name, '' AS type FROM command", '', "command,menu_id = '%sysid'", ''),
  simpleSys('Message', 'message', 'form', 'Message Table'),
  simpleSys('Repinfo', 'repinfo', 'form', 'Repinfo Table'),
  simpleSys('V20exrepinfo', 'v20exrepinfo', 'form', 'V20exrepinfo Table'),
  simpleSys('Grid', 'grid', 'code', 'Grid Table'),
  simpleSys('Reports', 'reports', 'form', 'Reports Table'),
  simpleSys('Dir', 'dir', 'code', 'Dir Table'),
  simpleSys('Lookup', 'lookup', 'code', 'Lookup Table'),
  cat('Dmct', 'M', "Dmct Table: ma_ct='%code'", 'App', "SELECT DISTINCT ma_ct AS val, '' AS name, '' AS type FROM dmct", '', '', "dmct,ma_ct = '%sysid'"),
  cat('Voucherinfo', 'M', "Voucherinfo Table: ma_ct='%code'", 'Sys', "SELECT DISTINCT ma_ct AS val, '' AS name, '' AS type FROM voucherinfo", '', "voucherinfo,ma_ct = '%sysid'", ''),
  cat('Options', 'M', "Options Table: name='%code'", 'App', "SELECT DISTINCT name AS val, '' AS name, '' AS type FROM options", '', '', "options,name = '%sysid'"),
  cat('V20dmmaubc', 'M', "Options V20dmmaubc: ma_maubc='%code'", 'App', "SELECT DISTINCT ma_maubc AS val, '' AS name, '' AS type FROM v20dmmaubc", '', '', "v20dmmaubc,ma_maubc = '%sysid'"),
  cat('Sysvar', 'M', "Sysvar Table: name='%code'", 'Sys', "SELECT DISTINCT name AS val, '' AS name, '' AS type FROM sysvar", '', "sysvar,name = '%sysid'", ''),
  simpleSys('V30exrepinfo', 'v30exrepinfo', 'form', 'V30exrepinfo Table')
] as UpdCategory[]).sort((a, b) => (a.sText < b.sText ? -1 : a.sText > b.sText ? 1 : 0));

const ft = (sType: string, sView: string, sText: string, sUrl: string, sExt: string): UpdFileType => ({ sType, sView, sText, sUrl, sExt, sUrlSaveTo: sUrl });

export const UPDATE_FILE_TYPES: UpdFileType[] = [
  ft('E', 'Exe File: %code', 'Exe', '', '*.exe'),
  ft('P', 'Rpt File: %code', 'Rpt', 'Rpt\\', '*.rpt'),
  ft('X', 'Xsd File: %code', 'Xsd', 'Rpt\\', '*.xsd'),
  ft('X', 'Image File: %code', 'Image', 'Images\\', '*.*'),
  ft('X', 'Message XmlFile Code = %code', 'Message', 'Log\\Offline\\Message\\', '*.*'),
  ft('E', 'Dll File: %code', 'Dll', '', '*.dll'),
  ft('X', 'Dir File: %code', 'Dir', 'App_Data\\Controllers\\Dir\\', '*.f'),
  ft('X', 'Filter File: %code', 'Filter', 'App_Data\\Controllers\\Filter\\', '*.f'),
  ft('X', 'Grid File: %code', 'Grid', 'App_Data\\Controllers\\Grid\\', '*.f'),
  ft('X', 'Report File: %code', 'Report', 'App_Data\\Controllers\\Report\\', '*.xml'),
  ft('X', 'Lookup File: %code', 'Lookup', 'App_Data\\Controllers\\Lookup\\', '*.xml'),
  ft('X', 'Template Excel File: %code', 'Excel Temp', 'App_Data\\Controllers\\Templates\\Excel\\', '*.xlsx'),
  ft('X', 'Template Rpt File: %code', 'Rpt Temp', 'App_Data\\Controllers\\Templates\\Rpt\\', '*.rpt'),
  ft('X', 'Aspx File: %code', 'Aspx File', 'Main\\', '*.aspx'),
  ft('X', 'Client Script: %code', 'Js File', 'ClientScript\\', '*.js'),
  ft('X', 'Dll F1 File: %code', 'Dll F1 File', 'bin\\', '*.dll'),
  ft('X', 'Dir XML File: %code', 'DirXML', 'App_Data\\Controllers\\Dir\\', '*.xml'),
  ft('X', 'Filter XML File: %code', 'FilterXML', 'App_Data\\Controllers\\Filter\\', '*.xml'),
  ft('X', 'Grid XML File: %code', 'GridXML', 'App_Data\\Controllers\\Grid\\', '*.xml'),
  ft('X', 'Include Javascript: %code', 'Include Javascript', 'App_Data\\Controllers\\Include\\Javascript\\', '*.txt'),
  ft('X', 'Include XML (*.txt): %code', 'Include XML TXT', 'App_Data\\Controllers\\Include\\XML\\', '*.txt'),
  ft('X', 'Include XML (*.xml): %code', 'Include XML XML', 'App_Data\\Controllers\\Include\\XML\\', '*.xml'),
  ft('X', 'Include Command: %code', 'Include Command', 'App_Data\\Controllers\\Include\\Command\\', '*.txt'),
  ft('X', 'Upload File: %code', 'Upload', 'App_Data\\Controllers\\Templates\\Upload\\', '*.xml')
];

/** Tìm loại theo sText (không phân biệt hoa thường, trim); không có → undefined. */
export function findCategory(text: string): UpdCategory | undefined {
  const t = (text ?? '').trim().toLowerCase();
  return UPDATE_CATEGORIES.find((c) => c.sText.trim().toLowerCase() === t);
}

export function findFileType(text: string): UpdFileType | undefined {
  const t = (text ?? '').trim().toLowerCase();
  return UPDATE_FILE_TYPES.find((c) => c.sText.trim().toLowerCase() === t);
}
