// Dựng markdown "menu cho AI" (lệnh Copy menu cho AI). Hàm thuần: không dùng vscode để test được bằng node:test.
import type { MenuItem, MenuRef, MenuStructureResult } from './types';
// util.ts chỉ import kiểu, không phụ thuộc vscode nên dùng chung được (nhóm vai trò + nhãn nhóm như view).
import { groupLabel, roleGroups } from '../vscode/util';

export interface AiContextInput {
  project: { code: string; name: string };
  ref: Pick<MenuRef, 'kind' | 'menuId' | 'sysId' | 'bar'>;
  /** Dòng menu gốc (lấy link / loại); có thể không có. */
  item?: Pick<MenuItem, 'link' | 'type'>;
  structure: MenuStructureResult;
}

export function buildAiContext(input: AiContextInput): string {
  const { project, ref, item, structure: res } = input;
  const lines: string[] = [
    `# Menu ${ref.bar} (${ref.kind === 'mob' ? 'Mobile' : 'FBO'})`,
    '',
    `- Dự án: ${project.code} — ${project.name}`,
    `- Menu id: ${ref.menuId}`,
    `- sysid: ${ref.sysId}`
  ];
  if (item?.link) lines.push(`- Link: ${item.link}`);
  if (item?.type) lines.push(`- Loại: ${item.type}`);
  for (const g of roleGroups) {
    const fs = res.files.filter((f) => g.roles.includes(f.role) && !f.missing);
    if (!fs.length) continue;
    lines.push('', `## ${groupLabel(g, ref.kind)}`, ...fs.map((f) => `- ${f.path}`));
  }
  const missing = res.files.filter((f) => f.missing);
  if (missing.length) lines.push('', '## Khai báo nhưng thiếu file', ...missing.map((f) => `- ${f.path}`));
  if (res.tables.length) lines.push('', '## Bảng', ...res.tables.map((x) => `- ${x}`));
  if (res.stores.length) lines.push('', '## Store', ...res.stores.map((x) => `- ${x}`));
  return lines.join('\n') + '\n';
}
