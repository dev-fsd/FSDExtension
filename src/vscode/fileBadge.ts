// Badge D / G / F / R / L trên tab (và Explorer) cho file controller thuộc chỉ mục của dự án đang chọn (BA 6.4).
// Phụ thuộc setting workbench.editor.decorations.badges; badge dùng chung chỗ với badge Git.
import * as vscode from 'vscode';
import type { MenuFileRole } from '../core/types';
import type { ActiveContext } from './activeContext';

interface Badge {
  letter: string;
  tip: string;
  color: string;
}

const BADGES: Partial<Record<MenuFileRole, Badge>> = {
  dir: { letter: 'D', tip: 'Dir', color: 'charts.blue' },
  grid: { letter: 'G', tip: 'Grid', color: 'charts.green' },
  filter: { letter: 'F', tip: 'Filter', color: 'charts.yellow' },
  report: { letter: 'R', tip: 'Report', color: 'charts.red' },
  dashboard: { letter: 'R', tip: 'Dashboards', color: 'charts.red' },
  lookup: { letter: 'L', tip: 'Lookup', color: 'charts.purple' }
};

export class FileBadgeProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<undefined>();
  readonly onDidChangeFileDecorations = this.emitter.event;
  private readonly reg: vscode.Disposable;
  private readonly sub: vscode.Disposable;
  /** Dấu hiệu lần vẽ trước: đổi dự án hoặc chỉ mục đổi thì báo VS Code hỏi lại toàn bộ. */
  private lastSig = '';

  constructor(private readonly ctx: ActiveContext) {
    this.reg = vscode.window.registerFileDecorationProvider(this);
    this.sub = ctx.onDidChange(() => this.refresh());
    this.refresh();
  }

  private signature(): string {
    const st = this.ctx.state;
    return `${st.project?.code ?? ''}|${st.session?.index?.version ?? 0}`;
  }

  /** ctx.onDidChange bắn rất dày (mỗi lần đổi tab): chỉ báo đổi khi dự án hoặc chỉ mục thật sự đổi. */
  private refresh(): void {
    const sig = this.signature();
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.emitter.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== 'file') return undefined;
    const role = this.ctx.state.session?.index?.roleOfFile(uri.fsPath);
    const b = role ? BADGES[role] : undefined;
    return b ? new vscode.FileDecoration(b.letter, b.tip, new vscode.ThemeColor(b.color)) : undefined;
  }

  dispose(): void {
    this.sub.dispose();
    this.reg.dispose();
    this.emitter.dispose();
  }
}
