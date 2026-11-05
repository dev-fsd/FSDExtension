// Định dạng văn bản cho nút Format của Query: SQL / JSON / XML (FormatService.FormatText của 5.2).
//
// Khác 5.2 (có chủ ý): 5.2 format SQL bằng bộ parse T-SQL của Microsoft (ScriptDom) — không có trong extension, nên SQL ở đây
// là bộ định dạng theo token đơn giản: đổi hoa / thường từ khóa, xuống dòng trước FROM / WHERE / GROUP BY / ORDER BY / HAVING /
// UNION, AND / OR thụt 2 tab, BEGIN / END thụt tab, mỗi tham số store một dòng; giữ nguyên khoảng cách quanh toán tử, chuỗi,
// comment. Văn bản có dòng GO, ngoặc / nháy không cân → trả lại nguyên văn (như 5.2 khi parse lỗi).
// JSON: giữ nguyên từng số / chuỗi, thụt bằng tab. XML: thụt 2 dấu cách, bỏ khai báo <?xml?>, nhiều gốc → format từng gốc.

const NL = '\r\n';

/** mode: sql | json | xml. SQL bắt đầu bằng "<" (nằm trong XML) thì từ khóa viết thường, như 5.2. */
export function formatText(mode: string, text: string): string {
  text = text ?? '';
  switch ((mode ?? '').toLowerCase()) {
    case 'json':
      return formatJson(text);
    case 'xml':
      return formatXml(text);
    default:
      return formatSql(text, !text.trimStart().startsWith('<'));
  }
}

// ===================== JSON =====================

export function formatJson(json: string): string {
  if (json.trim() === '') return json;
  const src = json.trim();
  try {
    JSON.parse(src);
  } catch {
    return json;
  }
  let out = '';
  let depth = 0;
  const pad = (): string => '\t'.repeat(depth);
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j;
    } else if (c === '{' || c === '[') {
      let k = i + 1;
      while (/\s/.test(src[k] ?? '')) k++;
      if (src[k] === (c === '{' ? '}' : ']')) {
        out += c + src[k];
        i = k;
      } else {
        depth++;
        out += c + NL + pad();
      }
    } else if (c === '}' || c === ']') {
      depth--;
      out += NL + pad() + c;
    } else if (c === ',') {
      out += ',' + NL + pad();
    } else if (c === ':') {
      out += ': ';
    } else if (!/\s/.test(c)) {
      out += c;
    }
  }
  return out;
}

// ===================== XML =====================

interface XNode {
  kind: 'el' | 'text' | 'raw';
  name?: string;
  attrs?: string;
  selfClose?: boolean;
  children?: XNode[];
  text?: string;
}

/** Thuộc tính viết lại name="value" (nháy đơn → nháy kép). */
function parseAttrs(raw: string): string {
  const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const val = m[3] !== undefined ? m[3] : m[4].replace(/"/g, '&quot;');
    parts.push(`${m[1]}="${val}"`);
  }
  return parts.length > 0 ? ' ' + parts.join(' ') : '';
}

/** Dựng cây; lỗi (thẻ lệch, không đóng) → null. Văn bản chỉ có khoảng trắng giữa các thẻ bị bỏ. */
function parseXml(src: string): XNode[] | null {
  const root: XNode = { kind: 'el', children: [] };
  const stack: XNode[] = [root];
  const add = (n: XNode): void => {
    (stack[stack.length - 1].children as XNode[]).push(n);
  };
  let i = 0;
  while (i < src.length) {
    if (src[i] !== '<') {
      const j = src.indexOf('<', i);
      const t = src.slice(i, j < 0 ? src.length : j);
      if (t.trim() !== '') add({ kind: 'text', text: t });
      i = j < 0 ? src.length : j;
      continue;
    }
    if (src.startsWith('<!--', i)) {
      const j = src.indexOf('-->', i);
      if (j < 0) return null;
      add({ kind: 'raw', text: src.slice(i, j + 3) });
      i = j + 3;
    } else if (src.startsWith('<![CDATA[', i)) {
      const j = src.indexOf(']]>', i);
      if (j < 0) return null;
      add({ kind: 'raw', text: src.slice(i, j + 3) });
      i = j + 3;
    } else if (src.startsWith('<?', i)) {
      const j = src.indexOf('?>', i);
      if (j < 0) return null;
      const pi = src.slice(i, j + 2);
      if (!/^<\?xml\s/i.test(pi)) add({ kind: 'raw', text: pi });
      i = j + 2;
    } else if (src.startsWith('<!', i)) {
      // DOCTYPE (có thể chứa [ … ] nội bộ)
      let depth = 0;
      let j = i + 2;
      for (; j < src.length; j++) {
        if (src[j] === '[') depth++;
        else if (src[j] === ']') depth--;
        else if (src[j] === '>' && depth <= 0) break;
      }
      if (j >= src.length) return null;
      add({ kind: 'raw', text: src.slice(i, j + 1) });
      i = j + 1;
    } else {
      // thẻ mở / đóng: tìm '>' ngoài nháy
      let j = i + 1;
      let q = '';
      for (; j < src.length; j++) {
        const c = src[j];
        if (q) {
          if (c === q) q = '';
        } else if (c === '"' || c === "'") q = c;
        else if (c === '>') break;
      }
      if (j >= src.length) return null;
      const inner = src.slice(i + 1, j);
      i = j + 1;
      if (inner.startsWith('/')) {
        if (stack.length < 2 || stack[stack.length - 1].name !== inner.slice(1).trim()) return null;
        stack.pop();
      } else {
        const selfClose = inner.endsWith('/');
        const mm = /^([^\s/]+)([\s\S]*)$/.exec(selfClose ? inner.slice(0, -1) : inner);
        if (!mm) return null;
        const el: XNode = { kind: 'el', name: mm[1], attrs: parseAttrs(mm[2]), selfClose, children: [] };
        add(el);
        if (!selfClose) stack.push(el);
      }
    }
  }
  return stack.length === 1 ? (root.children as XNode[]) : null;
}

function inlineXml(n: XNode): string {
  if (n.kind !== 'el') return n.text ?? '';
  const open = `<${n.name}${n.attrs}`;
  if (n.selfClose) return open + ' />';
  return `${open}>${(n.children ?? []).map(inlineXml).join('')}</${n.name}>`;
}

function writeXml(n: XNode, level: number): string {
  const pad = '  '.repeat(level);
  if (n.kind !== 'el') return pad + (n.text ?? '').replace(/\r?\n/g, NL);
  const open = `<${n.name}${n.attrs}`;
  if (n.selfClose) return `${pad}${open} />`;
  const kids = n.children ?? [];
  if (kids.length === 0) return `${pad}${open}></${n.name}>`;
  // Có chữ (chỉ chữ, hoặc lẫn chữ và thẻ): giữ trên một dòng như XmlWriter.
  if (kids.some((k) => k.kind === 'text')) return pad + inlineXml(n).replace(/\r?\n/g, NL);
  return `${pad}${open}>${NL}${kids.map((k) => writeXml(k, level + 1)).join(NL)}${NL}${pad}</${n.name}>`;
}

export function formatXml(xml: string): string {
  if (xml.trim() === '') return xml;
  const nodes = parseXml(xml);
  if (!nodes || nodes.length === 0) return xml;
  return nodes.map((n) => writeXml(n, 0)).join(NL).trim();
}

// ===================== SQL =====================

type TokKind = 'ws' | 'lc' | 'bc' | 'str' | 'id' | 'word' | 'num' | 'sym';
interface Tok {
  t: TokKind;
  v: string;
}

const KEYWORDS = new Set(
  (
    'SELECT FROM WHERE GROUP BY ORDER HAVING JOIN INNER LEFT RIGHT FULL OUTER CROSS ON AND OR NOT IN EXISTS BETWEEN LIKE IS NULL AS ' +
    'INSERT INTO VALUES UPDATE SET DELETE TRUNCATE CREATE ALTER DROP TABLE VIEW PROCEDURE PROC FUNCTION TRIGGER INDEX DECLARE ' +
    'IF ELSE BEGIN END WHILE RETURN RETURNS EXEC EXECUTE PRINT CASE WHEN THEN UNION ALL DISTINCT TOP ASC DESC WITH NOLOCK OVER ' +
    'PARTITION GO USE MERGE USING CURSOR OPEN CLOSE FETCH NEXT DEALLOCATE FOR TRY CATCH TRAN TRANSACTION COMMIT ROLLBACK ' +
    'GOTO WAITFOR DEFAULT PRIMARY CONSTRAINT FOREIGN REFERENCES UNIQUE CLUSTERED NONCLUSTERED EXCEPT INTERSECT ' +
    'INT BIGINT SMALLINT TINYINT BIT VARCHAR NVARCHAR CHAR NCHAR DATETIME SMALLDATETIME DECIMAL NUMERIC FLOAT MONEY UNIQUEIDENTIFIER ' +
    'VARBINARY'
  ).split(' ')
);

/** Từ khóa mở câu lệnh mới khi ở ngoài ngoặc. */
const STATEMENT_START = new Set([
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'DECLARE', 'SET', 'IF', 'WHILE', 'EXEC', 'EXECUTE', 'CREATE', 'ALTER', 'DROP',
  'PRINT', 'RETURN', 'MERGE', 'OPEN', 'CLOSE', 'FETCH', 'DEALLOCATE', 'GOTO', 'USE', 'WAITFOR', 'COMMIT', 'ROLLBACK'
]);

function tokenize(src: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (/\s/.test(c)) {
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j])) j++;
      toks.push({ t: 'ws', v: ' ' });
      i = j;
    } else if (c === '-' && n === '-') {
      let j = i;
      while (j < src.length && src[j] !== '\n' && src[j] !== '\r') j++;
      toks.push({ t: 'lc', v: src.slice(i, j) });
      i = j;
    } else if (c === '/' && n === '*') {
      const j = src.indexOf('*/', i + 2);
      if (j < 0) return null;
      toks.push({ t: 'bc', v: src.slice(i, j + 2) });
      i = j + 2;
    } else if (c === "'" || ((c === 'N' || c === 'n') && n === "'")) {
      let j = i + (c === "'" ? 1 : 2);
      for (;;) {
        if (j >= src.length) return null;
        if (src[j] === "'") {
          if (src[j + 1] === "'") { j += 2; continue; }
          break;
        }
        j++;
      }
      toks.push({ t: 'str', v: src.slice(i, j + 1) });
      i = j + 1;
    } else if (c === '[' || c === '"') {
      const j = src.indexOf(c === '[' ? ']' : '"', i + 1);
      if (j < 0) return null;
      toks.push({ t: 'id', v: src.slice(i, j + 1) });
      i = j + 1;
    } else if (/[A-Za-z_@#$]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[\w@#$]/.test(src[j])) j++;
      toks.push({ t: 'word', v: src.slice(i, j) });
      i = j;
    } else if (/\d/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[\w.]/.test(src[j])) j++;
      toks.push({ t: 'num', v: src.slice(i, j) });
      i = j;
    } else {
      toks.push({ t: 'sym', v: c });
      i++;
    }
  }
  return toks;
}

/**
 * Vị trí các token tham số của store CREATE/ALTER PROCEDURE có ≥ 2 tham số: tham số đầu, các dấu phẩy ngoài ngoặc, và chữ AS —
 * để mỗi tham số một dòng, AS một dòng.
 */
function procParamTokens(toks: Tok[]): Set<number> {
  const marks = new Set<number>();
  for (let i = 1; i < toks.length; i++) {
    if (toks[i].t !== 'word' || !/^PROC(EDURE)?$/i.test(toks[i].v)) continue;
    const prev = toks.slice(0, i).reverse().find((x) => x.t === 'word');
    if (!prev || !/^(CREATE|ALTER)$/i.test(prev.v)) continue;
    let depth = 0;
    const commas: number[] = [];
    let asAt = -1;
    let first = -1;
    for (let j = i + 1; j < toks.length; j++) {
      const u = toks[j];
      if (u.t === 'sym' && u.v === '(') depth++;
      else if (u.t === 'sym' && u.v === ')') depth--;
      else if (depth === 0 && u.t === 'word' && /^AS$/i.test(u.v)) { asAt = j; break; }
      else if (depth === 0 && u.t === 'sym' && u.v === ',') commas.push(j);
      else if (first < 0 && u.t === 'word' && u.v.startsWith('@')) first = j;
    }
    if (asAt > 0 && commas.length > 0 && first > 0) {
      marks.add(first);
      commas.forEach((c) => marks.add(c));
      marks.add(asAt);
    }
  }
  return marks;
}

/** upper = true: từ khóa HOA; false: thường (SQL nằm trong XML). */
export function formatSql(sql: string, upper = true): string {
  if (sql.trim() === '') return sql;
  const toks = tokenize(sql);
  if (!toks) return sql;
  // Văn bản có dòng GO: ScriptDom parse lỗi → 5.2 trả lại nguyên văn.
  if (/^[ \t]*GO[ \t]*(--.*)?$/im.test(sql)) return sql;
  let bal = 0;
  for (const t of toks) {
    if (t.t === 'sym' && t.v === '(') bal++;
    else if (t.t === 'sym' && t.v === ')') bal--;
    if (bal < 0) return sql;
  }
  if (bal !== 0) return sql;

  const params = procParamTokens(toks);
  const kw = (v: string): string => (KEYWORDS.has(v.toUpperCase()) ? (upper ? v.toUpperCase() : v.toLowerCase()) : v);
  const nextWord = (from: number): string => toks.slice(from + 1).find((x) => x.t === 'word')?.v.toUpperCase() ?? '';

  let out = '';
  let lineEmpty = true; // dòng hiện tại chưa có chữ (chỉ tab thụt)
  let indent = 0;
  let paren = 0;
  let caseDepth = 0;
  let stmt = '';
  let lastKw = '';
  let between = false;
  let pendingBlank = false;
  let spaceBefore = false;
  let noSpace = false; // ngay sau "(" hoặc "."
  let prev: Tok | undefined;

  const newline = (tabs: number): void => {
    if (out !== '') {
      if (lineEmpty) out = out.replace(/\t+$/, '');
      else out += NL;
    }
    if (pendingBlank && out !== '') out += NL;
    pendingBlank = false;
    out += '\t'.repeat(tabs);
    lineEmpty = true;
    spaceBefore = false;
  };
  const emit = (text: string, glue = false): void => {
    if (!lineEmpty && spaceBefore && !glue && !noSpace) out += ' ';
    out += text;
    lineEmpty = false;
    spaceBefore = false;
    noSpace = false;
  };
  const line = (tabs: number, text: string, kwU: string): void => {
    newline(tabs);
    emit(text);
    lastKw = kwU;
  };

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === 'ws') {
      if (!noSpace) spaceBefore = true;
      continue;
    }
    if (t.t === 'lc') {
      emit(t.v);
      newline(indent + (paren > 0 ? 1 : 0));
      prev = t;
      continue;
    }
    if (t.t === 'bc' || t.t === 'str' || t.t === 'id' || t.t === 'num') {
      emit(t.v);
      prev = t;
      continue;
    }

    if (t.t === 'sym') {
      if (t.v === '(') {
        paren++;
        const call = prev !== undefined && ((prev.t === 'word' && !KEYWORDS.has(prev.v.toUpperCase())) || prev.t === 'id');
        emit('(', call);
        noSpace = true;
      } else if (t.v === ')') {
        paren--;
        emit(')', true);
      } else if (t.v === ',' && params.has(i)) {
        emit(',', true);
        newline(1);
      } else if (t.v === ',' || t.v === ';') {
        emit(t.v, true);
        spaceBefore = true;
      } else if (t.v === '.') {
        emit('.', true);
        noSpace = true;
      } else {
        emit(t.v);
      }
      prev = t;
      continue;
    }

    // từ
    const U = t.v.toUpperCase();
    const text = kw(t.v);

    if (params.has(i)) {
      if (t.v.startsWith('@')) { newline(1); emit(t.v); }
      else if (U === 'AS') line(0, text, 'AS');
      prev = t;
      continue;
    }

    // CASE … END nằm trọn trong câu, kể cả trong ngoặc
    if (U === 'CASE') caseDepth++;
    if (U === 'END' && caseDepth > 0) {
      caseDepth--;
      emit(text);
      prev = t;
      continue;
    }

    if (paren === 0 && caseDepth === 0) {
      const after = (re: RegExp): boolean => re.test(lastKw);
      let handled = true;
      if (U === 'BEGIN') {
        const nx = nextWord(i);
        line(indent, text, U);
        stmt = U;
        if (nx !== 'TRAN' && nx !== 'TRANSACTION') indent++;
      } else if (U === 'END') {
        indent = Math.max(0, indent - 1);
        line(indent, text, U);
        if (!/^(ELSE|TRY|CATCH)$/.test(nextWord(i))) pendingBlank = true;
      } else if (U === 'ELSE') {
        line(indent, text, U);
      } else if (U === 'UNION' || U === 'EXCEPT' || U === 'INTERSECT') {
        line(indent, text, U);
      } else if (U === 'SELECT' && after(/^(UNION|ALL|EXCEPT|INTERSECT)$/)) {
        line(indent, text, U);
        stmt = U;
      } else if (U === 'SET' && stmt === 'UPDATE' && lastKw !== 'SET') {
        line(indent + 1, text, U);
      } else if (U === 'FROM' && !after(/^(DELETE|NEXT)$/)) {
        line(indent + 1, text, U);
      } else if (U === 'WHERE' || U === 'HAVING' || ((U === 'GROUP' || U === 'ORDER') && nextWord(i) === 'BY')) {
        line(indent + 1, text, U);
      } else if ((U === 'AND' || U === 'OR') && !(U === 'AND' && between)) {
        line(indent + 2, text, U);
      } else if (STATEMENT_START.has(U) && !(U === 'IF' && lastKw === 'ELSE') && !(/^(ALTER|DROP|CREATE)$/.test(U) && stmt === 'ALTER' && lastKw === 'TABLE') && !(/^(DELETE|UPDATE|SET)$/.test(U) && lastKw === 'ON')) {
        line(indent, text, U);
        stmt = U;
      } else {
        handled = false;
      }
      if (U === 'BETWEEN') between = true;
      else if (U === 'AND') between = false;
      if (handled) {
        prev = t;
        continue;
      }
    }
    emit(text);
    if (KEYWORDS.has(U)) lastKw = U;
    prev = t;
  }
  return out.replace(/\s+$/, '');
}
