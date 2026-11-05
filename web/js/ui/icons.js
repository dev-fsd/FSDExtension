// Bộ icon SVG inline dùng chung cho các màn webview (Query, Select Table, lưới, hộp thoại).
// Nét mảnh 1.3px trên lưới 16x16, tô bằng currentColor nên tự theo màu chữ / theme của IDE. Không dùng font icon, không CDN.
// icon(name, size?) → chuỗi HTML <svg class="ic">; tên lạ → chuỗi rỗng (không làm vỡ giao diện).
// Chỉ tạo chuỗi, không đụng DOM: gắn vào innerHTML của chỗ cần dùng.

const S = 'fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"';

// Mỗi icon: phần ruột <svg>. Icon đặc (chạy, dừng, ba chấm) tự khai fill="currentColor".
const PATHS = {
  play: '<path d="M4.5 3.2v9.6a.4.4 0 0 0 .6.35l7.8-4.8a.4.4 0 0 0 0-.7L5.1 2.85a.4.4 0 0 0-.6.35z" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>',
  stop: '<rect x="4" y="4" width="8" height="8" rx="1.2" fill="currentColor" stroke="none"/>',
  db: '<ellipse cx="8" cy="4" rx="5" ry="2"/><path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4"/><path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2"/>',
  table: '<rect x="2" y="3" width="12" height="10" rx="1.2"/><path d="M2 7h12M6.5 3v10"/>',
  chevronDown: '<path d="M4 6.2l4 4 4-4"/>',
  chevronUp: '<path d="M4 9.8l4-4 4 4"/>',
  chevronRight: '<path d="M6.2 4l4 4-4 4"/>',
  arrowRight: '<path d="M3 8h10M9 4l4 4-4 4"/>',
  search: '<circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5"/>',
  more: '<circle cx="3.5" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r="1.1" fill="currentColor" stroke="none"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  key: '<circle cx="5.5" cy="10.5" r="2.5"/><path d="M7.3 8.7L13 3M11 5l1.6 1.6"/>',
  panel: '<rect x="2" y="3" width="12" height="10" rx="1.2"/><path d="M6 3v10"/>',
  refresh: '<path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13 2.8v2.9h-2.9"/>',
  file: '<path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/>',
  filePlus: '<path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3M8 8v4M6 10h4"/>',
  folder: '<path d="M2 4.5h4l1.5 1.5H14V13H2z"/>',
  save: '<path d="M3 3h8l2 2v8H3z"/><path d="M5.5 3v3h4V3M5.5 13V9h5v4"/>',
  format: '<path d="M3 4h10M3 8h6M3 12h8"/>',
  code: '<path d="M6 4L2 8l4 4M10 4l4 4-4 4"/>',
  warning: '<path d="M8 2.2l6.3 11.3H1.7z"/><path d="M8 6.6v3.1M8 11.7v.2"/>',
  error: '<circle cx="8" cy="8" r="6"/><path d="M8 5v3.5M8 10.7v.2"/>',
  info: '<circle cx="8" cy="8" r="6"/><path d="M8 7.2V11M8 5v.2"/>',
  check: '<path d="M3.5 8.5l3 3 6-6.5"/>',
  pin: '<path d="M10 2.5l3.5 3.5-1.8.6-2.3 2.3.4 2.9-.7.7L6.8 9.4 3.5 12.7M3.5 12.7l-.2.2"/><path d="M6.6 5.9l-2.5-.4.7-.7"/>',
  copy: '<rect x="5.5" y="5.5" width="7.5" height="8" rx="1.2"/><path d="M3 10.5V3.5a.8.8 0 0 1 .8-.8H10"/>',
  filter: '<path d="M2 3h12l-4.5 5.5V13l-3-1.5V8.5z"/>',
  pulse: '<path d="M1 8h3l2-5 3 10 2-5h4"/>',
  box: '<path d="M2 5l6-3 6 3v6l-6 3-6-3z"/><path d="M2 5l6 3 6-3M8 8v6"/>',
  wrap: '<path d="M2 4h12M2 8h9.2a2.4 2.4 0 0 1 0 4.8H8.5M10 11l-1.6 1.8L10 14.6M2 12.8h3"/>',
  hash: '<path d="M6 2.5L5 13.5M11 2.5l-1 11M2.5 6h11M2.5 10h11"/>'
};

/** HTML của icon `name` cỡ `size` px (mặc định 16). */
export function icon(name, size = 16) {
  const body = PATHS[name];
  if (!body) return '';
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 16 16" ${S} aria-hidden="true" focusable="false">${body}</svg>`;
}

// ===== Icon nhiều màu (nút thanh công cụ thay chữ) =====
// Mỗi icon có một màu chính (class ci-<màu> → color: var(--ic-<màu>), lấy từ --vscode-charts-* / terminal-ansi qua theme.css)
// dùng cho nét và vùng tô nhạt (fill-opacity), kèm chi tiết phụ tô màu khác bằng var(--ic-*). Màu theo chức năng:
// chạy = xanh lá, dừng = đỏ, lưu = xanh dương, mở = vàng, script = tím, update = cam, DB = xanh dương, định dạng / nhìn = lục lam.
const T = 'fill="currentColor" fill-opacity=".22"';   // vùng tô nhạt cùng màu chính
const COLORED = {
  run: ['green', '<path d="M4.5 2.8v10.4a.5.5 0 0 0 .76.43l8.2-5.2a.5.5 0 0 0 0-.86l-8.2-5.2a.5.5 0 0 0-.76.43z" fill="currentColor" stroke="none"/>'],
  stop: ['red', '<rect x="3.5" y="3.5" width="9" height="9" rx="1.6" fill="currentColor" stroke="none"/>'],
  save: ['blue', `<path d="M3 2.5h8.2l2.3 2.3V13a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z" ${T}/><path d="M5.2 2.5v3.3h5.2V2.5"/><rect x="5" y="8.6" width="6" height="4.9" rx=".6" fill="currentColor" fill-opacity=".75" stroke="none"/>`],
  saveAs: ['blue', `<path d="M3 2.5h7.7l2.3 2.3V9" ${T}/><path d="M3 2.5v10.5h5M5.2 2.5v3.3h4.8V2.5"/><circle cx="11.8" cy="11.8" r="3.4" fill="var(--bg)" stroke="var(--ic-green)"/><path d="M11.8 10.2v3.2M10.2 11.8h3.2" stroke="var(--ic-green)"/>`],
  open: ['yellow', `<path d="M1.8 4.2a.7.7 0 0 1 .7-.7h3.3l1.4 1.5h6.3a.7.7 0 0 1 .7.7v7.1a.7.7 0 0 1-.7.7H2.5a.7.7 0 0 1-.7-.7z" fill="currentColor" fill-opacity=".3"/><path d="M1.8 7h12.4"/>`],
  newFile: ['cyan', `<path d="M3.5 1.8h5.2l3.8 3.8v8a.7.7 0 0 1-.7.7H3.5a.7.7 0 0 1-.7-.7V2.5a.7.7 0 0 1 .7-.7z" ${T}/><path d="M8.5 1.9v3.8h3.8"/><path d="M7.6 8v4.2M5.5 10.1h4.2" stroke="var(--ic-green)"/>`],
  db: ['blue', '<path d="M3 4v8c0 1.2 2.2 2.2 5 2.2s5-1 5-2.2V4c0 1.2-2.2 2.2-5 2.2S3 5.2 3 4z" fill="currentColor" fill-opacity=".14" stroke="none"/><ellipse cx="8" cy="4" rx="5" ry="2.2" fill="currentColor" fill-opacity=".38"/><path d="M3 4v8c0 1.2 2.2 2.2 5 2.2s5-1 5-2.2V4"/><path d="M3 8c0 1.2 2.2 2.2 5 2.2s5-1 5-2.2"/>'],
  format: ['cyan', '<path d="M2.5 3.5h11M2.5 6.5h7M2.5 9.5h9"/><path d="M2.5 12.5h5" stroke="var(--ic-purple)"/>'],
  xsd: ['purple', '<path d="M5.6 4.2L1.8 8l3.8 3.8M10.4 4.2L14.2 8l-3.8 3.8"/><path d="M9.3 3L6.7 13" stroke="var(--ic-orange)"/>'],
  profiler: ['pink', '<path d="M1.5 8.6h3l1.8-5.2 3 9.2 1.8-4h3.4"/>'],
  wrap: ['cyan', '<path d="M2 4h12M2 8h9.2a2.4 2.4 0 0 1 0 4.8H8.5M10 11l-1.6 1.8L10 14.6M2 12.8h3"/>'],
  search: ['blue', `<circle cx="6.8" cy="6.8" r="4.2" ${T}/><path d="M10 10l3.8 3.8" stroke-width="1.8" stroke="var(--ic-orange)"/>`],
  table: ['blue', '<rect x="2" y="3" width="12" height="10" rx="1.3" fill="currentColor" fill-opacity=".12"/><path d="M2 4.3A1.3 1.3 0 0 1 3.3 3h9.4A1.3 1.3 0 0 1 14 4.3V6H2z" fill="currentColor" fill-opacity=".45" stroke="none"/><path d="M2 6h12M2 9.5h12M6.5 6v7"/>'],
  panel: ['cyan', '<rect x="2" y="3" width="12" height="10" rx="1.3"/><path d="M2.6 4.3a.7.7 0 0 1 .7-.7H6v8.8H3.3a.7.7 0 0 1-.7-.7z" fill="currentColor" fill-opacity=".45" stroke="none"/><path d="M6 3v10"/>'],
  scriptCol: ['purple', '<path d="M4.6 4L1.6 8l3 4M11.4 4l3 4-3 4"/><rect x="6.7" y="3.4" width="2.6" height="9.2" rx=".7" fill="var(--ic-blue)" fill-opacity=".8" stroke="none"/>'],
  scriptData: ['purple', '<path d="M4.6 4L1.6 8l3 4M11.4 4l3 4-3 4"/><path d="M6.2 5.4v5.2c0 .6.8 1 1.8 1s1.8-.4 1.8-1V5.4" stroke="var(--ic-blue)"/><ellipse cx="8" cy="5.4" rx="1.8" ry=".9" fill="var(--ic-blue)" stroke="var(--ic-blue)"/>'],
  update: ['orange', `<path d="M2 5.2L8 2.4l6 2.8v6L8 13.8l-6-2.6z" ${T}/><path d="M2 5.2L8 8l6-2.8M8 8v5.8"/>`],
  updateFile: ['orange', `<path d="M3.5 1.8h5.2l3.8 3.8v8a.7.7 0 0 1-.7.7H3.5a.7.7 0 0 1-.7-.7V2.5a.7.7 0 0 1 .7-.7z" ${T}/><path d="M8.5 1.9v3.8h3.8"/><path d="M7.6 12V8M5.8 9.6l1.8-1.8 1.8 1.8" stroke="var(--ic-green)"/>`],
  refresh: ['green', '<path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13 2.8v2.9h-2.9"/>'],
  goto: ['blue', '<path d="M2.5 8h10M8.8 4l4 4-4 4"/>'],
  key: ['yellow', '<circle cx="5.5" cy="10.5" r="2.7" fill="currentColor" fill-opacity=".3"/><path d="M7.5 8.6L13.2 2.9M11.2 4.9l1.8 1.8M9.6 6.5l1.4 1.4"/>'],
  copy: ['blue', `<rect x="5.5" y="5.5" width="7.5" height="8" rx="1.2" ${T}/><path d="M3 10.5V3.5a.8.8 0 0 1 .8-.8H10"/>`],
  plusBox: ['green', `<rect x="2.5" y="2.5" width="11" height="11" rx="2" ${T}/><path d="M8 5v6M5 8h6"/>`],
  lock: ['green', '<rect x="3.5" y="7.2" width="9" height="6.3" rx="1.2" fill="currentColor" fill-opacity=".3"/><path d="M5.5 7.2V5.3a2.5 2.5 0 0 1 5 0v1.9"/>'],
  edit: ['orange', '<path d="M2.5 13.5l.7-3.2 7.6-7.6a1.4 1.4 0 0 1 2 0l.5.5a1.4 1.4 0 0 1 0 2L5.7 12.8z" fill="currentColor" fill-opacity=".25"/><path d="M9.6 3.9l2.5 2.5"/>'],
  checkAll: ['green', '<path d="M1.8 8.6l2.7 2.7 4.6-5.2M7 11.3l.9.9 6-6.8"/>'],
  uncheckAll: ['orange', '<rect x="3" y="3" width="10" height="10" rx="1.6"/><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"/>'],
  collapse: ['cyan', '<path d="M8.5 4L4.5 8l4 4M13 4L9 8l4 4"/>'],
  target: ['purple', '<circle cx="8" cy="8" r="4.2"/><path d="M8 1.8v3M8 11.2v3M1.8 8h3M11.2 8h3"/><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none"/>'],
  filter: ['orange', `<path d="M2 3h12l-4.5 5.5V13l-3-1.5V8.5z" ${T}/>`]
};

/** HTML icon nhiều màu `name` cỡ `size` px (mặc định 16); tên lạ → icon nét cùng tên (nếu có), không có thì chuỗi rỗng. */
export function cicon(name, size = 16) {
  const e = COLORED[name];
  if (!e) return icon(name, size);
  return `<svg class="ic ci-${e[0]}" width="${size}" height="${size}" viewBox="0 0 16 16" ${S} aria-hidden="true" focusable="false">${e[1]}</svg>`;
}

/**
 * Nút chỉ icon (thanh công cụ): icon màu + tooltip (kèm phím tắt). `a` = data-a. menu = true thêm mũi tên nhỏ (nút mở menu thả).
 * extra: chuỗi thuộc tính thêm (vd 'disabled'). Chữ không hiện trên nút — tên chức năng nằm ở title.
 */
export function ibtn(a, iconName, title, { menu = false, extra = '', cls = '' } = {}) {
  return `<button class="icon-btn tb ${cls}" data-a="${a}" title="${String(title).replace(/"/g, '&quot;')}" aria-label="${String(title).replace(/"/g, '&quot;')}" ${extra}>${cicon(iconName, 16)}${menu ? icon('chevronDown', 10) : ''}</button>`;
}

// ===== Nút DB của tab (viên thuốc): dùng chung Query / Select Table =====
// Chỉ hiển thị: DB có tên chứa "prod" (dạng từ riêng: IMPCO_PROD, prod-app…) → thêm class .prod để tô đỏ nhẹ + nhãn PROD.
const PROD_RE = /(^|[^a-z0-9])prod(uction)?([^a-z0-9]|$)/i;

/** Ruột nút DB: icon CSDL · tên · nhãn PROD (ẩn trừ khi .prod) · mũi tên. Tên điền bằng setDbPill. */
export function dbPillHtml() {
  return cicon('db', 14) + '<span class="nm" data-a="dbname">DB…</span><span class="tag-prod">PROD</span>' + icon('chevronDown', 12);
}

/** Đặt tên DB lên nút `btn` (nút chứa dbPillHtml) + bật / tắt .prod. */
export function setDbPill(btn, name) {
  const nm = btn.querySelector('[data-a="dbname"]');
  if (nm) nm.textContent = name || '…';
  btn.classList.toggle('prod', PROD_RE.test(name || ''));
}
