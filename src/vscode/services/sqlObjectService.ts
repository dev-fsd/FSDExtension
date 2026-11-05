// Lệnh sql.* (SqlObjectService.vb của 5.2): danh sách đối tượng (cache theo DB), cột, định nghĩa, tìm, script.
import { customGenScript, getDefinition, listColumns, listModifiedObjects, listObjects, objectScript, searchObjects, splitObjectNames, type ObjectRow } from '../../core/sql/sqlObjects';
import type { Registry } from '../bridge/types';
import { scripts, withDedicated, withPooled } from './sqlHost';

/** Danh sách đối tượng theo (dự án, DB) trong phiên; refresh = đọc lại. */
const objectCache = new Map<string, ObjectRow[]>();

export function register(reg: Registry): void {
  reg.register('sql.objects', async (a, ctx) =>
    withPooled(ctx, a.db, async (s, db) => {
      const key = `${ctx.project.code}|${db.toLowerCase()}`;
      const hit = objectCache.get(key);
      if (hit && a.refresh !== true) return hit;
      const list = await listObjects(s);
      objectCache.set(key, list);
      return list;
    })
  );
  // 5.1 "Filter Object Customize By Date" (from / to dạng yyyyMMdd) và "Get All Object Customize" (all = true).
  reg.register('sql.objectsModified', (a, ctx) =>
    withPooled(ctx, a.db, async (s, db) => {
      const key = `${ctx.project.code}|${db.toLowerCase()}`;
      let known = objectCache.get(key);
      if (!known) {
        known = await listObjects(s);
        objectCache.set(key, known);
      }
      return listModifiedObjects(s, scripts(), a.all === true ? 'all' : { from: String(a.from ?? ''), to: String(a.to ?? '') }, known);
    })
  );
  reg.register('sql.columns', (a, ctx) => withPooled(ctx, a.db, (s) => listColumns(s, String(a.name ?? ''))));
  reg.register('sql.definition', (a, ctx) => withPooled(ctx, a.db, (s, db) => getDefinition(s, String(a.name ?? ''), db)));
  reg.register('sql.search', (a, ctx) => withPooled(ctx, a.db, (s) => searchObjects(s, String(a.mode ?? ''), String(a.text ?? ''))));
  reg.register('sql.script', (a, ctx) =>
    withDedicated(ctx, a.db, (s) => objectScript(s, scripts(), String(a.name ?? ''), { alter: a.alter === true, quotedOff: a.quotedOff === true }))
  );
  // 5.1 Custom Gen: names = văn bản tên (xuống dòng / dấu phẩy); một kết nối cho cả danh sách.
  reg.register('sql.scripts', (a, ctx) =>
    withDedicated(ctx, a.db, (s) => customGenScript(s, scripts(), splitObjectNames(String(a.names ?? '')), a.alter === true))
  );
}
