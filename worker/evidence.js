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
