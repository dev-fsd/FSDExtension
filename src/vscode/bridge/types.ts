import type { ProjectRecord } from '../../core/types';
import type { ProjectSession } from '../projectSession';
export interface CallCtx {
  project: ProjectRecord;            // dự án của tab gọi lệnh
  session: ProjectSession;           // đã start()
  emit(event: string, data: unknown): void;   // đẩy sự kiện về đúng tab gọi (vd query.progress)
  panelId: string;                   // id tab, dùng cho query.cancel
}
export type Handler = (args: Record<string, any>, ctx: CallCtx) => Promise<unknown> | unknown;
export interface Registry { register(cmd: string, handler: Handler): void; }
