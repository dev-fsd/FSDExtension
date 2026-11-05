// Port Library\clsLibrary\GroupLibraries\Sys.vb: EncodeText / DecodeText / DecodeP.
import { decodeUtf7, encodeUtf7 } from './utf7';

/** Convert.FromBase64String của .NET: bỏ khoảng trắng, độ dài bội 4, đệm '=' đúng chỗ; sai thì ném lỗi. */
function fromBase64Strict(s: string): Buffer {
  const t = s.replace(/[ \t\r\n]/g, '');
  if (t.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(t)) throw new Error('Base64 không hợp lệ');
  return Buffer.from(t, 'base64');
}

/** Số chữ số của key (Len(xKey.ToString) trong VB; số âm tính cả dấu '-'). */
function keyLength(key: number): number {
  return String(Math.trunc(key)).length;
}

/** Dịch ký tự đầu của chuỗi Base64 theo `delta`; ngoài khoảng 0..65535 thì ném lỗi như Convert.ToChar. */
function shiftFirst(s: string, delta: number): string {
  if (s === '') return s;
  const code = s.charCodeAt(0) + delta;
  if (code < 0 || code > 0xffff) throw new RangeError('Ký tự ngoài khoảng');
  return String.fromCharCode(code) + s.substring(1);
}

export function encodeText(value: string, key = 0): string {
  const b64 = Buffer.from(encodeUtf7(value)).toString('base64');
  return shiftFirst(b64, 3 + key - keyLength(key));
}

/** Lỗi thì trả nguyên `value` như VB. */
export function decodeText(value: string, key = 0): string {
  try {
    const shifted = shiftFirst(value, -3 - key + keyLength(key));
    return decodeUtf7(fromBase64Strict(shifted));
  } catch {
    return value;
  }
}

/** UTF-32LE (như Encoding.UTF32): đơn vị không hợp lệ → U+FFFD, byte lẻ cuối bị bỏ. */
function utf32leToString(buf: Buffer): string {
  const parts: string[] = [];
  for (let i = 0; i + 4 <= buf.length; i += 4) {
    const cp = buf.readUInt32LE(i);
    parts.push(cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? '\uFFFD' : String.fromCodePoint(cp));
  }
  if (buf.length % 4 !== 0) parts.push('\uFFFD');
  return parts.join('');
}

/** Base64 UTF-32LE; thử thêm '=' tối đa 2 lần, lỗi thì trả nguyên. */
export function decodeP(value: string): string {
  let s = value;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return utf32leToString(fromBase64Strict(s));
    } catch {
      s += '=';
    }
  }
  return value;
}
