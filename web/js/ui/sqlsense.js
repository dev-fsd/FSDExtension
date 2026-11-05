// Gợi ý SQL cho editor Monaco: tên bảng / view / store / function của DB đang chọn, cột sau "alias." hoặc "bảng.".
// Mỗi editor gắn hàm trả { call, db } (DB của tab có thể đổi). Danh sách object cache theo DB (sql.objects).
const owners = new Map();       // model uri → () => ({ call, db })
const objectCache = new Map();  // db → Promise<[{name,type}]>
const columnCache = new Map();  // db|table → Promise<[{name,type,nullable}]>
let registered = false;

// Tên SQL FBO có $ và # (m81$202401, #temp).
export const NAME = /[\w$#@]+(?:\.[\w$#@]+)?/g;

/** Từ (gồm $ #) tại vị trí con trỏ: {text, start, end} (cột đếm từ 1). */
export function nameAt(model, pos) {
  const line = model.getLineContent(pos.lineNumber);
  let m;
  NAME.lastIndex = 0;
  while ((m = NAME.exec(line))) {
    const s = m.index + 1, e = s + m[0].length;
    if (pos.column >= s && pos.column <= e) return { text: m[0].replace(/^dbo\./i, ''), start: s, end: e };
  }
  return null;
}

export function objects(call, db, refresh) {
  if (refresh || !objectCache.has(db)) objectCache.set(db, call('sql.objects', { db, refresh: !!refresh }).catch(() => []));
  return objectCache.get(db);
}
export function columns(call, db, table) {
  const k = db + '|' + table.toLowerCase();
  if (!columnCache.has(k)) columnCache.set(k, call('sql.columns', { db, name: table }).catch(() => []));
  return columnCache.get(k);
}

/** alias → tên bảng, dò FROM / JOIN / UPDATE / INTO trong cả văn bản. */
function aliases(text) {
  const map = {};
  const re = /\b(?:FROM|JOIN|UPDATE|INTO)\s+([\w$#.[\]]+)(?:\s+(?:AS\s+)?([A-Za-z_]\w*))?/gi;
  let m;
  while ((m = re.exec(text))) {
    const table = m[1].replace(/[[\]]/g, '').replace(/^dbo\./i, '');
    map[table.toLowerCase()] = table;
    if (m[2] && !/^(WHERE|ON|INNER|LEFT|RIGHT|JOIN|SET|GROUP|ORDER|WITH|OUTER|CROSS|UNION|SELECT)$/i.test(m[2])) map[m[2].toLowerCase()] = table;
  }
  return map;
}

const KIND = { U: 'Struct', V: 'Interface', P: 'Function', FN: 'Method', IF: 'Method', TF: 'Method' };
const LABEL = { U: 'bảng', V: 'view', P: 'store', FN: 'function', IF: 'function', TF: 'function' };

function register(monaco) {
  if (registered) return;
  registered = true;
  monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: ['.'],
    async provideCompletionItems(model, pos) {
      const owner = owners.get(model.uri.toString());
      if (!owner) return { suggestions: [] };
      const { call, db } = owner();
      const before = model.getLineContent(pos.lineNumber).slice(0, pos.column - 1);
      const word = model.getWordUntilPosition(pos);
      const range = new monaco.Range(pos.lineNumber, word.startColumn, pos.lineNumber, word.endColumn);
      const dot = /([\w$#]+)\.[\w$#]*$/.exec(before);
      if (dot) {
        const table = aliases(model.getValue())[dot[1].toLowerCase()] || dot[1];
        const cols = await columns(call, db, table);
        return { suggestions: cols.map((c, i) => ({ label: c.name, kind: monaco.languages.CompletionItemKind.Field, detail: c.type + (c.nullable ? ' null' : ''), insertText: c.name, range, sortText: String(i).padStart(4, '0') })) };
      }
      const list = await objects(call, db);
      return { suggestions: list.filter((o) => o.type !== 'TR').map((o) => ({ label: o.name, kind: monaco.languages.CompletionItemKind[KIND[o.type] || 'Text'], detail: LABEL[o.type] || o.type, insertText: o.name, range })) };
    }
  });
}

/** Gắn gợi ý cho editor; getOwner() trả { call, db } hiện tại của tab. */
export function attachSqlSense(editor, getOwner) {
  register(window.monaco);
  const key = editor.getModel().uri.toString();
  owners.set(key, getOwner);
  editor.onDidDispose(() => owners.delete(key));
}
