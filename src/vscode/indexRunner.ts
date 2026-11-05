// Chạy việc dò chỉ mục trong tiến trình con (dist/indexWorker.js) với 64 luồng đọc file.
import { fork } from 'node:child_process';
import * as path from 'node:path';
import type { CancelToken } from '../core/types';
import type { ScanJob, ScanOut } from '../core/index/scanJob';

export type ScanJobsRunner = (jobs: ScanJob[], apply: (o: ScanOut) => void, progress: (n: number) => void, token?: CancelToken) => Promise<void>;

export function makeIndexRunner(extensionPath: string, keyFile: string): ScanJobsRunner {
  return (jobs, apply, progress, token) =>
    new Promise<void>((resolve, reject) => {
      if (jobs.length === 0) return resolve();
      const child = fork(path.join(extensionPath, 'dist', 'indexWorker.js'), [], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', UV_THREADPOOL_SIZE: '64' },
        silent: true
      });
      let settled = false;
      const end = (err?: Error): void => {
        if (settled) return;
        settled = true;
        clearInterval(poll);
        try {
          child.kill();
        } catch {
          /* đã thoát */
        }
        if (err) reject(err);
        else resolve();
      };
      const poll = setInterval(() => {
        if (token?.isCancellationRequested) {
          try {
            child.send({ t: 'cancel' });
          } catch {
            /* bỏ qua */
          }
          end();
        }
      }, 500);
      child.on('message', (m: { t: string; out?: ScanOut[]; finished?: number }) => {
        if (m.t === 'r') {
          for (const o of m.out ?? []) apply(o);
          progress(m.finished ?? 0);
        } else if (m.t === 'done') end();
      });
      child.on('error', (e) => end(e));
      child.on('exit', (code) => end(code === 0 || code === null ? new Error('Tiến trình dò chỉ mục thoát sớm') : new Error(`Tiến trình dò chỉ mục lỗi (${code})`)));
      child.send({ t: 'start', jobs, keyFile, parallel: 64 });
    });
}
