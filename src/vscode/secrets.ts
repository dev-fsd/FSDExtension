// Mật khẩu dự án cất trong SecretStorage của VS Code, khóa fsd.pw.<mã>. Không bao giờ ghi log.
import * as vscode from 'vscode';

const prefix = 'fsd.pw.';

export class ProjectSecrets {
  constructor(private readonly storage: vscode.SecretStorage) {}

  get(code: string): Thenable<string | undefined> {
    return this.storage.get(prefix + code);
  }

  set(code: string, password: string): Thenable<void> {
    return this.storage.store(prefix + code, password);
  }
}
