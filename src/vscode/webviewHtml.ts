// Dựng trang HTML cho webview (tab màn và panel MENU): CSP chỉ nguồn của extension, nonce, đường dẫn css / js trong web/.
import * as fs from 'fs';
import * as vscode from 'vscode';

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

/** JSON đưa vào <script type="application/json">: chặn "</script>" và ký tự phân tách dòng U+2028 / U+2029. */
function jsonForHtml(value: unknown): string {
  return JSON.stringify(value ?? {})
    .replace(/</g, '\\u003c')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
}

/**
 * Trang màn (web/screen.html) cho tab webview: {{csp}} {{nonce}} {{base}} (thư mục web, có "/" cuối) {{title}} {{init}}.
 * CSP: script chỉ nonce + nguồn extension (loader AMD của Monaco nạp được); worker qua blob (importScripts); không CDN.
 */
export function screenHtml(webview: vscode.Webview, webRoot: vscode.Uri, title: string, init: unknown): string {
  const n = nonce();
  const base = webview.asWebviewUri(webRoot).toString().replace(/\/?$/, '/');
  const src = webview.cspSource;
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${n}' ${src}`,
    `style-src ${src} 'unsafe-inline'`,
    `font-src ${src}`,
    `img-src ${src} data:`,
    'worker-src blob:',
    `connect-src ${src}`
  ].join('; ');
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const vars: Record<string, string> = { csp, nonce: n, base, title: esc(title), init: jsonForHtml(init) };
  // Một lượt thay: giá trị chứa "{{...}}" (vd câu SQL trong opts) không bị thay lần nữa.
  return fs
    .readFileSync(vscode.Uri.joinPath(webRoot, 'screen.html').fsPath, 'utf8')
    .replace(/\{\{(csp|nonce|base|title|init)\}\}/g, (_m, k: string) => vars[k]);
}

/** Trang panel "Đối tượng SQL" (WebviewView): theme.css + base.css + sqlobjects.css, mã web/js/sqlobjects/main.js (ES module, CSP nonce). */
export function sqlObjectsHtml(webview: vscode.Webview, webRoot: vscode.Uri): string {
  const n = nonce();
  const base = webview.asWebviewUri(webRoot).toString().replace(/\/?$/, '/');
  const src = webview.cspSource;
  const csp = ["default-src 'none'", `script-src 'nonce-${n}' ${src}`, `style-src ${src} 'unsafe-inline'`, `font-src ${src}`, `img-src ${src} data:`].join('; ');
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Đối tượng SQL</title>
<link rel="stylesheet" href="${base}css/theme.css">
<link rel="stylesheet" href="${base}css/base.css">
<link rel="stylesheet" href="${base}css/sqlobjects.css">
</head>
<body class="sqlo">
<div id="app"></div>
<script type="module" nonce="${n}" src="${base}js/sqlobjects/main.js"></script>
</body>
</html>
`;
}

/**
 * Trang panel MENU (WebviewView): nền chung web/css/theme.css + base.css, riêng web/css/menu.css, mã web/js/menu/main.js (ES module, CSP nonce).
 * Không cần worker / connect: panel chỉ nhận tin nhắn từ extension.
 */
export function menuHtml(webview: vscode.Webview, webRoot: vscode.Uri): string {
  const n = nonce();
  const base = webview.asWebviewUri(webRoot).toString().replace(/\/?$/, '/');
  const src = webview.cspSource;
  const csp = ["default-src 'none'", `script-src 'nonce-${n}' ${src}`, `style-src ${src} 'unsafe-inline'`, `font-src ${src}`, `img-src ${src} data:`].join('; ');
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Menu</title>
<link rel="stylesheet" href="${base}css/theme.css">
<link rel="stylesheet" href="${base}css/base.css">
<link rel="stylesheet" href="${base}css/menu.css">
</head>
<body class="menu">
<div id="app"></div>
<script type="module" nonce="${n}" src="${base}js/menu/main.js"></script>
</body>
</html>
`;
}
