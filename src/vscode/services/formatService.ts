// Lệnh format.text của màn Query (FormatService.FormatText của 5.2). report.writeSchema thuộc gói G.
import { formatText } from '../../core/sql/format';
import type { Registry } from '../bridge/types';

export function register(reg: Registry): void {
  reg.register('format.text', (a) => formatText(String(a.mode ?? ''), String(a.text ?? '')));
}
