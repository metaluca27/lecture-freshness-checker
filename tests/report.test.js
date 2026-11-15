import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, toMarkdown, VERDICT_LABEL, formatElapsed } from '../web/report.js';

const claims = [
  { id: 's2-c1', slide: 2, origin: 'text', text: '앱 최신 버전은 2.28이에요', kind: 'version' },
  { id: 's2-c2', slide: 2, origin: 'notes', text: '왼쪽 메뉴의 Customizations 에서 열어요', kind: 'menu' },
  { id: 's12-c1', slide: 12, origin: 'text', text: '플러그인이 60개 있어요', kind: 'number' },
  { id: 's12-c2', slide: 12, origin: 'image', text: '검사 안 한 내용', kind: 'number' },
];

const results = [
  { claimId: 's12-c1', verdict: 'unverified', evidence: [], references: [{ url: 'https://github.com/someone/antigravity-plugins', hostname: 'github.com', title: '54 official plugins' }], suggestion: null, humanTask: '마켓플레이스에서 직접 세어 보세요.', reason: 'no_matching_quote' },
  { claimId: 's2-c1', verdict: 'changed', evidence: [{ url: 'https://antigravity.google/download/', hostname: 'antigravity.google', tier: 1, quote: 'Antigravity App\nv2.31.2' }], references: [], suggestion: '최신 버전을 2.31.2로 고쳐요.', humanTask: null, reason: null },
  { claimId: 's2-c2', verdict: 'same', evidence: [{ url: 'https://cloud.google.com/blog/x', hostname: 'cloud.google.com', tier: 2, quote: 'Open the **Customizations** tab' }], references: [], suggestion: null, humanTask: null, reason: null },
];

test('summarize 는 판정별 개수를 센다', () => {
  assert.deepEqual(summarize(results), { same: 1, changed: 1, unverified: 1, total: 3 });
  assert.deepEqual(summarize([]), { same: 0, changed: 0, unverified: 0, total: 0 });
  assert.deepEqual(summarize([{ verdict: 'weird' }, null]), { same: 0, changed: 0, unverified: 0, total: 0 });
});

test('화면 표시는 그대로, 바뀜, 확인 못 함', () => {
  assert.deepEqual(VERDICT_LABEL, { same: '그대로', changed: '바뀜', unverified: '확인 못 함' });
});

test('formatElapsed 는 사람이 읽는 시간으로 바꾼다', () => {
  assert.equal(formatElapsed(42_300), '42초');
  assert.equal(formatElapsed(185_000), '3분 5초');
  assert.equal(formatElapsed(120_000), '2분');
});

test('toMarkdown 은 슬라이드 순서로 원래 문장, 판정, 근거, 출처, 수정안이나 할 일을 쓴다', () => {
  const md = toMarkdown(claims, results, { fileName: '강의.pptx', domains: { tier1: ['antigravity.google'], tier2: ['cloud.google.com'] }, elapsedMs: 185_000, checkedAt: '2026-11-13' });

  assert.match(md, /^# 강의자료 유통기한 검사 결과/);
  assert.match(md, /강의\.pptx/);
  assert.match(md, /2026-11-13/);
  assert.match(md, /3분 5초/);
  assert.match(md, /antigravity\.google/);
  assert.match(md, /바뀜 1.*그대로 1.*확인 못 함 1/s);

  // 슬라이드 순서: 2장이 12장보다 먼저
  assert.ok(md.indexOf('## 슬라이드 2') < md.indexOf('## 슬라이드 12'));
  assert.equal(md.match(/## 슬라이드 2\b/g).length, 1, '같은 장은 한 번만 제목을 쓴다');

  // 바뀜
  assert.match(md, /\*\*바뀜\*\*/);
  assert.match(md, /앱 최신 버전은 2\.28이에요/);
  assert.match(md, /수정안: 최신 버전을 2\.31\.2로 고쳐요\./);
  assert.match(md, /Antigravity App v2\.31\.2/, '근거 문장의 줄바꿈은 한 줄로');
  assert.match(md, /https:\/\/antigravity\.google\/download\//);
  assert.match(md, /1등급/);

  // 그대로
  assert.match(md, /\*\*그대로\*\*/);
  assert.match(md, /2등급/);

  // 확인 못 함
  assert.match(md, /\*\*확인 못 함\*\*/);
  assert.match(md, /할 일: 마켓플레이스에서 직접 세어 보세요\./);
});

test('3등급 출처는 "참고"로 구분해 쓰고 근거라고 하지 않는다', () => {
  const md = toMarkdown(claims, results, {});
  const block = md.slice(md.indexOf('플러그인이 60개 있어요'));
  assert.match(block, /참고\(판정 근거 아님\)/);
  assert.match(block, /github\.com/);
  assert.ok(!/근거:.*github\.com/.test(block));
});

test('결과가 없는 내용(중단, 한도 초과)은 검사하지 않았다고 쓴다', () => {
  const md = toMarkdown(claims, results, { skipped: 5, stopped: true });
  assert.match(md, /검사 안 한 내용/);
  assert.match(md, /검사하지 않음/);
  assert.match(md, /5개/);
  assert.match(md, /중단/);
});

test('원래 문장에 Markdown 기호가 있어도 문서 구조를 깨지 않는다', () => {
  const md = toMarkdown([{ id: 'a', slide: 1, text: '# 제목처럼 보이는 글\n| 표 | 처럼 |' }], [{ claimId: 'a', verdict: 'same', evidence: [], references: [] }], {});
  assert.ok(!/^# 제목처럼/m.test(md));
  assert.ok(!/\n\| 표/.test(md));
});

test('PDF 결과는 슬라이드 대신 쪽으로 쓴다', () => {
  const md = toMarkdown(claims, results, { unit: '쪽' });
  assert.match(md, /^## 2쪽$/m);
  assert.match(md, /^## 12쪽$/m);
  assert.ok(!md.includes('## 슬라이드'));
});
