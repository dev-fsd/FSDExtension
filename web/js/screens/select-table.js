// Màn Select Table (thay ucSelectTable 5.1, đối chiếu docs\v5.2\parity\select-table.md): chọn bảng, tick cột, điều kiện,
// chạy (F5 / Ctrl+R); bảng chia kỳ chạy theo khoảng ngày; WHERE bắt đầu "\" = câu SQL tự viết. Như 5.1: sửa trên lưới ghi thẳng
// DB (rời dòng tự lưu, Ctrl+S, F8 hỏi rồi xóa), Edit Column (thêm / sửa / xóa cột, sắp cột bảng log) chạy thẳng vào DB.
// ctx.opts: { table, where, db, run, hideColumns } — mở sẵn bảng (panel SQL, MultiSearch: chạy ngay + ẩn danh sách cột).
// Bản extension (webview): bảng + DB + SELECT + WHERE + Từ / Đến + cột tick + Chỉ đọc giữ bằng ctx.saveState để khôi phục tab;
// DB đổi ở nút DB trên thanh công cụ, hiện lại (đậm, PROD đỏ) ở thanh trạng thái cùng bảng · số dòng; phím F5… chạy cả khi con trỏ không ở ô nhập.
import { createGrid } from '../ui/grid.js';
import { dropMenu, menuAt, showDialog, showText } from '../ui/dialog.js';
import { objects } from '../ui/sqlsense.js';
import { setClipboard } from '../bridge.js';
import { icon, cicon, ibtn, dbPillHtml, setDbPill } from '../ui/icons.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TYPES = ['VARCHAR(16)', 'VARCHAR(32)', 'NUMERIC(19, 4)', 'NVARCHAR(256)', 'SMALLDATETIME', 'INT', 'TINYINT', 'BIT', 'DATETIME'];   // frmEditColumn 5.1
let seq = 0;

/** Trạng thái rỗng của vùng lưới: icon mờ + một câu gợi ý (có phím tắt). */
const emptyState = (name, html) => '<div class="empty-state">' + cicon(name, 36) + '<p>' + html + '</p></div>';

export function mount(root, ctx) {
  const no = ++seq;
  const saved = ctx.state && typeof ctx.state === 'object' ? ctx.state : null;   // trạng thái tab lần trước (khôi phục sau khi mở lại IDE)
  const st = { info: null, table: '', grid: null, set: null, running: null, colFilter: '', checked: new Set(), raw: false, resultCols: [], sql: '', hidden: false, restoring: false, total: null, ms: null };
  // Bố cục đúng ucSelectTable 5.1 (Designer): dải trên hai cột — trái SELECT (1 dòng) + WHERE (nhiều dòng, giãn); phải FROM, Chỉ đọc + Dừng / Chạy,
  // Ngày Từ – Đến (chỉ bảng chia kỳ). Dưới: danh sách cột (nút tên bảng + « ẩn, ô Search, ô tick, khóa chính đậm) | lưới; Focus Column ở đáy lưới.
  // Thanh công cụ (extension thêm, 5.1 dùng menu chuột phải): nút DB của tab + ẩn / hiện cột + menu script / thêm vào Update — chỉ icon màu, chữ ở tooltip.
  root.innerHTML = `
    <div class="scr-bar">
      <button class="db-pill" data-a="db" title="Đổi DB của tab (Ctrl+G)">${dbPillHtml()}</button>
      <span class="sep"></span>
      ${ibtn('hide', 'panel', 'Ẩn / hiện danh sách cột', { cls: 'on' })}
      ${ibtn('colScript', 'scriptCol', 'Script cho các cột đang tick (chuột phải danh sách cột cũng có)', { menu: true })}
      ${ibtn('dataScript', 'scriptData', 'Script dữ liệu (F12 = theo điều kiện)', { menu: true })}
      ${ibtn('pkg', 'update', 'Thêm vào Update (Ctrl+F12)', { menu: true })}
    </div>
    <div class="scr-prog"></div>
    <div class="st-q">
      <div class="st-ql">
        <div class="frow"><span class="lb">SELECT</span><div class="st-pick grow"><input data-a="fields" class="mono" placeholder="* (tick cột bên dưới để chọn)" autocomplete="off" spellcheck="false"><div class="st-sugg" data-a="fsugg"></div></div></div>
        <div class="frow top"><span class="lb">WHERE</span><div class="st-pick grow"><textarea data-a="where" class="mono" rows="3" placeholder="điều kiện · bắt đầu bằng \\ = câu SQL tự viết" spellcheck="false"></textarea><div class="st-sugg" data-a="wsugg"></div></div></div>
      </div>
      <div class="st-qr">
        <div class="frow"><span class="lb">FROM</span><div class="st-pick grow"><input data-a="table" class="mono" placeholder="Bảng / view… (gõ để tìm)" autocomplete="off" spellcheck="false"><div class="st-sugg" data-a="sugg"></div></div>
          ${ibtn('reload', 'refresh', 'Đọc lại cột của bảng')}</div>
        <div class="frow">
          <label class="icon-btn tb tog ro" title="Chỉ đọc — bỏ tick = sửa được trên lưới (Ctrl+S ghi thẳng vào DB)"><input type="checkbox" data-a="ro"><span class="i-lock">${cicon('lock')}</span><span class="i-edit">${cicon('edit')}</span></label>
          <span class="grow"></span>
          ${ibtn('stop', 'stop', 'Dừng (Ctrl+F5)', { cls: 'halt', extra: 'disabled' })}
          ${ibtn('run', 'run', 'Chạy (F5 / Ctrl+R)', { cls: 'go' })}
        </div>
        <div class="frow st-dates" data-a="dates" hidden><span class="lb ld">Từ</span><input type="date" data-a="dfrom"><span class="lb ld auto">Đến</span><input type="date" data-a="dto"></div>
      </div>
    </div>
    <div class="st-body">
      <div class="st-cols" data-a="colPane">
        <div class="st-cols-t"><button class="st-tname" data-a="tname" title="Đọc lại cột của bảng"></button>${ibtn('hide2', 'collapse', 'Ẩn danh sách cột', { cls: 'sm' })}</div>
        <div class="st-cols-h"><span class="srch">${icon('search', 14)}<input data-a="colFilter" placeholder="Search…" spellcheck="false"></span></div>
        <div class="st-cols-act"><span class="st-cnt" data-a="colCount"></span><span class="sp"></span>
          ${ibtn('all', 'checkAll', 'Chọn hết (Ctrl+A)', { cls: 'sm' })}${ibtn('none', 'uncheckAll', 'Bỏ hết (Ctrl+Shift+A)', { cls: 'sm' })}${ibtn('refresh', 'refresh', 'Đọc lại cột (F5 khi đứng ở danh sách)', { cls: 'sm' })}</div>
        <div class="st-list" data-a="cols" tabindex="0"><div class="empty">Chọn bảng để xem cột.</div></div>
      </div>
      <div class="st-split" data-a="split" title="Kéo để đổi độ rộng"></div>
      <button class="st-unhide" data-a="unhide" title="Hiện danh sách cột" hidden>${cicon('collapse', 14)}</button>
      <div class="st-main">
        <div class="st-grid" data-a="grid">${emptyState('table', 'Chọn bảng ở ô <b>FROM</b> rồi bấm <b>Chạy</b> hoặc nhấn <kbd>F5</kbd>.')}</div>
        <div class="st-focus">${cicon('target')}<input data-a="focus" list="st_focus_${no}" placeholder="Focus column… (Enter)" spellcheck="false"><datalist id="st_focus_${no}" data-a="focusList"></datalist>${ibtn('focusBtn', 'goto', 'Nhảy tới cột (Enter)')}</div>
      </div>
    </div>
    <div class="statusbar"><span class="sb-msg" data-a="status"></span><span class="chip warn" data-a="rwchip" hidden title="Chỉ đọc đang tắt: sửa / xóa trên lưới ghi thẳng vào DB">Sửa trực tiếp DB</span><span class="sp"></span><span data-a="sinfo"></span></div>`;
  const q = (a) => root.querySelector(`[data-a="${a}"]`);
  const nf = (n) => Number(n).toLocaleString('vi-VN');
  /** Dòng thông báo bên trái thanh trạng thái; kind: ok (xanh) / warn (cam) / bad (đỏ). */
  function setStatus(text, kind) { const el = q('status'); el.textContent = text || ''; el.className = 'sb-msg' + (kind ? ' ' + kind : ''); }
  /** Thông tin bên phải: DB (đậm, PROD đỏ) · bảng (đậm) · số dòng (đậm) · thời gian. */
  function drawInfo() {
    const parts = [`<span class="sb-db${q('db').classList.contains('prod') ? ' prod' : ''}">${esc(curDb || '…')}</span>`];
    if (st.table) parts.push(`<span class="t-name">${esc(st.table)}</span>`);
    if (st.total != null) parts.push(`<span class="t-num">${nf(st.total)}</span> dòng${st.ms != null ? ' · ' + (st.ms / 1000).toFixed(2) + ' s' : ''}`);
    q('sinfo').innerHTML = parts.join('<span class="dot"> · </span>');
  }
  /** Đếm cột tick / tổng ở dưới ô Search. */
  function setCount(total) { q('colCount').innerHTML = `<b>${nf(st.checked.size)}</b>/${nf(total)} cột`; }
  // DB của tab (nút DB trên thanh công cụ): mặc định DB App của dự án; tab khôi phục thì giữ DB lần trước.
  let curDb = (saved && saved.db) || ctx.opts.db || (ctx.project() || {}).db || '';
  const db = () => curDb;
  const dbLabel = () => { setDbPill(q('db'), curDb); drawInfo(); };
  dbLabel();
  updateRw();
  q('db').onclick = () => ctx.open('SetDatabaseTab');
  const toast = (m) => ctx.toast(m);
  const fail = (e) => toast('⚠ ' + esc(e.message || e));

  // Ghi bảng + DB + SELECT + WHERE + Từ / Đến + cột tick + Chỉ đọc của tab (ctx.saveState) sau 400 ms không đổi.
  let saveTimer = 0;
  function persist(now) {
    if (st.restoring) return;
    clearTimeout(saveTimer);
    const doIt = () => ctx.saveState({
      table: st.table, db: curDb, fields: q('fields').value, where: q('where').value, dfrom: q('dfrom').value, dto: q('dto').value,
      checked: [...st.checked], ro: q('ro').checked, hidden: st.hidden
    });
    if (now) doIt(); else saveTimer = setTimeout(doIt, 400);
  }

  /** Khôi phục tab sau khi mở lại IDE: nạp bảng, rồi đặt lại SELECT / WHERE / Từ–Đến / cột tick / Chỉ đọc. Không tự chạy câu lệnh. */
  async function restore() {
    st.restoring = true;
    try {
      q('where').value = saved.where || '';
      await pickTable(saved.table, false);
      if (st.info) {
        const names = new Set(allCols().map((c) => c.name));
        (saved.checked || []).forEach((n) => { if (names.has(n)) st.checked.add(n); });
        if (typeof saved.fields === 'string' && saved.fields) q('fields').value = saved.fields;
        drawCols();
        if (st.info.partition && saved.dfrom && saved.dto) { q('dfrom').value = saved.dfrom; q('dto').value = saved.dto; }
      }
      q('ro').checked = !!saved.ro;
      syncReadOnly();
      if (saved.hidden && !st.hidden) toggleCols();
    } finally { st.restoring = false; }
    persist(true);
  }

  ctx.call('project.databases').then((dbs) => {
    st.sysDb = ((dbs || []).find((d) => d.kind === 'sys') || {}).name;
    if (!curDb) { curDb = (((dbs || []).find((d) => d.kind === 'app') || (dbs || [])[0]) || {}).name || ''; dbLabel(); }   // DB App đầu của dự án
    if (saved && saved.table) { restore(); return; }
    if (ctx.opts.hideColumns) toggleCols();
    if (ctx.opts.table) { q('where').value = ctx.opts.where || ''; pickTable(ctx.opts.table, ctx.opts.run !== false); }
    else q('table').focus();
  }).catch(fail);
  if (!(saved && saved.table) && !ctx.opts.table) q('table').focus();   // mở tab trống: con trỏ đặt sẵn ở ô FROM ngay (không chờ đọc danh sách DB)
  ctx.setTitle('Select ' + no);

  // --- chọn bảng (gợi ý bảng / view của DB) ---
  const sugg = q('sugg');
  let suggItems = [], suggIdx = 0;
  q('table').oninput = async () => {
    const v = q('table').value.trim().toLowerCase();
    if (!v) { sugg.style.display = 'none'; return; }
    const list = await objects(ctx.call, db());
    suggItems = list.filter((o) => (o.type === 'U' || o.type === 'V') && o.name.toLowerCase().includes(v))
      .sort((a, b) => (a.name.toLowerCase().startsWith(v) ? 0 : 1) - (b.name.toLowerCase().startsWith(v) ? 0 : 1) || a.name.length - b.name.length).slice(0, 40);
    suggIdx = 0; drawSugg();
  };
  function drawSugg() {
    sugg.innerHTML = suggItems.map((o, i) => `<div class="pi${i === suggIdx ? ' on' : ''}" data-i="${i}"><span class="fi ${o.type === 'U' ? 'tbl' : 'sql'}">${o.type === 'U' ? 'TB' : 'VW'}</span><span>${esc(o.name)}</span></div>`).join('');
    sugg.style.display = suggItems.length ? 'block' : 'none';
    sugg.querySelectorAll('.pi').forEach((el) => { el.onmousedown = (e) => { e.preventDefault(); pickTable(suggItems[+el.dataset.i].name, false); }; });
  }
  q('table').onkeydown = (e) => {
    if (sugg.style.display === 'block' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { suggIdx = Math.max(0, Math.min(suggItems.length - 1, suggIdx + (e.key === 'ArrowDown' ? 1 : -1))); drawSugg(); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (sugg.style.display === 'block' && suggItems[suggIdx]) pickTable(suggItems[suggIdx].name, false); else pickTable(q('table').value.trim(), false); }
    else if (e.key === 'Escape') sugg.style.display = 'none';
  };
  q('table').onblur = () => setTimeout(() => { sugg.style.display = 'none'; }, 150);

  /** 5.1 txtFrom_ValueChanged: đọc cột, tiêu đề tab, bảng chia kỳ → Từ / Đến, xóa lưới cũ. */
  async function pickTable(name, runAfter) {
    if (!name) return;
    sugg.style.display = 'none';
    q('table').value = name; st.table = name; st.checked.clear(); q('fields').value = '';
    st.total = null; st.ms = null;
    q('tname').textContent = name; q('tname').title = 'Đọc lại cột của ' + name;
    drawInfo();
    ctx.setTitle(name, 'Select ' + name);
    q('cols').innerHTML = '<div class="empty">Đang đọc cột…</div>';
    try {
      st.info = await ctx.call('table.info', { db: db(), table: name });
    } catch (e) { q('cols').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    st.raw = false;
    q('dates').hidden = !st.info.partition;
    if (st.info.partition) { q('dfrom').value = st.info.dfrom; q('dto').value = st.info.dto; }
    syncReadOnly();
    clearGrid('Bấm Chạy hoặc nhấn F5 để xem dữ liệu.');
    drawCols(); fillFocusList(st.info.columns.map((c) => c.name));
    persist();
    if (runAfter) run();
  }
  q('reload').onclick = q('tname').onclick = () => (st.table ? pickTable(st.table, false) : q('table').focus());

  // --- danh sách cột (tick = đưa vào SELECT; câu SQL tự viết → cột của kết quả) ---
  const allCols = () => (st.raw ? st.resultCols.map((n) => ({ name: n, type: '' })) : (st.info && st.info.columns) || []);
  function drawCols() {
    const cols = allCols(), f = st.colFilter.toLowerCase();
    const shown = cols.filter((c) => !f || (c.name + ' ' + c.type).toLowerCase().includes(f));
    setCount(cols.length);
    q('cols').innerHTML = shown.map((c) => `<label class="st-col${c.pkey ? ' pk' : ''}"><input type="checkbox" data-c="${esc(c.name)}"${st.checked.has(c.name) ? ' checked' : ''}><span class="st-key"${c.pkey ? ' title="Khóa chính"' : ''}>${c.pkey ? cicon('key', 14) : ''}</span><span class="nm">${esc(c.name)}</span><span class="ty">${esc(c.type)}</span></label>`).join('') || '<div class="empty">Không có cột khớp.</div>';
    q('cols').querySelectorAll('input[data-c]').forEach((cb) => { cb.onchange = () => { cb.checked ? st.checked.add(cb.dataset.c) : st.checked.delete(cb.dataset.c); syncFields(); }; });
  }
  function syncFields() {
    const picked = allCols().filter((c) => st.checked.has(c.name)).map((c) => c.name);
    q('fields').value = picked.length ? picked.join(', ') : '*';
    setCount(allCols().length);
    persist();
  }
  const selectAll = () => { allCols().filter((c) => !st.colFilter || (c.name + ' ' + c.type).toLowerCase().includes(st.colFilter.toLowerCase())).forEach((c) => st.checked.add(c.name)); drawCols(); syncFields(); };
  const deselectAll = () => { st.checked.clear(); drawCols(); q('fields').value = '*'; setCount(allCols().length); persist(); };
  const refreshCols = () => { if (!st.raw && st.table) pickTable(st.table, false); else { st.checked.clear(); drawCols(); } q('fields').value = '*'; };
  q('colFilter').oninput = () => { st.colFilter = q('colFilter').value; drawCols(); };
  q('all').onclick = (e) => { e.preventDefault(); selectAll(); };
  q('none').onclick = (e) => { e.preventDefault(); deselectAll(); };
  q('refresh').onclick = (e) => { e.preventDefault(); refreshCols(); };
  const checkedCols = () => (st.info ? st.info.columns.filter((c) => st.checked.has(c.name)) : []);
  q('cols').oncontextmenu = (e) => { e.preventDefault(); menuAt(e.clientX, e.clientY, columnMenu()); };
  q('colPane').addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') return;
    if (e.ctrlKey && e.key.toLowerCase() === 'a') { e.preventDefault(); e.shiftKey ? deselectAll() : selectAll(); }
    else if (e.key === 'F5') { e.preventDefault(); e.stopPropagation(); refreshCols(); }
  });

  /** 5.1 cmdHide / cmdUnHide: ẩn danh sách cột (hiện dải » bên trái để mở lại) / hiện lại. */
  function toggleCols() {
    st.hidden = !st.hidden;
    q('colPane').style.display = q('split').style.display = st.hidden ? 'none' : '';
    q('unhide').hidden = !st.hidden;
    q('hide').classList.toggle('on', !st.hidden);
    persist();
  }
  q('hide').onclick = q('hide2').onclick = q('unhide').onclick = toggleCols;
  // Thanh kéo đổi độ rộng danh sách cột (5.1 splCenter).
  q('split').onmousedown = (e) => {
    e.preventDefault();
    const pane = q('colPane'), x0 = e.clientX, w0 = pane.getBoundingClientRect().width;
    const move = (ev) => { pane.style.width = Math.max(120, Math.min(innerWidth * 0.7, w0 + ev.clientX - x0)) + 'px'; };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  };

  // --- gợi ý tên cột trong SELECT / WHERE (5.1 _ColumnAutocomplete) ---
  function attachColumnSuggest(input, box) {
    let items = [], idx = 0;
    const word = () => { const v = input.value.slice(0, input.selectionStart); const m = /([\w$#]+)$/.exec(v); return m ? m[1] : ''; };
    const draw = () => {
      box.innerHTML = items.map((n, i) => `<div class="pi${i === idx ? ' on' : ''}" data-i="${i}"><span>${esc(n)}</span></div>`).join('');
      box.style.display = items.length ? 'block' : 'none';
      box.querySelectorAll('.pi').forEach((el) => { el.onmousedown = (e) => { e.preventDefault(); pick(items[+el.dataset.i]); }; });
    };
    const pick = (name) => {
      const pos = input.selectionStart, w = word();
      input.value = input.value.slice(0, pos - w.length) + name + input.value.slice(pos);
      input.selectionStart = input.selectionEnd = pos - w.length + name.length;
      items = []; draw(); persist();
    };
    input.addEventListener('input', () => {
      const w = word().toLowerCase();
      items = w.length < 1 ? [] : allCols().map((c) => c.name).filter((n) => n.toLowerCase().startsWith(w) && n.toLowerCase() !== w).slice(0, 30);
      idx = 0; draw(); persist();
    });
    input.addEventListener('keydown', (e) => {
      if (box.style.display !== 'block') return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { idx = Math.max(0, Math.min(items.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1))); draw(); e.preventDefault(); e.stopPropagation(); }
      else if (e.key === 'Tab' || (e.key === 'Enter' && items.length)) { e.preventDefault(); e.stopPropagation(); pick(items[idx]); }
      else if (e.key === 'Escape') { items = []; draw(); e.stopPropagation(); }
    }, true);
    input.addEventListener('blur', () => setTimeout(() => { box.style.display = 'none'; }, 150));
  }
  attachColumnSuggest(q('fields'), q('fsugg'));
  attachColumnSuggest(q('where'), q('wsugg'));
  q('dfrom').onchange = () => persist();
  q('dto').onchange = () => persist();

  // --- ReadOnly: câu SQL tự viết / bảng chia kỳ luôn chỉ đọc (5.1 getQuerry, lblDate_VisibleChanged) ---
  function syncReadOnly() {
    const forced = st.raw || !!(st.info && st.info.partition) || q('where').value.trim().startsWith('\\');
    if (forced) q('ro').checked = true;
    q('ro').disabled = forced;
    updateRw();
  }
  /** Chip cam ở thanh trạng thái khi Chỉ đọc tắt (lưới sửa được, ghi thẳng DB). */
  function updateRw() { q('rwchip').hidden = q('ro').checked; }
  q('ro').onchange = () => { updateRw(); if (st.set) showGrid(st.set); persist(); };
  q('where').addEventListener('input', syncReadOnly);

  // --- chạy ---
  async function run() {
    if (st.running) return;
    const table = q('table').value.trim(), raw = q('where').value.trim().startsWith('\\');
    if (!table && !raw) { q('table').focus(); return; }
    if (table && table !== st.table && !raw) await pickTable(table, false);
    if (!q('fields').value.trim()) q('fields').value = '*';
    const runId = 'st' + no + '-' + Date.now();
    st.running = runId; busy(true); setStatus('Đang chạy…'); persist(true);
    try {
      const r = await ctx.call('table.select', {
        db: db(), fields: q('fields').value, table: st.table || table, where: q('where').value, runId,
        partition: !!(st.info && st.info.partition), dfrom: q('dfrom').value, dto: q('dto').value
      });
      st.sql = r.sql;
      const res = r.result, err = res.messages.find((m) => m.kind === 'error');
      if (err) {
        clearGrid('');
        q('grid').innerHTML = `<div class="msgs"><div class="msg error">${icon('error', 14)}${esc(err.text)}</div>${/Conversion overflows/i.test(err.text)
          ? '<div class="msg">Gợi ý: query trả về số quá lớn (thường gặp decimal(38,12), numeric(38,20)) — CAST / CONVERT cột đó sang varchar hoặc giảm precision / scale.</div>' : ''}<div class="msg faint">${esc(r.sql)}</div></div>`;
        st.total = null; st.ms = null; drawInfo(); setStatus('Lỗi khi chạy', 'bad');
      } else if (!res.sets.length) {
        clearGrid('Command(s) completed successfully.'); st.total = null; st.ms = null; drawInfo(); setStatus('Command(s) completed successfully.', 'ok');
      } else {
        const s = res.sets[res.sets.length - 1];
        st.raw = raw;
        if (raw) { st.resultCols = s.columns.map((c) => c.name); st.checked.clear(); drawCols(); }
        syncReadOnly();
        showGrid(s);
        fillFocusList(s.columns.map((c) => c.name));
        st.total = s.total; st.ms = res.ms; drawInfo(); setStatus('');
      }
    } catch (e) { clearGrid(''); q('grid').innerHTML = `<div class="msgs"><div class="msg error">${icon('error', 14)}${esc(e.message)}</div></div>`; st.total = null; st.ms = null; drawInfo(); setStatus('Lỗi khi chạy', 'bad'); }
    finally { st.running = null; busy(false); }
  }
  function busy(on) { q('run').disabled = on; q('stop').disabled = !on; root.classList.toggle('is-busy', on); }
  function stop() { if (st.running) ctx.call('query.cancel', { runId: st.running }); }
  q('run').onclick = run;
  q('stop').onclick = stop;

  // --- lưới: sửa được khi bỏ ReadOnly; Lưu = script ---
  function clearGrid(text) {
    if (st.grid) { st.grid.dispose(); st.grid = null; }
    st.set = null;
    q('grid').innerHTML = text ? emptyState('table', esc(text)) : '';
  }
  function showGrid(s) {
    if (st.grid) st.grid.dispose();
    q('grid').innerHTML = '';
    st.set = s;
    const editable = !q('ro').checked;
    st.grid = createGrid(q('grid'), s, {
      editable, quickFilter: false, title: st.table, menuItems: gridMenu, enterSendTab: false,   // 5.1 grdTableDetail.isEnterSendTab = False
      // 5.1 CellValueChanged: ô sửa thành NULL → chuỗi rỗng / False theo kiểu cột.
      onChange: (row, col) => {
        st.editedRow = row;
        if (!col) return;
        const i = s.columns.findIndex((c) => c.name === col);
        if (i >= 0 && row[i] === null) { if (s.columns[i].clr === 'System.String') row[i] = ''; else if (s.columns[i].clr === 'System.Boolean') row[i] = false; }
      },
      onDeleteRows: deleteFromDb
    });
    // 5.1 CurrentRowIndexChanged → Save: chỉ khi dòng hiện tại thực sự đổi và dòng vừa rời là dòng đã sửa
    // (phím / chuột không đổi dòng — vd Esc đóng hộp báo lỗi — không lưu lại).
    st.lastRow = st.grid.current();
    const leave = () => {
      if (!st.grid) return;
      const now = st.grid.current(), prev = st.lastRow;
      if (now === prev) return;
      st.lastRow = now;
      if (st.editedRow && prev === st.editedRow) saveGrid(true);
    };
    st.grid.el.addEventListener('mouseup', leave);
    st.grid.el.addEventListener('keyup', leave);
  }
  function fillFocusList(names) { q('focusList').innerHTML = names.map((n) => `<option value="${esc(n)}">`).join(''); }
  function focusColumn() {
    const v = q('focus').value.trim();
    if (v.length === 1) return;
    if (!st.grid || !st.grid.focusColumn(v)) toast('Không có cột <b>' + esc(v) + '</b> trong kết quả');
  }
  q('focus').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); focusColumn(); } };
  q('focusBtn').onclick = focusColumn;

  const editable = () => st.grid && !q('ro').checked;
  function duplicateRow() {
    if (!editable()) return;
    const r = st.grid.current(); if (!r) return;
    st.grid.addRow(r);
  }
  function deleteRow() {
    if (!editable() || !st.set || !st.set.rows.length) return;
    const r = st.grid.current();
    if (r) st.grid.selectRow(st.set.rows.indexOf(r));
    st.grid.deleteSelected();
  }
  /** Ghi thay đổi vào DB (table.save: 1 transaction). */
  async function writeChanges(ch) {
    const pk = st.info ? st.info.columns.filter((c) => c.pkey).map((c) => c.name) : [];
    await ctx.call('table.save', { db: db(), table: st.table, pk, columns: st.set.columns.map((c) => ({ name: c.name, clr: c.clr })), added: ch.added, updated: ch.updated, deleted: ch.deleted });
  }
  /** 5.1 Save (Ctrl+S, tự lưu khi rời dòng). quiet = tự lưu: không có gì thì im. Lỗi → hộp báo, giữ thay đổi trên lưới để sửa lại. */
  async function saveGrid(quiet) {
    if (!editable() || st.saving) return;
    const ch = st.grid.getChanges();
    if (!ch.added.length && !ch.updated.length && !ch.deleted.length) { st.editedRow = null; if (quiet !== true) toast('Không có thay đổi để lưu'); return; }
    st.saving = true;
    try {
      await writeChanges(ch);
      st.grid.acceptChanges(); st.editedRow = null;
      setStatus('Đã lưu ' + (ch.added.length + ch.updated.length + ch.deleted.length) + ' dòng', 'ok');
    } catch (e) { showText({ title: 'Lưu — lỗi', text: e.message }); }
    finally { st.saving = false; }
  }
  /** 5.1 Delete Current Row: hỏi chắc chắn xóa → lưu thay đổi đang dở rồi xóa các dòng trong DB (dòng mới chưa lưu chỉ bỏ khỏi lưới). */
  async function deleteFromDb(list) {
    if (!(await showDialog({ title: 'Xóa', note: `Chắc chắn xóa ${list.length} dòng trong database?`, ok: 'Xóa' }))) return false;
    try {
      const pending = st.grid.getChanges();
      const fresh = new Set(pending.added);
      if (pending.added.length || pending.updated.length || pending.deleted.length) await writeChanges(pending);
      const rows = list.filter((r) => !fresh.has(r));
      if (rows.length) await writeChanges({ added: [], updated: [], deleted: rows });
      setTimeout(() => { st.grid.acceptChanges(); st.editedRow = null; }, 0);   // lưới ghi nhận dòng xóa sau khi hàm này trả true
      setStatus('Đã xóa ' + list.length + ' dòng', 'ok');
      return true;
    } catch (e) { showText({ title: 'Xóa dòng — lỗi', text: e.message }); return false; }
  }
  function resetSort() { if (st.set) showGrid(st.set); }
  /** 5.1 F1 (xCmd.AddEditRowGrid → frmEditRowGrid): sửa cả dòng đang chọn theo dạng form dọc; [null] = NULL. Lưới chỉ đọc → chỉ xem. */
  async function editRowForm() {
    if (!st.grid || !st.set) return;
    const row = st.grid.current(); if (!row) return;
    const ro = !editable();
    const text = (v) => (v === null || v === undefined ? '[null]' : v === true ? 'True' : v === false ? 'False' : String(v));
    const v = await showDialog({ title: 'Sửa dòng — ' + st.table, ok: ro ? 'Đóng' : 'OK', width: 620,
      fields: st.set.columns.map((c, i) => ({ id: 'c' + i, label: c.name, value: text(row[i]), readOnly: ro || c.readOnly })) });
    if (!v || ro) return;
    st.grid.updateRow(row, st.set.columns.map((c, i) => { const t = String(v['c' + i]).trim(); return t.toUpperCase() === '[NULL]' ? null : t === text(row[i]) ? undefined : t; }));
  }

  // --- script dữ liệu ---
  const key = () => q('where').value.trim();
  const needTable = () => { if (!st.table) { toast('Chọn bảng trước'); return false; } if (key().startsWith('\\')) { toast('Cần điều kiện WHERE thường (không phải câu SQL tự viết)'); return false; } return true; };
  async function genCondition() {
    if (!needTable()) return;
    try { showText({ title: st.sql || st.table, text: await ctx.call('table.dataScript', { db: db(), table: st.table, where: key() }) }); } catch (e) { fail(e); }
  }
  const visibleRows = () => (st.grid ? st.grid.visibleRows() : []);
  async function genSelected(toFile) {
    if (!needTable() || !st.set || !visibleRows().length) { if (st.table && !(st.set && visibleRows().length)) toast('Chạy để có dữ liệu trên lưới trước'); return; }
    let path = '';
    if (toFile) { const f = await ctx.call('file.pick', { filter: 'sql', save: true }); if (!f) return; path = f.path; setStatus('Gen To File: ' + path + ' …'); }
    try {
      const text = await ctx.call('table.rowsScript', { db: db(), table: st.table, where: key(), columns: st.set.columns.map((c) => ({ name: c.name, clr: c.clr })), rows: visibleRows(), path });
      if (toFile) setStatus('Gen To File ' + path + ' Successfully', 'ok'); else showText({ title: st.sql || st.table, text });
    } catch (e) { fail(e); }
  }
  async function genConditionFile() {
    if (!needTable()) return;
    const f = await ctx.call('file.pick', { filter: 'sql', save: true }); if (!f) return;
    setStatus('Gen To File: ' + f.path + ' …');
    try { await ctx.call('table.dataScriptFile', { db: db(), table: st.table, where: key(), path: f.path }); setStatus('Gen To File ' + f.path + ' Successfully', 'ok'); } catch (e) { setStatus(''); fail(e); }
  }
  async function genToUpdate() {
    if (!needTable()) return;
    try {
      const r = await ctx.call('upd.addData', { table: st.table, key: key(), db: db() });
      toast(r.message ? '⚠ ' + esc(r.message) : '⇪ Đã thêm vào Update: ' + esc(st.table + (key() ? ' WHERE ' + key() : '')));
    } catch (e) { fail(e); }
  }
  async function openVoucher() {
    if (!st.set) return;
    const r = st.grid.current(), cols = st.set.columns.map((c) => c.name.toLowerCase());
    const i = cols.indexOf('stt_rec'); if (!r || i < 0) return;
    const j = cols.indexOf('ma_ct');
    try { await ctx.call('shell.openVoucher', { sttRec: String(r[i] || '').trim(), maCt: j >= 0 ? String(r[j] || '').trim() : '' }); } catch (e) { fail(e); }
  }
  /** 5.1 frmScriptSQL: mỗi cột trong ô SELECT áp mẫu (%s = tên cột) → clipboard. */
  async function fieldsToScript() {
    const fields = q('fields').value.trim();
    const v = await showDialog({ title: 'Cột thành script', ok: 'Copy', note: 'Mỗi cột trong ô SELECT thay vào %s, ghép lại rồi copy vào clipboard.',
      fields: [{ id: 'tmpl', label: 'Mẫu', value: ', SUM(%s) AS %s', list: [', SUM(%s)', ', MAX(%s)', ', SUM(%s) AS %s', ', MAX(%s) AS %s', ', %s = 0', ", %s = ''"] }] });
    if (!v) return;
    setClipboard(fields.split(',').map((f) => v.tmpl.split('%s').join(f.trim())).join(''));
    toast('Đã copy vào clipboard');
  }
  function addToMemory() {
    if (!needTable()) return;
    ctx.call('table.dataScript', { db: db(), table: st.table, where: key() }).then((s) => { ctx.memory.add(s); toast('Đã thêm vào Memory Temp (lệnh FSD: Xem Memory Temp)'); }).catch(fail);
  }
  function gridMenu() {
    return [
      ['Nạp dữ liệu', run, 'F5'], ['Bỏ sắp xếp lưới', resetSort], ['Sửa dòng (form)', editRowForm, 'F1'], '-',
      ['Lưu', editable() ? saveGrid : null, 'Ctrl+S'], '-',
      ['Nhân bản dòng', editable() ? duplicateRow : null, 'F4'], ['Xóa dòng', editable() ? deleteRow : null, 'F8'], '-',
      ['Script theo điều kiện', genCondition, 'F12'], ['Thêm vào Update', genToUpdate, 'Ctrl+F12'], ['Script theo dữ liệu đang hiện', () => genSelected(false)],
      ['Script theo điều kiện ra file', genConditionFile], ['Script theo dữ liệu đang hiện ra file', () => genSelected(true)], '-',
      ['Mở chứng từ', isFb() ? openVoucher : null, 'Ctrl+F1'], ['Cột thành script', fieldsToScript, 'F9']];
  }
  const isFb = () => ((ctx.project() || {}).kind || '2') !== '2';

  // --- script cột (5.1 mnColumnStrip) ---
  async function colScript(kind, cols) {
    if (!st.info) { toast('Chọn bảng trước'); return null; }
    cols = cols || checkedCols();
    if (!cols.length) { toast('Tick cột bên trái trước'); return null; }
    return ctx.call('table.columnScript', { db: db(), kind, table: st.table, partition: st.info.partition, columns: cols, dfrom: q('dfrom').value, dto: q('dto').value });
  }
  async function viewScript(text, title) { if (text) ctx.open('Query', { sql: text, title, db: db() }); }
  async function toUpdate(text, label) {
    if (!text) return;
    try { const r = await ctx.call('upd.appendSql', { sql: text, db: db() }); toast(r.message ? '⚠ ' + esc(r.message) : '⇪ Đã thêm vào Other ' + (db() === st.sysDb ? 'Sys' : 'App') + ' SQL của Update: ' + esc(label)); } catch (e) { fail(e); }
  }
  const clip = (text) => { if (text) { setClipboard(text); toast('Đã copy script vào clipboard'); } };
  const safe = (fn) => async () => { try { await fn(); } catch (e) { fail(e); } };
  async function logInfo() { return st.table ? ctx.call('table.logInfo', { db: db(), table: st.table, partition: !!(st.info && st.info.partition) }) : { ok: false }; }
  async function logScript(extra) { return ctx.call('table.logScript', Object.assign({ db: db(), table: st.table, partition: !!(st.info && st.info.partition) }, extra || {})); }
  /** 5.1 NoteLogOrderForUpdate: bảng log lệch thứ tự / thiếu cột → nhắc đưa script sắp cột log vào Update. */
  async function noteLogOrder() {
    const li = await logInfo();
    if (li.ok && li.need.length) showText({ title: 'Sắp xếp cột bảng log', text: li.message + '\n\nThêm cột vào cuối sẽ không đúng thứ tự. Dùng "Script Log Column → Log Column Order To Update Script" để đưa script sắp xếp vào Update.' });
  }
  async function createTableScript() { return ctx.call('sql.script', { db: db(), name: st.table }); }
  async function needLogBase() { const li = await logInfo(); if (!li.ok) { toast('Chọn bảng gốc (không phải bảng log) trước!'); return null; } return li; }

  // Edit Column (5.1 chạy thẳng vào DB): chạy script, xóa cache Structure\App, đọc lại cột, bảng log lệch thì hỏi sắp lại.
  // Mọi lệnh gọi exec đều đã qua hộp xác nhận / form của màn → gửi confirmed = true để query.run không hỏi lần hai.
  async function exec(sql, title) {
    const r = await ctx.call('query.run', { db: db(), sql, runId: 'stc' + no + '-' + Date.now(), confirmed: true });
    const errs = r.messages.filter((m) => m.kind === 'error');
    if (errs.length) { showText({ title: title + ' — lỗi', text: errs.map((m) => m.text).join('\n') + '\n\n' + sql }); return null; }
    return r;
  }
  async function afterColumnChange(ok) {
    if (!ok) return;
    try { await ctx.call('shell.deleteStructApp'); } catch (e) { fail(e); }
    await pickTable(st.table, false);
    warnLogOrder();
  }
  async function addColumn() {
    if (!st.info) { toast('Chọn bảng trước'); return; }
    const v = await showDialog({ title: 'Add Column — ' + st.table, ok: 'OK', fields: [{ id: 'name', label: 'Field', required: true }, { id: 'type', label: 'Datatype', value: TYPES[0], list: TYPES, required: true }] });
    if (!v) return;
    if (st.info.columns.some((c) => c.name.toLowerCase() === v.name.trim().toLowerCase())) { showText({ title: 'Thêm cột', text: 'Cột đã có!' }); return; }
    afterColumnChange(await exec(await colScript('add', [{ name: v.name.trim(), type: v.type.trim() }]), 'Thêm cột'));
  }
  async function alterColumn() {
    if (!st.info) { toast('Chọn bảng trước'); return; }
    const first = checkedCols()[0];
    const v = await showDialog({ title: 'Alter Column — ' + st.table, ok: 'OK', fields: [{ id: 'name', label: 'Field', value: first ? first.name : '', required: true }, { id: 'type', label: 'Datatype', value: first ? first.type.toUpperCase() : TYPES[0], list: TYPES, required: true }] });
    if (!v) return;
    if (!st.info.columns.some((c) => c.name.toLowerCase() === v.name.trim().toLowerCase())) { showText({ title: 'Alter Column', text: 'Cột không có!' }); return; }
    afterColumnChange(await exec(await colScript('alter', [{ name: v.name.trim(), type: v.type.trim() }]), 'Alter Column'));
  }
  async function dropColumn() {
    const cols = checkedCols();
    if (!cols.length) { showText({ title: 'Xóa cột', text: 'Tick cột cần xóa!' }); return; }
    const names = cols.map((c) => c.name).join(', ');
    const where = st.info.partition ? `bảng phân kỳ [${st.table.slice(0, st.table.indexOf('$') + 1)}]?<br>${esc(names)}<br>Khoảng: ${q('dfrom').value} → ${q('dto').value} (nhiều bảng).` : `bảng [${st.table}]?<br>${esc(names)}`;
    if (!(await showDialog({ title: 'Xóa cột', note: `Xóa ${cols.length} cột khỏi ${where}<br><br>Thao tác sẽ DROP COLUMN trên database. Bạn có chắc không?`, ok: 'Drop' }))) return;
    afterColumnChange(await exec(await colScript('drop', cols), 'Xóa cột'));
  }
  /** Chạy script sắp cột cho các bảng log, hiện kết quả từng bảng (5.1 RunLogReorder). Caller đã hỏi xác nhận. */
  async function runLogReorder(need) {
    const r = await ctx.call('query.run', { db: db(), sql: await logScript({ only: need, direct: true }), runId: 'stl' + no + '-' + Date.now(), confirmed: true });
    const lines = r.sets.flatMap((x) => x.rows.map((row) => String(row[0]))).concat(r.messages.filter((m) => m.kind === 'error').map((m) => m.text));
    showText({ title: 'Sắp xếp cột bảng log', text: lines.join('\n') || 'Xong.' });
  }
  /** 5.1 WarnLogOrder: sau Add / Alter / Drop, bảng log lệch thứ tự / thiếu cột → hỏi sắp xếp lại ngay. */
  async function warnLogOrder() {
    const li = await logInfo();
    if (!li.ok || !li.existing.length || !li.need.length) return;
    if (await showDialog({ title: 'Sắp xếp cột bảng log', note: esc(li.message).replace(/\n/g, '<br>') + '<br><br>Sắp xếp lại cột bảng log ngay?', ok: 'Sắp xếp' })) runLogReorder(li.need);
  }
  async function reorderLog() {
    const li = await needLogBase(); if (!li) return;
    if (!li.existing.length) { showText({ title: 'Sắp lại cột bảng log', text: `Không có bảng log [${li.targets.join('], [')}] hoặc bảng gốc [${li.base}] trên database.` }); return; }
    if (!li.need.length) { showText({ title: 'Sắp lại cột bảng log', text: `Bảng log [${li.existing.join('], [')}] đã đúng thứ tự cột và đủ cột so với [${li.base}].` }); return; }
    if (!(await showDialog({ title: 'Sắp xếp cột bảng log', note: esc(li.message).replace(/\n/g, '<br>') + '<br><br>Dựng lại bảng log theo thứ tự cột bảng gốc (khóa bảng log trong lúc chạy). Tiếp tục?', ok: 'Tiếp tục' }))) return;
    runLogReorder(li.need);
  }
  function columnMenu() {
    return [
      ['Script thêm cột', [['Xem script', safe(async () => viewScript(await colScript('add'), 'ADD COLUMN ' + st.table))], ['Copy vào clipboard', safe(async () => clip(await colScript('add')))],
        ['Script cột cho phép NULL vào clipboard', safe(async () => { if (st.table) clip(await ctx.call('table.alterNull', { table: st.table })); })],
        ['Thêm vào Update', safe(async () => { const t = await colScript('add'); if (t) { await toUpdate(t, st.checked.size + ' cột'); noteLogOrder(); } })]]],
      ['Script sửa cột', [['Xem script', safe(async () => viewScript(await colScript('alter'), 'ALTER COLUMN ' + st.table))], ['Copy vào clipboard', safe(async () => clip(await colScript('alter')))],
        ['Thêm vào Update', safe(async () => toUpdate(await colScript('alter'), 'ALTER ' + st.checked.size + ' cột'))]]],
      ['Script xóa cột', [['Xem script', safe(async () => viewScript(await colScript('drop'), 'DROP COLUMN ' + st.table))], ['Copy vào clipboard', safe(async () => clip(await colScript('drop')))],
        ['Thêm vào Update', safe(async () => toUpdate(await colScript('drop'), 'DROP ' + st.checked.size + ' cột'))]]],
      ['Script tạo bảng', [['Xem script', safe(async () => { if (st.table && !st.raw) viewScript(await createTableScript(), 'CREATE ' + st.table); })],
        ['Copy vào clipboard', safe(async () => { if (st.table && !st.raw) clip(await createTableScript()); })],
        ['Thêm vào Update', safe(async () => { if (!st.table || st.raw) { toast('Chọn bảng trước'); return; } toUpdate(await createTableScript(), 'CREATE TABLE ' + st.table); })]]],
      ['Script cột bảng log', [['Xem script', safe(async () => { if (await needLogBase()) viewScript(await logScript(), 'LOG ORDER ' + st.table); })],
        ['Copy vào clipboard', safe(async () => { if (await needLogBase()) clip(await logScript()); })],
        ['Thêm vào Update', safe(async () => { if (await needLogBase()) toUpdate(await logScript(), 'sắp cột bảng log ' + st.table); })]]],
      '-',
      ['Sửa cột trên DB', [['Thêm cột', safe(addColumn)], ['Sửa cột', safe(alterColumn)], ['Xóa cột', safe(dropColumn)], ['Sắp lại cột bảng log', safe(reorderLog)]]],
      '-',
      ['Chọn hết', selectAll, 'Ctrl+A'], ['Bỏ hết', deselectAll, 'Ctrl+Shift+A'], ['Đọc lại', refreshCols, 'F5']];
  }
  q('colScript').onclick = () => dropMenu(q('colScript'), columnMenu());
  q('dataScript').onclick = () => dropMenu(q('dataScript'), [
    ['Script theo điều kiện', genCondition, 'F12'], ['Script theo dữ liệu đang hiện', () => genSelected(false)],
    ['Script theo điều kiện ra file', genConditionFile], ['Script theo dữ liệu đang hiện ra file', () => genSelected(true)], '-',
    ['Thêm vào Memory Temp', addToMemory, 'Ctrl+Insert'], ['Cột thành script', fieldsToScript, 'F9']]);

  q('pkg').onclick = () => {
    if (!st.table) { toast('Chọn bảng trước'); return; }
    dropMenu(q('pkg'), [
      [`Dữ liệu theo điều kiện${key() ? '' : ' (cả bảng)'}`, genToUpdate, 'Ctrl+F12'],
      ['Script tạo bảng', safe(async () => { const r = await ctx.call('upd.addObject', { name: st.table, type: 'U', db: db() }); toast(r.message ? '⚠ ' + esc(r.message) : '⇪ Đã thêm vào Update: CREATE ' + esc(st.table)); })]]);
  };

  // --- phím (5.1 ProcessCmdKey + phím tắt menu lưới) ---
  // Nghe ở document để phím chạy cả khi chưa có ô nào giữ focus (vừa mở tab, vừa bấm ra ngoài); phần tử con đã xử lý (stopPropagation / preventDefault) thì bỏ qua.
  const onKey = (e) => {
    if (e.defaultPrevented || document.querySelector('.dlg-back')) return;   // hộp thoại đang mở (gắn ở body): phím thuộc hộp
    const ctrl = e.ctrlKey || e.metaKey;
    const k = (ctrl ? 'C+' : '') + (e.shiftKey ? 'S+' : '') + e.key;
    const act = {
      F5: run, 'C+r': run, 'C+R': run, 'C+F5': stop, 'C+s': saveGrid, 'C+S': saveGrid, F4: duplicateRow, F8: deleteRow,
      F1: editRowForm, F12: genCondition, 'C+F12': genToUpdate, 'C+F1': () => isFb() && openVoucher(), F9: fieldsToScript, 'C+Insert': addToMemory,
      'C+g': () => ctx.open('SetDatabaseTab')
    }[k];
    if (act) { e.preventDefault(); act(); }
  };
  document.addEventListener('keydown', onKey);

  return {
    focus: () => (st.table ? q('where') : q('table')).focus(),
    db,
    /** Extension chọn DB cho tab (QuickPick) → đổi DB, nạp lại cột của bảng đang mở. */
    setDb: (name) => { curDb = name; dbLabel(); persist(true); if (st.table) pickTable(st.table, false); },
    /** 5.1 SetDataTab / _selectData: nạp bảng (+ điều kiện, chạy ngay). */
    loadTable: (table, where, runNow) => { if (where !== undefined) q('where').value = where; pickTable(table, !!runNow); },
    addToMemory,
    dispose: () => { persist(true); document.removeEventListener('keydown', onKey); stop(); if (st.grid) st.grid.dispose(); }
  };
}
