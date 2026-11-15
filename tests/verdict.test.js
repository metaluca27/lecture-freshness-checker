import test from 'node:test';
import assert from 'node:assert/strict';
import { finalize } from '../worker/verdict.js';

const domains = { tier1: ['antigravity.google'], tier2: ['cloud.google.com'] };

const T1 = 'https://antigravity.google/docs/plugins';
const T2 = 'https://cloud.google.com/blog/antigravity';
const T3 = 'https://github.com/someone/antigravity-plugins';

const pages = [
  { url: T1, text: 'The marketplace lists 54 plugins today. The Pro plan costs $19.99 per month.' },
  { url: T2, text: 'Antigravity ships with 60 plugins at launch. The Pro plan costs $19.99 per month.' },
  { url: T3, text: 'A list of 54 official plugins for Antigravity, maintained by the community.' },
];

const ev = (url, quote, stance) => ({ url, quote, stance });

test('changed, 근거가 1등급 본문에 있고 수정안이 있으면 changed', () => {
  const r = finalize(
    { verdict: 'changed', evidence: [ev(T1, 'The marketplace lists 54 plugins today', 'changed')], suggestion: '플러그인은 54개입니다.' },
    pages, domains,
  );
  assert.equal(r.verdict, 'changed');
  assert.equal(r.reason, null);
  assert.equal(r.suggestion, '플러그인은 54개입니다.');
  assert.equal(r.humanTask, null);
  assert.deepEqual(r.evidence, [{ url: T1, hostname: 'antigravity.google', tier: 1, quote: 'The marketplace lists 54 plugins today' }]);
});

test('same, 근거가 2등급 본문에 있으면 same', () => {
  const r = finalize(
    { verdict: 'same', evidence: [ev(T2, 'The Pro plan costs $19.99 per month', 'same')], suggestion: null },
    pages, domains,
  );
  assert.equal(r.verdict, 'same');
  assert.equal(r.reason, null);
  assert.equal(r.suggestion, null);
  assert.equal(r.humanTask, null);
  assert.equal(r.evidence[0].tier, 2);
});

test('same 인데 모델이 수정안을 보내도 버린다', () => {
  const r = finalize(
    { verdict: 'same', evidence: [ev(T1, 'The Pro plan costs $19.99 per month', 'same')], suggestion: '쓸데없는 수정안' },
    pages, domains,
  );
  assert.equal(r.verdict, 'same');
  assert.equal(r.suggestion, null);
});

test('changed, 근거가 3등급 본문에만 있으면 unverified(no_official_source)', () => {
  const r = finalize(
    { verdict: 'changed', evidence: [ev(T3, 'A list of 54 official plugins for Antigravity', 'changed')], suggestion: '54개입니다.' },
    pages, domains,
  );
  assert.equal(r.verdict, 'unverified');
  assert.equal(r.reason, 'no_official_source');
  assert.equal(r.suggestion, null);
  assert.ok(r.humanTask);
  assert.deepEqual(r.evidence, []);
});

test('changed, 근거가 본문에 없으면(지어낸 문장) unverified(quote_not_in_page)', () => {
  const r = finalize(
    { verdict: 'changed', evidence: [ev(T1, 'The marketplace lists 72 plugins today', 'changed')], suggestion: '72개입니다.' },
    pages, domains,
  );
  assert.equal(r.verdict, 'unverified');
  assert.equal(r.reason, 'quote_not_in_page');
  assert.equal(r.suggestion, null);
  assert.ok(r.humanTask);
  assert.deepEqual(r.evidence, []);
});

test('근거 주소가 가져온 페이지 목록에 없으면 unverified(quote_not_in_page)', () => {
  const r = finalize(
    { verdict: 'same', evidence: [ev('https://antigravity.google/docs/never-fetched', 'The Pro plan costs $19.99 per month', 'same')], suggestion: null },
    pages, domains,
  );
  assert.equal(r.verdict, 'unverified');
  assert.equal(r.reason, 'quote_not_in_page');
});

test('다른 페이지의 문장을 1등급 주소에 붙여도 인정하지 않는다', () => {
  const r = finalize(
    { verdict: 'same', evidence: [ev(T1, 'Antigravity ships with 60 plugins at launch', 'same')], suggestion: null },
    pages, domains,
  );
  assert.equal(r.verdict, 'unverified');
  assert.equal(r.reason, 'quote_not_in_page');
});

test('changed 인데 수정안이 없으면 unverified(no_matching_quote)', () => {
  for (const suggestion of [null, undefined, '', '   ']) {
    const r = finalize(
      { verdict: 'changed', evidence: [ev(T1, 'The marketplace lists 54 plugins today', 'changed')], suggestion },
      pages, domains,
    );
    assert.equal(r.verdict, 'unverified');
    assert.equal(r.reason, 'no_matching_quote');
    assert.equal(r.suggestion, null);
    assert.ok(r.humanTask);
  }
});

test('same 근거는 2등급, changed 근거는 1등급이면 1등급을 따라 changed', () => {
  const r = finalize(
    {
      verdict: 'same',
      evidence: [ev(T2, 'Antigravity ships with 60 plugins at launch', 'same'), ev(T1, 'The marketplace lists 54 plugins today', 'changed')],
      suggestion: '플러그인은 54개입니다.',
    },
    pages, domains,
  );
  assert.equal(r.verdict, 'changed');
  assert.equal(r.reason, null);
  assert.equal(r.evidence.length, 1);
  assert.equal(r.evidence[0].tier, 1);
});

test('changed 근거는 2등급, same 근거는 1등급이면 1등급을 따라 same', () => {
  const r = finalize(
    {
      verdict: 'changed',
      evidence: [ev(T2, 'Antigravity ships with 60 plugins at launch', 'changed'), ev(T1, 'The marketplace lists 54 plugins today', 'same')],
      suggestion: '60개입니다.',
    },
    pages, domains,
  );
  assert.equal(r.verdict, 'same');
  assert.equal(r.reason, null);
  assert.equal(r.suggestion, null);
  assert.equal(r.evidence[0].tier, 1);
});

test('같은 등급 안에서 근거가 서로 어긋나면 unverified', () => {
  const r = finalize(
    {
      verdict: 'changed',
      evidence: [ev(T1, 'The marketplace lists 54 plugins today', 'changed'), ev(T1, 'The Pro plan costs $19.99 per month', 'same')],
      suggestion: '54개입니다.',
    },
    pages, domains,
  );
  assert.equal(r.verdict, 'unverified');
  assert.equal(r.reason, 'no_matching_quote');
});

test('근거에 stance 가 없으면 전체 판정을 그 근거의 뜻으로 본다', () => {
  const r = finalize(
    { verdict: 'same', evidence: [{ url: T1, quote: 'The Pro plan costs $19.99 per month' }], suggestion: null },
    pages, domains,
  );
  assert.equal(r.verdict, 'same');
});

test('모델이 unverified 라고 하면 unverified(no_matching_quote), 모델의 할 일 문구를 쓴다', () => {
  const r = finalize({ verdict: 'unverified', evidence: [], suggestion: null, humanTask: '요금 페이지를 직접 확인하세요.' }, pages, domains);
  assert.equal(r.verdict, 'unverified');
  assert.equal(r.reason, 'no_matching_quote');
  assert.equal(r.humanTask, '요금 페이지를 직접 확인하세요.');
  assert.equal(r.suggestion, null);
});

test('근거가 하나도 없는 same 은 unverified(no_matching_quote)', () => {
  const r = finalize({ verdict: 'same', evidence: [], suggestion: null }, pages, domains);
  assert.equal(r.verdict, 'unverified');
  assert.equal(r.reason, 'no_matching_quote');
});

test('JSON 이 아니거나 형식이 틀리면 unverified(no_matching_quote)', () => {
  const badInputs = [null, undefined, 'same', 42, [], {}, { verdict: 'maybe' }, { verdict: 'same', evidence: 'none' }, { verdict: 'same', evidence: [null, 3, { url: 5, quote: {} }] }];
  for (const bad of badInputs) {
    const r = finalize(bad, pages, domains);
    assert.equal(r.verdict, 'unverified');
    assert.equal(r.reason, 'no_matching_quote');
    assert.equal(r.suggestion, null);
    assert.ok(r.humanTask);
    assert.deepEqual(r.evidence, []);
  }
});

test('가져온 페이지 목록이 비어 있거나 이상해도 예외를 내지 않는다', () => {
  const j = { verdict: 'same', evidence: [ev(T1, 'The Pro plan costs $19.99 per month', 'same')], suggestion: null };
  for (const badPages of [[], null, undefined, [null], [{ url: T1 }]]) {
    const r = finalize(j, badPages, domains);
    assert.equal(r.verdict, 'unverified');
  }
});

// ---------- "그대로"의 숫자 확인 ----------

test('same 이어도 슬라이드의 숫자가 근거 문장에 없으면 unverified 로 돌리고 빠진 숫자를 알려 준다', () => {
  const r = finalize(
    { verdict: 'same', evidence: [ev(T1, 'The Pro plan costs $19.99 per month', 'same')], suggestion: null },
    pages, domains, 'Pro 는 월 19.99달러, 플러그인은 54개',
  );
  assert.equal(r.verdict, 'unverified');
  assert.equal(r.reason, 'no_matching_quote');
  assert.match(r.humanTask, /54/);
  assert.ok(!/19\.99/.test(r.humanTask), '확인된 숫자는 할 일에 적지 않는다');
  assert.deepEqual(r.evidence, []);
});

test('same 이고 숫자가 근거 문장들에 나뉘어 모두 있으면 same', () => {
  const r = finalize(
    { verdict: 'same', evidence: [ev(T1, 'The Pro plan costs $19.99 per month', 'same'), ev(T1, 'The marketplace lists 54 plugins today', 'same')], suggestion: null },
    pages, domains, 'Pro 는 월 19.99달러, 플러그인은 54개',
  );
  assert.equal(r.verdict, 'same');
  assert.equal(r.evidence.length, 2);
});

test('슬라이드 문장을 주지 않으면 숫자 확인을 하지 않는다(예전 동작)', () => {
  const r = finalize({ verdict: 'same', evidence: [ev(T1, 'The Pro plan costs $19.99 per month', 'same')], suggestion: null }, pages, domains);
  assert.equal(r.verdict, 'same');
});

test('changed 판정에는 숫자 확인을 적용하지 않는다', () => {
  const r = finalize(
    { verdict: 'changed', evidence: [ev(T1, 'The marketplace lists 54 plugins today', 'changed')], suggestion: '54개로 고쳐요.' },
    pages, domains, '플러그인은 60개',
  );
  assert.equal(r.verdict, 'changed');
});
