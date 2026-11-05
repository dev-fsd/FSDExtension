// Tiến trình con dựng chỉ mục: đọc file controller bằng nhiều luồng (UV_THREADPOOL_SIZE do bên gọi đặt),
// tách khỏi extension host nên không tranh luồng với các extension khác. Giao tiếp qua IPC.
import { FControllerCrypto } from '../core/controllers/fCrypto';
import { runScanJob, type ScanJob, type ScanOut } from '../core/index/scanJob';

interface StartMsg {
  t: 'start';
  jobs: ScanJob[];
  keyFile: string;
  parallel: number;
}

let cancelled = false;

process.on('message', async (m: StartMsg | { t: 'cancel' }) => {
  if (m.t === 'cancel') {
    cancelled = true;
    return;
  }
  let crypto: FControllerCrypto | undefined;
  try {
    const keys = FControllerCrypto.loadKeys(m.keyFile);
    if (keys.length > 0) crypto = new FControllerCrypto(keys);
  } catch {
    // không có khóa: đọc .xml thay .f
  }
  const token = { get isCancellationRequested() { return cancelled; } };
  let next = 0;
  let batch: ScanOut[] = [];
  let finished = 0;
  const flush = (): void => {
    process.send?.({ t: 'r', out: batch, finished });
    batch = [];
    finished = 0;
  };
  const worker = async (): Promise<void> => {
    for (;;) {
      if (cancelled) return;
      const i = next++;
      if (i >= m.jobs.length) return;
      const out = await runScanJob(m.jobs[i], crypto, token);
      if (out) batch.push(out);
      finished++;
      if (finished >= 25) flush();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, m.parallel) }, worker));
  if (finished > 0 || batch.length > 0) flush();
  process.send?.({ t: 'done' });
});
