// Key dùng extension — cùng cơ chế key của FSD Studio (Library\clsLibrary\GroupLibraries\Sys.vb: GetCodeCheckMac, CheckCode)
// để người quản lý cấp bằng công cụ cấp key hiện có. Không có key hợp lệ thì extension không chạy.
//   Mã máy = EncodeText(8 ký tự cuối MAC, 11).   Key = "<mã máy>||<số>", số tính từ mã máy theo cấp 1..5.
// Khác 5.1 có chủ ý: mã máy phải khớp một card mạng của máy này (5.1 lấy theo file tạm nếu có, chép được sang máy khác).
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeText } from '../legacy/legacyText';

export interface LicenseState {
  ok: boolean;
  /** Cấp key 1..5 (1 full, 2 pro…); 0 = không hợp lệ. */
  level: number;
  /** Mã máy để gửi xin key (card mạng đầu tiên, như 5.1). */
  machineCode: string;
  /** Key đang dùng (chỉ khi hợp lệ). */
  key?: string;
}

/** File key FSD Studio 5.1 tự lưu khi nhập key: %TEMP%\FAST.Tool.key.fsi và key.txt cạnh exe. */
export function defaultKeyFiles(studioDir = 'D:\\SOFT\\FSDStudio'): string[] {
  return [join(tmpdir(), 'FAST.Tool.key.fsi'), join(studioDir, 'key.txt')];
}

export function machineCodeFromMac(mac: string): string {
  const hex = mac.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  return encodeText(hex.slice(-8), 11);
}

/** Math.Round của .NET (làm tròn số chẵn khi đúng ,5) cho phân số n / d, d > 0 — tính nguyên để khỏi sai số. */
function roundHalfEven(n: number, d: number): number {
  const q = Math.floor(n / d);
  const twiceRem = 2 * (n - q * d);
  if (twiceRem > d) return q + 1;
  if (twiceRem < d) return q;
  return q % 2 === 0 ? q : q + 1;
}

/** Số key của mã máy ở cấp k (Sys.CheckCode). */
export function expectedKey(machineCode: string, level: number): string {
  let s = '';
  for (let i = 0; i < machineCode.length; i++) {
    s += String(roundHalfEven(789 - 13 * level - i * 11 - machineCode.charCodeAt(i), i + level));
  }
  return s;
}

/** Cấp của key với mã máy cho trước; 0 = sai. Cấp 4 ở 5.1 là trạng thái bắt nhập lại key → không coi là dùng được. */
export function keyLevel(key: string, machineCode: string): number {
  const parts = key.trim().replace(/\|\|/g, '|').split('|');
  if (parts.length < 2 || parts[0] !== machineCode) return 0;
  for (let k = 1; k <= 5; k++) {
    if (expectedKey(machineCode, k) === parts[1]) return k === 4 ? 0 : k;
  }
  return 0;
}

/** MAC theo đúng thứ tự .NET GetAllNetworkInterfaces (như 5.1); không gọi được PowerShell thì lấy của Node. */
export function listMacs(): Promise<string[]> {
  const ps = '[System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | ForEach-Object { $_.GetPhysicalAddress().ToString() }';
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 10000, windowsHide: true }, (err, stdout) => {
      const fromNode = Object.values(networkInterfaces()).flat()
        .map((n) => (n?.mac ?? '').replace(/:/g, '').toUpperCase())
        .filter((m) => m && m !== '000000000000');
      const fromPs = err ? [] : stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      resolve([...new Set([...fromPs, ...fromNode])]);
    });
  });
}

/** Đọc file key của 5.1 (Unicode UTF-16LE có BOM; chịu cả UTF-8). */
export function readKeyFile(path: string): string {
  try {
    if (!existsSync(path)) return '';
    const buf = readFileSync(path);
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le').trim();
    return buf.toString('utf8').replace(/^\uFEFF/, '').trim();
  } catch {
    return '';
  }
}

/** Kiểm key: thử key đã lưu của extension rồi tới file key của FSD Studio, với mọi card mạng của máy. */
export async function checkLicense(storedKey: string | undefined, keyFiles: string[] = defaultKeyFiles()): Promise<LicenseState> {
  const codes = (await listMacs()).map(machineCodeFromMac);
  const machineCode = codes[0] ?? '';
  const candidates = [storedKey ?? '', ...keyFiles.map(readKeyFile)].filter(Boolean);
  for (const key of candidates) {
    for (const code of codes) {
      const level = keyLevel(key, code);
      if (level > 0) return { ok: true, level, machineCode, key: key.trim() };
    }
  }
  return { ok: false, level: 0, machineCode };
}
