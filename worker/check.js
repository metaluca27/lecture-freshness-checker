// 내용 하나를 검사하는 흐름.
// 검색 → 출처 등급 분류 → 공식 본문 읽기 → 모델 판정 → 코드 규칙으로 최종 판정.
// 네트워크를 쓰는 일은 deps 로 받아서, 시험에서는 가짜로 바꿔 끼운다.
//   deps.search(query)        -> [{ url, title, hostname, ... }]
//   deps.fetchPage(url)       -> { url, text }
//   deps.judge(claim, pages)  -> 모델 답변(JSON)

import { tierOf } from './tiers.js';
import { excerptFor } from './page.js';
import { finalize, unverified } from './verdict.js';

const MAX_OFFICIAL_PAGES = 3;
const MAX_REFERENCES = 3;
const EXCERPT_CHARS = 12000;

// 같은 페이지를 주소만 조금 달리 여러 번 세지 않게 한다(끝 빗금, ?hl=ko 같은 꼬리 무시).
function pageKey(url) {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase() + u.pathname.replace(/\/+$/, '');
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

// 공식 도메인 아래에 있는 사용자 게시판·커뮤니티 글인가. (예: support.google.com/…/thread/…)
export function isUserGenerated(url) {
  try {
    return /\/(thread|threads|community|communities|forum|forums|discussions?|questions?)(\/|$)/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

// 본문에서 조각을 고를 때 쓸 낱말
function termsOf(claim) {
  const fromKeywords = Array.isArray(claim.keywords) ? claim.keywords.filter((k) => typeof k === 'string') : [];
  const fromText = `${claim.text ?? ''} ${claim.query ?? ''}`.split(/[\s,()[\]"'“”]+/).filter((w) => w.length >= 3 || /\d/.test(w));
  return [...new Set([...fromKeywords, ...fromText].map((t) => t.trim()).filter(Boolean))].slice(0, 20);
}

/**
 * @param {object} claim 내용(Claim). query, keywords 는 있으면 쓴다
 * @param {{ tier1?: string[], tier2?: string[] }} domains
 * @param {{ search: Function, fetchPage: Function, judge: Function }} deps
 * @returns {Promise<object>} 판정 결과(Result). 예외를 밖으로 내지 않는다
 */
export async function checkClaim(claim, domains, deps) {
  const claimId = claim && typeof claim.id === 'string' ? claim.id : null;
  const done = (partial, references = []) => ({ claimId, ...partial, references });

  try {
    if (!claim || typeof claim.text !== 'string' || !claim.text.trim()) return done(unverified('api_error'));

    const query = typeof claim.query === 'string' && claim.query.trim() ? claim.query.trim() : claim.text.trim();
    const listOf = (v) => (Array.isArray(v) ? v.filter((d) => typeof d === 'string' && d.trim()).map((d) => d.trim()) : []);
    const officialDomains = [...new Set([...listOf(domains?.tier1), ...listOf(domains?.tier2)])];

    // 1) 검색 두 번: 공식 사이트 한정(판정 근거용)과 일반(참고 출처용).
    //    공식 사이트가 여러 곳이면 한 번에 묶어 찾는다.
    let siteFilter = '';
    if (officialDomains.length === 1) siteFilter = `site:${officialDomains[0]}`;
    else if (officialDomains.length > 1) siteFilter = `(${officialDomains.map((d) => `site:${d}`).join(' OR ')})`;
    const queries = [query];
    if (siteFilter) queries.unshift(`${siteFilter} ${query}`);
    const settled = await Promise.allSettled(queries.map((q) => deps.search(q)));
    if (settled.every((s) => s.status === 'rejected')) return done(unverified('api_error'));

    const seen = new Set();
    const hits = [];
    for (const s of settled) {
      if (s.status !== 'fulfilled' || !Array.isArray(s.value)) continue;
      for (const r of s.value) {
        const key = r && typeof r.url === 'string' ? pageKey(r.url) : null;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        // 공식 도메인 안에 있어도 사용자들이 쓴 글(질문 게시판 등)은 공식 문서가 아니다.
        const tier = isUserGenerated(r.url) ? 3 : tierOf(r.url, domains);
        hits.push({ url: r.url, title: typeof r.title === 'string' ? r.title : '', tier });
      }
    }

    // 2) 등급 분류. 3등급은 참고로만 보여 주고 열지 않는다.
    const references = hits
      .filter((h) => h.tier === 3)
      .slice(0, MAX_REFERENCES)
      .map((h) => ({ url: h.url, hostname: hostnameOf(h.url), title: h.title }));
    const official = hits
      .filter((h) => h.tier < 3)
      .sort((a, b) => a.tier - b.tier)
      .slice(0, MAX_OFFICIAL_PAGES);
    const terms = termsOf(claim);

    // 공식 페이지를 읽고 모델에 판정을 맡긴 뒤 코드 규칙으로 최종 판정한다.
    // allPages 는 지금까지 읽은 공식 본문 전체다(근거 대조는 조각이 아니라 본문 전체로 한다).
    const allPages = [];
    const judgeWith = async (candidates) => {
      const fetched = await Promise.allSettled(candidates.map((h) => deps.fetchPage(h.url)));
      const pages = fetched
        .filter((f) => f.status === 'fulfilled' && f.value && typeof f.value.text === 'string' && f.value.text)
        .map((f) => f.value)
        .filter((p) => tierOf(p.url, domains) < 3 && !isUserGenerated(p.url)); // 다른 곳으로 넘겨진 페이지는 뺀다
      if (pages.length === 0) return unverified('page_unreadable');
      allPages.push(...pages);
      // 긴 본문은 낱말 주변 조각만 모델에 준다.
      const shown = pages.map((p) => ({ url: p.url, text: excerptFor(p.text, terms, { maxChars: EXCERPT_CHARS }) }));
      let judgement;
      try {
        judgement = await deps.judge(claim, shown);
      } catch {
        return unverified('api_error');
      }
      return finalize(judgement, allPages, domains, claim.text, claim.kind);
    };

    // 3) 첫 판정
    let result = official.length === 0 ? unverified('no_official_source') : await judgeWith(official);

    // 4) 근거를 못 찾았으면 한 번만 더 찾아본다. 검색어를 본문에 나올 법한 낱말로 바꿔
    //    아직 읽지 않은 공식 페이지를 찾는다. 그래도 없으면 확인 못 함으로 둔다.
    const retryable = result.verdict === 'unverified' && ['no_matching_quote', 'no_official_source', 'page_unreadable'].includes(result.reason);
    const keywords = Array.isArray(claim.keywords) ? claim.keywords.filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim()) : [];
    const retryQuery = keywords.slice(0, 5).join(' ');
    if (retryable && siteFilter && keywords.length >= 2 && retryQuery.toLowerCase() !== query.toLowerCase()) {
      let more = [];
      try {
        more = await deps.search(`${siteFilter} ${retryQuery}`);
      } catch {
        more = [];
      }
      const fresh = [];
      for (const r of Array.isArray(more) ? more : []) {
        const key = r && typeof r.url === 'string' ? pageKey(r.url) : null;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        if (isUserGenerated(r.url)) continue;
        const tier = tierOf(r.url, domains);
        if (tier < 3) fresh.push({ url: r.url, tier });
      }
      fresh.sort((a, b) => a.tier - b.tier);
      if (fresh.length > 0) {
        const second = await judgeWith(fresh.slice(0, MAX_OFFICIAL_PAGES));
        if (second.verdict !== 'unverified') result = second;
        else if (result.reason !== 'no_matching_quote' && second.reason === 'no_matching_quote') result = second;
      }
    }

    return done(result, references);
  } catch {
    return done(unverified('api_error'));
  }
}
