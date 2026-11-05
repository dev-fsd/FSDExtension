// Khởi tạo hệ màn webview: bảng lệnh bridge + ScreenHost + khôi phục tab sau khi mở lại IDE. extension.ts chỉ gọi setupScreens(app).
import * as vscode from 'vscode';
import type { ProjectRecord } from '../../core/types';
import type { App } from '../app';
import { CommandRegistry } from '../bridge/registry';
import { serviceRegisters } from '../services';
import { closePool } from '../services/sqlHost';
import { SCREEN_VIEW_TYPE, ScreenHost, setScreenHost } from './screenHost';

/** Dự án cho lệnh ẩn: dự án đang mở của panel, không có thì chọn từ danh sách. */
async function pickProject(app: App): Promise<ProjectRecord | undefined> {
  const cur = app.ctx.state.project;
  if (cur) return cur;
  const all = app.registry.projects();
  if (all.length === 0) {
    void vscode.window.showWarningMessage('Chưa có dự án nào (FSD: Nhập dự án).');
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(all.map((p) => ({ label: p.code, description: p.name, project: p })), { title: 'Chọn dự án' });
  return pick?.project;
}

export function setupScreens(app: App): vscode.Disposable {
  const registry = new CommandRegistry(app.log);
  for (const register of serviceRegisters) {
    try {
      register(registry, app);
    } catch (e) {
      app.log.error('Đăng ký service bridge lỗi', e);
    }
  }
  const host = new ScreenHost(app, registry);
  setScreenHost(host);
  const subs: vscode.Disposable[] = [
    host,
    host.onDidChangeList(() => app.view.refresh()),
    // Tắt extension: đóng các kết nối SQL dùng chung của lệnh sql.* / table.*.
    { dispose: () => void closePool().catch(() => undefined) },
    vscode.window.registerWebviewPanelSerializer(SCREEN_VIEW_TYPE, {
      deserializeWebviewPanel: (panel, state) => host.revive(panel, state)
    }),
    // Lệnh ẩn (chưa khai trong package.json): kiểm nền webview — Monaco, lưới 1.000 dòng, hộp thoại, bridge.
    vscode.commands.registerCommand('fsd.screenDemo', async () => {
      const project = await pickProject(app);
      if (project) host.open('_demo', project, {});
    })
  ];
  return {
    dispose: () => {
      setScreenHost(undefined);
      subs.forEach((d) => d.dispose());
    }
  };
}
