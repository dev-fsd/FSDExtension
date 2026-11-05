// Màn Query (thay ucQuery 5.1, đối chiếu docs\v5.2\parity\query.md): editor SQL, chạy theo batch GO trên DB chọn của tab,
// kết quả lưới / thông báo / Find Result. Phím như 5.1: F5 chạy (bôi đen = chạy phần chọn), Ctrl+F5 dừng, Ctrl+R ẩn / hiện kết quả,
// Ctrl+O mở, Ctrl+S lưu, Ctrl+Shift+S lưu thành, Ctrl+Insert thêm vào Memory Temp, Ctrl+Space xem cột / mã của tên tại con trỏ,
// Ctrl+Click chèn mã ALTER của store / view / function lên đầu.
// ctx.opts: { sql, title, db, language } — mở sẵn nội dung (xem định nghĩa, Memory Temp, "SELECT TOP 100" từ màn khác).
// Bản extension (webview): nội dung + DB + file giữ bằng ctx.saveState để khôi phục tab; phím F5… chạy cả khi con trỏ ngoài editor; DB đổi ở nút DB, hiện lại (đậm, PROD đỏ) cùng số bảng · dòng ở thanh trạng thái.
import { createEditor } from '../ui/editor.js';
import { createGrid } from '../ui/grid.js';
import { showDialog, showText, showColumns, showCode, dropMenu } from '../ui/dialog.js';
import { attachSqlSense, nameAt } from '../ui/sqlsense.js';
import { callWithFiles } from '../bridge.js';
import { icon, cicon, ibtn, dbPillHtml, setDbPill } from '../ui/icons.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const WRAP = { section: 'ucQuery', name: 'WrapText' };   // cùng khóa registry với 5.1
let seq = 0;

/** Trạng thái rỗng của vùng kết quả: icon mờ + một câu gợi ý (có phím tắt). */
const emptyState = (name, html) => '<div class="empty-state">' + cicon(name, 36) + '<p>' + html + '</p></div>';
const emptyRun = () => emptyState('run', 'Bấm <b>Chạy</b> hoặc nhấn <kbd>F5</kbd> để xem kết quả.');
/** Nhãn tab kết quả: chữ + badge đếm mờ (bad = badge đỏ khi có lỗi). */
const tabLabel = (text, n, bad) => esc(text) + (n ? `<span class="badge${bad ? ' bad' : ''}">${n.toLocaleString('vi-VN')}</span>` : '');

// 5.1 IsValidObjectNameSelection: chặn phần chọn không phải tên đối tượng. Trả câu cảnh báo, '' = hợp lệ.
const SQL_WORDS = new Set(('SELECT INSERT UPDATE DELETE FROM WHERE JOIN INNER LEFT RIGHT OUTER ON AND OR LIKE ORDER GROUP HAVING UNION ' +
  'AS CASE WHEN EXEC EXECUTE DECLARE SET BEGIN END IF ELSE WHILE').split(' '));
function badName(text) {
  text = text.replace(/\([^)]*\)$/, '').trim();
  if (!text) return 'Không có tên đối tượng tại con trỏ';
  if (text.length > 150) return 'Phần chọn quá dài (tối đa 150 ký tự)';
  if (/[\r\n\t]/.test(text)) return 'Phần chọn có xuống dòng';
  const kw = text.split(/[ .[\]]+/).find((w) => SQL_WORDS.has(w.toUpperCase()));
  if (kw) return 'Phần chọn có từ khóa SQL: ' + kw;
  if (text.split(/ +/).filter(Boolean).length > 4) return 'Phần chọn có quá nhiều từ';
  return '';
}
const cleanName = (s) => s.replace(/\([^)]*\)$/, '').replace(/[[\]]/g, '').trim().replace(/^dbo\./i, '');

export function mount(root, ctx) {
  const no = ++seq;
  const saved = ctx.state && typeof ctx.state === 'object' ? ctx.state : null;   // trạng thái tab lần trước (khôi phục sau khi mở lại IDE)
  const st = { path: '', dirty: false, running: null, results: null, view: 'grid', showResults: true, editor: null, decorations: [], findDecos: [], finds: [], pending: null };
  root.innerHTML = `
    <div class="scr-bar">
      ${ibtn('run', 'run', 'Chạy (F5) — bôi đen để chạy phần chọn', { cls: 'go' })}
      ${ibtn('stop', 'stop', 'Dừng (Ctrl+F5)', { cls: 'halt', extra: 'disabled' })}
      <span class="sep"></span>
      <button class="db-pill" data-a="db" title="Đổi DB chạy của tab (Ctrl+G)">${dbPillHtml()}</button>
      <span class="sep"></span>
      ${ibtn('new', 'newFile', 'Mới — xóa trắng editor')}
      ${ibtn('open', 'open', 'Mở file .sql (Ctrl+O)')}
      ${ibtn('save', 'save', 'Lưu (Ctrl+S)')}
      ${ibtn('saveas', 'saveAs', 'Lưu thành… (Ctrl+Shift+S)')}
      <span class="sep"></span>
      ${ibtn('beauty', 'format', 'Định dạng SQL / JSON / XML (phần chọn hoặc cả bài)', { menu: true })}
      ${ibtn('xsd', 'xsd', 'Ghi cấu trúc kết quả ra .xsd (Crystal) hoặc .frx (FastReport)')}
      ${ibtn('profiler', 'profiler', 'Mở FSDProfiler theo dõi SQL của DB dự án')}
      <span class="sep"></span>
      <label class="icon-btn tb tog" title="Xuống dòng (nhớ cho lần sau)"><input type="checkbox" data-a="wrap">${cicon('wrap')}</label>
      <span class="sp"></span>
      <span class="srch">${icon('search', 14)}<input class="tb-find" data-a="find" placeholder="Tìm trong editor…" title="Gõ từ 2 ký tự: tô mọi chỗ khớp, danh sách ở tab Find Result"></span>
    </div>
    <div class="scr-prog"></div>
    <div class="q-edit" data-a="editor"></div>
    <div class="q-split" data-a="split" title="Kéo để đổi chiều cao"></div>
    <div class="q-res" data-a="res">
      <div class="rtabs"><button data-v="grid" class="on">Kết quả</button><button data-v="msg">Thông báo</button><button data-v="find">Find Result</button>
        <span class="sp"></span><span class="faint q-hint"><kbd>Ctrl+R</kbd> ẩn / hiện</span><button class="q-close" data-a="close" title="Ẩn kết quả (Ctrl+R)">${icon('close', 14)}</button></div>
      <div class="q-out" data-a="out">${emptyRun()}</div>
    </div>
    <div class="statusbar"><span class="sb-msg" data-a="status"></span><span class="sp"></span><span data-a="sinfo"></span></div>`;
  const q = (a) => root.querySelector(`[data-a="${a}"]`);
  /** Thông báo bên trái thanh trạng thái; kind: ok (xanh) / warn (cam) / bad (đỏ). */
  function setStatus(text, kind) { const el = q('status'); el.textContent = text || ''; el.className = 'sb-msg' + (kind ? ' ' + kind : ''); }
  /** Thông tin bên phải: DB (đậm, PROD đỏ) · số bảng · số dòng (đậm) · thời gian — sau mỗi lần chạy. */
  function setInfo(r) {
    const prod = q('db').classList.contains('prod') ? ' prod' : '';
    const parts = [`<span class="sb-db${prod}">${esc(r ? r.db : dbSel.value || '…')}</span>`];
    if (r) {
      const rows = r.sets.reduce((a, s) => a + s.total, 0);
      parts.push(`<span class="t-num">${r.sets.length}</span> bảng`, `<span class="t-num">${rows.toLocaleString('vi-VN')}</span> dòng`, (r.ms / 1000).toFixed(2) + ' s');
    }
    q('sinfo').innerHTML = parts.join('<span class="dot"> · </span>');
  }
  // DB của tab (chọn ở thanh trạng thái dưới): mặc định DB App của dự án.
  const dbSel = { value: (saved && saved.db) || ctx.opts.db || (ctx.project() || {}).db || '' };
  if (saved) { st.path = saved.path || ''; st.dirty = !!saved.dirty; }
  let saveTimer = 0;
  /** Ghi nội dung + DB + file của tab (ctx.saveState) sau 400 ms không gõ. */
  function persist(now) {
    clearTimeout(saveTimer);
    const doIt = () => { if (st.editor) ctx.saveState({ sql: st.editor.getValue(), db: dbSel.value, path: st.path, dirty: st.dirty }); };
    if (now) doIt(); else saveTimer = setTimeout(doIt, 400);
  }
  const dbLabel = () => { setDbPill(q('db'), dbSel.value); setInfo(st.results && st.results.db === dbSel.value ? st.results : null); };
  // DB mặc định = DB App đầu của dự án; điền sau khi đọc xong, giao diện không phải chờ.
  if (!dbSel.value) {
    ctx.call('project.databases').then((dbs) => {
      if (dbSel.value) return;
      dbSel.value = (((dbs || []).find((d) => d.kind === 'app') || (dbs || [])[0]) || {}).name || '';
      dbLabel();
    }).catch(() => { /* không đọc được DB: màn tự báo khi chạy */ });
  }
  dbLabel();

  // --- editor ---
  createEditor(q('editor'), { value: saved && typeof saved.sql === 'string' ? saved.sql : ctx.opts.sql || '', language: ctx.opts.language || 'sql' }).then((ed) => {
    st.editor = ed;
    if (st.pending) { setText(st.pending.text, st.pending.path, st.pending.keepClean); st.pending = null; }
    const m = window.monaco, K = m.KeyCode, C = m.KeyMod.CtrlCmd, S = m.KeyMod.Shift;
    // Menu chuột phải như mnStrip 5.1 (Run / Stop / Ẩn hiện / Open / Save / Save As / XSD) + Undo / Redo / Select All.
    const act = (id, label, keys, run, order, group) => ed.addAction({ id, label, keybindings: keys, run, contextMenuGroupId: group || '0_fsd', contextMenuOrder: order });
    act('fsd.run', 'Chạy (F5)', [K.F5], run, 1);
    act('fsd.stop', 'Dừng (Ctrl+F5)', [C | K.F5], stop, 2);
    act('fsd.results', 'Ẩn / hiện kết quả (Ctrl+R)', [C | K.KeyR], toggleResults, 3);
    act('fsd.open', 'Mở… (Ctrl+O)', [C | K.KeyO], openFile, 1, '1_file');
    act('fsd.save', 'Lưu (Ctrl+S)', [C | K.KeyS], () => save(false), 2, '1_file');
    act('fsd.saveas', 'Lưu thành… (Ctrl+Shift+S)', [C | S | K.KeyS], () => save(true), 3, '1_file');
    act('fsd.xsd', 'Tạo XSD / FRX', [], writeSchema, 4, '1_file');
    // Chuột phải tên bảng / view (hoặc phần bôi đen) → mở Select Table của bảng đó (BA ba-ui mục 8).
    act('fsd.selectTable', 'Select Table (tên tại con trỏ)', [], () => {
      const raw = nameAtCursor(ed), bad = raw ? badName(raw) : 'Đặt con trỏ vào tên bảng trước.';
      if (bad) { ctx.toast('⚠ ' + esc(bad)); return; }
      ctx.open('SelectTable', { table: cleanName(raw), db: dbSel.value });
    }, 5, '1_file');
    act('fsd.undo', 'Hoàn tác (Ctrl+Z)', [], () => ed.trigger('menu', 'undo'), 4, '9_cutcopypaste');
    act('fsd.redo', 'Làm lại (Ctrl+Y)', [], () => ed.trigger('menu', 'redo'), 5, '9_cutcopypaste');
    act('fsd.all', 'Chọn tất cả (Ctrl+A)', [], () => ed.trigger('menu', 'editor.action.selectAll'), 6, '9_cutcopypaste');
    ed.addCommand(C | K.Insert, addToMemory);
    ed.addCommand(C | K.Space, ctrlSpace);
    // Phím menu chính 5.1 vẫn chạy khi đứng trong editor (Monaco mặc định: Ctrl+G = tới dòng, Ctrl+U = undo con trỏ).
    ed.addCommand(C | K.KeyG, () => ctx.open('SetDatabaseTab'));
    ed.addCommand(C | K.KeyQ, () => ctx.open('SetDatabaseMain'));
    ed.addCommand(C | K.KeyU, () => ctx.open('ChangeDatabase'));
    ed.onDidChangeModelContent(() => { if (!st.dirty && !st.loading) { st.dirty = true; title(); } clearMarks(); persist(); });
    ed.onMouseDown((e) => {
      if (!e.event.ctrlKey || !e.target.position) return;
      // Như 5.1: lấy phần đang chọn lúc Ctrl+bấm (chưa bị bấm xóa), không có thì lấy tên tại chỗ bấm.
      const sel = ed.getSelection();
      const text = sel && !sel.isEmpty() ? ed.getModel().getValueInRange(sel).trim() : (nameAt(ed.getModel(), e.target.position) || {}).text;
      insertDefinition(text || '');
    });
    attachSqlSense(ed, () => ({ call: ctx.call, db: dbSel.value }));
    ctx.call('setting.get', WRAP).then((v) => { q('wrap').checked = +v === 1; applyWrap(); }).catch(() => { /* không đọc được registry: mặc định không xuống dòng như 5.1 */ });
    ed.focus();
  }).catch((e) => { q('editor').innerHTML = `<div class="empty">${esc(e.message)}</div>`; });

  function title() {
    const name = st.path ? st.path.split(/[\\/]/).pop() : ctx.opts.title || 'Query ' + no;
    ctx.setTitle((st.dirty ? '● ' : '') + name, st.path || name);
  }
  title();
  q('db').onclick = () => ctx.open('SetDatabaseTab');

  // Phím khi con trỏ ngoài editor (lưới kết quả, thanh công cụ): Monaco đã xử lý thì thôi (defaultPrevented).
  root.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    const c = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.key === 'F5' && !c) run();
    else if (e.key === 'F5' && c) stop();
    else if (c && !e.shiftKey && k === 'r') toggleResults();
    else if (c && !e.shiftKey && k === 'o') openFile();
    else if (c && k === 's') save(e.shiftKey);
    else if (c && !e.shiftKey && k === 'g') ctx.open('SetDatabaseTab');
    else return;
    e.preventDefault();
  });

  // --- chạy ---
  async function run() {
    if (!st.editor || st.running) return;
    const model = st.editor.getModel(), selRange = st.editor.getSelection();
    const selected = selRange && !selRange.isEmpty() ? model.getValueInRange(selRange) : '';
    const sql = selected || model.getValue();
    if (!sql.trim()) return;
    const offset = selected ? selRange.startLineNumber - 1 : 0;
    const runId = 'q' + no + '-' + Date.now();
    st.running = runId; busy(true); clearMarks(); persist(true);
    setStatus('Đang chạy…');
    try {
      const r = await ctx.call('query.run', { db: dbSel.value, sql, runId });
      r.offset = offset; st.results = r;
      st.view = r.messages.some((x) => x.kind === 'error') || !r.sets.length ? 'msg' : 'grid';
      markErrors(r);
      const hasErr = r.messages.some((x) => x.kind === 'error');
      setStatus(hasErr ? 'Có lỗi — xem tab Thông báo' : '', hasErr ? 'bad' : '');
      setInfo(r);
    } catch (e) {
      st.results = { sets: [], messages: [{ kind: 'error', text: e.message, line: -1 }], offset: 0 };
      st.view = 'msg'; setStatus('Lỗi khi chạy', 'bad'); setInfo(null);
    } finally {
      st.running = null; busy(false);
    }
    if (!st.showResults) toggleResults();
    renderOut();
  }
  // Tiến độ khi đang đọc kết quả (5.1 SetRows: "Table n: x Rows").
  ctx.on('query.progress', (p) => { if (p && p.runId === st.running) setStatus(`Bảng ${p.table}: ${p.rows.toLocaleString('vi-VN')} dòng…`); });
  function stop() { if (st.running) ctx.call('query.cancel', { runId: st.running }); }
  function busy(on) { q('run').disabled = on; q('stop').disabled = !on; root.classList.toggle('is-busy', on); }

  // --- kết quả ---
  let grids = [];
  function renderOut() {
    grids.forEach((g) => g.dispose()); grids = [];
    root.querySelectorAll('.rtabs button[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === st.view));
    const out = q('out'), r = st.results;
    root.querySelector('.rtabs [data-v="find"]').innerHTML = tabLabel('Find Result', st.finds.length);
    if (st.view === 'find') { renderFinds(out); return; }
    if (!r) { out.innerHTML = emptyRun(); return; }
    root.querySelector('.rtabs [data-v="grid"]').innerHTML = tabLabel('Kết quả', r.sets.length);
    const hasErr = r.messages.some((m) => m.kind === 'error');
    root.querySelector('.rtabs [data-v="msg"]').innerHTML = tabLabel('Thông báo', r.messages.length, hasErr);
    if (st.view === 'msg') {
      out.innerHTML = '<div class="msgs">' + (r.messages.length ? r.messages.map((m, i) =>
        `<div class="msg ${m.kind}${m.line >= 0 ? ' link' : ''}" data-i="${i}">${m.kind === 'error' ? icon('error', 14) : ''}${esc(m.text)}${m.line >= 0 ? ` <span class="faint">(dòng ${m.line + r.offset + 1})</span>` : ''}</div>`).join('')
        : '<div class="msg">Lệnh đã chạy xong.</div>') + '</div>';
      out.querySelectorAll('.msg.link').forEach((el) => { el.onclick = () => gotoLine(r.messages[+el.dataset.i].line + r.offset + 1); });
      return;
    }
    if (!r.sets.length) { out.innerHTML = emptyState('table', 'Không có bảng kết quả.'); return; }
    out.innerHTML = '';
    const single = r.sets.length === 1;
    r.sets.forEach((s, i) => {
      const box = document.createElement('div');
      box.className = 'q-set' + (single ? ' fill' : '');
      if (s.truncated) box.insertAdjacentHTML('beforeend', `<div class="q-note">Bảng ${i + 1}: hiện ${s.rows.length.toLocaleString('vi-VN')} / ${s.total.toLocaleString('vi-VN')} dòng</div>`);
      out.appendChild(box);
      const g = createGrid(box, s);
      if (!single) box.style.height = Math.min(g.height() + (s.truncated ? 20 : 0), 300) + 'px';
      grids.push(g);
    });
  }
  root.querySelectorAll('.rtabs button[data-v]').forEach((b) => { b.onclick = () => { st.view = b.dataset.v; renderOut(); }; });

  function markErrors(r) {
    const lines = r.messages.filter((m) => m.kind === 'error' && m.line >= 0).map((m) => m.line + r.offset + 1);
    st.decorations = st.editor.deltaDecorations(st.decorations, lines.map((ln) => ({
      range: new window.monaco.Range(ln, 1, ln, 1), options: { isWholeLine: true, className: 'q-errline', glyphMarginClassName: 'q-errglyph' }
    })));
  }
  function clearMarks() { if (st.editor && st.decorations.length) st.decorations = st.editor.deltaDecorations(st.decorations, []); }
  function gotoLine(ln) { st.editor.revealLineInCenter(ln); st.editor.setSelection(new window.monaco.Range(ln, 1, ln, st.editor.getModel().getLineMaxColumn(ln))); st.editor.focus(); }

  // --- ô tìm + Find Result (5.1 txtFindText / _findAll): ≥ 2 ký tự mới tìm, khoảng trắng khớp mọi cụm trắng ---
  function find(text) {
    const ed = st.editor;
    if (!ed) return;
    if (text.length <= 1) { st.finds = []; st.findDecos = ed.deltaDecorations(st.findDecos, []); renderOut(); return; }
    const ws = /\s/.test(text);
    const pattern = ws ? text.trim().split(/\s+/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+') : text;
    const model = ed.getModel();
    st.finds = model.findMatches(pattern, false, ws, false, null, false, 5000).map((mt) => mt.range);
    st.findDecos = ed.deltaDecorations(st.findDecos, st.finds.map((range) => ({ range, options: { inlineClassName: 'q-findhit', overviewRuler: { color: '#e5a50a', position: 4 } } })));
    if (st.finds.length) { ed.setSelection(st.finds[0]); ed.revealRangeInCenter(st.finds[0]); }
    // 5.1 _findShowForm_Click: sang tab Find Result, kết quả đang ẩn thì hiện ra.
    st.view = 'find';
    if (!st.showResults) toggleResults();
    renderOut();
  }
  function renderFinds(out) {
    const model = st.editor && st.editor.getModel();
    if (!st.finds.length || !model) { out.innerHTML = emptyState('search', q('find').value.length > 1 ? 'Không tìm thấy.' : 'Gõ vào ô tìm (từ 2 ký tự) để liệt kê chỗ khớp.'); return; }
    out.innerHTML = '<div class="msgs">' + st.finds.map((r, i) => {
      const line = model.getLineContent(r.startLineNumber);
      const a = r.startColumn - 1, b = r.startLineNumber === r.endLineNumber ? r.endColumn - 1 : line.length;
      return `<div class="msg link" data-i="${i}"><span class="faint">${r.startLineNumber}:</span> ${esc(line.slice(0, a))}<b class="q-findhit">${esc(line.slice(a, b))}</b>${esc(line.slice(b))}</div>`;
    }).join('') + '</div>';
    out.querySelectorAll('.msg.link').forEach((el) => {
      el.onclick = () => { const r = st.finds[+el.dataset.i]; st.editor.setSelection(r); st.editor.revealRangeInCenter(r); st.editor.focus(); };
    });
  }
  q('find').oninput = (e) => find(e.target.value);

  // --- chia đôi editor / kết quả ---
  function toggleResults() {
    st.showResults = !st.showResults;
    q('res').style.display = st.showResults ? '' : 'none';
    q('split').style.display = st.showResults ? '' : 'none';
  }
  q('split').onmousedown = (e) => {
    e.preventDefault();
    const ed = q('editor'), y0 = e.clientY, h0 = ed.getBoundingClientRect().height;
    const move = (ev) => { ed.style.flex = 'none'; ed.style.height = Math.max(80, h0 + ev.clientY - y0) + 'px'; };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  };

  // --- file ---
  async function openFile() {
    const f = await ctx.call('file.open', { filter: 'sql' });
    if (f) setText(f.text, f.path);
  }
  /** keepClean: nạp nội dung không đánh dấu "chưa lưu" (đối tượng nạp từ SQL Objects khi tab chưa gắn file). */
  function setText(textValue, path, keepClean) {
    if (!st.editor) { st.pending = { text: textValue, path, keepClean }; return; }
    st.loading = true;
    st.editor.setValue(textValue);
    st.loading = false;
    if (path !== undefined) st.path = path || '';
    st.dirty = !!(keepClean && st.path); title();
    st.editor.setPosition({ lineNumber: 1, column: 1 });
  }
  async function save(saveAs) {
    if (!st.editor) return;
    const r = await ctx.call('file.save', { path: st.path, text: st.editor.getValue(), saveAs, filter: 'sql', encoding: 'utf16' });
    if (!r) return;
    st.path = r.path; st.dirty = false; title(); persist(true); ctx.toast('Đã lưu <span class="mono">' + esc(r.path) + '</span>');
  }
  // Kéo thả đúng 1 file .sql vào editor (như 5.1): mở và nhớ đường dẫn để Lưu ghi lại file đó.
  q('editor').addEventListener('drop', async (e) => {
    const files = e.dataTransfer.files;
    if (files.length !== 1 || !/\.sql$/i.test(files[0].name)) return;
    e.preventDefault(); e.stopPropagation();
    try {
      const f = await callWithFiles('file.readDropped', {}, [files[0]]);
      if (f) setText(f.text, f.path); else setText(await files[0].text(), '');
    } catch (err) { ctx.toast('⚠ ' + esc(err.message)); }
  }, true);

  // --- Wrap (nhớ ở registry như 5.1) ---
  function applyWrap() { if (st.editor) st.editor.updateOptions({ wordWrap: q('wrap').checked ? 'on' : 'off' }); }
  q('wrap').onchange = () => { applyWrap(); ctx.call('setting.set', Object.assign({ value: q('wrap').checked }, WRAP)).catch(() => { /* ghi registry lỗi: bỏ qua như 5.1 */ }); };

  // --- Memory Temp: toàn bộ nội dung + GO (5.1 AddToMemory) ---
  function addToMemory() {
    if (!st.editor) return;
    ctx.memory.add(st.editor.getValue());
    ctx.toast('Đã thêm vào Memory Temp (lệnh FSD: Xem Memory Temp)');
  }

  // --- định dạng, XSD / FRX ---
  async function beauty(mode) {
    const s = st.editor.getSelection(), model = st.editor.getModel();
    const range = s && !s.isEmpty() ? s : model.getFullModelRange();
    try {
      const out = await ctx.call('format.text', { mode, text: model.getValueInRange(range) });
      st.editor.executeEdits('beauty', [{ range, text: out }]);
      window.monaco.editor.setModelLanguage(model, mode === 'json' ? 'javascript' : mode);
    } catch (e) { ctx.toast('⚠ ' + esc(e.message)); }
  }
  async function writeSchema() {
    const r = st.results;
    if (!r || !r.sets.length) { ctx.toast('Chạy query có kết quả trước (bảng d1, d2…)'); return; }
    const v = await showDialog({
      title: 'Ghi cấu trúc kết quả (XSD / FRX)', ok: 'Ghi',
      note: 'File <b>.frx</b>: chỉ đồng bộ &lt;Dictionary&gt; (giữ layout); file khác: ghi lại .xsd.',
      fields: [{ id: 'name', label: 'Tên DataSet', value: 'ds', required: true }]
        .concat(r.sets.map((s, i) => ({ id: 't' + i, label: `Bảng ${i + 1} (${s.columns.length} cột)`, value: 'd' + (i + 1), required: true })))
        .concat([{ id: 'path', label: 'File', value: '', required: true, browse: async (cur) => { const f = await ctx.call('file.pick', { filter: 'xsd;frx', path: cur, save: true }); return f && f.path; } }])
    });
    if (!v) return;
    try {
      const msg = await ctx.call('report.writeSchema', { path: v.path, name: v.name, tables: r.sets.map((s, i) => ({ name: v['t' + i], columns: s.columns })) });
      showText({ title: 'XSD / FRX', text: msg });
    } catch (e) { ctx.toast('⚠ ' + esc(e.message)); }
  }

  // --- tên đối tượng tại con trỏ: Ctrl+Space xem, Ctrl+Click chèn ALTER ---
  function nameAtCursor(ed) {
    const sel = ed.getSelection();
    if (sel && !sel.isEmpty()) return ed.getModel().getValueInRange(sel).trim();
    const n = nameAt(ed.getModel(), ed.getPosition());
    return n ? n.text : '';
  }
  /** 5.1 ShowSqlByName: bảng → hộp danh sách cột; store / view / function → hộp xem mã ALTER. Không phải đối tượng → gợi ý. */
  async function ctrlSpace(ed) {
    ed = ed && ed.getModel ? ed : st.editor;
    const raw = nameAtCursor(ed);
    const suggest = () => ed.trigger('fsd', 'editor.action.triggerSuggest', {});
    if (!raw || badName(raw)) { suggest(); return; }
    const name = cleanName(raw);
    try {
      const d = await ctx.call('sql.definition', { db: dbSel.value, name });
      if (!d) { ctx.toast('❌ <b>' + esc(name) + '</b> không có trong ' + esc(dbSel.value)); suggest(); return; }
      if (d.type === 'U') {
        const cols = await ctx.call('sql.columns', { db: dbSel.value, name: d.name });
        showColumns({ title: d.name, columns: cols });
        return;
      }
      const code = await ctx.call('sql.script', { db: dbSel.value, name: d.name, alter: true });
      showCode({ title: d.name, text: code, onCtrlSpace: (viewer) => ctrlSpace(viewer) });
    } catch (e) { ctx.toast('⚠ ' + esc(e.message)); }
  }
  /** 5.1 InsertRoutineDefinitionAtCursor: mã ALTER (+ GO) + 2 dòng trống + nội dung cũ. */
  async function insertDefinition(raw) {
    const bad = badName(raw);
    if (bad) { ctx.toast('⚠ ' + esc(bad)); return; }
    const name = cleanName(raw);
    try {
      const d = await ctx.call('sql.definition', { db: dbSel.value, name });
      if (!d) { ctx.toast('❌ <b>' + esc(name) + '</b> không có trong ' + esc(dbSel.value)); return; }
      if (d.type === 'U') { ctx.toast('⚠ Ctrl+Click chỉ chèn mã view / store / function / trigger. Bảng → Ctrl+Space (danh sách cột).'); return; }
      const code = await ctx.call('sql.script', { db: dbSel.value, name: d.name, alter: true });
      if (!code.trim()) { ctx.toast('⚠ Không lấy được mã của ' + esc(d.name)); return; }
      const ed = st.editor;
      ed.executeEdits('definition', [{ range: new window.monaco.Range(1, 1, 1, 1), text: code.replace(/\s+$/, '') + '\r\n\r\n' }]);
      ed.setPosition({ lineNumber: 1, column: 1 }); ed.revealLine(1); ed.focus();
    } catch (e) { ctx.toast('⚠ ' + esc(e.message)); }
  }

  q('beauty').onclick = () => dropMenu(q('beauty'), [['Định dạng SQL', () => beauty('sql')], ['Định dạng JSON', () => beauty('json')], ['Định dạng XML', () => beauty('xml')]]);
  q('xsd').onclick = writeSchema;
  q('profiler').onclick = async () => { try { ctx.toast(esc(await ctx.call('plugin.profiler'))); } catch (e) { ctx.toast('⚠ ' + esc(e.message)); } };
  q('run').onclick = run;
  q('stop').onclick = stop;
  q('new').onclick = () => { if (st.editor) { st.editor.setValue(''); st.editor.focus(); } };
  q('open').onclick = openFile;
  q('save').onclick = () => save(false);
  q('saveas').onclick = () => save(true);
  q('close').onclick = toggleResults;

  return {
    focus: () => st.editor && st.editor.focus(),
    isDirty: () => st.dirty,
    db: () => dbSel.value,
    setDb: (name) => { dbSel.value = name; dbLabel(); persist(true); },
    /** Mở sẵn câu SQL (vd "SELECT TOP 100" từ trang bảng). */
    setSql: (sqlText) => setText(sqlText),
    /** 5.1 SetDataTab: nạp mã đối tượng chọn ở SQL Objects vào tab này (giữ đường dẫn file), rồi tô theo ô tìm. */
    loadObject: (text) => { setText(text, undefined, true); if (q('find').value.length > 1) find(q('find').value); },
    /** 5.1 frmMain gán txtFindText (panel lọc theo cột / nội dung + Enter). */
    setFind: (text) => { q('find').value = text || ''; find(q('find').value); },
    addToMemory,
    dispose: () => { persist(true); stop(); grids.forEach((g) => g.dispose()); if (st.editor) st.editor.dispose(); }
  };
}
