// Các thành phần chạy khi đã có key hợp lệ.
import type * as vscode from 'vscode';
import type { ActiveContext } from './activeContext';
import type { Logger } from './log';
import type { MenuViewProvider } from './menuView';
import type { ProjectRegistry } from './projects';
import type { SessionManager } from './projectSession';

export interface App {
  context: vscode.ExtensionContext;
  log: Logger;
  registry: ProjectRegistry;
  sessions: SessionManager;
  ctx: ActiveContext;
  view: MenuViewProvider;
}
