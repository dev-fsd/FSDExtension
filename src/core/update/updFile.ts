// Đọc / ghi file .upd — DataSet.WriteXml của .NET theo Config\SaveUpdateSchema.xsd (FSD Studio 5.1 / 5.2).
// Table1 = dòng gen (cột theo thứ tự schema, cột DBNull bị bỏ qua), Table2 = Other SQL (AppSQL, SysSQL).
// Định dạng ghi giống XmlTextWriter: UTF-8 không BOM, thụt 2 khoảng trắng, xuống dòng CRLF, `<x />` cho chuỗi rỗng,
// text chỉ escape & < > (CR / LF / Tab giữ nguyên), standalone="yes".
// Đọc giữ nguyên text (không chuẩn hóa xuống dòng) nên Load → Save lại ra đúng từng byte.

/** Thứ tự cột Table1 trong schema. */
export const UPD_COLUMNS = [
  'sView', 'sDB', 'sType', 'sCode', 'sTbl', 'sKey', 'sValue', 'sUrl', 'sUrlSaveTo', 'sysSqlCode', 'appSqlCode', 'type', 'name', 'storeValue'
] as const;
export type UpdColumn = (typeof UPD_COLUMNS)[number];

/** Một dòng gen. Cột không có trong object = DBNull. */
export type UpdRow = Partial<Record<UpdColumn, string>>;

export interface UpdContent {
  rows: UpdRow[];
  appSql: string;
  sysSql: string;
}

const NL = '\r\n';

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function element(name: string, value: string, indent: string): string {
  return value === '' ? `${indent}<${name} />${NL}` : `${indent}<${name}>${escapeText(value)}</${name}>${NL}`;
}

/** Ghi nội dung .upd (chuỗi; ghi ra file UTF-8 không BOM). */
export function serializeUpd(c: UpdContent): string {
  let out = `<?xml version="1.0" standalone="yes"?>${NL}<NewDataSet>${NL}`;
  for (const r of c.rows) {
    out += `  <Table1>${NL}`;
    for (const col of UPD_COLUMNS) {
      const v = r[col];
      if (v !== undefined) out += element(col, v, '    ');
    }
    out += `  </Table1>${NL}`;
  }
  out += `  <Table2>${NL}`;
  out += element('AppSQL', c.appSql, '    ');
  out += element('SysSQL', c.sysSql, '    ');
  out += `  </Table2>${NL}</NewDataSet>`;
  return out;
}

function unescapeText(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (_m, e: string) => {
    switch (e) {
      case 'lt': return '<';
      case 'gt': return '>';
      case 'amp': return '&';
      case 'quot': return '"';
      case 'apos': return "'";
      default: {
        const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
      }
    }
  });
}

/** Giá trị phần tử con: `<x />` → '', `<x>text</x>` → text đã giải entity (CDATA giữ nguyên). */
function childValues(block: string): Map<string, string> {
  const map = new Map<string, string>();
  const rx = /<([A-Za-z_][\w.-]*)(?:\s*\/>|\s*>([\s\S]*?)<\/\1\s*>)/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(block))) {
    const raw = m[2] ?? '';
    const text = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>|([^<]+)/g, (_x, cdata: string | undefined, plain: string | undefined) =>
      cdata !== undefined ? cdata : unescapeText(plain ?? '')
    );
    map.set(m[1], text);
  }
  return map;
}

/** Giải .upd từ chuỗi đã decode. Phần tử lạ bị bỏ qua như DataSet.ReadXml. */
export function parseUpd(xml: string): UpdContent {
  const text = xml.replace(/^﻿/, '');
  const rows: UpdRow[] = [];
  const rx1 = /<Table1\b[^>]*?(?:\/>|>([\s\S]*?)<\/Table1\s*>)/g;
  let m: RegExpExecArray | null;
  while ((m = rx1.exec(text))) {
    const row: UpdRow = {};
    const vals = childValues(m[1] ?? '');
    for (const col of UPD_COLUMNS) {
      const v = vals.get(col);
      if (v !== undefined) row[col] = v;
    }
    rows.push(row);
  }
  let appSql = '';
  let sysSql = '';
  const m2 = /<Table2\b[^>]*?(?:\/>|>([\s\S]*?)<\/Table2\s*>)/.exec(text);
  if (m2) {
    const vals = childValues(m2[1] ?? '');
    appSql = vals.get('AppSQL') ?? '';
    sysSql = vals.get('SysSQL') ?? '';
  }
  return { rows, appSql, sysSql };
}

/** Decode file .upd theo BOM (UTF-16 LE/BE, UTF-8); không BOM → UTF-8. */
export function decodeUpd(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  return buf.toString('utf8');
}
