// Mở tab màn Query / Select Table và các lệnh VS Code mở màn (gói A gọi openQuery / openObjectScript / openSelectTable,
// extension.ts đăng ký buildScreenCommandHandlers).
import * as vscode from 'vscode';
import { objectScript } from '../../core/sql/sqlObjects';
import { dataScript } from '../../core/sql/tableOps';
import type { BasketItem } from '../../core/basket/basket';
import type { ProjectRecord } from '../../core/types';
import type { App } from '../app';
import type { CallCtx } from '../bridge/types';
import type { Handler } from '../commands';
import { getMemoryText } from '../services/memoryService';
import { scripts, withDedicated } from '../services/sqlHost';
import { buildBasketCommands } from '../services/updService';
import { openScreen } from './screenHost';

export interface OpenQueryOpts {
  sql?: string;
  title?: string;
  db?: string;
  language?: string;
}

export interface OpenSelectTableOpts {
  table?: string;
  db?: string;
  where?: string;
  run?: boolean;
}

/** Mở tab Query mới cho dự án; opts nạp sẵn nội dung / tên tab / DB / ngôn ngữ (sql | xml | json). */
export function openQuery(_app: App, project: ProjectRecord, opts: OpenQueryOpts = {}): Promise<void> {
  openScreen('query', project, { ...opts });
  return Promise.resolve();
}

/** Ngữ cảnh gọi service từ lệnh VS Code (không có tab gọi): phiên của dự án, không đẩy sự kiện. */
async function ctxOf(app: App, project: ProjectRecord): Promise<CallCtx> {
  const session = app.sessions.get(project);
  await session.start();
  return { project, session, panelId: '', emit: () => undefined };
}

/**
 * Mở Query nạp sẵn script của đối tượng: store / view / function / trigger — ALTER (ctrl = DROP + CREATE + QUOTED OFF);
 * bảng — chỉ phần thay đổi (ctrl = CREATE TABLE đủ + index + default + bảng kỳ). Cùng logic với lệnh sql.script.
 */
export async function openObjectScript(app: App, project: ProjectRecord, name: string, ctrl: boolean): Promise<void> {
  const ctx = await ctxOf(app, project);
  const code = await withDedicated(ctx, '', (s) => objectScript(s, scripts(), name, { alter: !ctrl, quotedOff: ctrl }));
  const apps = await ctx.session.appDatabases();
  await openQuery(app, project, { sql: code, title: name, db: apps[0] ?? project.sysDatabase });
}

/** Mở tab Select Table (màn do gói F làm; opts truyền thẳng cho màn). */
export function openSelectTable(_app: App, project: ProjectRecord, opts: OpenSelectTableOpts = {}): Promise<void> {
  openScreen('select-table', project, { ...opts });
  return Promise.resolve();
}

/** Menu truyền cho màn Update Script để điền sẵn 3 ô tìm và Save / Load Update theo menu (kind: 'fbo' | 'mob' | 'fb'). */
export interface UpdateScriptMenu {
  kind?: 'fbo' | 'mob' | 'fb';
  id: string;
  t?: string;
  sys?: string;
  code?: string;
  type?: string;
  link?: string;
  exe?: string;
}

export interface OpenUpdateScriptOpts {
  menu?: UpdateScriptMenu;
}

/** Mở tab Update Script (gói update) cho dự án; opts.menu điền sẵn theo menu đang chọn. Màn khác gọi ctx.open('UpdateScript', opts). */
export function openUpdateScript(_app: App, project: ProjectRecord, opts: OpenUpdateScriptOpts = {}): Promise<void> {
  openScreen('update-script', project, { ...opts });
  return Promise.resolve();
}

/** Menu cần sửa: kind 'fbo' | 'mob' (| 'fb'), id = wmenu_id (FB: menu_id); t = tên hiện trên cây, link = đường dẫn (dò file của menu). */
export interface OpenMenuEditOpts {
  kind?: 'fbo' | 'mob' | 'fb';
  id?: string;
  t?: string;
  link?: string;
}

/** Mở tab Sửa menu (wcommand / dvcommand trong DB Sys) cho dự án; màn khác gọi ctx.open('MenuEdit', opts). */
export function openMenuEdit(_app: App, project: ProjectRecord, opts: OpenMenuEditOpts = {}): Promise<void> {
  openScreen('menu-edit', project, { ...opts });
  return Promise.resolve();
}

/** Menu truyền cho màn Multi Search để điền sẵn ô tìm file (cùng hình với UpdateScriptMenu). */
export interface OpenMultiSearchOpts {
  menu?: UpdateScriptMenu;
  /** File xem sẵn khi mở (view "Cây màn" bấm một file lúc chưa có tab Multi Search). */
  file?: string;
}

/** Mở tab Multi Search (tìm file / nội dung, xem và sửa file) cho dự án. Màn khác gọi ctx.open('MultiSearch', opts). */
export function openMultiSearch(_app: App, project: ProjectRecord, opts: OpenMultiSearchOpts = {}): Promise<void> {
  openScreen('multi-search', project, { ...opts });
  return Promise.resolve();
}

/** Script thật của một mục giỏ update (nối vào objectScript / dataScript của core). */
async function basketScript(app: App, item: BasketItem, project: ProjectRecord): Promise<string> {
  const ctx = await ctxOf(app, project);
  const db = item.db === 'sys' ? project.sysDatabase : '';
  if (item.kind === 'data') return withDedicated(ctx, db, (s) => dataScript(s, item.table, item.key));
  return withDedicated(ctx, db, (s) => objectScript(s, scripts(), item.name, { alter: item.alter, quotedOff: item.quotedOff }));
}

export function buildScreenCommandHandlers(app: App, deps: { ensureProject: () => Promise<ProjectRecord | undefined> }): Record<string, Handler> {
  // Lệnh giỏ update: cần biết dự án trước (ensureProject) rồi mới gọi lệnh gốc (đọc dự án đồng bộ).
  let current: ProjectRecord | undefined;
  const basket = buildBasketCommands({
    currentProject: () => current,
    scriptOf: (item, project) => basketScript(app, item, project)
  });
  const withProject = (cmd: keyof typeof basket): Handler => async () => {
    current = await deps.ensureProject();
    if (current) await basket[cmd]();
  };

  return {
    'fsd.openQuery': async () => {
      const project = await deps.ensureProject();
      if (project) await openQuery(app, project);
    },
    'fsd.selectTable': async () => {
      const project = await deps.ensureProject();
      if (project) await openSelectTable(app, project, {});
    },
    // Có thể truyền { menu } (panel MENU) để điền sẵn theo menu; không truyền thì mở trống.
    'fsd.openUpdateScript': async (arg?: OpenUpdateScriptOpts) => {
      const project = await deps.ensureProject();
      if (project) await openUpdateScript(app, project, arg && typeof arg === 'object' && arg.menu ? { menu: arg.menu } : {});
    },
    'fsd.openMultiSearch': async (arg?: OpenMultiSearchOpts) => {
      const project = await deps.ensureProject();
      if (!project) return;
      const o: OpenMultiSearchOpts = {};
      if (arg && typeof arg === 'object') {
        if (arg.menu) o.menu = arg.menu;
        if (typeof arg.file === 'string' && arg.file) o.file = arg.file;
      }
      await openMultiSearch(app, project, o);
    },
    // Lệnh có thể truyền menu cần sửa ({ kind, id, t, link }) — panel MENU (chuột phải) truyền menu đang chọn; không truyền thì màn hiện "Chọn menu".
    'fsd.openMenuEdit': async (arg?: OpenMenuEditOpts) => {
      const project = await deps.ensureProject();
      if (!project) return;
      const opts: OpenMenuEditOpts = arg && typeof arg === 'object' && typeof arg.id === 'string' ? { kind: arg.kind, id: arg.id, t: arg.t, link: arg.link } : {};
      await openMenuEdit(app, project, opts);
    },
    'fsd.viewMemory': async () => {
      const project = await deps.ensureProject();
      if (!project) return;
      const text = getMemoryText(project.code);
      if (text.trim() === '') {
        void vscode.window.showInformationMessage('Memory Temp đang trống.');
        return;
      }
      await openQuery(app, project, { sql: text, title: 'Memory Temp' });
    },
    'fsd.basketView': withProject('fsd.basketView'),
    'fsd.basketCopy': withProject('fsd.basketCopy'),
    'fsd.basketClear': withProject('fsd.basketClear')
  };
}
