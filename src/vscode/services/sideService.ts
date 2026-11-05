// Lệnh bridge để tab Update / Multi Search nói chuyện với view "Cây màn" ở sidebar trái (sideTreeView.ts):
//   side.send { screen, event, data } — tab → view (vd 'menu' = menu mở kèm tab, 'checkVoucher'); view chưa mở thì giữ tin 'menu' chờ.
//   side.get  { screen }              — tab đọc thư mục chương trình view đang chọn ({ program, mode } | null); thay đổi sau đó tới qua sự kiện side.program.
// Chiều view → tab đi bằng ScreenHost.emit (sự kiện ms.view, ms.find, ms.cmd, side.program…) từ sideTreeView.ts.
import * as vscode from 'vscode';
import { isSideScreen, SideShare, type SideScreen } from '../../core/side/sideMode';
import type { Registry } from '../bridge/types';

/** Kho chia sẻ dùng chung (sideTreeView.ts ghi thư mục chương trình, lấy tin chờ). */
export const sideShare = new SideShare();

/** Nơi nhận tin tab → view; trả true nếu view đang mở và đã nhận. */
export type SideSink = (project: string, screen: SideScreen, event: string, data: unknown) => boolean;
let sink: SideSink | undefined;

export function setSideSink(fn: SideSink | undefined): void {
  sink = fn;
}

const str = (v: unknown): string => (v == null ? '' : String(v));

export function register(reg: Registry): void {
  reg.register('side.send', (a, ctx) => {
    const screen = str(a.screen);
    if (!isSideScreen(screen)) throw new Error(`Màn không hợp lệ: ${screen}`);
    const event = str(a.event);
    if (event === '') throw new Error('Thiếu tên sự kiện.');
    const delivered = sink ? sink(ctx.project.code, screen, event, a.data) : false;
    if (!delivered) sideShare.hold(ctx.project.code, screen, event, a.data);
    return { delivered };
  });

  // Nút ở thanh của tab: đưa focus về view "Cây màn" (mở sidebar nếu đang ẩn).
  reg.register('side.focus', async () => {
    await vscode.commands.executeCommand('fsd.screenTree.focus');
    return null;
  });

  reg.register('side.get', (a, ctx) => {
    const screen = str(a.screen);
    if (!isSideScreen(screen)) throw new Error(`Màn không hợp lệ: ${screen}`);
    return sideShare.getProgram(ctx.project.code, screen) ?? null;
  });
}
