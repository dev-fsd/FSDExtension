// Memory Temp (5.1 / 5.2): chuỗi tạm theo dự án. memory.add nối text + GO, memory.get đọc, memory.clear xóa.
// Lưu ở globalState (theo dự án) nên còn sau khi mở lại IDE; chưa có context thì giữ trong bộ nhớ.
import type * as vscode from 'vscode';
import { appendMemory } from '../../core/basket/memory';
import type { Registry } from '../bridge/types';

const KEY_PREFIX = 'fsd.memoryTemp.';
const fallback = new Map<string, string>();
let state: vscode.Memento | undefined;

const keyOf = (projectCode: string): string => KEY_PREFIX + projectCode;
const read = (code: string): string => (state ? state.get<string>(keyOf(code), '') : fallback.get(code) ?? '');
async function write(code: string, text: string): Promise<void> {
  if (state) await state.update(keyOf(code), text === '' ? undefined : text);
  else fallback.set(code, text);
}

/** Nội dung Memory Temp của dự án (cho lệnh VS Code nếu cần xem). */
export function getMemoryText(projectCode: string): string {
  return read(projectCode);
}

export function register(reg: Registry, context?: vscode.ExtensionContext): void {
  if (context) state = context.globalState;

  // { text } → nối vào cuối (+ GO). Text trống thì giữ nguyên.
  reg.register('memory.add', async (args, ctx) => {
    const text = appendMemory(read(ctx.project.code), args.text == null ? '' : String(args.text));
    await write(ctx.project.code, text);
    return { text };
  });
  reg.register('memory.get', (_args, ctx) => ({ text: read(ctx.project.code) }));
  reg.register('memory.clear', async (_args, ctx) => {
    await write(ctx.project.code, '');
    return { text: '' };
  });
}
