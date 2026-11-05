// Màn Sửa menu (thay frmWCommandUpdate FBO / frmCommandUpdate FB / frmDVCommand Mobile 5.1; chép từ FSDStudio52\Web\js\screens\menu-edit.js):
// form các cột của dòng menu — Lưu sửa / Lưu mới (kiểm cha, mã trùng; FBO "Tự cấp command" 88.xx, Mobile "Tự cấp menu_id" M1.xx),
// sau Lưu sửa hỏi cập nhật menu cùng đường dẫn / sysid. Bên phải: file của menu theo thư mục (nhấp đúp mở, chuột phải copy / mở thư mục / IDE).
// Service: src\vscode\services\menuEditService.ts (medit.*); ghi thẳng DB Sys nhưng host luôn hiện hộp xác nhận (dự án + DB) trước khi ghi.
// Bản extension (webview): menu cần sửa nhận qua ctx.opts { kind, id, t, link } (không có cây menu 5.2 để lấy node đang chọn);
// lệnh nhanh chỉ còn Create Update / Update File (mở màn Update Script); Save As / Clone chưa có trong extension.
import { menuAt } from '../ui/dialog.js';
import { setClipboard } from '../bridge.js';
import { createGrid } from '../ui/grid.js';
import { esc } from '../ui/explorer.js';
import { cicon, ibtn } from '../ui/icons.js';

const LABEL = { wmenu_id: 'Wmenu_id', wmenu_id0: 'Wmenu_id0', menu_id: 'Menu_id', menu_id0: 'Menu_id0', bar: 'Bar', bar2: 'Bar2', link: 'Link', exe: 'Exe', type: 'Type', sysid: 'SysID', syscode: 'SysCode', edition: 'Edition', expl_icon: 'Expl_icon', icon: 'Icon', icon_url: 'Icon_url', hide_yn: 'Hide_yn', vc_active: 'Vc_active', action: 'Action', xtype: 'Xtype', xgroup: 'Xgroup', status: 'Status', icon_color: 'Icon_color' };
const QUICK = { fbo: [['Create Update — mở màn Update Script theo menu này', 'CreateUpdate', 'update'], ['Update File — mở màn Update Script theo menu này', 'UpdateFile', 'updateFile']], fb: [], mob: [] };

/** Nạp css riêng của màn (screen.html chỉ nạp theme / base / ui / app). */
function loadCss() {
  const m = document.querySelector('meta[name="fsd-web-base"]');
  const href = ((m && m.content) || '') + 'css/menu-edit.css';
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => l.href === href || l.getAttribute('href') === href)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href;
  document.head.appendChild(l);
}

export function mount(root, ctx) {
  loadCss();
  root.innerHTML = `
    <div class="me">
      <div class="me-left">
        <div class="f1-h"><b class="t-name" data-a="title">Sửa menu</b><span class="muted" data-a="status"></span></div>
        <div class="form me-form" data-a="form"></div>
        <div class="me-acts"><label class="chk" data-a="autoWrap"><input type="checkbox" data-a="auto" checked><span data-a="autoLbl">Tự cấp command</span></label><span class="sp"></span>
          ${ibtn('saveNew', 'plusBox', 'Lưu mới — thêm dòng mới theo các ô')}${ibtn('save', 'save', 'Lưu sửa (Ctrl+S)', { cls: 'main' })}</div>
        <div class="me-quick" data-a="quick"></div>
      </div>
      <div class="me-right"><div class="rtabs" data-a="ftabs"></div><div class="ldb-list" data-a="files"></div></div>
    </div>`;
  const q = (a) => root.querySelector(`[data-a="${a}"]`);
  ctx.setTitle('Sửa menu');
  const st = { kind: 'fbo', id: '', node: null, fields: [], files: [], folder: '' };
  const toastErr = (e) => ctx.toast('⚠ ' + esc(e.message || e));
  const keyOf = () => (st.kind === 'fb' ? 'menu_id' : 'wmenu_id');
  const val = (name) => (st.fields.find((f) => f.name === name) || {}).value || '';

  async function load(kind, node) {
    if (!node) return;
    st.kind = kind; st.id = node.id; st.node = node;
    q('autoWrap').hidden = kind === 'fb';
    q('autoLbl').textContent = kind === 'mob' ? 'Tự cấp menu_id' : 'Tự cấp command';
    try { st.fields = (await ctx.call('medit.get', { kind, id: node.id })).fields; } catch (e) { toastErr(e); return; }
    q('title').textContent = (node.t || node.id) + ' — ' + node.id;
    ctx.setTitle('Sửa menu — ' + node.id);
    q('status').textContent = '';
    q('form').innerHTML = st.fields.map((f) => `<div class="frow"><label class="lb">${esc(LABEL[f.name] || f.name)}</label><input class="grow${/id|link|exe|sys/.test(f.name) ? ' mono' : ''}" data-f="${esc(f.name)}" value="${esc(f.value)}" spellcheck="false"></div>`).join('');
    q('quick').innerHTML = (QUICK[kind] || []).map(([t, a, ic]) => `<button class="icon-btn tb" data-q="${a}" title="${esc(t)}" aria-label="${esc(t)}">${cicon(ic)}</button>`).join('');
    q('quick').querySelectorAll('[data-q]').forEach((b) => { b.onclick = () => openUpdate(); });
    loadFiles(node);
  }
  /** Create Update / Update File của 5.1: mở màn Update Script điền sẵn theo menu đang sửa. */
  function openUpdate() {
    ctx.open('UpdateScript', { menu: { kind: st.kind, id: st.id, t: (st.node && st.node.t) || '', sys: val('sysid'), code: val('syscode'), type: val('type'), link: val('link') || val('action'), exe: val('exe') } });
  }
  async function loadFiles(node) {
    const sys = val('sysid');
    st.files = [];
    if (sys) { try { st.files = (await ctx.call('menu.files', { kind: st.kind, sysid: sys, link: node.link || val('link') || '' })).files; } catch { /* chưa dò được file của menu */ } }
    const folders = [...new Set(st.files.map((f) => f.folder))];
    if (!folders.includes(st.folder)) st.folder = folders[0] || '';
    q('ftabs').innerHTML = folders.map((f) => `<button data-t="${esc(f)}" class="${f === st.folder ? 'on' : ''}">${esc(f)} (${st.files.filter((x) => x.folder === f).length})</button>`).join('') || '<span class="muted" style="padding:4px 8px">Không có file của menu</span>';
    q('ftabs').querySelectorAll('[data-t]').forEach((b) => { b.onclick = () => { st.folder = b.dataset.t; drawFiles(); }; });
    drawFiles();
  }
  function drawFiles() {
    q('ftabs').querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === st.folder));
    q('files').innerHTML = st.files.filter((f) => f.folder === st.folder).map((f) => `<div class="ldb-it" data-p="${esc(f.path)}" title="${esc(f.path)}">${esc(f.name)}</div>`).join('');
  }
  q('files').ondblclick = (e) => { const it = e.target.closest('[data-p]'); if (it) ctx.call('ms.openDefault', { path: it.dataset.p }).catch(toastErr); };
  q('files').oncontextmenu = (e) => {
    e.preventDefault(); const it = e.target.closest('[data-p]'); if (!it) return; const p = it.dataset.p;
    menuAt(e.clientX, e.clientY, [['Copy tên file', () => setClipboard(p.split('\\').pop())], ['Copy đường dẫn', () => setClipboard(p)], ['Copy file vào clipboard', () => ctx.call('ms.copyFiles', { paths: [p] }).catch(toastErr)],
      ['Mở thư mục chứa', () => ctx.call('shell.explore', { path: p, select: true }).catch(toastErr)], ['Mở (mặc định)', () => ctx.call('ms.openDefault', { path: p }).catch(toastErr)],
      ['Mở bằng IDE', () => ctx.call('ms.openIde', { paths: [p] }).catch(toastErr)], ['Xem XML (bung entity)', () => ctx.open('DtdEntityViewer', { path: p })]]);
  };
  async function save(mode) {
    if (!st.id) return;
    const values = {}; q('form').querySelectorAll('[data-f]').forEach((el) => { values[el.dataset.f] = el.value; });
    if (mode === 'Edit' && st.kind === 'fbo' && values.wmenu_id.trim().toUpperCase() !== st.id.toUpperCase()) ctx.toast('Đổi wmenu_id — nhớ sửa menu trong quản lý yêu cầu (QLYC).');
    q('status').textContent = 'Đang chờ xác nhận…';
    try {
      // Host hiện hộp xác nhận (dự án + DB Sys + các việc sẽ ghi) rồi mới ghi, trong một transaction.
      const r = await ctx.call('medit.save', { kind: st.kind, mode, oldId: st.id, values, auto: q('auto').checked && st.kind !== 'fb' });
      if (r.cancelled) { q('status').textContent = r.message; return; }
      q('status').textContent = r.message + (r.menu_id ? ' · menu_id ' + r.menu_id : '');
      r.notes.forEach((n) => ctx.toast(esc(n)));
      if (mode === 'Edit') await dupUpdate(r.id);
      if (ctx.menu.reload) await ctx.menu.reload(st.kind);
      await load(st.kind, { id: r.id, t: values.bar, link: values.link });
    } catch (e) { toastErr(e); q('status').textContent = ''; }
  }
  /** 5.1 frmDuplicateUpdate: menu cùng đường dẫn / sysid → tick dòng muốn cập nhật bar / bar2 / đường dẫn theo menu vừa sửa. */
  async function dupUpdate(id) {
    let rows;
    try { rows = await ctx.call('medit.dups', { kind: st.kind, id }); } catch { return; }
    if (!rows.length) return;
    const back = document.createElement('div');
    back.className = 'dlg-back';
    back.innerHTML = '<div class="dlg" style="width:900px"><div class="dlg-title">Cập nhật các menu trùng đường dẫn / sysid</div><div class="me-dup"></div><div class="dlg-foot"><span class="dlg-err"></span><button class="btn" data-x="cancel">Bỏ qua</button><button class="btn primary" data-x="ok">Cập nhật dòng đã tick</button></div></div>';
    document.body.appendChild(back);
    const cols = [{ name: 'Cập nhật', clr: 'System.Boolean' }, { name: 'Phân hệ', readOnly: true }, { name: 'Mã menu', readOnly: true }, { name: 'Tên (VN)' }, { name: 'Tên (EN)' }, { name: st.kind === 'fb' ? 'Exe' : st.kind === 'mob' ? 'Action' : 'Link' }, { name: 'cur', width: 1 }];
    const g = createGrid(back.querySelector('.me-dup'), { columns: cols, rows }, { editable: true, allowAdd: false });
    await new Promise((res) => {
      back.querySelector('[data-x="cancel"]').onclick = () => res();
      back.querySelector('[data-x="ok"]').onclick = async () => {
        try { const n = await ctx.call('medit.dupsApply', { kind: st.kind, rows }); if (n) ctx.toast('Đã cập nhật ' + n + ' menu trùng'); } catch (e) { toastErr(e); }
        res();
      };
    });
    g.dispose(); back.remove();
  }
  q('save').onclick = () => save('Edit');
  q('saveNew').onclick = () => save('New');
  root.addEventListener('keydown', (e) => { if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); save('Edit'); } });
  const o = ctx.opts || {};
  if (o.id) load(o.kind || 'fbo', { id: o.id, t: o.t, link: o.link }); else q('form').innerHTML = '<div class="empty">Chọn menu trên panel MENU rồi chọn "Sửa menu".</div>';
  return {
    focus: () => { const el = q('form').querySelector('input'); if (el) el.focus(); },
    // Nạp menu khác vào form đang mở (panel MENU gọi khi chọn node khác).
    menuChanged: (kind, node) => load(kind, node)
  };
}
