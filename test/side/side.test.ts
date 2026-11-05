// View "Cây màn" ở sidebar trái (fsd.screenTree): chọn màn để hiện, lệnh được phép, kho chia sẻ view ⇄ tab (src/core/side/sideMode.ts),
// và phần thuần của giao diện (web/js/sidebar/icons.js, countText / splitTokens của ui/explorer.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isSideScreen, pickSideScreen, SIDE_CALLS, SIDE_COMMANDS, SIDE_OPS, SideShare } from '../../src/core/side/sideMode';

const extRoot = path.resolve(__dirname, '..', '..', '..');
// import() thật (không bị tsc đổi thành require) vì các file web là ES module.
const realImport = new Function('u', 'return import(u)') as (u: string) => Promise<any>;
const web = (...p: string[]) => realImport(pathToFileURL(path.join(extRoot, 'web', ...p)).href);

/** Xóa mọi lời gọi var(...) (kể cả lồng nhau) để chỉ còn giá trị màu viết thẳng. */
function stripVars(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; ) {
    if (s.startsWith('var(', i)) {
      let depth = 0;
      let j = i + 3;
      for (; j < s.length; j++) {
        if (s[j] === '(') depth++;
        else if (s[j] === ')' && --depth === 0) break;
      }
      i = j + 1;
    } else out += s[i++];
  }
  return out;
}

test('isSideScreen: chỉ Update Script và Multi Search', () => {
  assert.equal(isSideScreen('update-script'), true);
  assert.equal(isSideScreen('multi-search'), true);
  assert.equal(isSideScreen('query'), false);
  assert.equal(isSideScreen(undefined), false);
});

test('pickSideScreen: tab đang focus thuộc hai màn thì hiện cây của nó và ghi nhớ', () => {
  const r = pickSideScreen({ focusedScreen: 'multi-search', tabScreens: ['update-script', 'multi-search'], last: 'update-script', forced: '' });
  assert.deepEqual(r, { screen: 'multi-search', fromFocus: true });
});

test('pickSideScreen: focus sang tab Query thì giữ màn cuối nếu tab của nó còn', () => {
  const r = pickSideScreen({ focusedScreen: 'query', tabScreens: ['query', 'update-script'], last: 'update-script', forced: '' });
  assert.deepEqual(r, { screen: 'update-script', fromFocus: false });
});

test('pickSideScreen: màn cuối đã đóng thì lấy màn đầu tiên còn tab, không còn gì thì rỗng', () => {
  assert.equal(pickSideScreen({ tabScreens: ['multi-search', 'query'], last: 'update-script', forced: '' }).screen, 'multi-search');
  assert.equal(pickSideScreen({ tabScreens: ['query'], last: 'update-script', forced: '' }).screen, '');
  assert.equal(pickSideScreen({ tabScreens: [], last: '', forced: '' }).screen, '');
});

test('pickSideScreen: nút chuyển nhanh thắng tab đang focus, kể cả khi màn đó chưa có tab', () => {
  const r = pickSideScreen({ focusedScreen: 'update-script', tabScreens: ['update-script'], last: 'update-script', forced: 'multi-search' });
  assert.deepEqual(r, { screen: 'multi-search', fromFocus: false });
});

test('SIDE_CALLS: chỉ lệnh đọc / tìm / thêm vào Update / thao tác file; không có ghi file, chạy SQL, đóng gói', () => {
  for (const bad of ['ms.save', 'file.save', 'query.run', 'sql.run', 'upd.create', 'upd.save', 'upd.load', 'upd.clear', 'upd.deletePackage', 'upd.fileOp', 'shell.deleteStructApp']) {
    assert.equal(SIDE_CALLS.has(bad), false, bad);
  }
  for (const need of ['upd.searchFiles', 'upd.menuContext', 'upd.addExplorerFiles', 'upd.addDeclare', 'upd.addObjects', 'upd.sqlObjects', 'ms.checkVoucher', 'ms.openIde']) {
    assert.equal(SIDE_CALLS.has(need), true, need);
  }
  // Không trùng tên với thao tác riêng của view.
  for (const op of SIDE_OPS) assert.equal(SIDE_CALLS.has(op), false, op);
  for (const c of SIDE_COMMANDS) assert.match(c, /^fsd\./);
});

test('SIDE_CALLS: mọi lệnh đều có service đăng ký (không gọi vào lệnh không tồn tại)', () => {
  const dir = path.join(extRoot, 'src', 'vscode', 'services');
  const src = fs.readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  for (const cmd of SIDE_CALLS) assert.ok(src.includes(`'${cmd}'`), `chưa có service đăng ký ${cmd}`);
});

test('SideShare: thư mục chương trình theo dự án + màn, ghi đè lần sau', () => {
  const s = new SideShare();
  assert.equal(s.getProgram('A', 'update-script'), undefined);
  s.setProgram('A', 'update-script', 'D:\\Web\\', 'fbo');
  s.setProgram('A', 'multi-search', 'D:\\Mobile\\', 'mob');
  s.setProgram('B', 'update-script', 'E:\\Web\\', 'fb');
  assert.deepEqual(s.getProgram('A', 'update-script'), { program: 'D:\\Web\\', mode: 'fbo' });
  assert.deepEqual(s.getProgram('A', 'multi-search'), { program: 'D:\\Mobile\\', mode: 'mob' });
  s.setProgram('A', 'update-script', 'D:\\Other\\', 'fbo');
  assert.equal(s.getProgram('A', 'update-script')?.program, 'D:\\Other\\');
  assert.equal(s.getProgram('B', 'update-script')?.mode, 'fb');
});

test('SideShare: chỉ giữ tin "menu" (cái mới nhất mỗi màn), lấy ra thì xóa', () => {
  const s = new SideShare();
  assert.equal(s.hold('A', 'update-script', 'menu', { id: '1' }), true);
  assert.equal(s.hold('A', 'update-script', 'menu', { id: '2' }), true);
  assert.equal(s.hold('A', 'multi-search', 'menu', { id: '3' }), true);
  assert.equal(s.hold('A', 'multi-search', 'checkVoucher', null), false);
  assert.equal(s.hold('B', 'update-script', 'menu', { id: '9' }), true);
  const got = s.take('A');
  assert.deepEqual(got.map((h) => [h.screen, (h.data as { id: string }).id]).sort(), [['multi-search', '3'], ['update-script', '2']]);
  assert.deepEqual(s.take('A'), []);
  assert.equal(s.take('B').length, 1);
});

test('icons.js: fileKind theo đuôi, sqlKind theo loại, ic trả svg có màu theo theme', async () => {
  const { fileKind, sqlKind, ic, fileIcon, COLOR } = await web('js', 'sidebar', 'icons.js');
  assert.deepEqual(fileKind('Dir\\SVTran.f'), ['fileCode', 'yellow']);
  assert.deepEqual(fileKind('Dir\\SVTran.XML'), ['fileCode', 'blue']);
  assert.deepEqual(fileKind('rs_x.sql'), ['fileCode', 'purple']);
  assert.deepEqual(fileKind('Mau.frx'), ['fileText', 'red']);
  assert.deepEqual(fileKind('README'), ['file', 'muted']);
  assert.deepEqual(sqlKind('U'), ['table', 'blue']);
  assert.deepEqual(sqlKind('p'), ['store', 'orange']);
  assert.deepEqual(sqlKind('TF'), ['func', 'purple']);
  assert.equal(ic('khong-co'), '');
  const svg = ic('folder', 'yellow', 16);
  assert.match(svg, /^<svg /);
  assert.ok(svg.includes('width="16"'));
  assert.ok(svg.includes('--vscode-charts-yellow'));
  assert.ok(!/#[0-9a-f]{3,6}/i.test(stripVars(svg)), 'màu cứng ngoài var()');
  assert.ok(fileIcon('a.f').includes('--vscode-charts-yellow'));
  for (const v of Object.values(COLOR)) assert.match(String(v), /^var\(--vscode-/);
});

test('explorer.js: countText, splitTokens', async () => {
  const { countText, splitTokens } = await web('js', 'ui', 'explorer.js');
  assert.equal(countText(0, 0), '( 0 dòng )');
  assert.equal(countText(0, 12), '( 12 dòng )');
  assert.equal(countText(3, 12), '( 3 / 12 )');
  assert.deepEqual(splitTokens('a, b;\nA\tc'), ['a', 'b', 'c']);
});

test('css sidebar / tab: không màu xám cứng, không rgba đen / xám đè lên', () => {
  for (const f of ['sidebar.css', 'update-script.css', 'multi-search.css']) {
    const css = fs.readFileSync(path.join(extRoot, 'web', 'css', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    // Bỏ phần màu dự phòng bên trong var(--vscode-xxx, <dự phòng>) rồi mới dò.
    const bare = stripVars(css);
    assert.ok(!/#[0-9a-f]{3,8}\b/i.test(bare), `${f}: màu hex cứng`);
    assert.ok(!/rgba?\(/i.test(bare), `${f}: rgb/rgba cứng`);
  }
});
