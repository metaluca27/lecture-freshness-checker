import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorker } from '../worker/index.js';

const ORIGIN = 'https://vaulted-bus-346411.web.app';
const KEY = 'route-test-key-DO-NOT-LEAK';
const env = { LINER_API_KEY: KEY };
const domains = { tier1: ['antigravity.google'], tier2: ['cloud.google.com'] };
const claim = { id: 's1-c1', slide: 1, origin: 'text', text: '플러그인은 60개', kind: 'number', query: 'Antigravity plugins', keywords: ['plugins'] };

function fakes(over = {}) {
  const log = { chat: [], search: [], fetched: [] };
  return {
    log,
    chatJson: async (messages, e, options) => {
      log.chat.push({ messages, options });
      if (over.chatError) throw over.chatError;
      const name = options?.schemaName;
      if (over.chat) return over.chat(name, messages);
      if (name === 'sites') return { tier1: ['Antigravity.Google'], tier2: ['cloud.google.com'] };
      if (name === 'claims') return { claims: [{ text: '플러그인은 60개', kind: 'number', origin: 'text', query: 'q', keywords: ['plugins'] }] };
      return { verdict: 'unverified', evidence: [], suggestion: null, humanTask: '직접 확인' };
    },
    search: async (q) => { log.search.push(q); return over.results ?? []; },
    fetchPageText: async (url) => { log.fetched.push(url); return { url, text: over.pageText ?? 'Some official page text that is long enough to count.' }; },
  };
}

const post = (path, body, { origin = ORIGIN, raw, headers = {} } = {}) =>
  new Request(`https://worker.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}), ...headers },
    body: raw ?? JSON.stringify(body),
  });

// ---------- 출처(CORS) ----------

test('허용 출처는 CORS 를 허용한다', async () => {
  for (const origin of [ORIGIN, 'http://localhost:8799']) {
    const w = makeWorker(fakes());
    const res = await w.fetch(post('/api/suggest-sites', { sample: '안티그라비티 강의' }, { origin }), env);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), origin);
    assert.match(res.headers.get('vary') ?? '', /Origin/i);
  }
});

test('사전 요청(OPTIONS)에 허용 메서드와 헤더를 알려 준다', async () => {
  const w = makeWorker(fakes());
  const res = await w.fetch(new Request('https://worker.test/api/check', { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'POST' } }), env);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
  assert.match(res.headers.get('access-control-allow-methods'), /POST/);
  assert.match(res.headers.get('access-control-allow-headers'), /content-type/i);
});

test('그 밖의 출처와 출처 없는 요청은 403', async () => {
  const f = fakes();
  const w = makeWorker(f);
  for (const origin of ['https://evil.example.com', 'https://vaulted-bus-346411.web.app.evil.com', 'http://localhost:3000', null]) {
    const res = await w.fetch(post('/api/check', { claim, domains }, { origin }), env);
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  }
  assert.equal(f.log.search.length, 0);
});

test('/health 는 출처와 상관없이 열려 있다', async () => {
  const res = await makeWorker(fakes()).fetch(new Request('https://worker.test/health'), env);
  assert.deepEqual(await res.json(), { ok: true });
});

test('모르는 경로는 404, GET 으로 /api 를 부르면 405', async () => {
  const w = makeWorker(fakes());
  assert.equal((await w.fetch(post('/api/open-any-url', { url: 'https://example.com' }), env)).status, 404);
  assert.equal((await w.fetch(new Request('https://worker.test/api/check', { headers: { origin: ORIGIN } }), env)).status, 405);
});

// ---------- 입력 검사 ----------

test('잘못된 JSON 은 400', async () => {
  const w = makeWorker(fakes());
  for (const raw of ['{not json', '', '[1,2]', '"글자"']) {
    const res = await w.fetch(post('/api/check', null, { raw }), env);
    assert.equal(res.status, 400);
  }
});

test('/api/check: claim.text 가 1,000자를 넘으면 400', async () => {
  const w = makeWorker(fakes());
  const res = await w.fetch(post('/api/check', { claim: { ...claim, text: '가'.repeat(1001) }, domains }), env);
  assert.equal(res.status, 400);
  const ok = await w.fetch(post('/api/check', { claim: { ...claim, text: '가'.repeat(1000) }, domains }), env);
  assert.equal(ok.status, 200);
});

test('/api/check: claim 이 없거나 글자가 비면 400', async () => {
  const w = makeWorker(fakes());
  for (const body of [{ domains }, { claim: {}, domains }, { claim: { ...claim, text: '  ' }, domains }, { claim: 'x', domains }]) {
    assert.equal((await w.fetch(post('/api/check', body), env)).status, 400);
  }
});

test('/api/check: domains.tier1 이 비어 있거나 도메인 모양이 아니면 400', async () => {
  const f = fakes();
  const w = makeWorker(f);
  const bad = [
    undefined, {}, { tier1: [] }, { tier1: [''] }, { tier1: 'antigravity.google' },
    { tier1: ['https://antigravity.google/docs'] }, { tier1: ['localhost'] }, { tier1: ['a b.com'] },
    { tier1: ['antigravity.google'], tier2: ['not a domain'] },
    { tier1: ['a.com', 'b.com', 'c.com', 'd.com'] },
  ];
  for (const d of bad) {
    assert.equal((await w.fetch(post('/api/check', { claim, domains: d }), env)).status, 400, JSON.stringify(d));
  }
  assert.equal(f.log.search.length, 0);
});

test('/api/extract: 그림이 5MB 를 넘으면 400', async () => {
  const w = makeWorker(fakes());
  const big = 'data:image/png;base64,' + 'A'.repeat(Math.ceil((5 * 1024 * 1024 + 10) * 4 / 3));
  const res = await w.fetch(post('/api/extract', { slide: 1, text: '글', notes: '', imageDataUrl: big }), env);
  assert.equal(res.status, 400);
});

test('/api/extract: 그림 주소가 data:image 가 아니면 400', async () => {
  const w = makeWorker(fakes());
  for (const imageDataUrl of ['https://example.com/a.png', 'data:text/html;base64,AAAA', 'data:image/svg+xml;base64,AAAA', 42]) {
    assert.equal((await w.fetch(post('/api/extract', { slide: 1, text: '글', notes: '', imageDataUrl }), env)).status, 400);
  }
});

test('/api/extract: 슬라이드 번호나 글자가 이상하면 400', async () => {
  const w = makeWorker(fakes());
  for (const body of [{ text: '글' }, { slide: 0, text: '글' }, { slide: 61, text: '글' }, { slide: 1.5, text: '글' }, { slide: 1, text: 42 }, { slide: 1, text: '가'.repeat(20001) }]) {
    assert.equal((await w.fetch(post('/api/extract', body), env)).status, 400, JSON.stringify(body).slice(0, 60));
  }
});

test('요청 본문이 너무 크면 413', async () => {
  const w = makeWorker(fakes());
  const res = await w.fetch(post('/api/check', null, { raw: '{"x":"' + 'a'.repeat(9 * 1024 * 1024) + '"}' }), env);
  assert.equal(res.status, 413);
});

// ---------- 정상 동작 ----------

test('/api/suggest-sites: 모델 제안을 도메인 모양으로 다듬어 돌려준다', async () => {
  const f = fakes({ chat: () => ({ tier1: ['https://Antigravity.Google/docs', 'antigravity.google', 'not a domain'], tier2: ['cloud.google.com', 'github.com/x', 'a.com', 'b.com', 'c.com', 'd.com', 'e.com'] }) });
  const res = await makeWorker(f).fetch(post('/api/suggest-sites', { sample: '안티그라비티 강의' }), env);
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.deepEqual(out.tier1, ['antigravity.google']);
  assert.ok(out.tier2.length <= 5);
  assert.ok(out.tier2.includes('cloud.google.com'));
  assert.ok(out.tier2.every((d) => /^[a-z0-9.-]+$/.test(d)));
});

test('/api/suggest-sites: 자료 제목으로 먼저 검색하고, 나온 사이트를 모델에 함께 보여 준다', async () => {
  const f = fakes({ results: [{ url: 'https://notebook.google.com/', title: 'Gemini Notebook - Google', hostname: 'notebook.google.com' }] });
  const res = await makeWorker(f).fetch(post('/api/suggest-sites', { sample: '제미나이 노트북\nGEMINI NOTEBOOK\n사용법' }), env);
  assert.equal(res.status, 200);
  assert.equal(f.log.search.length, 1);
  assert.match(f.log.search[0], /제미나이 노트북 GEMINI NOTEBOOK 사용법 공식 사이트/);
  const shown = f.log.chat.find((c) => c.options.schemaName === 'sites').messages.map((m) => m.content).join('\n');
  assert.match(shown, /<search_results>\n- notebook\.google\.com · Gemini Notebook - Google\n<\/search_results>/);
});

test('/api/suggest-sites: 모델이 알아낸 제품 이름으로 검색한다', async () => {
  const f = fakes({
    chat: (name) => (name === 'topic' ? { product: 'Gemini Notebook', query: 'Gemini Notebook official site' } : { tier1: ['notebook.google.com'], tier2: [] }),
    results: [{ url: 'https://notebook.google.com/', title: 'Gemini Notebook', hostname: 'notebook.google.com' }],
  });
  const res = await makeWorker(f).fetch(post('/api/suggest-sites', { sample: '강사 아무개\n출퇴근길이 1:1 과외가 되는\n제미나이 노트북' }), env);
  assert.deepEqual(f.log.search, ['Gemini Notebook official site']);
  assert.deepEqual((await res.json()).tier1, ['notebook.google.com']);
});

test('/api/suggest-sites: 검색이 실패해도 제안은 계속한다', async () => {
  const f = fakes();
  f.search = async () => { throw new Error('search down'); };
  const res = await makeWorker(f).fetch(post('/api/suggest-sites', { sample: '안티그라비티 강의' }), env);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).tier1, ['antigravity.google']);
});

test('/api/suggest-sites: sample 이 없으면 400', async () => {
  const w = makeWorker(fakes());
  assert.equal((await w.fetch(post('/api/suggest-sites', {}), env)).status, 400);
  assert.equal((await w.fetch(post('/api/suggest-sites', { sample: '  ' }), env)).status, 400);
});

test('/api/extract: 내용에 id 와 slide 를 붙이고 8개까지만 돌려준다', async () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ text: `내용 ${i + 1}`, kind: 'number', origin: 'text', query: 'q', keywords: ['k'] }));
  const f = fakes({ chat: () => ({ claims: [...many.slice(0, 2), { text: '', kind: 'number', origin: 'text', query: 'q', keywords: [] }, { text: '이상한 종류', kind: 'weird', origin: 'text', query: 'q', keywords: [] }, ...many.slice(2)] }) });
  const res = await makeWorker(f).fetch(post('/api/extract', { slide: 7, text: '글자', notes: '노트', imageDataUrl: null }), env);
  assert.equal(res.status, 200);
  const { claims } = await res.json();
  assert.equal(claims.length, 8);
  assert.deepEqual(claims[0], { id: 's7-c1', slide: 7, origin: 'text', text: '내용 1', kind: 'number', query: 'q', keywords: ['k'] });
  assert.ok(claims.every((c) => c.text && c.kind !== 'weird'));
  assert.deepEqual(claims.map((c) => c.id), ['s7-c1', 's7-c2', 's7-c3', 's7-c4', 's7-c5', 's7-c6', 's7-c7', 's7-c8']);
});

test('/api/extract: 글자도 노트도 그림도 없으면 모델을 부르지 않고 빈 목록', async () => {
  const f = fakes();
  const res = await makeWorker(f).fetch(post('/api/extract', { slide: 1, text: ' ', notes: '', imageDataUrl: null }), env);
  assert.deepEqual(await res.json(), { claims: [] });
  assert.equal(f.log.chat.length, 0);
});

test('/api/check: 판정 결과(Result)를 돌려준다', async () => {
  const url = 'https://antigravity.google/docs/plugins';
  const f = fakes({
    results: [{ url, title: 'Plugins', hostname: 'antigravity.google' }],
    pageText: 'The Marketplace lists 54 plugins today.',
    chat: () => ({ verdict: 'changed', evidence: [{ url, quote: 'The Marketplace lists 54 plugins today', stance: 'changed' }], suggestion: '54개로 고쳐요.', humanTask: null }),
  });
  const res = await makeWorker(f).fetch(post('/api/check', { claim, domains }), env);
  assert.equal(res.status, 200);
  const r = await res.json();
  assert.equal(r.claimId, 's1-c1');
  assert.equal(r.verdict, 'changed');
  assert.equal(r.evidence[0].tier, 1);
  assert.deepEqual(Object.keys(r).sort(), ['claimId', 'evidence', 'humanTask', 'reason', 'references', 'suggestion', 'verdict']);
});

// ---------- 사용량 제한 ----------

test('사용량 제한 바인딩이 거절하면 429', async () => {
  const f = fakes();
  const keys = [];
  const limited = { ...env, RATE_LIMITER: { limit: async ({ key }) => { keys.push(key); return { success: false }; } } };
  const res = await makeWorker(f).fetch(post('/api/check', { claim, domains }, { headers: { 'cf-connecting-ip': '203.0.113.9' } }), limited);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
  assert.deepEqual(keys, ['203.0.113.9']);
  assert.equal(f.log.search.length, 0);
});

test('바인딩이 없으면 워커 메모리의 주소별 카운터로 제한한다', async () => {
  let now = 1_000_000;
  const w = makeWorker({ ...fakes(), now: () => now, memoryLimit: 3 });
  const hit = (ip) => w.fetch(post('/api/suggest-sites', { sample: '강의' }, { headers: { 'cf-connecting-ip': ip } }), env);
  assert.deepEqual([(await hit('1.1.1.1')).status, (await hit('1.1.1.1')).status, (await hit('1.1.1.1')).status], [200, 200, 200]);
  assert.equal((await hit('1.1.1.1')).status, 429);
  assert.equal((await hit('2.2.2.2')).status, 200, '다른 주소는 따로 센다');
  now += 61_000;
  assert.equal((await hit('1.1.1.1')).status, 200, '1분이 지나면 다시 된다');
});

// ---------- 오류 ----------

test('내부 오류는 500 이고 응답에 키나 내부 정보가 없다', async () => {
  const f = fakes({ chatError: new Error(`boom at C:\\secret\\path with ${KEY}`) });
  const res = await makeWorker(f).fetch(post('/api/suggest-sites', { sample: '강의' }), env);
  assert.equal(res.status, 500);
  const text = await res.text();
  assert.ok(!text.includes(KEY));
  assert.ok(!text.includes('secret'));
  assert.ok(!text.includes('boom'));
  assert.deepEqual(JSON.parse(text), { error: 'internal_error' });
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
});

test('Liner 쪽 오류는 502 로 알리고 내부 정보는 싣지 않는다', async () => {
  const err = Object.assign(new Error('liner_rate_limit_exceeded (429)'), { name: 'LinerError', code: 'rate_limit_exceeded', status: 429 });
  const res = await makeWorker(fakes({ chatError: err })).fetch(post('/api/extract', { slide: 1, text: '글', notes: '' }), env);
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: 'upstream_error' });
});

test('키가 설정되지 않았으면 500 이고 모델을 부르지 않는다', async () => {
  const f = fakes();
  const res = await makeWorker(f).fetch(post('/api/suggest-sites', { sample: '강의' }), {});
  assert.equal(res.status, 500);
  assert.equal(f.log.chat.length, 0);
});
