// Trang HTML của view "Cây màn" (fsd.screenTree, WebviewView ở sidebar trái): nền chung theme.css + base.css + ui.css, css dùng chung với
// tab Update (update-script.css: vùng thu / mở, cây có ô tick, hộp lịch sử), css riêng sidebar.css; mã web/js/sidebar/main.js (ES module, CSP nonce).
// Không cần worker / Monaco: view chỉ dựng cây và gọi lệnh qua extension.
import * as vscode from 'vscode';

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

export function sidebarHtml(webview: vscode.Webview, webRoot: vscode.Uri): string {
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
<title>Cây màn</title>
<link rel="stylesheet" href="${base}css/theme.css">
<link rel="stylesheet" href="${base}css/base.css">
<link rel="stylesheet" href="${base}css/ui.css">
<link rel="stylesheet" href="${base}css/update-script.css">
<link rel="stylesheet" href="${base}css/sidebar.css">
</head>
<body class="sb">
<div id="app"></div>
<script type="module" nonce="${n}" src="${base}js/sidebar/main.js"></script>
</body>
</html>
`;
}
