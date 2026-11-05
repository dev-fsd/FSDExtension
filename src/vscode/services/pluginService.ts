// plugin.profiler: chạy <fsd.studioDir>\Plugin\FSDProfiler.exe theo dõi SQL của DB dự án (như 5.2 PluginService).
// Mỗi DB một tiến trình; đang chạy thì không mở thêm.
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { profilerArgs, profilerDbName } from '../../core/basket/shellHelpers';
import { studioDir } from '../projects';
import type { Registry } from '../bridge/types';

const running = new Map<string, ChildProcess>();

export function register(reg: Registry): void {
  // Trả câu báo cho toast; thiếu exe thì ném lỗi.
  reg.register('plugin.profiler', async (_args, ctx) => {
    const db = profilerDbName(ctx.project.sysDatabase);
    const key = db.toLowerCase();
    const cur = running.get(key);
    if (cur && cur.exitCode === null && cur.signalCode === null) return 'FSDProfiler đang chạy cho ' + db;

    const dir = path.join(studioDir(), 'Plugin');
    const exe = path.join(dir, 'FSDProfiler.exe');
    if (!fs.existsSync(exe)) throw new Error('Không tìm thấy ' + exe);

    const password = (await ctx.session.queryConfig(ctx.project.sysDatabase)).password;
    // Không cho FSDProfiler kế thừa CLR profiler của tiến trình cha.
    const env: NodeJS.ProcessEnv = { ...process.env, COR_ENABLE_PROFILING: '0' };
    delete env.COR_PROFILER;
    delete env.COR_PROFILER_PATH;

    const child = spawn(exe, profilerArgs(ctx.project, password, db), { cwd: dir, env, detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', () => running.delete(key));
    child.on('exit', () => {
      if (running.get(key) === child) running.delete(key);
    });
    child.unref();
    running.set(key, child);
    return 'Đã chạy FSDProfiler cho ' + db;
  });
}
