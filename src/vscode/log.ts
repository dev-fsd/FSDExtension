// Output channel "FSD Menu". Chỉ ghi thông điệp, không ghi mật khẩu / key.
import * as vscode from 'vscode';

export class Logger {
  private readonly channel = vscode.window.createOutputChannel('FSD Menu');

  info(msg: string): void {
    this.channel.appendLine(`[${new Date().toLocaleTimeString()}] ${msg}`);
  }

  error(msg: string, err?: unknown): void {
    const detail = err instanceof Error ? err.message : err ? String(err) : '';
    this.channel.appendLine(`[${new Date().toLocaleTimeString()}] LỖI ${msg}${detail ? ': ' + detail : ''}`);
  }

  /** Báo lỗi cho người dùng, kèm nút mở Output. */
  notifyError(msg: string): void {
    void vscode.window.showErrorMessage(msg, 'Xem log').then((c) => {
      if (c === 'Xem log') this.show();
    });
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }
}
