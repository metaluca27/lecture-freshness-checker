import test from 'node:test';
import assert from 'node:assert/strict';
import { tierOf } from '../worker/tiers.js';

const domains = { tier1: ['antigravity.google'], tier2: ['cloud.google.com'] };

const cases = [
  ['https://antigravity.google/docs/plugins', 1],
  ['https://docs.antigravity.google/x', 1],
  ['https://ANTIGRAVITY.google/Pricing', 1],
  ['https://cloud.google.com/blog/x', 2],
  ['https://github.com/someone/antigravity-plugins', 3],
  ['https://github.com/official/antigravity-official-plugins', 3],
  ['https://antigravity.google.evil.com/', 3],
  ['https://evilantigravity.google/', 3],
  ['http://antigravity.google/docs', 3],
  ['주소 아님', 3],
  ['', 3],
];

for (const [url, expected] of cases) {
  test(`${url || '(빈 문자열)'} 은 ${expected}등급`, () => {
    assert.equal(tierOf(url, domains), expected);
  });
}

test('사용자가 적은 도메인의 대소문자와 앞뒤 공백, 맨 앞 점은 무시한다', () => {
  const messy = { tier1: [' Antigravity.Google '], tier2: ['.cloud.google.com'] };
  assert.equal(tierOf('https://antigravity.google/docs', messy), 1);
  assert.equal(tierOf('https://cloud.google.com/x', messy), 2);
});

test('도메인 설정이 비어 있으면 모두 3등급', () => {
  assert.equal(tierOf('https://antigravity.google/docs', {}), 3);
  assert.equal(tierOf('https://antigravity.google/docs', { tier1: [''], tier2: [] }), 3);
});
