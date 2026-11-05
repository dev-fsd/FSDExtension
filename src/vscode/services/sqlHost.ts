// Phần dùng chung của các service SQL (query / sqlObject / table): chọn DB, kết nối, script system.db.
import * as fs from 'fs';
import * as path from 'path';
import { ScriptStore } from '../../core/sql/scriptStore';
import { SqlSession } from '../../core/sql/sqlSession';
import type { CallCtx } from '../bridge/types';

let store: ScriptStore | undefined;

/** Script xuất từ system.db 5.2 (resources/scripts); dist/extension.js nằm cạnh thư mục resources. */
export function scripts(): ScriptStore {
  if (!store) {
    const candidates = [path.join(__dirname, '..', 'resources', 'scripts'), path.join(__dirname, '..', '..', '..', 'resources', 'scripts')];
    const dir = candidates.find((d) => fs.existsSync(path.join(d, 'GETFULLCOL.sql'))) ?? candidates[0];
    store = new ScriptStore(dir);
  }
  return store;
}

/** Tên DB: trống → DB App đầu tiên của dự án (như 5.2 AppDatabase), không có thì DB Sys. */
export async function resolveDb(ctx: CallCtx, db: unknown): Promise<string> {
  const name = typeof db === 'string' ? db.trim() : '';
  if (name !== '') return name;
  const apps = await ctx.session.appDatabases();
  return apps[0] ?? ctx.project.sysDatabase;
}

interface Pooled {
  session: SqlSession;
  timer: NodeJS.Timeout;
}

const pool = new Map<string, Pooled>();
const POOL_IDLE_MS = 30_000;

/**
 * Chạy fn trên kết nối dùng chung theo (dự án, DB) cho các lệnh đọc nhẹ (danh sách đối tượng, cột, định nghĩa…);
 * kết nối nhàn rỗi 30 giây thì đóng. Lệnh nặng / ghi dùng withDedicated.
 */
export async function withPooled<T>(ctx: CallCtx, db: unknown, fn: (s: SqlSession, dbName: string) => Promise<T>): Promise<T> {
  const dbName = await resolveDb(ctx, db);
  const key = `${ctx.project.code}|${dbName.toLowerCase()}`;
  let entry = pool.get(key);
  if (!entry || !entry.session.alive) {
    if (entry) clearTimeout(entry.timer);
    const session = await SqlSession.open(await ctx.session.queryConfig(dbName));
    entry = { session, timer: setTimeout(() => undefined, 0) };
    pool.set(key, entry);
  }
  clearTimeout(entry.timer);
  const e = entry;
  e.timer = setTimeout(() => {
    if (pool.get(key) === e) pool.delete(key);
    void e.session.close();
  }, POOL_IDLE_MS);
  e.timer.unref();
  try {
    return await fn(e.session, dbName);
  } catch (err) {
    if (!e.session.alive && pool.get(key) === e) pool.delete(key);
    throw err;
  }
}

/** Chạy fn trên một kết nối riêng (mở rồi đóng) — lệnh nặng, ghi, transaction. */
export async function withDedicated<T>(ctx: CallCtx, db: unknown, fn: (s: SqlSession, dbName: string) => Promise<T>): Promise<T> {
  const dbName = await resolveDb(ctx, db);
  const session = await SqlSession.open(await ctx.session.queryConfig(dbName));
  try {
    return await fn(session, dbName);
  } finally {
    await session.close();
  }
}

/** Đóng mọi kết nối dùng chung (khi tắt extension). */
export async function closePool(): Promise<void> {
  const all = [...pool.values()];
  pool.clear();
  for (const p of all) clearTimeout(p.timer);
  await Promise.all(all.map((p) => p.session.close()));
}
