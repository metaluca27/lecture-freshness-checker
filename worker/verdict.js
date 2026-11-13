// 최종 판정 규칙. 모델 답변을 그대로 믿지 않고, 코드 규칙으로 최종 판정을 만든다.
//
// 모델 답변(modelJudgement) 형식:
//   { verdict: 'same' | 'changed' | 'unverified',
//     evidence: [{ url, quote, stance?: 'same' | 'changed' }],
//     suggestion: string | null, humanTask: string | null }
// 가져온 페이지(fetchedPages) 형식: [{ url, text }]

import { tierOf } from './tiers.js';
import { quoteInPage } from './evidence.js';

const HUMAN_TASKS = {
  no_official_source: '공식 사이트에서는 근거를 찾지 못했어요. 공식 문서를 직접 열어 확인해 주세요.',
  quote_not_in_page: '근거 문장이 공식 문서 본문에서 확인되지 않았어요. 공식 문서를 직접 열어 확인해 주세요.',
  no_matching_quote: '공식 문서에서 이 내용과 맞는 문장을 찾지 못했어요. 직접 확인해 주세요.',
};

function unverified(reason, humanTask) {
  const task = typeof humanTask === 'string' && humanTask.trim() ? humanTask.trim() : HUMAN_TASKS[reason];
  return { verdict: 'unverified', evidence: [], suggestion: null, humanTask: task, reason };
}

// 주소 비교용. 뒤의 #조각과 맨 끝 빗금 차이는 같은 페이지로 본다.
function urlKey(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href.replace(/\/$/, '');
  } catch {
    return null;
  }
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * @param {unknown} modelJudgement 모델이 돌려준 판정
 * @param {Array<{url: string, text: string}>} fetchedPages 워커가 실제로 가져온 본문
 * @param {{ tier1?: string[], tier2?: string[] }} domains
 * @returns {{ verdict: string, evidence: Array, suggestion: string|null, humanTask: string|null, reason: string|null }}
 */
export function finalize(modelJudgement, fetchedPages, domains) {
  const j = modelJudgement;
  if (!j || typeof j !== 'object' || Array.isArray(j)) return unverified('no_matching_quote');
  if (!['same', 'changed', 'unverified'].includes(j.verdict)) return unverified('no_matching_quote');
  if (j.verdict === 'unverified') return unverified('no_matching_quote', j.humanTask);
  if (!Array.isArray(j.evidence)) return unverified('no_matching_quote');

  const claimed = j.evidence.filter(
    (e) => e && typeof e === 'object' && typeof e.url === 'string' && typeof e.quote === 'string' && e.quote.trim(),
  );
  if (claimed.length === 0) return unverified('no_matching_quote');

  const pageByUrl = new Map();
  for (const p of Array.isArray(fetchedPages) ? fetchedPages : []) {
    if (!p || typeof p.url !== 'string' || typeof p.text !== 'string') continue;
    const key = urlKey(p.url);
    if (key) pageByUrl.set(key, p);
  }

  // 1) 근거 문장이 그 주소의 본문에 실제로 있는 것만 남긴다.
  const found = [];
  for (const e of claimed) {
    const page = pageByUrl.get(urlKey(e.url));
    if (!page || !quoteInPage(e.quote, page.text)) continue;
    found.push({
      url: page.url,
      hostname: hostnameOf(page.url),
      tier: tierOf(page.url, domains),
      quote: e.quote.trim(),
      stance: e.stance === 'same' || e.stance === 'changed' ? e.stance : j.verdict,
    });
  }
  if (found.length === 0) return unverified('quote_not_in_page');

  // 2) 공식 출처(1, 2등급)만 판정 근거로 쓴다.
  const official = found.filter((e) => e.tier === 1 || e.tier === 2);
  if (official.length === 0) return unverified('no_official_source');

  // 3) 1등급이 있으면 1등급을 따르고, 없으면 2등급을 따른다.
  const topTier = official.some((e) => e.tier === 1) ? 1 : 2;
  const top = official.filter((e) => e.tier === topTier);
  const stances = new Set(top.map((e) => e.stance));
  if (stances.size !== 1) return unverified('no_matching_quote');
  const verdict = top[0].stance;

  const evidence = top.map(({ url, hostname, tier, quote }) => ({ url, hostname, tier, quote }));

  if (verdict === 'changed') {
    const suggestion = typeof j.suggestion === 'string' ? j.suggestion.trim() : '';
    if (!suggestion) return unverified('no_matching_quote');
    return { verdict: 'changed', evidence, suggestion, humanTask: null, reason: null };
  }

  return { verdict: 'same', evidence, suggestion: null, humanTask: null, reason: null };
}
