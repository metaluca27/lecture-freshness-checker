import test from 'node:test';
import assert from 'node:assert/strict';
import { runCheck, pickImage } from '../web/run.js';

const domains = { tier1: ['antigravity.google'], tier2: [] };
const slidesOf = (n) => Array.from({ length: n }, (_, i) => ({ slide: i + 1, text: `${i + 1}장 글자`, notes: `${i + 1}장 노트`, images: [] }));
const tick = (ms = 1) => new Promise((r) => setTimeout(r, ms));

// 가짜 api. perSlide 는 장마다 뽑을 내용 수.
function fakeApi({ perSlide = 2, delay = 1, failExtract = [], failCheck = [] } = {}) {
  const s = { active: 0, maxActive: 0, extractCalls: [], checkCalls: [] };
  const enter = async () => { s.active++; s.maxActive = Math.max(s.maxActive, s.active); await tick(delay); s.active--; };
  return {
    stats: s,
    extract: async (input) => {
      s.extractCalls.push(input);
      await enter();
      if (failExtract.includes(input.slide)) throw new Error('extract boom');
      const n = typeof perSlide === 'function' ? perSlide(input.slide) : perSlide;
      return { claims: Array.from({ length: n }, (_, i) => ({ id: `s${input.slide}-c${i + 1}`, slide: input.slide, origin: 'text', text: `${input.slide}장 내용 ${i + 1}`, kind: 'number', query: 'q', keywords: [] })) };
    },
    check: async ({ claim, domains: d }) => {
      s.checkCalls.push({ claim, domains: d });
      await enter();
      if (failCheck.includes(claim.id)) throw new Error('check boom');
      return { claimId: claim.id, verdict: 'same', evidence: [], references: [], suggestion: null, humanTask: null, reason: null };
    },
  };
}

test('슬라이드 3장: 추출한 뒤 내용을 하나씩 검사하고 진행 상황을 알린다', async () => {
  const api = fakeApi();
  const events = [];
  const out = await runCheck(slidesOf(3), domains, api, (e) => events.push(e));

  assert.equal(api.stats.extractCalls.length, 3);
  assert.deepEqual(api.stats.extractCalls[0], { slide: 1, text: '1장 글자', notes: '1장 노트', imageDataUrl: null, context: '1장 글자\n2장 글자\n3장 글자\n1장 노트\n2장 노트\n3장 노트' });
  assert.equal(out.claims.length, 6);
  assert.equal(out.results.length, 6);
  assert.deepEqual(out.claims.map((c) => c.id), ['s1-c1', 's1-c2', 's2-c1', 's2-c2', 's3-c1', 's3-c2'], '슬라이드 순서대로');
  assert.deepEqual(out.results.map((r) => r.claimId), out.claims.map((c) => c.id), '결과도 같은 순서');
  assert.deepEqual(api.stats.checkCalls[0].domains, domains);

  const ex = events.filter((e) => e.phase === 'extract');
  const ch = events.filter((e) => e.phase === 'check');
  assert.equal(ex.length, 3);
  assert.equal(ch.length, 6);
  assert.deepEqual(ex[ex.length - 1].done, 3);
  assert.equal(ex[0].total, 3);
  assert.equal(ch[ch.length - 1].done, 6);
  assert.equal(ch[0].total, 6);
  assert.ok(ch.every((e) => e.claim && e.result));
  assert.equal(events[events.length - 1].phase, 'done');
  assert.equal(out.stopped, false);
  assert.equal(out.skipped, 0);
});

test('동시에 나가는 요청은 최대 3개', async () => {
  const api = fakeApi({ perSlide: 3, delay: 5 });
  await runCheck(slidesOf(8), domains, api, () => {});
  assert.equal(api.stats.maxActive, 3);
});

test('내용은 PPT 하나당 최대 60개만 검사하고, 넘친 수를 알려 준다', async () => {
  const api = fakeApi({ perSlide: 8, delay: 0 });
  const out = await runCheck(slidesOf(10), domains, api, () => {});
  assert.equal(out.claims.length, 60);
  assert.equal(out.results.length, 60);
  assert.equal(out.skipped, 20);
  assert.equal(api.stats.checkCalls.length, 60);
  assert.equal(out.claims[59].id, 's8-c4', '앞 슬라이드부터 채운다');
});

test('검사 요청이 실패하면 그 내용만 unverified 로 두고 나머지는 계속한다', async () => {
  const api = fakeApi({ failCheck: ['s2-c1'] });
  const out = await runCheck(slidesOf(3), domains, api, () => {});
  assert.equal(out.results.length, 6);
  const failed = out.results.find((r) => r.claimId === 's2-c1');
  assert.equal(failed.verdict, 'unverified');
  assert.equal(failed.reason, 'api_error');
  assert.ok(failed.humanTask);
  assert.deepEqual(failed.evidence, []);
  assert.deepEqual(failed.references, []);
  assert.equal(out.results.filter((r) => r.verdict === 'same').length, 5);
});

test('추출 요청이 실패한 장은 건너뛰고 기록해 둔다', async () => {
  const api = fakeApi({ failExtract: [2] });
  const out = await runCheck(slidesOf(3), domains, api, () => {});
  assert.deepEqual(out.failedSlides, [2]);
  assert.deepEqual(out.claims.map((c) => c.slide), [1, 1, 3, 3]);
  assert.equal(out.results.length, 4);
});

test('사용자가 중단하면 진행 중인 요청 뒤에 멈추고 지금까지 결과를 돌려준다', async () => {
  const api = fakeApi({ perSlide: 4, delay: 5 });
  const controller = new AbortController();
  let checked = 0;
  const out = await runCheck(slidesOf(5), domains, api, (e) => {
    if (e.phase === 'check' && ++checked === 4) controller.abort();
  }, { signal: controller.signal });

  assert.equal(out.stopped, true);
  assert.equal(out.claims.length, 20, '뽑은 내용은 모두 남긴다');
  assert.ok(out.results.length >= 4 && out.results.length <= 7, `검사한 것만 담긴다: ${out.results.length}`);
  assert.ok(api.stats.checkCalls.length <= 7);
  assert.ok(out.results.every((r) => r && r.claimId));
});

test('추출 단계에서 중단해도 예외 없이 돌려준다', async () => {
  const api = fakeApi({ delay: 5 });
  const controller = new AbortController();
  const out = await runCheck(slidesOf(9), domains, api, (e) => { if (e.phase === 'extract' && e.done === 2) controller.abort(); }, { signal: controller.signal });
  assert.equal(out.stopped, true);
  assert.equal(api.stats.checkCalls.length, 0);
  assert.deepEqual(out.results, []);
});

test('걸린 시간을 잰다', async () => {
  const out = await runCheck(slidesOf(2), domains, fakeApi({ delay: 10 }), () => {});
  assert.ok(out.elapsedMs >= 15, `elapsedMs=${out.elapsedMs}`);
  assert.ok(out.elapsedMs < 5000);
});

test('글자도 노트도 없는 장은 추출 요청을 보내지 않는다', async () => {
  const api = fakeApi();
  const slides = [{ slide: 1, text: '', notes: '  ', images: [] }, { slide: 2, text: '글자', notes: '', images: [] }];
  const out = await runCheck(slides, domains, api, () => {});
  assert.deepEqual(api.stats.extractCalls.map((c) => c.slide), [2]);
  assert.equal(out.claims.length, 2);
});

// ---------- 슬라이드 그림 읽기 ----------

const img = (name, size) => ({ name, bytes: new Uint8Array(size), mime: 'image/png' });

test('pickImage: 글자가 적고 그림이 있는 장에서 가장 큰 그림을 고른다', () => {
  const slide = { slide: 1, text: '', notes: '노트', images: [img('icon.png', 10), img('full.png', 500000), img('photo.png', 30000)] };
  assert.equal(pickImage(slide).name, 'full.png');
});

test('pickImage: 글자가 충분한 장과 그림이 없는 장은 고르지 않는다', () => {
  assert.equal(pickImage({ slide: 1, text: '가'.repeat(200), notes: '', images: [img('a.png', 5000)] }), null);
  assert.equal(pickImage({ slide: 1, text: '', notes: '', images: [] }), null);
  assert.equal(pickImage({ slide: 1, text: '', notes: '' }), null);
});

test('pickImage: 아이콘처럼 아주 작은 그림뿐이면 고르지 않는다', () => {
  assert.equal(pickImage({ slide: 1, text: '', notes: '', images: [img('icon.png', 2000)] }), null);
});

test('imageFor 가 준 그림을 추출 요청에 함께 보낸다', async () => {
  const api = fakeApi();
  const slides = [{ slide: 1, text: '', notes: '', images: [img('full.png', 50000)] }, { slide: 2, text: '글자가 있는 장', notes: '', images: [] }];
  const seen = [];
  await runCheck(slides, domains, api, () => {}, { imageFor: async (s) => { seen.push(s.slide); return s.slide === 1 ? 'data:image/jpeg;base64,AAAA' : null; } });
  const bySlide = Object.fromEntries(api.stats.extractCalls.map((c) => [c.slide, c.imageDataUrl]));
  assert.deepEqual(bySlide, { 1: 'data:image/jpeg;base64,AAAA', 2: null });
  assert.deepEqual(seen.sort(), [1, 2]);
});

test('그림에서 나온 내용은 origin 이 image 로 남는다', async () => {
  const api = fakeApi();
  api.extract = async (input) => ({ claims: [{ id: `s${input.slide}-c1`, slide: input.slide, origin: input.imageDataUrl ? 'image' : 'text', text: '그림 속 버전 2.31', kind: 'version' }] });
  const out = await runCheck([{ slide: 1, text: '', notes: '', images: [img('full.png', 50000)] }], domains, api, () => {}, { imageFor: async () => 'data:image/jpeg;base64,AAAA' });
  assert.equal(out.claims[0].origin, 'image');
});

test('그림 준비에 실패해도 글자와 노트는 검사한다', async () => {
  const api = fakeApi();
  const out = await runCheck([{ slide: 1, text: '글자', notes: '노트', images: [img('full.png', 50000)] }], domains, api, () => {}, { imageFor: async () => { throw new Error('canvas 실패'); } });
  assert.equal(api.stats.extractCalls[0].imageDataUrl, null);
  assert.equal(out.results.length, 2);
  assert.deepEqual(out.failedSlides, []);
});

test('슬라이드 글자가 거의 없으면 발표 노트를 자료 주제로 보낸다', async () => {
  const api = fakeApi();
  await runCheck([{ slide: 1, text: '', notes: '제미나이 노트북 사용법을 소개해요', images: [] }], domains, api, () => {});
  assert.match(api.stats.extractCalls[0].context, /제미나이 노트북/);
});

test('onProgress 가 예외를 내도 검사는 계속한다', async () => {
  const out = await runCheck(slidesOf(2), domains, fakeApi(), () => { throw new Error('화면 오류'); });
  assert.equal(out.results.length, 4);
});
