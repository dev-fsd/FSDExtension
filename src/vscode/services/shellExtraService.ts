// shell.deleteStructApp, shell.openVoucher — lệnh vỏ phụ của Select Table (port ShellService 5.2).
import { deleteFilesIn, structAppDirs } from '../../core/basket/shellHelpers';
import type { Registry } from '../bridge/types';

export function register(reg: Registry): void {
  // Sau khi đổi cột: xóa cache cấu trúc <web_source>\App_Data\Controllers\Structure\App và <webprogram_dir>\… (chỉ FILE ngay trong thư mục đó).
  reg.register('shell.deleteStructApp', (_args, ctx) => {
    const { deleted, failed } = deleteFilesIn(structAppDirs(ctx.project));
    if (failed.length > 0) {
      throw new Error(`Đã xóa ${deleted.length} file cache Structure\\App, còn ${failed.length} file không xóa được: ${failed.map((f) => f.file + ' (' + f.error + ')').join('; ')}`);
    }
    return `Đã xóa ${deleted.length} file cache Structure\\App.`;
  });

  // { sttRec, maCt } — chỉ dự án FB (voucherinfo.cexe). Dự án FBO / Mobile mở chứng từ trên web, không có chương trình này.
  reg.register('shell.openVoucher', (args, ctx) => {
    if (args.sttRec == null || String(args.sttRec).trim() === '') return '';
    if ((ctx.project.menuType || '2') === '2') {
      throw new Error('"Mở chứng từ" chỉ dùng cho dự án FB (chạy voucherinfo.cexe); dự án FBO / Mobile không có chương trình này.');
    }
    throw new Error('Dự án FB: extension chưa đọc được thư mục chương trình FB (fbprogram_dir) nên chưa mở được chứng từ — dùng FSD Studio.');
  });
}
