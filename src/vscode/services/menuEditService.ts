// Lệnh medit.* của màn Sửa menu (MenuEditService.vb của 5.2): medit.get, medit.save, medit.dups, medit.dupsApply.
// Tác phong 5.1: sửa menu GHI THẲNG DB Sys (wcommand / command / dvcommand), nhưng mọi lệnh ghi đều hiện hộp xác nhận
// (modal) ghi rõ dự án + máy chủ + DB Sys, và chỉ chạy trên DB Sys của dự án của tab gọi lệnh.
import * as vscode from 'vscode';
import type { ProjectRecord } from '../../core/types';
import { applyDups, findDups, getRow, saveMenu, type SaveIO } from '../../core/menuedit/editRepo';
import { normalizeKind } from '../../core/menuedit/spec';
import type { CallCtx, Registry } from '../bridge/types';
import { withDedicated, withPooled } from './sqlHost';

/** Phần câu SQL hiện trong hộp xác nhận (cắt cho vừa hộp). */
const PREVIEW_CHARS = 1200;

async function confirmWrite(ctx: CallCtx, lines: string[], sql: string): Promise<boolean> {
  const p = ctx.project;
  const preview = sql.length > PREVIEW_CHARS ? sql.slice(0, PREVIEW_CHARS) + '\n…' : sql;
  const pick = await vscode.window.showWarningMessage(
    `Ghi menu lên dự án ${p.code}, DB Sys ${p.sysDatabase}?`,
    {
      modal: true,
      detail: `Máy chủ: ${p.server}\n${lines.join('\n')}\n\nGhi thẳng vào DB, trong một transaction (lỗi thì hoàn tác).\n\n${preview}`
    },
    'Ghi'
  );
  return pick === 'Ghi';
}

/**
 * onSaved: gọi sau khi ghi menu thành công (không phải hủy xác nhận) để nơi gọi nạp lại menu của dự án (panel MENU).
 * Không chạy ngay: màn còn đọc lại menu vừa lưu và có thể ghi tiếp (cập nhật menu trùng) — gộp các lần ghi dồn dập thành một.
 */
export function register(reg: Registry, onSaved?: (project: ProjectRecord) => void): void {
  const timers = new Map<string, NodeJS.Timeout>();
  const saved = (project: ProjectRecord): void => {
    if (!onSaved) return;
    clearTimeout(timers.get(project.code));
    timers.set(
      project.code,
      setTimeout(() => {
        timers.delete(project.code);
        onSaved(project);
      }, 2500)
    );
  };

  // Đọc: dùng kết nối dùng chung của DB Sys.
  reg.register('medit.get', (a, ctx) => withPooled(ctx, ctx.project.sysDatabase, (s) => getRow(s, normalizeKind(a.kind), String(a.id ?? ''))));

  reg.register('medit.dups', (a, ctx) => withPooled(ctx, ctx.project.sysDatabase, (s) => findDups(s, normalizeKind(a.kind), String(a.id ?? ''))));

  // Ghi: kết nối riêng + transaction; hộp xác nhận ở giữa (đọc kiểm trước, ghi sau).
  reg.register('medit.save', async (a, ctx) => {
    const r = await withDedicated(ctx, ctx.project.sysDatabase, (s) => {
      const io: SaveIO = {
        sysDb: ctx.project.sysDatabase,
        confirm: (lines, sql) => confirmWrite(ctx, lines, sql),
        transaction: (fn) => s.transaction(fn)
      };
      return saveMenu(
        s,
        {
          kind: normalizeKind(a.kind),
          mode: a.mode === 'New' ? 'New' : 'Edit',
          oldId: String(a.oldId ?? ''),
          values: a.values && typeof a.values === 'object' ? (a.values as Record<string, unknown>) : {},
          auto: a.auto === true
        },
        io
      );
    });
    if (!r.cancelled) saved(ctx.project);
    return r;
  });

  reg.register('medit.dupsApply', async (a, ctx) => {
    const n = await withDedicated(ctx, ctx.project.sysDatabase, (s) => {
      const io: SaveIO = {
        sysDb: ctx.project.sysDatabase,
        confirm: (lines, sql) => confirmWrite(ctx, lines, sql),
        transaction: (fn) => s.transaction(fn)
      };
      return applyDups(s, normalizeKind(a.kind), (Array.isArray(a.rows) ? a.rows : []) as unknown[][], io);
    });
    if (n > 0) saved(ctx.project);
    return n;
  });
}
