// Port FSDStudio52\Features\Controllers\FControllerReader.vb
// Đọc controller FBO theo thứ tự runtime: .f trước (giải vùng mã hóa trong bộ nhớ), không trọn thì quay về .xml.
// Chỉ đọc; không bao giờ tạo / sửa / xóa file .f.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ControllerText } from '../types';
import type { FControllerCrypto } from './fCrypto';

export const DEFAULT_KEY_FILE_NAME = 'convert_keys.txt';

// Dạng 1: <Encrypted>…</Encrypted>. Dạng 2: giá trị ENTITY FastBusiness.Encryption.Begin…End.
const RX_ENCRYPTED_TAG = /<Encrypted>([\s\S]*?)<\/Encrypted>/gi;
const RX_ENCRYPTED_ENTITY = /FastBusiness\.Encryption\.Begin([A-Za-z0-9+/=&%\s]*?)FastBusiness\.Encryption\.End/g;

/** Giải mọi vùng mã hóa trong văn bản .f; vùng không giải được giữ nguyên và được đếm. */
export function convertText(input: string, crypto?: FControllerCrypto): ControllerText {
  const result: ControllerText = { path: '', source: 'f', text: '', lockedRegions: 0, decodedRegions: 0, fellBackFromF: false };
  const giai = (whole: string, region: string): string => {
    const text = !crypto || crypto.keyCount === 0 ? undefined : crypto.decode(region);
    if (text === undefined) {
      result.lockedRegions++;
      return whole;
    }
    result.decodedRegions++;
    return text;
  };
  const output = (input ?? '').replace(RX_ENCRYPTED_TAG, giai);
  result.text = output.replace(RX_ENCRYPTED_ENTITY, giai);
  return result;
}

/** Bỏ đuôi .f / .xml (nếu có). */
export function stripControllerExt(p: string): string {
  const s = (p ?? '').trim();
  if (/\.f$/i.test(s)) return s.slice(0, -2);
  if (/\.xml$/i.test(s)) return s.slice(0, -4);
  return s;
}

/** Controller FBO là UTF-8 (thường có BOM): đọc và bỏ BOM. */
async function readAllText(file: string): Promise<string> {
  const buf = await fs.promises.readFile(file);
  const s = buf.toString('utf8');
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(p)).isFile();
  } catch {
    return false;
  }
}

/** Như readController nhưng người gọi đã biết .f / .xml có hay không (đỡ stat lại trên share mạng). */
export async function readControllerWith(
  basePath: string,
  exists: { f: boolean; xml: boolean },
  crypto?: FControllerCrypto
): Promise<ControllerText | undefined> {
  const fPath = basePath + '.f';
  const xmlPath = basePath + '.xml';
  // Không có khóa mà có .xml: .f nào có vùng mã hóa cũng phải quay về .xml, nên đọc thẳng .xml (đỡ đọc .f rồi đọc lại .xml trên share mạng).
  const noKey = !crypto || crypto.keyCount === 0;
  if (exists.f && !(noKey && exists.xml)) {
    let fromF: ControllerText | undefined;
    try {
      fromF = convertText(await readAllText(fPath), crypto);
      fromF.path = fPath;
      fromF.source = 'f';
    } catch {
      // .f đang bị khóa / lỗi mạng: thử .xml bên dưới.
    }
    if (fromF && (fromF.lockedRegions === 0 || !exists.xml)) return fromF;
  }
  if (exists.xml) {
    return {
      path: xmlPath,
      source: 'xml',
      text: await readAllText(xmlPath),
      lockedRegions: 0,
      decodedRegions: 0,
      fellBackFromF: exists.f
    };
  }
  return undefined;
}

/**
 * Đọc controller theo đường dẫn không đuôi hoặc có đuôi .f / .xml.
 * .f chuyển trọn → dùng; còn vùng khóa mà có .xml → đọc .xml (fellBackFromF); không có .xml thì trả bản .f (vùng khóa giữ nguyên).
 */
export async function readController(pathWithOrWithoutExt: string, crypto?: FControllerCrypto): Promise<ControllerText | undefined> {
  const basePath = stripControllerExt(pathWithOrWithoutExt);
  const [f, xml] = await Promise.all([fileExists(basePath + '.f'), fileExists(basePath + '.xml')]);
  return readControllerWith(basePath, { f, xml }, crypto);
}

/** Đường dẫn file khóa đang dùng ("" = không có): tham số cấu hình → %USERPROFILE%\convert_keys.txt. */
export function resolveKeyFile(configured?: string): string {
  const candidates: string[] = [];
  if (configured && configured.trim() !== '') {
    candidates.push(configured.trim().replace(/%([^%]+)%/g, (m, name: string) => process.env[name] ?? m));
  }
  candidates.push(path.join(process.env.USERPROFILE || os.homedir(), DEFAULT_KEY_FILE_NAME));
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      // bỏ qua
    }
  }
  return '';
}
