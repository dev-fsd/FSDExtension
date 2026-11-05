// UTF-7 kiểu System.Text.Encoding.UTF7 của .NET (UTF7Encoding, allowOptionals = false).
// Không import 'vscode' để test được bằng node --test.

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Ký tự được ghi trực tiếp (không mã hóa): A-Za-z0-9 ' ( ) , - . / : ? + space, tab, CR, LF. */
function isDirect(code: number): boolean {
  if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || (code >= 0x30 && code <= 0x39)) return true;
  switch (code) {
    case 0x27: case 0x28: case 0x29: case 0x2c: case 0x2d: case 0x2e: case 0x2f: case 0x3a: case 0x3f:
    case 0x20: case 0x09: case 0x0d: case 0x0a:
      return true;
    default:
      return false;
  }
}

/** Mã hóa chuỗi sang byte UTF-7 như .NET (luôn đóng khối base64 bằng '-'). */
export function encodeUtf7(text: string): Uint8Array {
  const out: number[] = [];
  let inBase64 = false;
  let bits = 0; // số bit đang chờ trong acc
  let acc = 0;

  const flush = (): void => {
    if (bits > 0) {
      out.push(BASE64.charCodeAt((acc << (6 - bits)) & 0x3f));
      bits = 0;
      acc = 0;
    }
    out.push(0x2d); // '-'
    inBase64 = false;
  };

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isDirect(code)) {
      if (inBase64) flush();
      out.push(code);
    } else if (!inBase64 && code === 0x2b) {
      out.push(0x2b, 0x2d); // '+' → "+-"
    } else {
      if (!inBase64) {
        out.push(0x2b); // '+'
        inBase64 = true;
      }
      // UTF-16BE: 16 bit mỗi ký tự, cắt từng 6 bit
      acc = (acc << 16) | code;
      bits += 16;
      while (bits >= 6) {
        bits -= 6;
        out.push(BASE64.charCodeAt((acc >> bits) & 0x3f));
      }
      acc &= (1 << bits) - 1;
    }
  }
  if (inBase64) flush();
  return Uint8Array.from(out);
}

/** Giải byte UTF-7 như .NET: "+-" → '+'; sau khối base64 nếu gặp '-' thì nuốt. */
export function decodeUtf7(bytes: Uint8Array): string {
  const out: string[] = [];
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b !== 0x2b) {
      out.push(b < 0x80 ? String.fromCharCode(b) : '\uFFFD');
      i++;
      continue;
    }
    i++;
    if (i < bytes.length && bytes[i] === 0x2d) { // "+-"
      out.push('+');
      i++;
      continue;
    }
    // khối base64: gom 16 bit một ký tự
    let acc = 0;
    let bits = 0;
    while (i < bytes.length) {
      const idx = bytes[i] < 0x80 ? BASE64.indexOf(String.fromCharCode(bytes[i])) : -1;
      if (idx < 0) break;
      acc = (acc << 6) | idx;
      bits += 6;
      if (bits >= 16) {
        bits -= 16;
        out.push(String.fromCharCode((acc >> bits) & 0xffff));
        acc &= (1 << bits) - 1;
      }
      i++;
    }
    if (i < bytes.length && bytes[i] === 0x2d) i++; // nuốt '-' kết thúc
  }
  return out.join('');
}
