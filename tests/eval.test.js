import test from 'node:test';
import assert from 'node:assert/strict';
import { score } from '../eval/run-eval.js';

const row = (expected, got) => ({ expected, got });

test('score 는 정답과 판정을 비교해 수치를 낸다', () => {
  const s = score([
    row('changed', 'changed'), // 잡아냄
    row('changed', 'unverified'), // 놓침
    row('same', 'same'),
    row('same', 'changed'), // 억울한 바뀜
    row('unverified', 'same'), // 근거 없이 단정
    row('unverified', 'unverified'),
  ]);
  assert.deepEqual(s, { total: 6, match: 3, changedTotal: 2, changedCaught: 1, falseChanged: 1, overclaimed: 1, missed: 1 });
});

test('score 는 빈 목록에서도 0 을 낸다', () => {
  assert.deepEqual(score([]), { total: 0, match: 0, changedTotal: 0, changedCaught: 0, falseChanged: 0, overclaimed: 0, missed: 0 });
});

import { grade } from '../eval/run-deck-eval.js';

test('grade 는 심어 둔 내용을 뽑힌 내용과 맞춰 판정을 비교한다', () => {
  const planted = [
    { key: 'ver', slide: 2, match: '2\\.28', expected: 'changed' },
    { key: 'win', slide: 2, match: 'Windows\\s*10', expected: 'same' },
    { key: 'gone', slide: 3, match: '없는 문장', expected: 'same' },
  ];
  const claims = [
    { id: 'a', slide: 2, text: '최신 버전은 2.28이에요' },
    { id: 'b', slide: 2, text: 'Windows 10과 11을 지원해요' },
    { id: 'c', slide: 4, text: '심지 않은 내용' },
    { id: 'd', slide: 9, text: '다른 장의 2.28' },
  ];
  const results = [
    { claimId: 'a', verdict: 'changed' }, { claimId: 'b', verdict: 'unverified' },
    { claimId: 'c', verdict: 'changed' }, { claimId: 'd', verdict: 'same' },
  ];
  const g = grade(planted, claims, results);
  assert.deepEqual(g.rows.map((r) => [r.key, r.got]), [['ver', 'changed'], ['win', 'unverified'], ['gone', 'missing']]);
  assert.deepEqual(g.extraChanged.map((c) => c.id), ['c']);
  assert.equal(g.extracted, 4);
});
