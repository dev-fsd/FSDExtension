// Thử tích hợp: đọc menu FBO / Mobile từ DB Sys (chỉ SELECT).
// Build trước: npx tsc -p tsconfig.test.json ; chạy: node scripts/try-menus.mjs
// Biến môi trường: FSD_SQL_SERVER, FSD_SQL_USER, FSD_SQL_PASSWORD, FSD_SQL_DB
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { FSD_SQL_SERVER: server, FSD_SQL_USER: user, FSD_SQL_PASSWORD: password, FSD_SQL_DB: database } = process.env;

if (!server || !user || password === undefined || !database) {
  console.log('Cách dùng (PowerShell):');
  console.log('  npx tsc -p tsconfig.test.json');
  console.log('  $env:FSD_SQL_SERVER="host\\inst"; $env:FSD_SQL_USER="sa"; $env:FSD_SQL_PASSWORD="..."; $env:FSD_SQL_DB="<DB Sys>"');
  console.log('  node scripts/try-menus.mjs');
  process.exit(1);
}

const { SqlClient } = require(path.join(root, 'out-test/src/core/sql/sqlClient.js'));
const { loadMenus, buildTree, hasMobile } = require(path.join(root, 'out-test/src/core/sql/menuRepo.js'));
const scriptsDir = path.join(root, 'resources', 'scripts');

const client = new SqlClient({ server, user, password, database });
try {
  for (const kind of ['fbo', 'mob']) {
    const items = await loadMenus(client, kind, scriptsDir);
    const tree = buildTree(items);
    console.log(`${kind === 'fbo' ? 'FBO' : 'Mobile'}: ${items.length} dòng, ${tree.length} nút gốc`);
    for (const it of items.slice(0, 5)) console.log(`  ${it.id} | cha=${it.parentId} | ${it.bar} | sysid=${it.sysId} | type=${it.type}`);
  }
  console.log('Có dvcommand:', await hasMobile(client));
} catch (e) {
  console.error('Lỗi:', e.message);
  process.exitCode = 1;
} finally {
  await client.close();
}
