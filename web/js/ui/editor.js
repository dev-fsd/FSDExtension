// Editor code dùng chung (Monaco, nằm trong extension tại lib/monaco, không dùng CDN). Nạp 1 lần, theme theo theme của IDE.
// Chạy trong webview: loader AMD nạp bằng <script src> (CSP script-src cho nguồn của webview), worker tạo qua blob URL
// rồi importScripts(workerMain.js) — webview và file tài nguyên khác origin nên không thể new Worker(url) trực tiếp.
let loading = null;

/** Thư mục lib/monaco (có "/" cuối): meta fsd-web-base của screen.html, thiếu thì suy từ vị trí file này. */
function monacoBase() {
  const meta = document.querySelector('meta[name="fsd-web-base"]');
  const web = meta && meta.content ? meta.content : new URL('../../', import.meta.url).href;
  return web.replace(/\/?$/, '/') + 'lib/monaco/';
}

// Theme của IDE: VS Code gắn class lên <body> (vscode-dark / vscode-light / vscode-high-contrast / vscode-high-contrast-light).
const cls = (name) => document.body.classList.contains(name);
export const isHighContrast = () => cls('vscode-high-contrast');
export const isDark = () => cls('vscode-dark') || (isHighContrast() && !cls('vscode-high-contrast-light'));

let colorCtx;
/** Màu CSS bất kỳ (hex, rgb(), tên màu…) → '#rrggbb' / '#rrggbbaa' để Monaco nhận; rỗng / không hiểu → undefined. */
function toHex(css) {
  if (!css) return undefined;
  if (!colorCtx) { const c = document.createElement('canvas'); c.width = c.height = 1; colorCtx = c.getContext('2d', { willReadFrequently: true }); }
  colorCtx.clearRect(0, 0, 1, 1);
  colorCtx.fillStyle = '#000';
  colorCtx.fillStyle = css;
  colorCtx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = colorCtx.getImageData(0, 0, 1, 1).data;
  const h = (n) => n.toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b) + (a < 255 ? h(a) : '');
}

const VAR = {
  'editor.background': '--vscode-editor-background',
  'editor.foreground': '--vscode-editor-foreground',
  'editor.lineHighlightBackground': '--vscode-editor-lineHighlightBackground',
  'editor.selectionBackground': '--vscode-editor-selectionBackground',
  'editor.inactiveSelectionBackground': '--vscode-editor-inactiveSelectionBackground',
  'editorLineNumber.foreground': '--vscode-editorLineNumber-foreground',
  'editorLineNumber.activeForeground': '--vscode-editorLineNumber-activeForeground',
  'editorCursor.foreground': '--vscode-editorCursor-foreground',
  'editorWidget.background': '--vscode-editorWidget-background',
  'editorWidget.border': '--vscode-editorWidget-border',
  'editorSuggestWidget.background': '--vscode-editorSuggestWidget-background',
  'editorSuggestWidget.selectedBackground': '--vscode-editorSuggestWidget-selectedBackground',
  'input.background': '--vscode-input-background',
  'input.foreground': '--vscode-input-foreground'
};

/** Theme Monaco lấy màu nền / chọn / số dòng từ biến --vscode-* hiện tại; màu cú pháp giữ mặc định theo vs / vs-dark / hc. */
export function applyTheme() {
  const monaco = window.monaco;
  if (!monaco) return;
  const cs = getComputedStyle(document.documentElement);
  const colors = {};
  Object.keys(VAR).forEach((k) => { const v = toHex(cs.getPropertyValue(VAR[k]).trim()); if (v) colors[k] = v; });
  const hc = isHighContrast();
  const base = hc ? (isDark() ? 'hc-black' : 'hc-light') : isDark() ? 'vs-dark' : 'vs';
  monaco.editor.defineTheme('fsd-ide', { base, inherit: true, rules: [], colors });
  monaco.editor.setTheme('fsd-ide');
}

function watchTheme() {
  // IDE đổi theme: đổi class của <body> và style (biến --vscode-*) của <html>.
  let t = 0;
  const later = () => { clearTimeout(t); t = setTimeout(applyTheme, 30); };
  new MutationObserver(later).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(later).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
}

export function loadMonaco() {
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const base = monacoBase();
      const vsUrl = base + 'vs';
      // Worker: blob (cùng origin với trang) nạp workerMain.js từ tài nguyên extension bằng importScripts.
      window.MonacoEnvironment = {
        getWorkerUrl() {
          const src = `self.MonacoEnvironment={baseUrl:${JSON.stringify(base)}};importScripts(${JSON.stringify(vsUrl + '/base/worker/workerMain.js')});`;
          return URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        }
      };
      const s = document.createElement('script');
      s.src = vsUrl + '/loader.js';
      s.onerror = () => reject(new Error('Không nạp được editor (lib/monaco).'));
      s.onload = () => {
        window.require.config({ paths: { vs: vsUrl } });
        window.require(['vs/editor/editor.main'], () => { applyTheme(); watchTheme(); resolve(window.monaco); }, reject);
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

/** Tạo editor trong el. opts ghi đè mặc định (language, value, readOnly, wordWrap…). */
export async function createEditor(el, opts) {
  const monaco = await loadMonaco();
  return monaco.editor.create(el, Object.assign({
    language: 'sql', automaticLayout: true, minimap: { enabled: false },
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-font-family').trim() || 'Consolas, "Cascadia Mono", monospace',
    fontSize: 13, scrollBeyondLastLine: false,
    renderWhitespace: 'selection', tabSize: 4, insertSpaces: false, glyphMargin: true
  }, opts || {}));
}
