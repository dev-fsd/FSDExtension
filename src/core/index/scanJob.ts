// Một việc dò sysId cho chỉ mục — dùng chung cho luồng chính (dự phòng / test) và tiến trình con (indexWorker).
import type { CancelToken, MenuKind, MenuStructureResult } from '../types';
import type { FControllerCrypto } from '../controllers/fCrypto';
import { rootSignature, scanMenu, signatureOf } from '../controllers/menuStructure';

export interface ScanJob {
  /** Khóa trong chỉ mục (kind|sysid chữ thường). */
  k: string;
  kind: MenuKind;
  sysId: string;
  dir: string;
  /** Có cấu trúc cũ: chỉ quét lại khi chữ ký file gốc đổi. Không có: quét luôn. */
  oldSig?: string;
}

export interface ScanOut {
  k: string;
  sig: string;
  result: MenuStructureResult;
}

/** Trả undefined nếu không đổi so với cấu trúc cũ. */
export async function runScanJob(job: ScanJob, crypto?: FControllerCrypto, token?: CancelToken): Promise<ScanOut | undefined> {
  const mobile = job.kind === 'mob';
  if (job.oldSig === undefined) {
    const result = await scanMenu(job.dir, job.sysId, { mobile, crypto, token });
    return { k: job.k, sig: signatureOf(result, job.sysId, mobile), result };
  }
  const sig = await rootSignature(job.dir, job.sysId, mobile);
  if (sig === job.oldSig) return undefined;
  const result = await scanMenu(job.dir, job.sysId, { mobile, crypto, token });
  return { k: job.k, sig, result };
}
