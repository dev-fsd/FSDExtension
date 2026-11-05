// Icon SVG nhiều màu cho cây ở sidebar và hai màn Update / Multi Search: nét mảnh trên lưới 16x16, tô bằng currentColor,
// màu lấy từ bảng màu biểu đồ của theme (--vscode-charts-*) nên đổi theo sáng / tối. Chỉ tạo chuỗi HTML, không đụng DOM.
// ic(tên, màu?, cỡ?) → <svg>; kindIcon(...) chọn icon + màu theo đuôi file / loại đối tượng SQL.

const S = 'fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"';

const PATHS = {
  chevron: '<path d="M6.2 4l4 4-4 4"/>',
  folder: '<path d="M2 4.5h4l1.5 1.5H14V13H2z"/>',
  folderOpen: '<path d="M2 4.5h4l1.5 1.5H13v1.5M2 13l1.6-5.5H15L13.4 13z"/>',
  file: '<path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/>',
  fileCode: '<path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3M6.6 8.6L5.4 10l1.2 1.4M9.4 8.6l1.2 1.4-1.2 1.4"/>',
  fileText: '<path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3M6 8h4M6 10.5h4"/>',
  table: '<rect x="2" y="3" width="12" height="10" rx="1.2"/><path d="M2 7h12M6.5 3v10"/>',
  view: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
  store: '<path d="M4.5 3.2v9.6a.4.4 0 0 0 .6.35l7.8-4.8a.4.4 0 0 0 0-.7L5.1 2.85a.4.4 0 0 0-.6.35z"/>',
  func: '<path d="M10.5 3H9.2A2 2 0 0 0 7.3 4.4L6 11.6A2 2 0 0 1 4.1 13H3.5M4.5 7.5h6"/>',
  trigger: '<path d="M9 2L4 9h3.5L7 14l5-7H8.5z"/>',
  db: '<ellipse cx="8" cy="4" rx="5" ry="2"/><path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4"/><path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  refresh: '<path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13 2.8v2.9h-2.9"/>',
  expand: '<path d="M4 6l4 4 4-4"/><path d="M4 2.5h8"/>',
  collapse: '<path d="M4 10l4-4 4 4"/><path d="M4 13.5h8"/>',
  search: '<circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5"/>',
  list: '<path d="M5.5 4h8M5.5 8h8M5.5 12h8"/><circle cx="2.8" cy="4" r=".6" fill="currentColor"/><circle cx="2.8" cy="8" r=".6" fill="currentColor"/><circle cx="2.8" cy="12" r=".6" fill="currentColor"/>',
  filter: '<path d="M2 3h12l-4.5 5.5V13l-3-1.5V8.5z"/>',
  clock: '<circle cx="8" cy="8" r="5.8"/><path d="M8 4.6V8l2.4 1.5"/>',
  history: '<path d="M2.5 8a5.5 5.5 0 1 0 1.7-4"/><path d="M2.5 2.8V6H5.7M8 5v3.2l2 1.2"/>',
  open: '<path d="M2 4.5h4l1.5 1.5H14V13H2z"/><path d="M8 11V8.2M6.6 9.4L8 8l1.4 1.4"/>',
  dots: '<circle cx="3.5" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r="1.1" fill="currentColor" stroke="none"/>',
  save: '<path d="M3 3h8l2 2v8H3z"/><path d="M5.5 3v3h4V3M5.5 13V9h5v4"/>',
  saveAs: '<path d="M3 3h8l2 2v3M3 3v10h5"/><path d="M5.5 3v3h4V3"/><path d="M11 14v-4M9 12h4"/>',
  merge: '<path d="M3 3v3a3 3 0 0 0 3 3h4M13 3v3a3 3 0 0 1-3 3M8 9v5"/>',
  trash: '<path d="M3 4.5h10M6.2 4.5V3h3.6v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>',
  copy: '<rect x="5.5" y="5.5" width="7.5" height="8" rx="1.2"/><path d="M3 10.5V3.5a.8.8 0 0 1 .8-.8H10"/>',
  check: '<path d="M3.5 8.5l3 3 6-6.5"/>',
  checkAll: '<path d="M1.8 8.5l2.7 2.7 4.3-5M7.5 11l.8.7 5.2-6"/>',
  eye: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
  zero: '<circle cx="8" cy="8" r="5.5"/><path d="M5.2 10.8l5.6-5.6"/>',
  wrap: '<path d="M2 4h12M2 8h9.2a2.4 2.4 0 0 1 0 4.8H8.5M10 11l-1.6 1.8L10 14.6M2 12.8h3"/>',
  format: '<path d="M3 4h10M3 8h6M3 12h8"/>',
  ide: '<path d="M6 4L2 8l4 4M10 4l4 4-4 4"/>',
  clone: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.2"/><rect x="2.5" y="2.5" width="8" height="8" rx="1.2"/>',
  auto: '<path d="M9 2L4.5 9h3L7 14l4.5-7h-3z"/>',
  voucher: '<path d="M3 2.5h10v11l-2-1.2-1.5 1.2L8 12.3 6.5 13.5 5 12.3 3 13.5z"/><path d="M5.8 6h4.4M5.8 8.5h3"/>',
  pkg: '<path d="M2 5l6-3 6 3v6l-6 3-6-3z"/><path d="M2 5l6 3 6-3M8 8v6"/>',
  upload: '<path d="M8 11V2.5M4.5 6L8 2.5 11.5 6M2.5 13.5h11"/>',
  panel: '<rect x="2" y="3" width="12" height="10" rx="1.2"/><path d="M6 3v10"/>',
  warn: '<path d="M8 2.2l6.3 11.3H1.7z"/><path d="M8 6.6v3.1M8 11.7v.2"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  clearAll: '<path d="M3 4.5h10M6.2 4.5V3h3.6v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.5 7l3 4M9.5 7l-3 4"/>',
  external: '<path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5M11.5 9.5V13H3V4.5h3.5"/>'
};

/** Màu theo ý nghĩa — đều là biến của theme VS Code, có màu dự phòng khi mở ngoài IDE. */
export const COLOR = {
  blue: 'var(--vscode-charts-blue, #3794ff)',
  green: 'var(--vscode-charts-green, #89d185)',
  yellow: 'var(--vscode-charts-yellow, #cca700)',
  orange: 'var(--vscode-charts-orange, #d18616)',
  purple: 'var(--vscode-charts-purple, #b180d7)',
  red: 'var(--vscode-charts-red, #f14c4c)',
  muted: 'var(--vscode-descriptionForeground, #8a8a8a)'
};

/** HTML icon `name` cỡ `size` px, tô màu `color` (khóa của COLOR hoặc chuỗi CSS); không màu = theo màu chữ. Tên lạ → ''. */
export function ic(name, color, size = 14) {
  const body = PATHS[name];
  if (!body) return '';
  const c = color ? COLOR[color] || color : '';
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 16 16" ${S}${c ? ` style="color:${c}"` : ''} aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Đuôi file → icon + màu: .f vàng, .xml xanh dương, .sql tím, bảng tính xanh lá, mẫu in đỏ, còn lại xám. */
export function fileKind(name) {
  const ext = (String(name).match(/\.([^.\\/]+)$/) || [])[1];
  switch ((ext || '').toLowerCase()) {
    case 'f': return ['fileCode', 'yellow'];
    case 'xml': case 'xsd': case 'ent': case 'aspx': return ['fileCode', 'blue'];
    case 'sql': return ['fileCode', 'purple'];
    case 'js': return ['fileCode', 'yellow'];
    case 'xlsx': case 'xls': case 'csv': return ['fileText', 'green'];
    case 'rpt': case 'frx': case 'rldc': return ['fileText', 'red'];
    case 'upd': return ['pkg', 'orange'];
    case 'txt': case 'html': case 'css': return ['fileText', 'muted'];
    default: return ['file', 'muted'];
  }
}

/** Icon của một file theo tên. */
export function fileIcon(name, size = 14) {
  const [n, c] = fileKind(name);
  return ic(n, c, size);
}

/** Loại đối tượng SQL (sys.objects type) → [icon, màu]: bảng xanh dương, view xanh lá, store cam, function tím, trigger đỏ. */
export function sqlKind(type) {
  switch (String(type || '').trim().toUpperCase()) {
    case 'U': return ['table', 'blue'];
    case 'V': return ['view', 'green'];
    case 'P': return ['store', 'orange'];
    case 'FN': case 'IF': case 'TF': return ['func', 'purple'];
    case 'TR': return ['trigger', 'red'];
    default: return ['file', 'muted'];
  }
}

export function sqlIcon(type, size = 14) {
  const [n, c] = sqlKind(type);
  return ic(n, c, size);
}
