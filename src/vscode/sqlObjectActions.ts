// Thao tác dùng chung của "Đối tượng SQL" (QuickPick sqlPicker.ts và panel cũ sqlObjectsView.ts): mở đối tượng vào tab Query / Select Table,
// copy script, Custom Gen. Chỉ dùng dịch vụ sql.* qua ScreenHost.call (cùng đường với tab màn).
import * as vscode from 'vscode';
import type { App } from './app';
import { openQuery, openSelectTable } from './screens/openScreens';
import { getScreenHost } from './screens/screenHost';

/** Thông báo ngắn: warn = hộp cảnh báo, còn lại = dòng trạng thái 4 giây. */
export function toast(msg: string, warn: boolean): void {
  if (!msg) return;
  if (warn) void vscode.window.showWarningMessage(msg);
  else vscode.window.setStatusBarMessage(`$(info) ${msg}`, 4000);
}

/** Tab Query / Select Table được focus gần nhất của dự án đang mở (5.1: "tab đang mở"). */
export function focusedTab(app: App): { id: string; screen: string } | undefined {
  const project = app.ctx.state.project;
  return project ? getScreenHost().focused(project.code) : undefined;
}

export interface OpenOptions {
  /** DROP + CREATE + QUOTED OFF thay vì ALTER. */
  ctrl?: boolean;
  /** Bảng luôn lấy script (không mở Select Table / nạp vào tab Select Table) — nút "DROP + CREATE" của QuickPick. */
  forceQuery?: boolean;
}

/**
 * Bấm một dòng (5.2 openObject / 5.1 SetToTabData): bảng + tab Select Table → nạp bảng vào tab đó; bảng + không có tab Query → mở Select Table;
 * còn lại lấy script (ALTER; ctrl = DROP + CREATE + QUOTED OFF) rồi nạp vào tab Query đang mở, không có thì mở tab Query mới.
 */
export async function openObject(app: App, name: string, type: string, db: string, opts: OpenOptions = {}): Promise<void> {
  const project = app.ctx.state.project;
  if (!project || !name) return;
  const ctrl = opts.ctrl === true;
  const host = getScreenHost();
  const cur = focusedTab(app);
  const intoQuery = cur?.screen === 'query';
  if (type === 'U' && !opts.forceQuery) {
    if (cur?.screen === 'select-table') {
      host.emit(cur.id, 'table.load', { table: name });
      host.reveal(cur.id);
      return;
    }
    if (!intoQuery) {
      await openSelectTable(app, project, { table: name, db: db || undefined });
      return;
    }
  }
  const code = String(await host.call(project, 'sql.script', { db, name, alter: !ctrl, quotedOff: ctrl }));
  // Bảng không Ctrl = chỉ phần trigger (như 5.1); bảng không có trigger thì rỗng — báo, không xóa trắng editor.
  if (!code.trim()) {
    toast(type === 'U' && !ctrl ? `Bảng ${name} không có trigger — Ctrl+bấm để lấy CREATE TABLE đủ` : `Không còn đối tượng ${name}`, true);
    return;
  }
  if (intoQuery && cur) {
    host.emit(cur.id, 'query.loadObject', { text: code });
    host.reveal(cur.id);
  } else {
    await openQuery(app, project, { sql: code, title: name, db: db || undefined });
  }
}

/**
 * 5.1 Custom Gen / Custom Gen Current List: names = văn bản tên (xuống dòng / dấu phẩy) → script ALTER (hoặc DROP + CREATE) của từng đối tượng,
 * mỗi cái kết bằng GO; nạp vào tab Query đang mở, chưa có thì mở tab Query mới.
 */
export async function customGen(app: App, names: string, db: string, alter: boolean): Promise<void> {
  const project = app.ctx.state.project;
  if (!project) return;
  const r = (await getScreenHost().call(project, 'sql.scripts', { db, names, alter })) as { text: string; failed: string[] };
  if (r.failed.length) toast(`Không lấy được script: ${r.failed.slice(0, 8).join(', ')}${r.failed.length > 8 ? ` … (+${r.failed.length - 8})` : ''}`, true);
  if (!r.text.trim()) return;
  const cur = focusedTab(app);
  if (cur?.screen === 'query') {
    getScreenHost().emit(cur.id, 'query.loadObject', { text: r.text });
    getScreenHost().reveal(cur.id);
  } else {
    await openQuery(app, project, { sql: r.text, title: 'Custom Gen', db: db || undefined });
  }
}

/** 5.1 Ctrl+C trên danh sách: bảng → CREATE đủ cột; store / view / function / trigger → ALTER. */
export async function copyScript(app: App, name: string, type: string, db: string): Promise<void> {
  const project = app.ctx.state.project;
  if (!project || !name) return;
  const code = String(await getScreenHost().call(project, 'sql.script', { db, name, alter: type !== 'U', quotedOff: false }));
  await vscode.env.clipboard.writeText(code);
  toast('Set Script To Clipboard!', false);
}
