// 근거 문장 대조. 모델이 고른 근거 문장이 가져온 본문에 실제로 있는지 코드로 확인한다.
// 지어낸 근거를 막는 가장 중요한 장치라서, 헷갈리면 "없다" 쪽으로 판단한다.

const MIN_QUOTE_LENGTH = 8;

/**
 * 비교용으로 글자를 다듬는다. 뜻이 바뀌지 않는 차이(공백, 대소문자, 따옴표 모양,
 * Markdown 강조 기호)만 없앤다.
 */
export function normalizeText(text) {
  if (typeof text !== 'string') return '';
  return text
    .normalize('NFKC')
    .replace(/[​-‍﻿]/g, '') // 보이지 않는 글자
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // Markdown 링크는 보이는 글자만 남긴다
    .replace(/^#{1,6}\s+/gm, '') // Markdown 제목 표시
    .replace(/[*`]/g, '') // Markdown 강조, 코드 표시
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const isDigit = (ch) => ch >= '0' && ch <= '9';

// 일치한 자리의 앞이 숫자의 일부인가. 예: "60 plugins" 안의 "0 plugins"
function cutsNumberBefore(page, start) {
  if (!isDigit(page[start])) return false;
  const prev = page[start - 1];
  if (prev === undefined) return false;
  if (isDigit(prev)) return true;
  return (prev === '.' || prev === ',') && isDigit(page[start - 2] ?? '');
}

// 일치한 자리의 뒤가 숫자의 일부인가. 예: "2.28.2" 안의 "2.28", "$199" 안의 "$19"
function cutsNumberAfter(page, end) {
  if (!isDigit(page[end - 1])) return false;
  const next = page[end];
  if (next === undefined) return false;
  if (isDigit(next)) return true;
  return (next === '.' || next === ',') && isDigit(page[end + 1] ?? '');
}

/**
 * @param {string} quote 모델이 고른 근거 문장
 * @param {string} pageText 가져온 본문 전체
 * @returns {boolean}
 */
export function quoteInPage(quote, pageText) {
  const q = normalizeText(quote);
  const page = normalizeText(pageText);
  if (q.length < MIN_QUOTE_LENGTH || page.length === 0) return false;

  let from = 0;
  while (true) {
    const start = page.indexOf(q, from);
    if (start === -1) return false;
    const end = start + q.length;
    if (!cutsNumberBefore(page, start) && !cutsNumberAfter(page, end)) return true;
    from = start + 1;
  }
}

// ---------- 숫자 대조 ----------
// "그대로" 판정은 슬라이드 문장의 숫자가 근거 문장에 모두 있을 때만 인정한다.
// 근거가 내용의 일부만 뒷받침하는데 통째로 맞다고 하는 것을 막는다.

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, hundred: 100, thousand: 1000,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** 글에 나온 숫자를 모은다. "7,500" 은 7500, "2.31.2" 는 그대로 버전 문자열로 둔다. */
export function numbersIn(text, { words = false } = {}) {
  if (typeof text !== 'string') return [];
  let s = text.normalize('NFKC').toLowerCase();
  if (words) s = s.replace(/[a-z]+/g, (w) => (Object.hasOwn(NUMBER_WORDS, w) ? String(NUMBER_WORDS[w]) : w));
  // '2025.11' 이나 '2026.5' 처럼 연도와 달을 점으로 이은 날짜는 두 숫자로 나눠 본다.
  s = s.replace(/(?<!\d)((?:19|20)\d{2})\.(0?[1-9]|1[0-2])(?![\d.])/g, '$1 $2');
  const out = [];
  for (const m of s.matchAll(/\d[\d,]*(?:\.\d+)*/g)) {
    const raw = m[0].replace(/,(?=\d)/g, '').replace(/[,.]+$/, '');
    if (!raw) continue;
    // 점이 둘 이상이면 버전 번호다. 숫자로 바꾸지 않고 글자 그대로 비교한다.
    out.push((raw.match(/\./g) ?? []).length >= 2 ? raw : String(Number(raw)));
  }
  return out;
}

/**
 * 슬라이드 문장의 숫자 가운데 근거 문장들에 없는 것을 돌려준다. 빈 목록이면 모두 있다는 뜻이다.
 * @param {string} claimText
 * @param {string[]} quotes
 */
export function missingNumbers(claimText, quotes) {
  const have = new Set((quotes ?? []).flatMap((q) => numbersIn(q, { words: true })));
  return [...new Set(numbersIn(claimText))].filter((n) => !have.has(n));
}
