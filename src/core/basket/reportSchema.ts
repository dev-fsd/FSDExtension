// Ghi cấu trúc kết quả query ra .xsd (Crystal) / đồng bộ <Dictionary> của .frx (FastReport) — port FormatService.WriteSchema 5.2
// + FrxDictionaryWriter 5.1. Thuần (không vscode). Đặt ở core/basket vì gói này chỉ được sở hữu thư mục đó.

export interface SchemaColumn {
  name: string;
  /** Kiểu .NET đầy đủ, vd "System.Int32"; lạ / thiếu → System.String. */
  clr?: string;
}
export interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
}
export interface SchemaSet {
  name: string;
  tables: SchemaTable[];
}

/** Kiểu .NET mà Type.GetType của 5.2 nhận ra và ta hỗ trợ; ngoài danh sách → String. */
const KNOWN_CLR = new Set([
  'System.Boolean', 'System.Byte', 'System.SByte', 'System.Char', 'System.DateTime', 'System.DateTimeOffset', 'System.Decimal',
  'System.Double', 'System.Guid', 'System.Int16', 'System.Int32', 'System.Int64', 'System.Single', 'System.String', 'System.TimeSpan',
  'System.UInt16', 'System.UInt32', 'System.UInt64', 'System.Byte[]', 'System.Object'
]);

export function normalizeClr(clr: string | undefined): string {
  const c = (clr ?? '').trim();
  return KNOWN_CLR.has(c) ? c : 'System.String';
}

/** DataSet.Tables.Add + Columns.Add của 5.2: tên bảng trùng → lỗi; tên cột trùng (không phân biệt hoa thường) → x1, x2… */
export function buildSchemaSet(name: string, tables: Array<{ name: string; columns: SchemaColumn[] }>): SchemaSet {
  const set: SchemaSet = { name: name.trim() || 'ds', tables: [] };
  for (const t of tables) {
    const tn = (t.name ?? '').trim();
    if (tn === '') throw new Error('Tên bảng không được trống.');
    if (set.tables.some((x) => x.name.toLowerCase() === tn.toLowerCase())) throw new Error(`Bảng '${tn}' đã có trong DataSet.`);
    const used = new Set<string>();
    const columns: SchemaColumn[] = [];
    for (const c of t.columns) {
      const base = c.name ?? '';
      let unique = base;
      let n = 0;
      while (used.has(unique.toLowerCase())) {
        n++;
        unique = base + n;
      }
      used.add(unique.toLowerCase());
      columns.push({ name: unique, clr: normalizeClr(c.clr) });
    }
    set.tables.push({ name: tn, columns });
  }
  return set;
}

// ===================== XSD =====================

/** Kiểu .NET → kiểu XSD như DataSet.WriteXmlSchema. */
function xsdType(clr: string): { type: string; extra: string } {
  switch (clr) {
    case 'System.Boolean': return { type: 'xs:boolean', extra: '' };
    case 'System.Byte': return { type: 'xs:unsignedByte', extra: '' };
    case 'System.SByte': return { type: 'xs:byte', extra: '' };
    case 'System.Int16': return { type: 'xs:short', extra: '' };
    case 'System.Int32': return { type: 'xs:int', extra: '' };
    case 'System.Int64': return { type: 'xs:long', extra: '' };
    case 'System.UInt16': return { type: 'xs:unsignedShort', extra: '' };
    case 'System.UInt32': return { type: 'xs:unsignedInt', extra: '' };
    case 'System.UInt64': return { type: 'xs:unsignedLong', extra: '' };
    case 'System.Decimal': return { type: 'xs:decimal', extra: '' };
    case 'System.Double': return { type: 'xs:double', extra: '' };
    case 'System.Single': return { type: 'xs:float', extra: '' };
    case 'System.DateTime': return { type: 'xs:dateTime', extra: '' };
    case 'System.DateTimeOffset': return { type: 'xs:dateTime', extra: ' msdata:DataType="System.DateTimeOffset, mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089"' };
    case 'System.TimeSpan': return { type: 'xs:duration', extra: '' };
    case 'System.Byte[]': return { type: 'xs:base64Binary', extra: '' };
    case 'System.Guid': return { type: 'xs:string', extra: ' msdata:DataType="System.Guid, mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089"' };
    case 'System.Char': return { type: 'xs:string', extra: ' msdata:DataType="System.Char, mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089"' };
    case 'System.Object': return { type: 'xs:anyType', extra: '' };
    default: return { type: 'xs:string', extra: '' };
  }
}

/** XmlConvert.EncodeLocalName gọn: ký tự không hợp lệ trong tên XML → _xHHHH_ (tên bắt đầu bằng chữ số / ký tự lạ cũng được mã hóa). */
export function encodeXmlName(name: string): string {
  if (name === '') return name;
  let out = '';
  let first = true;
  for (const ch of name) {
    const ok = first ? /[A-Za-z_À-￿]/.test(ch) : /[A-Za-z0-9_.\-·À-￿]/.test(ch);
    if (ok && ch !== ':') out += ch;
    else out += '_x' + ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0') + '_';
    first = false;
  }
  return out;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Nội dung .xsd giống DataSet.WriteXmlSchema (thụt 2 dấu cách, LF → CRLF như Windows). */
export function buildXsd(set: SchemaSet): string {
  const dsName = encodeXmlName(set.name);
  const L: string[] = [];
  L.push('<?xml version="1.0" standalone="yes"?>');
  L.push(`<xs:schema id="${esc(dsName)}" xmlns="" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:msdata="urn:schemas-microsoft-com:xml-msdata">`);
  L.push(`  <xs:element name="${esc(dsName)}" msdata:IsDataSet="true" msdata:UseCurrentLocale="true">`);
  L.push('    <xs:complexType>');
  L.push('      <xs:choice minOccurs="0" maxOccurs="unbounded">');
  for (const t of set.tables) {
    L.push(`        <xs:element name="${esc(encodeXmlName(t.name))}">`);
    L.push('          <xs:complexType>');
    L.push('            <xs:sequence>');
    for (const c of t.columns) {
      const x = xsdType(normalizeClr(c.clr));
      L.push(`              <xs:element name="${esc(encodeXmlName(c.name))}"${x.extra} type="${x.type}" minOccurs="0" />`);
    }
    L.push('            </xs:sequence>');
    L.push('          </xs:complexType>');
    L.push('        </xs:element>');
  }
  L.push('      </xs:choice>');
  L.push('    </xs:complexType>');
  L.push('  </xs:element>');
  L.push('</xs:schema>');
  return L.join('\r\n');
}

// ===================== XML DOM tối thiểu cho .frx =====================

interface XAttr { name: string; value: string }
interface XText { kind: 'text'; value: string; cdata: boolean }
interface XComment { kind: 'comment'; value: string }
interface XElem {
  kind: 'elem';
  name: string;
  attrs: XAttr[];
  children: XNode[];
  /** Vị trí trong văn bản gốc (chỉ element lúc parse). */
  start: number;
  end: number;
  selfClosing: boolean;
}
type XNode = XElem | XText | XComment;

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9A-Fa-f]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e] ?? _m;
  });
}

/** Phân tích văn bản XML (element / attribute / text / CDATA / comment; bỏ qua khai báo và PI). Trả phần tử gốc. */
export function parseXml(text: string): XElem {
  let pos = 0;
  const n = text.length;
  const fail = (msg: string): never => {
    throw new Error(`XML không hợp lệ (vị trí ${pos}): ${msg}`);
  };
  const skipWs = (): void => {
    while (pos < n && /\s/.test(text[pos])) pos++;
  };
  const readName = (): string => {
    const m = /^[^\s=\/>]+/.exec(text.slice(pos, pos + 300));
    if (!m) return fail('thiếu tên');
    pos += m[0].length;
    return m[0];
  };

  function parseElement(): XElem {
    const start = pos;
    pos++; // '<'
    const el: XElem = { kind: 'elem', name: readName(), attrs: [], children: [], start, end: 0, selfClosing: false };
    for (;;) {
      skipWs();
      if (text.startsWith('/>', pos)) {
        pos += 2;
        el.selfClosing = true;
        el.end = pos;
        return el;
      }
      if (text[pos] === '>') {
        pos++;
        break;
      }
      const an = readName();
      skipWs();
      if (text[pos] !== '=') fail('thiếu dấu = sau thuộc tính ' + an);
      pos++;
      skipWs();
      const q = text[pos];
      if (q !== '"' && q !== "'") fail('giá trị thuộc tính phải có nháy');
      const close = text.indexOf(q, pos + 1);
      if (close < 0) fail('thiếu nháy đóng');
      el.attrs.push({ name: an, value: decodeEntities(text.slice(pos + 1, close)) });
      pos = close + 1;
    }
    for (;;) {
      if (pos >= n) fail(`thiếu thẻ đóng </${el.name}>`);
      if (text.startsWith('</', pos)) {
        const close = text.indexOf('>', pos);
        const nm = text.slice(pos + 2, close).trim();
        if (nm !== el.name) fail(`thẻ đóng </${nm}> không khớp <${el.name}>`);
        pos = close + 1;
        el.end = pos;
        return el;
      }
      if (text.startsWith('<!--', pos)) {
        const close = text.indexOf('-->', pos);
        if (close < 0) fail('comment không đóng');
        el.children.push({ kind: 'comment', value: text.slice(pos + 4, close) });
        pos = close + 3;
      } else if (text.startsWith('<![CDATA[', pos)) {
        const close = text.indexOf(']]>', pos);
        if (close < 0) fail('CDATA không đóng');
        el.children.push({ kind: 'text', value: text.slice(pos + 9, close), cdata: true });
        pos = close + 3;
      } else if (text.startsWith('<?', pos)) {
        const close = text.indexOf('?>', pos);
        if (close < 0) fail('PI không đóng');
        pos = close + 2;
      } else if (text[pos] === '<') {
        el.children.push(parseElement());
      } else {
        const next = text.indexOf('<', pos);
        const end = next < 0 ? n : next;
        const raw = text.slice(pos, end);
        // Khoảng trắng thuần giữa các thẻ chỉ là thụt dòng — bỏ.
        if (raw.trim() !== '') el.children.push({ kind: 'text', value: decodeEntities(raw), cdata: false });
        pos = end;
      }
    }
  }

  // Bỏ khai báo, comment, DOCTYPE trước phần tử gốc.
  for (;;) {
    skipWs();
    if (text.startsWith('<?', pos)) pos = text.indexOf('?>', pos) + 2;
    else if (text.startsWith('<!--', pos)) pos = text.indexOf('-->', pos) + 3;
    else if (text.startsWith('<!', pos)) pos = text.indexOf('>', pos) + 1;
    else break;
    if (pos <= 0) fail('khai báo không đóng');
  }
  if (text[pos] !== '<') fail('không thấy phần tử gốc');
  return parseElement();
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r/g, '&#xD;').replace(/\n/g, '&#xA;').replace(/\t/g, '&#x9;');
}
function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
}

/** Ghi một phần tử như XmlWriter Indent (2 dấu cách, thẻ rỗng "/>" liền không cách như FastReport Designer). */
function serialize(el: XElem, level: number, nl: string): string {
  const pad = '  '.repeat(level);
  const attrs = el.attrs.map((a) => ` ${a.name}="${escAttr(a.value)}"`).join('');
  if (el.children.length === 0) return `${pad}<${el.name}${attrs}/>`;
  const hasText = el.children.some((c) => c.kind === 'text');
  if (hasText) {
    // Nội dung hỗn hợp / chữ: ghi liền, không thụt bên trong (như XmlWriter).
    const inner = el.children
      .map((c) => (c.kind === 'text' ? (c.cdata ? `<![CDATA[${c.value}]]>` : escText(c.value)) : c.kind === 'comment' ? `<!--${c.value}-->` : serialize(c, 0, nl).trim()))
      .join('');
    return `${pad}<${el.name}${attrs}>${inner}</${el.name}>`;
  }
  const lines = el.children.map((c) => (c.kind === 'comment' ? `${pad}  <!--${c.value}-->` : serialize(c as XElem, level + 1, nl)));
  return `${pad}<${el.name}${attrs}>${nl}${lines.join(nl)}${nl}${pad}</${el.name}>`;
}

// ===================== FRX =====================

export interface FrxSyncResult {
  isNewFile: boolean;
  addedTables: string[];
  addedColumns: string[];
  removedColumns: string[];
}

/** Câu báo như SyncResult.ToMessage 5.1. */
export function frxMessage(r: FrxSyncResult, filePath: string): string {
  const L: string[] = [];
  L.push((r.isNewFile ? 'Đã tạo mới: ' : 'Đã cập nhật Dictionary: ') + filePath);
  if (r.addedTables.length) L.push('Thêm bảng: ' + r.addedTables.join(', '));
  if (r.addedColumns.length) L.push('Thêm cột: ' + r.addedColumns.join(', '));
  if (r.removedColumns.length) L.push('Bỏ cột (không còn trong query): ' + r.removedColumns.join(', '));
  if (!r.isNewFile && !r.addedTables.length && !r.addedColumns.length && !r.removedColumns.length) L.push('Cấu trúc không đổi.');
  return L.join('\n');
}

const attrOf = (el: XElem, name: string): string | undefined => el.attrs.find((a) => a.name === name)?.value;
const setAttr = (el: XElem, name: string, value: string): void => {
  const a = el.attrs.find((x) => x.name === name);
  if (a) a.value = value;
  else el.attrs.push({ name, value });
};
const elem = (name: string, attrs: Array<[string, string]> = [], children: XNode[] = []): XElem => ({
  kind: 'elem', name, attrs: attrs.map(([n, v]) => ({ name: n, value: v })), children, start: 0, end: 0, selfClosing: false
});
const isCalculated = (c: XElem): boolean => (attrOf(c, 'Calculated') ?? '').toLowerCase() === 'true';

/** Cột theo thứ tự query (giữ element cũ nếu trùng tên, chỉ cập nhật DataType), cột Calculated để cuối. */
function syncColumns(source: XElem, table: SchemaTable, result: FrxSyncResult): void {
  const oldColumns = source.children.filter((c): c is XElem => c.kind === 'elem' && c.name === 'Column');
  const calculated = oldColumns.filter(isCalculated);
  const oldByName = new Map<string, XElem>();
  for (const c of oldColumns.filter((x) => !isCalculated(x))) {
    const nm = attrOf(c, 'Name');
    if (nm !== undefined && !oldByName.has(nm.toLowerCase())) oldByName.set(nm.toLowerCase(), c);
  }
  const fresh: XElem[] = [];
  for (const col of table.columns) {
    const key = col.name.toLowerCase();
    let el = oldByName.get(key);
    if (el) {
      oldByName.delete(key);
      setAttr(el, 'DataType', normalizeClr(col.clr));
    } else {
      el = elem('Column', [['Name', col.name], ['DataType', normalizeClr(col.clr)]]);
      result.addedColumns.push(`${table.name}.${col.name}`);
    }
    fresh.push(el);
  }
  for (const el of oldByName.values()) result.removedColumns.push(`${table.name}.${attrOf(el, 'Name')}`);
  // Bỏ Column cũ, chèn lên đầu (Column phải đứng trước các thẻ con khác như Relation).
  source.children = [...fresh, ...calculated, ...source.children.filter((c) => !(c.kind === 'elem' && c.name === 'Column'))];
}

/** Đồng bộ Dictionary vào dictionary element (tạo XmlDataConnection khi thiếu). */
function syncDictionary(dictionary: XElem, set: SchemaSet, result: FrxSyncResult): void {
  let connection = dictionary.children.find((c): c is XElem => c.kind === 'elem' && c.name === 'XmlDataConnection');
  if (!connection) {
    connection = elem('XmlDataConnection', [['Name', 'Connection']]);
    dictionary.children.unshift(connection);
  }
  for (const table of set.tables) {
    let source = connection.children.find(
      (c): c is XElem => c.kind === 'elem' && c.name === 'TableDataSource' && (attrOf(c, 'Name') ?? '').toLowerCase() === table.name.toLowerCase()
    );
    if (!source) {
      source = elem('TableDataSource', [['Name', table.name], ['DataType', 'System.Int32'], ['Enabled', 'true'], ['TableName', table.name]]);
      connection.children.push(source);
      result.addedTables.push(table.name);
    }
    syncColumns(source, table, result);
  }
}

function frxSkeleton(): XElem {
  const d = new Date();
  const p = (v: number, w = 2): string => String(v).padStart(w, '0');
  const now = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  return elem('Report', [['ScriptLanguage', 'CSharp'], ['ReportInfo.Created', now], ['ReportInfo.Modified', now]], [
    elem('Dictionary'),
    elem('ReportPage', [['Name', 'Page1'], ['Watermark.Font', 'Arial, 60pt']])
  ]);
}

/**
 * Đồng bộ <Dictionary> của .frx. existing = nội dung file hiện có (undefined = file chưa có → tạo khung).
 * Khác 5.2: file đã có thì chỉ thay đúng khối <Dictionary>, phần còn lại giữ nguyên từng byte (5.2 ghi lại cả file).
 * Trả nội dung mới (chưa gồm BOM) và kết quả đồng bộ.
 */
export function syncFrx(existing: string | undefined, set: SchemaSet): { text: string; result: FrxSyncResult } {
  const result: FrxSyncResult = { isNewFile: existing === undefined, addedTables: [], addedColumns: [], removedColumns: [] };
  if (existing === undefined) {
    const root = frxSkeleton();
    const dict = root.children[0] as XElem;
    syncDictionary(dict, set, result);
    return { text: '<?xml version="1.0" encoding="utf-8"?>\r\n' + serialize(root, 0, '\r\n'), result };
  }
  const text = existing.replace(/^﻿/, '');
  const root = parseXml(text);
  if (root.name !== 'Report') throw new Error('File không phải mẫu FastReport (.frx): thiếu thẻ gốc <Report>.');
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const found = root.children.find((c): c is XElem => c.kind === 'elem' && c.name === 'Dictionary');
  const dict = found ?? elem('Dictionary');
  syncDictionary(dict, set, result);
  if (found) {
    // Dictionary đã có trong file: thay đúng đoạn [start, end) (Dictionary là con trực tiếp của Report → mức 1).
    return { text: text.slice(0, found.start) + serialize(found, 1, nl).trimStart() + text.slice(found.end), result };
  }
  // Chưa có Dictionary: chèn ngay sau thẻ mở <Report ...>.
  const openEnd = text.indexOf('>', root.start) + 1;
  if (root.selfClosing) {
    const rebuilt = text.slice(0, openEnd - 2).trimEnd() + '>' + nl + serialize(dict, 1, nl) + nl + `</${root.name}>` + text.slice(root.end);
    return { text: rebuilt, result };
  }
  return { text: text.slice(0, openEnd) + nl + serialize(dict, 1, nl) + text.slice(openEnd), result };
}
