import test from 'node:test';
import assert from 'node:assert/strict';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parsePdf } from '../web/pdf.js';
import { makePdf } from './helpers/make-pdf.js';

// 시험에서는 캔버스가 없으므로 그림 그리기를 가짜로 바꾼다.
function fakeRender() {
  const calls = [];
  const renderPage = async (page, pageNumber) => { calls.push(pageNumber); return { bytes: new Uint8Array(20000), mime: 'image/jpeg' }; };
  renderPage.calls = calls;
  return renderPage;
}

const LONG = ['The Pro plan costs $19.99 per month and includes weekly limits.', 'Version 2.31 is the latest release as of November 2026.', 'Open the Customizations tab in the left sidebar to browse plugins.'];

test('쪽마다 글자를 읽어 슬라이드와 같은 모양으로 돌려준다', async () => {
  const renderPage = fakeRender();
  const pages = await parsePdf(makePdf([LONG, ['Second page line one', 'Second page line two', ...LONG]]), pdfjsLib, { renderPage });
  assert.equal(pages.length, 2);
  assert.deepEqual(pages.map((p) => p.slide), [1, 2]);
  assert.match(pages[0].text, /The Pro plan costs \$19\.99 per month/);
  assert.match(pages[0].text, /Version 2\.31 is the latest release/);
  assert.match(pages[1].text, /Second page line one\s+Second page line two/);
  assert.equal(pages[0].notes, '');
  assert.deepEqual(pages[0].images, []);
  assert.deepEqual(renderPage.calls, [], '글자가 충분한 쪽은 그림으로 만들지 않는다');
});

test('글자가 없는 쪽(스캔한 쪽)은 그림으로 만들어 함께 담는다', async () => {
  const renderPage = fakeRender();
  const pages = await parsePdf(makePdf([LONG, [], ['Short']]), pdfjsLib, { renderPage });
  assert.deepEqual(renderPage.calls, [2, 3]);
  assert.equal(pages[1].text, '');
  assert.equal(pages[1].images.length, 1);
  assert.equal(pages[1].images[0].mime, 'image/jpeg');
  assert.equal(pages[1].images[0].name, 'page-2.jpg');
  assert.equal(pages[2].text, 'Short');
  assert.equal(pages[2].images.length, 1);
});

test('그림 그리기에 실패해도 글자는 돌려준다', async () => {
  const pages = await parsePdf(makePdf([['Short text']]), pdfjsLib, { renderPage: async () => { throw new Error('canvas 없음'); } });
  assert.equal(pages[0].text, 'Short text');
  assert.deepEqual(pages[0].images, []);
});

test('renderPage 를 주지 않으면 글자만 읽는다', async () => {
  const pages = await parsePdf(makePdf([[]]), pdfjsLib);
  assert.deepEqual(pages, [{ slide: 1, text: '', notes: '', images: [] }]);
});

test('깨진 파일은 읽을 수 없다는 오류를 낸다', async () => {
  const junk = new TextEncoder().encode('이건 pdf 가 아니에요');
  await assert.rejects(() => parsePdf(junk, pdfjsLib), /pdf 파일을 읽을 수 없어요/);
});

test('60쪽은 되고 61쪽은 60쪽까지라는 오류를 낸다', async () => {
  const many = (n) => Array.from({ length: n }, (_, i) => [`Page ${i + 1}`]);
  assert.equal((await parsePdf(makePdf(many(60)), pdfjsLib)).length, 60);
  await assert.rejects(() => parsePdf(makePdf(many(61)), pdfjsLib), /60쪽까지 검사할 수 있어요/);
});

test('넘겨받은 바이트를 망가뜨리지 않는다(같은 파일을 다시 읽을 수 있다)', async () => {
  const bytes = makePdf([LONG]);
  await parsePdf(bytes, pdfjsLib);
  const again = await parsePdf(bytes, pdfjsLib);
  assert.match(again[0].text, /Pro plan/);
});
