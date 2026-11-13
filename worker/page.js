// 공식 문서 본문 읽기와 주소 안전 검사.
// Liner Search 는 요약만 주기 때문에, 근거 대조에 쓸 본문은 워커가 직접 가져온다.
// 가져온 본문은 자료일 뿐이다. 그 안에 지시처럼 보이는 글이 있어도 따르지 않는다.

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_CHARS = 600_000; // 근거 대조는 본문 전체를 상대로 하므로 넉넉히 둔다
const MAX_HOPS = 4; // HTTP 리다이렉트와 안내 페이지 이동을 합친 횟수
const MIN_TEXT_CHARS = 50;

export class PageError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'PageError';
    this.code = code;
  }
}

/**
 * 워커가 열어도 되는 공개 https 주소인가. 헷갈리면 거짓.
 */
export function isSafePublicUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== '443') return false;

  const host = u.hostname.toLowerCase().replace(/\.+$/, '');
  if (!host.includes('.')) return false; // localhost, intranet 같은 점 없는 이름
  if (host.startsWith('[') || host.includes(':')) return false; // IPv6 숫자 주소
  if (/^[0-9.]+$/.test(host)) return false; // IPv4 숫자 주소(공개 주소라도 받지 않는다)
  if (/^0x[0-9a-f]+$/i.test(host)) return false;
  for (const suffix of ['.local', '.localhost', '.internal', '.lan', '.home', '.corp', '.test', '.invalid', '.example']) {
    if (host.endsWith(suffix)) return false;
  }
  return true;
}

function decodeHtmlEntities(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', copy: '©', reg: '®', trade: '™' };
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => safeCodePoint(parseInt(h, 16), m))
    .replace(/&#(\d+);/g, (m, d) => safeCodePoint(parseInt(d, 10), m))
    .replace(/&([a-zA-Z]+);/g, (m, name) => named[name] ?? m);
}

function safeCodePoint(n, fallback) {
  try {
    return String.fromCodePoint(n);
  } catch {
    return fallback;
  }
}

/**
 * HTML 에서 사람이 읽는 본문 글자만 남긴다.
 */
export function htmlToText(html) {
  if (typeof html !== 'string') return '';
  let s = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|nav|footer|noscript|svg|template|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|table|section|article|header|main|pre|blockquote|dd|dt)\s*>/gi, '\n')
    .replace(/<\/(td|th)\s*>/gi, ' ')
    .replace(/<[^>]+>/g, '');
  s = decodeHtmlEntities(s).replace(/ /g, ' ');
  return s
    .split('\n')
    .map((line) => line.replace(/[ \t\r\f\v]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * 긴 본문에서 낱말 주변만 잘라 모델에 줄 조각을 만든다.
 * 근거 대조는 이 조각이 아니라 본문 전체를 상대로 한다.
 */
export function excerptFor(text, terms, { maxChars = 12000, window = 700 } = {}) {
  if (typeof text !== 'string') return '';
  if (text.length <= maxChars) return text;

  const lower = text.toLowerCase();
  const ranges = [];
  for (const term of terms ?? []) {
    const t = String(term ?? '').toLowerCase().trim();
    if (t.length < 2) continue;
    let from = 0;
    while (ranges.length < 200) {
      const i = lower.indexOf(t, from);
      if (i === -1) break;
      ranges.push([Math.max(0, i - window), Math.min(text.length, i + t.length + window)]);
      from = i + t.length;
    }
  }
  if (ranges.length === 0) return text.slice(0, maxChars);

  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }

  let out = '';
  for (const [a, b] of merged) {
    const piece = text.slice(a, b);
    const sep = out ? '\n…\n' : '';
    if (out.length + sep.length + piece.length > maxChars) {
      const room = maxChars - out.length - sep.length;
      if (room > 100) out += sep + piece.slice(0, room);
      break;
    }
    out += sep + piece;
  }
  return out;
}

// 응답 본문을 크기 제한 안에서 글자로 읽는다.
async function readLimited(res, maxBytes) {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new PageError('too_large');
  if (!res.body) {
    const t = await res.text();
    if (t.length > maxBytes) throw new PageError('too_large');
    return t;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* 이미 닫힘 */ }
      throw new PageError('too_large');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.byteLength; }
  return new TextDecoder('utf-8').decode(all);
}

// "Redirecting to: /docs/x" 같은 안내 페이지가 가리키는 주소를 찾는다.
function softRedirectTarget(html, text) {
  if (text.length > 400) return null;
  const meta = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["']?\s*\d+\s*;\s*url=([^"'>\s]+)/i);
  if (meta) return decodeHtmlEntities(meta[1]);
  const said = text.match(/Redirecting to:?\s*(\S+)/i);
  return said ? said[1] : null;
}

const looksLikeHtml = (s) => /^\s*(<!doctype html|<html[\s>])/i.test(s);

// /docs/... 주소는 Markdown 판(.md)이 있으면 그쪽이 메뉴 글자 없이 깨끗하다.
function markdownVariant(u) {
  if (!/\/docs(\/|$)/.test(u.pathname)) return null;
  const path = u.pathname.replace(/\/+$/, '');
  if (!path || /\.[a-z0-9]{1,5}$/i.test(path)) return null;
  const md = new URL(u.href);
  md.pathname = path + '.md';
  md.hash = '';
  return md.href;
}

/**
 * @param {string} url 가져올 주소(검색 결과에 나온 공식 사이트 주소)
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, maxBytes?: number, maxChars?: number }} options
 * @returns {Promise<{ url: string, text: string }>} url 은 사람이 열어 볼 최종 주소
 */
export async function fetchPageText(url, options = {}) {
  const { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES, maxChars = DEFAULT_MAX_CHARS } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new PageError('timeout')), timeoutMs);

  const get = async (target) => {
    try {
      return await fetchImpl(target, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'text/markdown, text/html;q=0.9, text/plain;q=0.8', 'user-agent': 'lecture-freshness-checker/0.1' },
      });
    } catch (e) {
      if (e instanceof PageError) throw e;
      if (controller.signal.aborted) throw new PageError('timeout');
      throw new PageError('fetch_failed');
    }
  };

  try {
    let current = url;
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      if (!isSafePublicUrl(current)) throw new PageError('unsafe_url');
      const u = new URL(current);
      u.hash = '';
      current = u.href;

      // 1) Markdown 판을 먼저 본다.
      const mdUrl = markdownVariant(u);
      if (mdUrl) {
        const res = await get(mdUrl);
        const type = (res.headers.get('content-type') ?? '').toLowerCase();
        if (res.status === 200 && (type.includes('markdown') || type.includes('text/plain'))) {
          const md = (await readLimited(res, maxBytes)).trim();
          if (md.length >= MIN_TEXT_CHARS && !looksLikeHtml(md)) {
            return { url: current, text: md.slice(0, maxChars) };
          }
        }
      }

      // 2) 원래 주소를 읽는다.
      const res = await get(current);

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) throw new PageError(`http_${res.status}`);
        current = new URL(location, current).href;
        continue;
      }
      if (res.status !== 200) throw new PageError(`http_${res.status}`);

      const type = (res.headers.get('content-type') ?? '').toLowerCase();
      const isHtml = type.includes('html');
      if (!isHtml && !type.includes('text/plain') && !type.includes('markdown')) throw new PageError('not_text');

      const raw = await readLimited(res, maxBytes);
      const text = isHtml || looksLikeHtml(raw) ? htmlToText(raw) : raw.trim();

      const next = softRedirectTarget(raw, text);
      if (next) {
        current = new URL(next, current).href;
        continue;
      }

      if (text.length < MIN_TEXT_CHARS) throw new PageError('empty_page');
      return { url: current, text: text.slice(0, maxChars) };
    }
    throw new PageError('too_many_redirects');
  } finally {
    clearTimeout(timer);
  }
}
