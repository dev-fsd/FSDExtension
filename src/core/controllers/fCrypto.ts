// Port FSDStudio52\Features\Controllers\FControllerCrypto.vb
// Giải vùng mã hóa trong controller .f của FBO (AES-CBC + gzip). Chỉ dùng trong bộ nhớ để lấy tên;
// không ghi bản giải ra file / log.
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as zlib from 'node:zlib';
import type { KeyPair } from '../types';

const THUAT_TOAN: Record<number, string> = { 16: 'aes-128-cbc', 24: 'aes-192-cbc', 32: 'aes-256-cbc' };

/**
 * 96 byte đầu của luồng gzip do GZipStream .NET cũ sinh (header gzip + bảng Huffman cố định).
 * Vùng bắt đầu bằng '&' hoặc '%' đã bị cắt đúng đoạn bản mã của 96 byte này → mã hóa lại bằng chính key/IV rồi nối vào đầu.
 */
const GZIP_PREFIX_96 = Buffer.from(
  '1F8B0800000000000400EDBD07601C499625262F6DCA7B7F4AF54AD7E074A10880601324D8904010ECC188CDE692EC1D69472329AB2A81CA6556655D661640CCED9DBCF7DE7BEFBDF7DE7BEFBDF7BA3B9D4E27F7DFFF3F5C6664016CF6CE4ADA',
  'hex'
);

export class FControllerCrypto {
  private readonly keys: KeyPair[];
  private last = 0;

  constructor(keys: KeyPair[]) {
    this.keys = keys ? [...keys] : [];
  }

  /** Số cặp key/IV đang có. 0 = không giải được vùng nào. */
  get keyCount(): number {
    return this.keys.length;
  }

  /** Thử lần lượt từng key (ưu tiên key vừa giải được). Không giải được → undefined. */
  decode(value: string): string | undefined {
    const n = this.keys.length;
    for (let i = 0; i < n; i++) {
      const idx = (this.last + i) % n;
      const text = FControllerCrypto.decodeWith(value, this.keys[idx].key, this.keys[idx].iv);
      if (text !== undefined) {
        this.last = idx;
        return text;
      }
    }
    return undefined;
  }

  static decodeWith(value: string, key: Uint8Array, iv: Uint8Array): string | undefined {
    try {
      const alg = THUAT_TOAN[key.length];
      if (!alg || iv.length !== 16) return undefined;
      const b64 = (value ?? '').replace(/\s+/g, '');
      const packed = b64.startsWith('&') || b64.startsWith('%');
      const payload = packed ? b64.slice(1) : b64;
      // .NET FromBase64String khắt khe hơn Node: kiểm tra trước.
      if (payload.length === 0 || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) return undefined;
      let cipher: Buffer = Buffer.from(payload, 'base64');
      if (packed) {
        const enc = crypto.createCipheriv(alg, key, iv);
        enc.setAutoPadding(false);
        const head = Buffer.concat([enc.update(GZIP_PREFIX_96), enc.final()]);
        cipher = Buffer.concat([head, cipher]);
      }
      if (cipher.length === 0 || cipher.length % 16 !== 0) return undefined;
      const dec = crypto.createDecipheriv(alg, key, iv);
      dec.setAutoPadding(false);
      const raw = Buffer.concat([dec.update(cipher), dec.final()]);
      // Tự kiểm padding PKCS7 → key sai thì gần như chắc chắn hỏng ở đây.
      const pad = raw[raw.length - 1];
      if (pad < 1 || pad > 16 || pad > raw.length) return undefined;
      for (let i = 0; i < pad; i++) {
        if (raw[raw.length - 1 - i] !== pad) return undefined;
      }
      let body: Buffer = raw.subarray(0, raw.length - pad);
      if (body.length > 2 && body[0] === 0x1f && body[1] === 0x8b) {
        // Z_SYNC_FLUSH: chịu được luồng gzip .NET cũ thiếu phần kết.
        body = zlib.gunzipSync(body, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
      }
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body);
    } catch {
      // Bản mã hỏng / key sai / không phải UTF-8: không giải được là trạng thái bình thường.
      return undefined;
    }
  }

  /** Mã hóa ngược (cùng định dạng FBO, không nén) — chỉ dùng cho test tự sinh dữ liệu. */
  static encode(text: string, key: Uint8Array, iv: Uint8Array): string {
    const alg = THUAT_TOAN[key.length];
    if (!alg) throw new Error('Độ dài key không hợp lệ (16/24/32 byte).');
    const enc = crypto.createCipheriv(alg, key, iv);
    return Buffer.concat([enc.update(Buffer.from(text, 'utf8')), enc.final()]).toString('base64');
  }

  static hex(s: string): Uint8Array {
    const clean = (s ?? '').replace(/[^0-9a-fA-F]/g, '');
    if (clean.length % 2 !== 0) return new Uint8Array(0);
    return new Uint8Array(Buffer.from(clean, 'hex'));
  }

  /** Đọc file khóa: mỗi dòng `key_hex|iv_hex` (key 16/24/32 byte, IV 16 byte); dòng sai / trùng bỏ qua. */
  static loadKeys(path: string): KeyPair[] {
    const list: KeyPair[] = [];
    if (!path || !fs.existsSync(path)) return list;
    const seen = new Set<string>();
    let content: string;
    try {
      content = fs.readFileSync(path, 'utf8');
    } catch {
      return list;
    }
    for (const line of content.split(/\r?\n/)) {
      const p = line.indexOf('|');
      if (p <= 0) continue;
      const key = FControllerCrypto.hex(line.slice(0, p));
      const iv = FControllerCrypto.hex(line.slice(p + 1));
      if ((key.length === 16 || key.length === 24 || key.length === 32) && iv.length === 16 && !seen.has(line.trim())) {
        seen.add(line.trim());
        list.push({ key, iv });
      }
    }
    return list;
  }
}
