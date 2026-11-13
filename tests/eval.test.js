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
