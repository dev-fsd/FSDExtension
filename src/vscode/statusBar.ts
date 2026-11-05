// Thanh trạng thái (tùy chọn, setting fsd.statusBar): mã menu của file đang mở.
import * as vscode from 'vscode';
import type { ActiveContext } from './activeContext';

export class MenuStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
  private readonly sub: vscode.Disposable;

  constructor(private readonly ctx: ActiveContext) {
    this.item.command = 'fsd.focusMenuOfFile';
    this.sub = ctx.onDidChange(() => this.render());
    this.render();
  }

  render(): void {
    const sel = this.ctx.state.selected;
    const enabled = vscode.workspace.getConfiguration('fsd').get<boolean>('statusBar', false);
    if (!enabled || !sel) {
      this.item.hide();
      return;
    }
    this.item.text = `$(list-tree) ${sel.menuId}`;
    const md = new vscode.MarkdownString();
    md.appendText(`${sel.bar || sel.menuId} · sysid ${sel.sysId}`);
    this.item.tooltip = md;
    this.item.show();
  }

  dispose(): void {
    this.sub.dispose();
    this.item.dispose();
  }
}
