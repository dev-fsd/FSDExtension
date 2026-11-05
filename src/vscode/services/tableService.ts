// Lệnh table.* của màn Select Table (TableService.vb của 5.2): cột, SELECT, lưu lưới, script cột / dữ liệu / bảng log.
// Lưới ghi thẳng vào DB như 5.1 (table.save: UPDATE / INSERT / DELETE theo khóa chính, một transaction).
import {
  FileSink,
  alterNullScript,
  buildSelectSql,
  columnScript,
  dataScript,
  dataScriptToSink,
  existingLogTables,
  logInfo,
  logReorderScript,
  rowsScript,
  runSave,
  saveStatements,
  tableInfo,
  type SaveArgs
} from '../../core/sql/tableOps';
import * as fs from 'fs';
import type { Registry } from '../bridge/types';
import { executeQuery } from './queryService';
import { scripts, withDedicated, withPooled } from './sqlHost';

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export function register(reg: Registry): void {
  reg.register('table.info', (a, ctx) => withPooled(ctx, a.db, (s) => tableInfo(s, scripts(), text(a.table))));

  // Câu SQL tự viết (where bắt đầu "\") có thể chứa lệnh ghi → hỏi xác nhận như query.run; câu SELECT thường không hỏi.
  reg.register('table.select', async (a, ctx) => {
    const sql = buildSelectSql(scripts(), {
      fields: text(a.fields),
      table: text(a.table),
      where: text(a.where),
      partition: a.partition === true,
      dfrom: text(a.dfrom),
      dto: text(a.dto)
    });
    const raw = text(a.where).trim().startsWith('\\');
    const result = await executeQuery(ctx, { db: a.db, sql, runId: a.runId, confirm: raw });
    return { sql, result };
  });

  reg.register('table.columnScript', (a, ctx) =>
    withDedicated(ctx, a.db, async (s) => {
      const table = text(a.table).trim();
      const partition = a.partition === true;
      const logs = await existingLogTables(s, table, partition);
      const cols = (Array.isArray(a.columns) ? a.columns : []) as Array<{ name: string; type: string }>;
      return columnScript(scripts(), text(a.kind), table, partition, cols, logs, text(a.dfrom), text(a.dto));
    })
  );

  reg.register('table.alterNull', (a) => alterNullScript(scripts(), text(a.table)));

  reg.register('table.logInfo', (a, ctx) => withDedicated(ctx, a.db, (s) => logInfo(s, text(a.table).trim(), a.partition === true)));

  reg.register('table.logScript', (a, ctx) =>
    withDedicated(ctx, a.db, (s) =>
      logReorderScript(s, {
        table: text(a.table).trim(),
        partition: a.partition === true,
        only: Array.isArray(a.only) ? (a.only as unknown[]).map(String) : undefined,
        direct: a.direct === true
      })
    )
  );

  reg.register('table.dataScript', (a, ctx) => withDedicated(ctx, a.db, (s) => dataScript(s, text(a.table).trim(), text(a.where))));

  reg.register('table.dataScriptFile', (a, ctx) =>
    withDedicated(ctx, a.db, async (s) => {
      const path = text(a.path);
      const sink = new FileSink(path);
      try {
        await dataScriptToSink(s, text(a.table).trim(), text(a.where), sink);
      } finally {
        sink.close();
      }
      return 'Đã ghi ' + path;
    })
  );

  reg.register('table.rowsScript', (a, ctx) =>
    withDedicated(ctx, a.db, async (s) => {
      const out = await rowsScript(s, {
        table: text(a.table),
        where: text(a.where),
        columns: (a.columns ?? []) as Array<{ name: string; clr: string }>,
        rows: (a.rows ?? []) as unknown[][]
      });
      const path = text(a.path);
      if (path === '') return out;
      fs.writeFileSync(path, '﻿' + out, 'utf8');
      return 'Đã ghi ' + path;
    })
  );

  // Lưu sửa đổi trên lưới: 1 transaction; UPDATE / DELETE không trúng dòng nào → hoàn tác cả lần lưu và báo lỗi.
  reg.register('table.save', async (a, ctx) => {
    const statements = saveStatements({
      table: text(a.table),
      pk: (a.pk ?? []) as string[],
      columns: (a.columns ?? []) as SaveArgs['columns'],
      deleted: (a.deleted ?? []) as unknown[][],
      updated: (a.updated ?? []) as SaveArgs['updated'],
      added: (a.added ?? []) as unknown[][]
    });
    if (statements.length === 0) return { count: 0 };
    await withDedicated(ctx, a.db, (s) => s.transaction(() => runSave(statements, (sql) => s.execute(sql))));
    return { count: statements.length };
  });
}
