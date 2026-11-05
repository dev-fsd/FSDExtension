// CodeLens dòng 0 của file .xml / .f trong controllersDir: tên menu.
import * as vscode from 'vscode';
import { matchProjectByPath } from '../core/projects/projectStore';
import type { App } from './app';
import { fileKey } from './util';

export class MenuCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;

  constructor(private readonly app: App) {
    app.sessions.onDidChange(() => this.emitter.fire());
  }

  refresh(): void {
    this.emitter.fire();
  }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (!vscode.workspace.getConfiguration('fsd').get<boolean>('codeLens', true)) return [];
    const p = doc.uri.fsPath;
    if (!/\.(xml|f)$/i.test(p)) return [];
    const match = matchProjectByPath(this.app.registry.projects(), p);
    if (!match || !p.toLowerCase().startsWith(match.controllersDir.toLowerCase())) return [];
    const session = this.app.sessions.get(match.project);
    void session.start();
    const index = session.index;
    if (!index) return [];
    const refs = index.menusOfFile(p);
    if (refs.length === 0) return [];

    const range = new vscode.Range(0, 0, 0, 0);
    const name = (r: (typeof refs)[number]): string => r.bar || r.menuId;
    const title = `$(list-tree) ${name(refs[0])}${refs.length > 1 ? ` +${refs.length - 1}` : ''}`;
    const tooltip = refs.map((r) => `${r.menuId} ${r.bar}`.trim()).join('\n');
    // Bấm = chọn menu đó trong panel (menu đang chọn nếu file thuộc nó, không thì menu đầu).
    const selected = this.app.ctx.state.selected;
    const pick = refs.find((r) => selected && r.kind === selected.kind && r.menuId === selected.menuId) ?? refs[0];
    const lenses = [new vscode.CodeLens(range, { title, command: 'fsd.focusMenuOfFile', arguments: [pick], tooltip })];

    const key = fileKey(p);
    const stale = refs.some((r) => index.structureOf(r.kind, r.sysId)?.files.some((f) => fileKey(f.path) === key && f.staleF));
    if (stale) lenses.push(new vscode.CodeLens(range, { title: '$(warning) .f cũ', command: 'fsd.focusMenuOfFile', arguments: [pick], tooltip: '.f cũ hơn .xml — chưa sinh lại' }));
    return lenses;
  }
}
