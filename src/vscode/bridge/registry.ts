// Bảng lệnh webview → extension: Map tên lệnh → handler; dispatch trả { ok, result } hoặc { ok:false, error } (không ném lỗi ra ngoài).
import type { Logger } from '../log';
import type { CallCtx, Handler, Registry } from './types';

/** Lệnh chậm hơn mức này thì ghi log [perf] (xem BA 8b). */
const SLOW_MS = 500;

export type DispatchResult = { ok: true; result: unknown } | { ok: false; error: string };

export class CommandRegistry implements Registry {
  private readonly handlers = new Map<string, Handler>();

  constructor(private readonly log?: Logger) {}

  /** Đăng ký lệnh; đăng ký lại cùng tên thì lệnh sau thay lệnh trước (có ghi log). */
  register(cmd: string, handler: Handler): void {
    if (this.handlers.has(cmd)) this.log?.info(`Lệnh bridge "${cmd}" được đăng ký lại — dùng bản sau`);
    this.handlers.set(cmd, handler);
  }

  has(cmd: string): boolean {
    return this.handlers.has(cmd);
  }

  commands(): string[] {
    return [...this.handlers.keys()].sort();
  }

  async dispatch(cmd: string, args: Record<string, any> | undefined, ctx: CallCtx): Promise<DispatchResult> {
    const handler = this.handlers.get(cmd);
    if (!handler) {
      this.log?.error(`Lệnh bridge chưa có: ${cmd}`);
      return { ok: false, error: `Lệnh chưa hỗ trợ: ${cmd}` };
    }
    const t0 = Date.now();
    try {
      const result = await handler(args && typeof args === 'object' ? args : {}, ctx);
      const ms = Date.now() - t0;
      if (ms >= SLOW_MS) this.log?.info(`[perf] ${cmd} ${ms} ms`);
      return { ok: true, result: result === undefined ? null : result };
    } catch (e) {
      this.log?.error(`Lệnh bridge ${cmd} lỗi`, e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
