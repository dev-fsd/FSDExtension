// So khớp nội dung file của Multi Search (port ContentSearchBodyMatches 5.1 + các cờ Aa / nguyên từ / regex của 5.2).
// Mặc định: dấu phẩy tách nhiều từ (khớp một trong các từ), không phân biệt hoa thường, một dấu cách khớp mọi cụm khoảng trắng.
import { MAX_LINES_PER_FILE } from './options';

export interface ContentOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
}

export interface ContentMatcher {
  /** File có khớp không (so cả nội dung, cho phép khớp xuyên dòng). */
  matchesBody(body: string): boolean;
  /** Các dòng khớp (tối đa MAX_LINES_PER_FILE) — rỗng nếu chỉ khớp xuyên dòng. */
  matchLines(body: string): Array<{ n: number; text: string }>;
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD = '[\\w\\u00C0-\\uFFFF]';

/** Một cụm: mỗi phần giữa các khoảng trắng được escape rồi nối bằng \s+ (Regex.Escape từng phần như 5.1 BuildFlexibleWhitespacePattern). */
function flexible(term: string): string {
  const parts = term.split(/\s+/).filter((p) => p !== '');
  return parts.map(escapeRegex).join('\\s+');
}

/** Bỏ dấu * đầu từ khóa (5.1: sKey.Replace("*", "") khi tìm nội dung). */
function cleanTerm(t: string): string {
  return t.replace(/\*/g, '').trim();
}

/** Dựng bộ so khớp; chuỗi rỗng sau khi làm sạch → undefined. Regex sai cú pháp → ném Error tiếng Việt. */
export function buildContentMatcher(text: string, opts: ContentOptions): ContentMatcher | undefined {
  let source: string;
  if (opts.regex === true) {
    source = (text ?? '').trim();
    if (source === '') return undefined;
  } else {
    const terms = (text ?? '')
      .split(',')
      .map(cleanTerm)
      .filter((t) => t !== '')
      .map(flexible)
      .filter((t) => t !== '');
    if (terms.length === 0) return undefined;
    source = terms.join('|');
  }
  if (opts.wholeWord === true) source = `(?<!${WORD})(?:${source})(?!${WORD})`;
  let re: RegExp;
  try {
    re = new RegExp(source, opts.matchCase === true ? '' : 'i');
  } catch (e) {
    throw new Error('Biểu thức chính quy không hợp lệ: ' + (e instanceof Error ? e.message : String(e)));
  }
  return {
    matchesBody: (body) => re.test(body),
    matchLines: (body) => {
      const out: Array<{ n: number; text: string }> = [];
      const lines = body.split(/\r\n|\r|\n/);
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (!re.test(l)) continue;
        out.push({ n: i + 1, text: (l.length > 300 ? l.slice(0, 300) : l).trim() });
        if (out.length >= MAX_LINES_PER_FILE) break;
      }
      return out;
    }
  };
}
