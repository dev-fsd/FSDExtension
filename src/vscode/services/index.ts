// Danh sách service đăng ký lệnh bridge cho màn webview. Mỗi service export register(reg, ...).
// setup.ts gọi lần lượt từng hàm dưới đây.
import type { App } from '../app';
import type { Registry } from '../bridge/types';
import { register as formatService } from './formatService';
import { register as gridService } from './gridService';
import { register as memoryService } from './memoryService';
import { register as menuEditService } from './menuEditService';
import { register as pluginService } from './pluginService';
import { register as queryService } from './queryService';
import { register as reportService } from './reportService';
import { register as searchService } from './searchService';
import { register as shellBasics } from './shellBasics';
import { register as shellExtraService } from './shellExtraService';
import { register as sqlObjectService } from './sqlObjectService';
import { register as tableService } from './tableService';
import { register as updService } from './updService';

export type ServiceRegister = (reg: Registry, app: App) => void;

export const serviceRegisters: ServiceRegister[] = [
  shellBasics,
  (reg) => queryService(reg),
  (reg) => sqlObjectService(reg),
  (reg) => tableService(reg),
  (reg) => formatService(reg),
  (reg, app) => updService(reg, app.context),
  (reg, app) => memoryService(reg, app.context),
  (reg) => reportService(reg),
  (reg) => gridService(reg),
  (reg) => pluginService(reg),
  (reg) => shellExtraService(reg),
  (reg) => searchService(reg),
  // Sửa menu xong: quét lại menu của dự án để panel MENU thấy menu mới / đổi tên.
  (reg, app) => menuEditService(reg, (project) => {
    void app.sessions.get(project).rebuild().then(() => app.ctx.recompute()).catch((e) => app.log.error('Nạp lại menu sau khi sửa lỗi', e));
  })
];
