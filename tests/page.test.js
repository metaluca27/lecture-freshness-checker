import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafePublicUrl, htmlToText, fetchPageText, excerptFor } from '../worker/page.js';

// ---------- isSafePublicUrl ----------

const urlCases = [
  ['https://antigravity.google/docs', true],
  ['https://docs.example.co.kr/a/b?c=d', true],
  ['http://antigravity.google/docs', false],
  ['ftp://antigravity.google/docs', false],
  ['https://localhost/x', false],
  ['https://LOCALHOST/x', false],
  ['https://127.0.0.1/x', false],
  ['https://[::1]/x', false],
  ['https://10.0.0.1/x', false],
  ['https://192.168.0.1/x', false],
  ['https://169.254.169.254/x', false],
  ['https://8.8.8.8/x', false], // 숫자 주소는 공개 주소라도 받지 않는다
  ['https://user:pw@example.com/', false],
  ['https://example.com:8443/', false],
  ['https://intranet/', false], // 점 없는 이름
  ['https://printer.local/', false],
  ['https://db.internal/', false],
  ['https://app.localhost/', false],
  ['주소 아님', false],
  ['', false],
  [null, false],
];

for (const [url, expected] of urlCases) {
  test(`isSafePublicUrl(${JSON.stringify(url)}) 는 ${expected}`, () => {
    assert.equal(isSafePublicUrl(url), expected);
  });
}

// ---------- htmlToText ----------

test('htmlToText 는 script, style, nav, footer 를 지우고 본문을 남긴다', () => {
  const html = `<!doctype html><html><head><title>제목</title><style>.a{color:red}</style>
    <script>var secret = "스크립트 글자";</script></head>
    <body><nav><a href="/">메뉴 글자</a></nav>
    <main><h1>요금 안내</h1><p>Pro 요금제는 <b>월 $19.99</b>입니다.</p><ul><li>첫째</li><li>둘째</li></ul></main>
    <footer>바닥 글자</footer><!-- 주석 글자 --></body></html>`;
  const text = htmlToText(html);
  assert.match(text, /요금 안내/);
  assert.match(text, /Pro 요금제는 월 \$19\.99입니다\./);
  assert.match(text, /첫째\n둘째/);
  for (const gone of ['스크립트 글자', '메뉴 글자', '바닥 글자', '주석 글자', 'color:red']) {
    assert.ok(!text.includes(gone), `${gone} 이 남아 있으면 안 된다`);
  }
});

test('htmlToText 는 HTML 표기를 원래 문자로 복원한다', () => {
  assert.equal(htmlToText('<p>A &amp; B &lt;v2&gt; &quot;x&quot; &#39;y&#39;&nbsp;z &#xD55C;</p>'), 'A & B <v2> "x" \'y\' z 한');
});

// ---------- excerptFor ----------

test('excerptFor 는 낱말 주변만 잘라 준다', () => {
  const text = 'a'.repeat(5000) + ' The Pro plan costs $19.99 per month. ' + 'b'.repeat(5000);
  const ex = excerptFor(text, ['Pro plan'], { maxChars: 1000, window: 100 });
  assert.ok(ex.length <= 1000);
  assert.match(ex, /The Pro plan costs \$19\.99 per month\./);
});

test('excerptFor 는 낱말이 없으면 앞부분을 돌려준다', () => {
  const text = '처음 문장입니다. ' + 'x'.repeat(5000);
  const ex = excerptFor(text, ['없는낱말'], { maxChars: 300 });
  assert.equal(ex.length, 300);
  assert.ok(ex.startsWith('처음 문장입니다.'));
});

test('excerptFor 는 짧은 본문은 그대로 돌려준다', () => {
  assert.equal(excerptFor('짧은 본문', ['본문'], { maxChars: 1000 }), '짧은 본문');
});

test('excerptFor 는 대소문자를 가리지 않고, 겹치는 조각은 합친다', () => {
  const text = 'x'.repeat(3000) + ' AGENT MANAGER opens. Agent Manager closes. ' + 'y'.repeat(3000);
  const ex = excerptFor(text, ['agent manager'], { maxChars: 2000, window: 50 });
  assert.equal(ex.match(/opens/g).length, 1);
  assert.match(ex, /closes/);
});

// ---------- fetchPageText ----------

// 가짜 fetch. routes 는 { 주소: 응답 설정 }.
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push(String(url));
    const r = routes[String(url)];
    if (!r) return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    if (r.throw) throw r.throw;
    return new Response(r.body ?? '', { status: r.status ?? 200, headers: r.headers ?? { 'content-type': 'text/html; charset=utf-8' } });
  };
  impl.calls = calls;
  return impl;
}

const HTML = (body) => `<html><body><main>${body}</main></body></html>`;
const LONG = '본문 내용입니다. '.repeat(20);

test('평범한 HTML 페이지의 본문을 읽는다', async () => {
  const f = fakeFetch({ 'https://example.com/pricing': { body: HTML(`<p>Pro 는 월 $19.99 ${LONG}</p>`) } });
  const page = await fetchPageText('https://example.com/pricing', { fetchImpl: f });
  assert.equal(page.url, 'https://example.com/pricing');
  assert.match(page.text, /Pro 는 월 \$19\.99/);
});

test('안전하지 않은 주소는 가져오지 않는다', async () => {
  const f = fakeFetch({});
  await assert.rejects(() => fetchPageText('http://example.com/x', { fetchImpl: f }), /unsafe_url/);
  await assert.rejects(() => fetchPageText('https://127.0.0.1/x', { fetchImpl: f }), /unsafe_url/);
  assert.equal(f.calls.length, 0);
});

test('/docs 주소는 .md 를 먼저 시도하고, 돌려주는 주소는 사람이 여는 원래 주소다', async () => {
  const f = fakeFetch({
    'https://example.com/docs/plugins.md': { body: `# Plugins\n\nThere are 54 plugins. ${LONG}`, headers: { 'content-type': 'text/markdown; charset=utf-8' } },
    'https://example.com/docs/plugins': { body: HTML('HTML 쪽 본문') },
  });
  const page = await fetchPageText('https://example.com/docs/plugins', { fetchImpl: f });
  assert.equal(page.url, 'https://example.com/docs/plugins');
  assert.match(page.text, /There are 54 plugins/);
  assert.deepEqual(f.calls, ['https://example.com/docs/plugins.md']);
});

test('.md 가 없으면 HTML 로 읽는다', async () => {
  const f = fakeFetch({ 'https://example.com/docs/plugins': { body: HTML(`<p>HTML 쪽 본문 ${LONG}</p>`) } });
  const page = await fetchPageText('https://example.com/docs/plugins', { fetchImpl: f });
  assert.match(page.text, /HTML 쪽 본문/);
  assert.deepEqual(f.calls, ['https://example.com/docs/plugins.md', 'https://example.com/docs/plugins']);
});

test('.md 주소가 HTML 을 돌려주면 쓰지 않는다', async () => {
  const f = fakeFetch({
    'https://example.com/docs/plugins.md': { body: HTML('<p>찾을 수 없는 페이지</p>') },
    'https://example.com/docs/plugins': { body: HTML(`<p>진짜 본문 ${LONG}</p>`) },
  });
  const page = await fetchPageText('https://example.com/docs/plugins', { fetchImpl: f });
  assert.match(page.text, /진짜 본문/);
});

test('HTTP 리다이렉트를 따라가되 넘겨받은 주소를 다시 검사한다', async () => {
  const ok = fakeFetch({
    'https://example.com/old': { status: 301, headers: { location: '/new' } },
    'https://example.com/new': { body: HTML(`<p>새 페이지 ${LONG}</p>`) },
  });
  const page = await fetchPageText('https://example.com/old', { fetchImpl: ok });
  assert.equal(page.url, 'https://example.com/new');
  assert.match(page.text, /새 페이지/);

  const bad = fakeFetch({
    'https://example.com/old': { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data' } },
  });
  await assert.rejects(() => fetchPageText('https://example.com/old', { fetchImpl: bad }), /unsafe_url/);
  assert.deepEqual(bad.calls, ['https://example.com/old']);
});

test('리다이렉트가 끝없이 이어지면 멈춘다', async () => {
  const f = fakeFetch({
    'https://example.com/a': { status: 302, headers: { location: '/b' } },
    'https://example.com/b': { status: 302, headers: { location: '/a' } },
  });
  await assert.rejects(() => fetchPageText('https://example.com/a', { fetchImpl: f }), /too_many_redirects/);
  assert.ok(f.calls.length <= 6);
});

test('"Redirecting to" 안내 페이지는 한 번 더 따라간다', async () => {
  const f = fakeFetch({
    'https://example.com/changelog': { body: '<html><head><meta http-equiv="refresh" content="0;url=/docs/changelog"></head><body><a href="/docs/changelog">Redirecting to: /docs/changelog</a></body></html>' },
    'https://example.com/docs/changelog.md': { body: `# Changelog\n\nVersion 2.31 released. ${LONG}`, headers: { 'content-type': 'text/markdown' } },
  });
  const page = await fetchPageText('https://example.com/changelog', { fetchImpl: f });
  assert.equal(page.url, 'https://example.com/docs/changelog');
  assert.match(page.text, /Version 2\.31 released/);
});

test('404 나 500 은 오류', async () => {
  const f = fakeFetch({ 'https://example.com/boom': { status: 500, body: 'x' } });
  await assert.rejects(() => fetchPageText('https://example.com/nope', { fetchImpl: f }), /http_404/);
  await assert.rejects(() => fetchPageText('https://example.com/boom', { fetchImpl: f }), /http_500/);
});

test('글자가 아닌 파일(PDF, 그림)은 읽지 않는다', async () => {
  const f = fakeFetch({ 'https://example.com/a.pdf': { body: '%PDF-1.7', headers: { 'content-type': 'application/pdf' } } });
  await assert.rejects(() => fetchPageText('https://example.com/a.pdf', { fetchImpl: f }), /not_text/);
});

test('크기 제한을 넘으면 오류', async () => {
  const f = fakeFetch({ 'https://example.com/big': { body: HTML('가'.repeat(5000)) } });
  await assert.rejects(() => fetchPageText('https://example.com/big', { fetchImpl: f, maxBytes: 1000 }), /too_large/);
});

test('본문이 거의 비어 있으면(화면 렌더링 방식) 오류', async () => {
  const f = fakeFetch({ 'https://example.com/spa': { body: '<html><body><div id="root"></div><script>app()</script></body></html>' } });
  await assert.rejects(() => fetchPageText('https://example.com/spa', { fetchImpl: f }), /empty_page/);
});

test('시간 제한을 넘으면 오류', async () => {
  const slow = async (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason ?? new Error('aborted')));
  });
  await assert.rejects(() => fetchPageText('https://example.com/slow', { fetchImpl: slow, timeoutMs: 30 }), /timeout/);
});

test('네트워크 오류는 fetch_failed 로 바꾼다', async () => {
  const f = fakeFetch({ 'https://example.com/x': { throw: new TypeError('network down') } });
  await assert.rejects(() => fetchPageText('https://example.com/x', { fetchImpl: f }), /fetch_failed/);
});

test('아주 긴 본문은 상한까지만 담는다', async () => {
  const f = fakeFetch({ 'https://example.com/long': { body: HTML('<p>' + 'word '.repeat(2000) + '</p>') } });
  const page = await fetchPageText('https://example.com/long', { fetchImpl: f, maxChars: 500 });
  assert.equal(page.text.length, 500);
});
