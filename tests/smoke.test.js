import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';

test('GET /health 는 ok: true 를 돌려준다', async () => {
  const res = await worker.fetch(new Request('https://example.test/health'), {});
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('모르는 경로는 404 를 돌려준다', async () => {
  const res = await worker.fetch(new Request('https://example.test/nope'), {});
  assert.equal(res.status, 404);
});
