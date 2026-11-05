// Đọc menu FBO (wcommand) / Mobile (dvcommand) và dựng cây — port MenuService.vb.
import * as fs from 'fs';
import * as path from 'path';
import type { MenuItem, MenuKind, MenuNode } from '../types';
import type { SqlClient } from './sqlClient';

const SCRIPT_FILE: Record<MenuKind, string> = {
  fbo: 'GETWCOMMAND.sql',
  mob: 'GETDVCOMMAND.sql',
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

/** Tên menu trong DB có thể kèm thẻ HTML (vd `Mua sắm<span id="fsd_flow_ms"></span>`): chỉ giữ chữ để hiển thị và tìm. */
export function plainText(v: string): string {
  return v.replace(/<[^>]*>/g, '').trim();
}

function isOn(v: unknown): boolean {
  if (v === true || v === 1) return true;
  const s = str(v).toLowerCase();
  return s === '1' || s === 'true';
}

/** Lỗi 208 = Invalid object name (bảng không tồn tại). */
function isMissingTable(e: unknown): boolean {
  const err = e as { number?: number; message?: string };
  return err?.number === 208 || /invalid object name/i.test(err?.message ?? '');
}

export async function loadMenus(client: SqlClient, kind: MenuKind, scriptsDir: string): Promise<MenuItem[]> {
  const script = fs.readFileSync(path.join(scriptsDir, SCRIPT_FILE[kind]), 'utf8').replace(/^﻿/, '');
  let rows: Record<string, unknown>[];
  try {
    rows = await client.query(script);
  } catch (e) {
    if (kind === 'mob' && isMissingTable(e)) return [];
    throw e;
  }
  return rows.map((r): MenuItem => {
    const item: MenuItem = {
      kind,
      id: str(r.wmenu_id),
      parentId: str(r.wmenu_id0),
      bar: plainText(str(r.bar)),
      sysId: str(r.sysid),
      link: kind === 'fbo' ? str(r.link) : '',
      type: str(r.type),
    };
    if (kind === 'mob') {
      item.mobile = {
        fboMenuId: str(r.menu_id),
        iconUrl: str(r.icon_url),
        iconColor: str(r.icon_color),
        enabled: isOn(r.status),
        xgroup: str(r.xgroup),
        action: str(r.action),
        bar2: str(r.bar2),
      };
    }
    return item;
  });
}

/**
 * Dựng cây như panel trái FSD Studio 5.1 (clsMenuTreeBuilder): trùng mã giữ dòng đầu, bar = "-" bỏ, sắp theo mã
 * (không phân biệt hoa thường). Chỉ dòng không có cha (wmenu_id0 rỗng) là gốc; dòng có cha không tồn tại
 * (hoặc trỏ vào chính nó) không hiện trên cây — 5.1 cũng không hiện.
 */
export function buildTree(items: MenuItem[]): MenuNode[] {
  const byId = new Map<string, MenuNode>();
  for (const it of items) {
    if (it.bar.trim() === '-') continue;
    const key = it.id.toLowerCase();
    if (byId.has(key)) continue;
    byId.set(key, { ...it });
  }
  const sorted = [...byId.values()].sort((a, b) => {
    const x = a.id.toLowerCase();
    const y = b.id.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const roots: MenuNode[] = [];
  for (const node of sorted) {
    const pKey = node.parentId.toLowerCase();
    if (pKey === '') {
      roots.push(node);
      continue;
    }
    const parent = pKey !== node.id.toLowerCase() ? byId.get(pKey) : undefined;
    if (parent) (parent.children ??= []).push(node);
  }
  return roots;
}

export async function hasMobile(client: SqlClient): Promise<boolean> {
  const rows = await client.query<{ id: unknown }>("SELECT OBJECT_ID('dvcommand') AS id");
  return rows.length > 0 && rows[0].id !== null && rows[0].id !== undefined && rows[0].id !== '';
}

/** Một khối trong danh sách tìm menu: các menu mở được cùng một cha trực tiếp. */
export interface MenuBranchGroup {
  /** Đường nhánh tới cha, vd "Tổng hợp › Chứng từ". */
  title: string;
  items: MenuItem[];
}

/** Menu mở được màn: có sysid, bar khác rỗng và khác "-". */
export function isOpenableMenu(m: MenuItem): boolean {
  const bar = (m.bar ?? '').trim();
  return !!(m.sysId ?? '').trim() && bar !== '' && bar !== '-';
}

/** Ghép bar các tổ tiên bằng " › "; quá 3 cấp thì rút cấp giữa thành "…". */
export function branchTitle(path: string[]): string {
  const p = path.map((s) => s.trim()).filter(Boolean);
  const shown = p.length > 3 ? [p[0], '…', p[p.length - 1]] : p;
  return shown.join(' › ');
}

/**
 * Chia menu mở được thành khối theo nhánh cây: mỗi khối = các menu cùng cha trực tiếp
 * (menu nằm ngay dưới gốc → tiêu đề là tên gốc). Khối xếp theo thứ tự duyệt cây (cây đã sắp theo mã),
 * khối của một cha nằm ở chỗ cha đó xuất hiện đầu tiên.
 */
export function groupMenusByBranch(tree: MenuNode[], openable: (m: MenuItem) => boolean = isOpenableMenu): MenuBranchGroup[] {
  const out: MenuBranchGroup[] = [];
  const emit = (path: string[], items: MenuNode[]): void => {
    const list = items.filter(openable);
    if (list.length) out.push({ title: branchTitle(path), items: list });
  };
  const walk = (node: MenuNode, path: string[]): void => {
    const here = [...path, node.bar];
    const kids = node.children ?? [];
    emit(here, kids);
    for (const k of kids) if (k.children?.length) walk(k, here);
  };
  for (const root of tree) {
    // Gốc mở được màn thì nằm chung khối với con trực tiếp của nó.
    const kids = root.children ?? [];
    emit([root.bar], [root, ...kids]);
    for (const k of kids) if (k.children?.length) walk(k, [root.bar]);
  }
  return out;
}
