import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { FControllerCrypto } from '../../src/core/controllers/fCrypto';
import { buildContentMatcher } from '../../src/core/search/content';
import { buildTypeFilter, normalizeExts, passesFolderFilter } from '../../src/core/search/options';
import { buildNameTokens, folderSegmentsMatch, parseKeywordToken, tokenMatches } from '../../src/core/search/pattern';
import { looksBinary, readForView, readSearchText } from '../../src/core/search/readText';
import { isUnderRoots, searchRoots } from '../../src/core/search/roots';
import { runSearch } from '../../src/core/search/scan';
import { checkVoucher, controllerNames, findDuplicates } from '../../src/core/search/voucher';
import type { ProjectRecord } from '../../src/core/types';

/** Cây thư mục mẫu (thư mục tạm); trả gốc có dấu phân cách cuối. */
function fixture(): { root: string; clean: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-search-'));
  const w = (rel: string, text: string | Buffer): void => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  };
  w('App_Data/Controllers/Dir/SVTran.xml', '<dir>\r\n  Hello   World ma_kh\r\n  helloworld\r\n</dir>');
  w('App_Data/Controllers/Dir/SVTran.f', '<dir>hello world in f</dir>');
  w('App_Data/Controllers/Grid/SVTran.xml', '<grid>\n  ma_kh Hello\n</grid>');
  w('App_Data/Controllers/Filter/SVTran2.xml', '<filter>nothing</filter>');
  w('App_Data/Controllers/Report/rpt1.xml', '<report>Hello</report>');
  w('App_Data/Controllers/Structure/App/hidden.xml', 'Hello hidden');
  w('Help/help.xml', 'Hello help');
  w('Web/page.aspx', '<%@ Page %> Hello');
  w('Web/app.js', 'var hello = 1;');
  w('logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03]));
  return { root: root + path.sep, clean: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const rels = (r: { files: Array<{ rel: string }> }): string[] => r.files.map((f) => f.rel.replace(/\\/g, '/')).sort();

test('parseKeywordToken / folderSegmentsMatch', () => {
  assert.deepEqual(parseKeywordToken('Dir\\SVTran'), { namePattern: 'SVTran', folderHint: ['Dir'] });
  assert.deepEqual(parseKeywordToken('a/b\\c.xml'), { namePattern: 'c.xml', folderHint: ['a', 'b'] });
  assert.equal(folderSegmentsMatch(['x', 'SubDir'], ['Dir']), false);
  assert.equal(folderSegmentsMatch(['x', 'dir'], ['Dir']), true);
  assert.equal(folderSegmentsMatch(['x'], []), true);
});

test('buildNameTokens: đuôi theo token, giao với tick, bỏ ký tự cấm', () => {
  const t = buildNameTokens('SVTran.xml, bad|name, x', { exact: false });
  assert.equal(t.length, 2);
  assert.deepEqual(t[0].exts, ['xml']);
  assert.equal(t[1].exts, undefined);
  // token .xml giao với tick chỉ .f → bị loại
  assert.equal(buildNameTokens('SVTran.xml', { uiExts: ['f'] }).length, 0);
  assert.equal(buildNameTokens('SVTran', { uiExts: ['f'] }).length, 1);
  const ex = buildNameTokens('SVTran', { exact: true })[0];
  assert.equal(tokenMatches(ex, 'SVTran.xml', []), true);
  assert.equal(tokenMatches(ex, 'SVTran2.xml', []), false);
  const wc = buildNameTokens('SV*.xml', {})[0];
  assert.equal(tokenMatches(wc, 'SVTran.xml', []), true);
  assert.equal(tokenMatches(wc, 'xSVTran.xml', []), false);
});

test('buildTypeFilter: loại đối tượng → đuôi / thư mục; Mobile đổi gốc và Report → Dashboards', () => {
  assert.deepEqual(buildTypeFilter({}), { exts: [], folders: [] });
  assert.deepEqual(buildTypeFilter({ types: ['form', 'xml', 'dir', 'filter', 'grid', 'report', 'upload'] }), { exts: [], folders: [] });
  assert.deepEqual(buildTypeFilter({ types: ['form'] }), { exts: ['f'], folders: [] });
  const f = buildTypeFilter({ types: ['grid', 'report'], mobile: true, folders: ['Extra'] });
  assert.deepEqual(f.folders, ['app_data\\controllers\\mobile\\grid\\', 'app_data\\controllers\\mobile\\dashboards\\', 'extra\\']);
  assert.equal(passesFolderFilter('App_Data\\Controllers\\Mobile\\Grid\\x\\', f), true);
  assert.equal(passesFolderFilter('App_Data\\Controllers\\Grid\\', f), false);
  assert.deepEqual(normalizeExts(['.XML', 'xml', ' f ', '']), ['xml', 'f']);
});

test('tìm theo tên: chứa / đúng tên / Dir\\X / wildcard / loại trừ Structure và Help', async () => {
  const fx = fixture();
  try {
    const contains = await runSearch({ root: fx.root, text: 'svtran' });
    assert.deepEqual(rels(contains), [
      'App_Data/Controllers/Dir/SVTran.f',
      'App_Data/Controllers/Dir/SVTran.xml',
      'App_Data/Controllers/Filter/SVTran2.xml',
      'App_Data/Controllers/Grid/SVTran.xml'
    ]);
    assert.equal(contains.capped, false);
    assert.equal(contains.cancelled, undefined);

    const exact = await runSearch({ root: fx.root, text: 'svtran', exact: true });
    assert.equal(exact.files.length, 3);
    assert.ok(!rels(exact).some((r) => r.includes('SVTran2')));

    assert.deepEqual(rels(await runSearch({ root: fx.root, text: 'Dir\\SVTran' })), ['App_Data/Controllers/Dir/SVTran.f', 'App_Data/Controllers/Dir/SVTran.xml']);
    assert.equal(rels(await runSearch({ root: fx.root, text: 'SVTran.xml' })).length, 2);
    assert.deepEqual(rels(await runSearch({ root: fx.root, text: '*.js, logo' })), ['Web/app.js', 'logo.png']);
    // Structure\ và Help\ không bao giờ vào kết quả
    assert.equal((await runSearch({ root: fx.root, text: 'hidden, help' })).files.length, 0);
  } finally {
    fx.clean();
  }
});

test('lọc loại file: ô tick .f / Grid / đuôi tùy chọn', async () => {
  const fx = fixture();
  try {
    assert.deepEqual(rels(await runSearch({ root: fx.root, text: 'svtran', types: ['form'] })), ['App_Data/Controllers/Dir/SVTran.f']);
    assert.deepEqual(rels(await runSearch({ root: fx.root, text: 'svtran', types: ['grid'] })), ['App_Data/Controllers/Grid/SVTran.xml']);
    assert.deepEqual(rels(await runSearch({ root: fx.root, text: 'svtran', types: ['dir', 'grid'], exts: ['xml'] })), [
      'App_Data/Controllers/Dir/SVTran.xml',
      'App_Data/Controllers/Grid/SVTran.xml'
    ]);
    assert.deepEqual(rels(await runSearch({ root: fx.root, text: 'page', exts: ['.aspx'] })), ['Web/page.aspx']);
    // token .xml + chỉ tick .f → không còn gì
    assert.equal((await runSearch({ root: fx.root, text: 'SVTran.xml', exts: ['f'] })).files.length, 0);
  } finally {
    fx.clean();
  }
});

test('tìm nội dung: khoảng trắng linh hoạt, OR theo dấu phẩy, dòng khớp, bỏ file nhị phân', async () => {
  const fx = fixture();
  try {
    const r = await runSearch({ root: fx.root, text: 'hello world', content: true });
    const dir = r.files.find((f) => f.rel.replace(/\\/g, '/') === 'App_Data/Controllers/Dir/SVTran.xml');
    assert.ok(dir);
    assert.deepEqual(dir.lines, [{ n: 2, text: 'Hello   World ma_kh' }]);
    assert.ok(rels(r).includes('App_Data/Controllers/Dir/SVTran.f'));
    assert.ok(!rels(r).some((x) => x.includes('Structure') || x.startsWith('Help')));

    assert.deepEqual(rels(await runSearch({ root: fx.root, text: 'ma_kh, var hello', content: true })), ['App_Data/Controllers/Dir/SVTran.xml', 'App_Data/Controllers/Grid/SVTran.xml', 'Web/app.js']);
    // dấu * đầu bị bỏ
    assert.equal((await runSearch({ root: fx.root, text: '*ma_kh', content: true })).files.length, 2);
    // file nhị phân (png) không vào kết quả dù không khớp loại
    assert.ok(!rels(await runSearch({ root: fx.root, text: 'PNG', content: true })).includes('logo.png'));
    // lọc loại: chỉ Grid
    assert.deepEqual(rels(await runSearch({ root: fx.root, text: 'hello', content: true, types: ['grid'] })), ['App_Data/Controllers/Grid/SVTran.xml']);
  } finally {
    fx.clean();
  }
});

test('tìm nội dung: phân biệt hoa thường, nguyên từ, regex', async () => {
  const fx = fixture();
  try {
    assert.deepEqual(rels(await runSearch({ root: fx.root, text: 'HELLO', content: true, matchCase: true })), []);
    assert.equal((await runSearch({ root: fx.root, text: 'Hello', content: true, matchCase: true })).files.length > 0, true);
    // "Hello" nguyên từ: dòng "helloworld" không tính
    const word = await runSearch({ root: fx.root, text: 'hello', content: true, wholeWord: true, types: ['dir'], exts: ['xml'] });
    assert.deepEqual(word.files[0].lines?.map((l) => l.n), [2]);
    const loose = await runSearch({ root: fx.root, text: 'hello', content: true, types: ['dir'], exts: ['xml'] });
    assert.deepEqual(loose.files[0].lines?.map((l) => l.n), [2, 3]);
    // regex: chuỗi có dấu phẩy không bị tách
    assert.deepEqual(rels(await runSearch({ root: fx.root, text: 'var\\s+hello\\s*=\\s*\\d', content: true, regex: true })), ['Web/app.js']);
    assert.deepEqual(rels(await runSearch({ root: fx.root, text: 'ma_kh,\\s*Hello|zzz', content: true, regex: true })), []);
    await assert.rejects(() => runSearch({ root: fx.root, text: '(unclosed', content: true, regex: true }), /Biểu thức chính quy không hợp lệ/);
  } finally {
    fx.clean();
  }
});

test('hủy giữa chừng và giới hạn số file', async () => {
  const fx = fixture();
  try {
    for (let d = 0; d < 30; d++) {
      for (let i = 0; i < 20; i++) {
        const full = path.join(fx.root, 'bulk', 'd' + d, `item${i}.txt`);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, 'x');
      }
    }
    const total = (await runSearch({ root: fx.root, text: 'item' })).files.length;
    assert.equal(total, 600);
    const ac = new AbortController();
    const cancelled = await runSearch({ root: fx.root, text: 'item' }, { signal: ac.signal, onProgress: () => ac.abort() });
    assert.equal(cancelled.cancelled, true);
    assert.ok(cancelled.files.length < total, `đã hủy nhưng vẫn ra ${cancelled.files.length}/${total}`);
    // hủy trước khi chạy
    const pre = new AbortController();
    pre.abort();
    const none = await runSearch({ root: fx.root, text: 'item' }, { signal: pre.signal });
    assert.equal(none.cancelled, true);
    assert.equal(none.files.length, 0);
    // chặn số file
    const capped = await runSearch({ root: fx.root, text: 'item', maxFiles: 50 });
    assert.equal(capped.files.length, 50);
    assert.equal(capped.capped, true);
    // tiến độ được báo
    let last = 0;
    await runSearch({ root: fx.root, text: 'item' }, { onProgress: (p) => { last = p.found; } });
    assert.equal(last, 600);
  } finally {
    fx.clean();
  }
});

test('lỗi đầu vào: từ khóa rỗng, thư mục không có', async () => {
  const fx = fixture();
  try {
    await assert.rejects(() => runSearch({ root: fx.root, text: '  ' }), /Chưa nhập từ khóa/);
    await assert.rejects(() => runSearch({ root: path.join(fx.root, 'khong-co'), text: 'a' }), /Không vào được thư mục/);
    await assert.rejects(() => runSearch({ root: fx.root, text: '*', content: true }), /Chưa nhập từ khóa/);
  } finally {
    fx.clean();
  }
});

test('.f: so khớp nội dung chỉ giải vùng mã hóa khi có khóa (trong bộ nhớ), file không bị ghi', async () => {
  const fx = fixture();
  try {
    const key = new Uint8Array(16).fill(5);
    const iv = new Uint8Array(16).fill(6);
    const secret = FControllerCrypto.encode('SECRET_TOKEN', key, iv);
    const file = path.join(fx.root, 'App_Data', 'Controllers', 'Dir', 'Enc.f');
    const original = `<a><Encrypted>${secret}</Encrypted></a>`;
    fs.writeFileSync(file, original);
    const before = fs.statSync(file).mtimeMs;
    assert.equal((await runSearch({ root: fx.root, text: 'SECRET_TOKEN', content: true })).files.length, 0);
    const withKey = await runSearch({ root: fx.root, text: 'SECRET_TOKEN', content: true }, { crypto: new FControllerCrypto([{ key, iv }]) });
    assert.deepEqual(rels(withKey), ['App_Data/Controllers/Dir/Enc.f']);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
    assert.equal(fs.statSync(file).mtimeMs, before);
    // xem file: nguyên văn
    assert.equal((await readForView(file)).text, original);
    assert.equal(await readSearchText(file, 10, undefined), undefined, 'file quá lớn so với giới hạn thì bỏ qua');
  } finally {
    fx.clean();
  }
});

test('đọc file: BOM UTF-8 / UTF-16, nhị phân bị từ chối', async () => {
  const fx = fixture();
  try {
    const u8 = path.join(fx.root, 'u8.sql');
    fs.writeFileSync(u8, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Tiếng Việt', 'utf8')]));
    const v = await readForView(u8);
    assert.equal(v.text, 'Tiếng Việt');
    assert.equal(v.language, 'sql');
    const u16 = path.join(fx.root, 'u16.txt');
    fs.writeFileSync(u16, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Việt', 'utf16le')]));
    assert.equal((await readForView(u16)).text, 'Việt');
    await assert.rejects(() => readForView(path.join(fx.root, 'logo.png')), /Không phải file chữ/);
    await assert.rejects(() => readForView(path.join(fx.root, 'none.txt')), /Không có file/);
    assert.equal(looksBinary('abc\u0001'), true);
    assert.equal(looksBinary('abc\r\n\tđ'), false);
  } finally {
    fx.clean();
  }
});

test('buildContentMatcher: rỗng sau khi bỏ dấu *', () => {
  assert.equal(buildContentMatcher('*, ,', {}), undefined);
  const m = buildContentMatcher('a b', {});
  assert.ok(m?.matchesBody('xx a \r\n  b yy'));
  assert.equal(m?.matchLines('xx a \r\n  b yy').length, 0, 'khớp xuyên dòng: file khớp nhưng không có dòng');
});

test('Check Voucher: trùng trong file và giữa hai file, bỏ file tên dài', async () => {
  const fx = fixture();
  try {
    const dir = path.join(fx.root, 'App_Data', 'Controllers', 'Grid', 'Config', 'Include');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'Voucher.Controller.AAA'), '<controller name="X1"/><controller name="X1"/><controller name="Y"/>');
    fs.writeFileSync(path.join(dir, 'Voucher.Controller.BBB'), "<controller class='z' name='Y'/><controller name=\"Z\"/>");
    fs.writeFileSync(path.join(dir, 'Voucher.Controller.AAAA'), '<controller name="Y"/>');
    const r = await checkVoucher(fx.root);
    assert.deepEqual(r.errors, [
      { a: 'Voucher.Controller.AAA', name: 'X1', b: 'Voucher.Controller.AAA' },
      { a: 'Voucher.Controller.AAA', name: 'Y', b: 'Voucher.Controller.BBB' }
    ]);
    assert.deepEqual(r.files, ['App_Data\\Controllers\\Grid\\Config\\Include\\Voucher.Controller.AAA', 'App_Data\\Controllers\\Grid\\Config\\Include\\Voucher.Controller.BBB']);
    await assert.rejects(() => checkVoucher(path.join(fx.root, 'none')), /Không có thư mục/);
    assert.deepEqual(controllerNames('<controller name = " a "/>'), ['a']);
    assert.deepEqual(findDuplicates(new Map([['f', ['a']]])), []);
  } finally {
    fx.clean();
  }
});

test('gốc tìm theo dự án và kiểm đường dẫn nằm trong gốc', () => {
  const p = { code: 'T', webSource: 'D:\\sites\\T\\Web\\', webProgramDir: '', mobileDir: '' } as ProjectRecord;
  const roots = searchRoots(p);
  assert.deepEqual(roots.map((r) => r.id), ['ctl', 'web', 'mobile', 'other']);
  assert.equal(roots[0].path, 'D:\\sites\\T\\Web\\App_Data\\Controllers\\');
  assert.equal(roots[2].path, 'D:\\sites\\T\\MobileApp\\');
  assert.equal(roots[3].path, 'D:\\sites\\T\\');
  assert.deepEqual(searchRoots(p, () => false).map((r) => r.id), ['ctl', 'web', 'other']);
  const paths = roots.map((r) => r.path);
  assert.equal(isUnderRoots('D:\\sites\\T\\Web\\a\\b.xml', paths), true);
  assert.equal(isUnderRoots('d:/sites/t/web', paths), true);
  assert.equal(isUnderRoots('D:\\sites\\T\\Web\\..\\..\\Other\\x', paths), false);
  assert.equal(isUnderRoots('D:\\sites\\TX\\a', paths), false);
  assert.equal(isUnderRoots('C:\\Windows\\win.ini', paths), false);
});
