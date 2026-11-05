// Đóng gói extension thành dist/extension.js; sql.js cần file wasm đi kèm.
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');

mkdirSync('dist', { recursive: true });
copyFileSync('node_modules/sql.js/dist/sql-wasm.wasm', 'dist/sql-wasm.wasm');

const ctx = await esbuild.context({
  entryPoints: { extension: 'src/vscode/extension.ts', indexWorker: 'src/worker/indexWorker.ts' },
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outdir: 'dist',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info'
});

if (watch) await ctx.watch();
else { await ctx.rebuild(); await ctx.dispose(); }
