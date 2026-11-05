// Lệnh query.* của màn Query (QueryService.vb của 5.2): chạy SQL nhiều batch, tiến độ, hủy.
// Khác 5.2 có chủ ý: câu có lệnh ghi hỏi xác nhận (modal) trước khi chạy.
import * as vscode from 'vscode';
import { BatchRunner, type QueryResult52 } from '../../core/sql/queryRunner';
import { detectWrites } from '../../core/sql/sqlText';
import type { CallCtx, Registry } from '../bridge/types';
import { resolveDb } from './sqlHost';

interface Running {
  runner: BatchRunner;
  panelId: string;
}

const running = new Map<string, Running>();

/** Hỏi xác nhận khi câu SQL có lệnh ghi; true = được chạy. */
export async function confirmWrites(ctx: CallCtx, sql: string, dbName: string): Promise<{ ok: boolean; writes: string[] }> {
  const writes = detectWrites(sql);
  if (writes.length === 0) return { ok: true, writes };
  const pick = await vscode.window.showWarningMessage(
    `Câu SQL có ${writes.join(', ')}. Chạy trên dự án ${ctx.project.code}, DB ${dbName}?`,
    { modal: true, detail: 'Lệnh ghi chạy thẳng lên DB, không hoàn tác được.' },
    'Chạy'
  );
  return { ok: pick === 'Chạy', writes };
}

/**
 * Chạy SQL của một tab. confirm = true: câu có lệnh ghi phải được xác nhận; không xác nhận → không chạy,
 * trả kết quả rỗng kèm thông báo.
 */
export async function executeQuery(
  ctx: CallCtx,
  a: { db?: unknown; sql: string; runId?: string; confirm: boolean }
): Promise<QueryResult52> {
  const dbName = await resolveDb(ctx, a.db);
  const sql = String(a.sql ?? '');
  if (a.confirm) {
    const c = await confirmWrites(ctx, sql, dbName);
    if (!c.ok) {
      return {
        sets: [],
        messages: [{ kind: 'info', text: `Chưa chạy: bạn không xác nhận lệnh ${c.writes.join(', ')}.` }],
        ms: 0,
        cancelled: false,
        db: dbName,
        batches: 0
      };
    }
  }
  const runId = a.runId && a.runId !== '' ? a.runId : `r${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const runner = new BatchRunner(await ctx.session.queryConfig(dbName), dbName);
  running.set(runId, { runner, panelId: ctx.panelId });
  try {
    return await runner.run(sql, { onProgress: (table, rows) => ctx.emit('query.progress', { runId, table, rows }) });
  } finally {
    running.delete(runId);
  }
}

/** Hủy theo runId; không có runId thì hủy mọi lần chạy của tab. */
export function cancelQuery(ctx: CallCtx, runId: unknown): void {
  if (typeof runId === 'string' && runId !== '') {
    running.get(runId)?.runner.cancel();
    return;
  }
  for (const r of running.values()) {
    if (r.panelId === ctx.panelId) r.runner.cancel();
  }
}

export function register(reg: Registry): void {
  // confirmed = true: màn gọi đã tự hỏi người dùng (vd Edit Column của Select Table) → không hỏi lần hai.
  reg.register('query.run', (a, ctx) => executeQuery(ctx, { db: a.db, sql: a.sql, runId: a.runId, confirm: a.confirmed !== true }));
  reg.register('query.cancel', (a, ctx) => {
    cancelQuery(ctx, a.runId);
    return null;
  });
}
