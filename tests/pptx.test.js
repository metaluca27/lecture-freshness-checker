import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { parsePptx } from '../web/pptx.js';
import { makePptx } from './helpers/make-pptx.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 9, 8, 7]);

// 1장은 글자와 노트, 2장은 그림과 노트, 3장은 노트 없는 글자
async function sample() {
  return makePptx([
    { paragraphs: ['안티그라비티 입문', 'Pro 요금제는 월 $19.99'], notes: ['요금은 강의 전날 다시 확인'] },
    { paragraphs: ['마켓플레이스 화면'], notes: ['그림 설명'], images: [{ name: 'image1.png', bytes: PNG }, { name: 'image2.jpg', bytes: JPG }] },
    { paragraphs: ['플러그인은 60개'] },
  ]);
}

test('세 장을 순서대로 읽고 글자, 노트, 그림을 장마다 나눠 담는다', async () => {
  const slides = await parsePptx(await sample(), JSZip);
  assert.equal(slides.length, 3);
  assert.deepEqual(slides.map((s) => s.slide), [1, 2, 3]);

  assert.equal(slides[0].text, '안티그라비티 입문\nPro 요금제는 월 $19.99');
  assert.equal(slides[0].notes, '요금은 강의 전날 다시 확인');
  assert.deepEqual(slides[0].images, []);

  assert.equal(slides[1].text, '마켓플레이스 화면');
  assert.equal(slides[1].notes, '그림 설명');
  assert.deepEqual(slides[1].images.map((i) => [i.name, i.mime]), [['image1.png', 'image/png'], ['image2.jpg', 'image/jpeg']]);
  assert.deepEqual(Array.from(slides[1].images[0].bytes), Array.from(PNG));

  assert.equal(slides[2].text, '플러그인은 60개');
  assert.equal(slides[2].notes, '');
  assert.deepEqual(slides[2].images, []);
});

test('노트에서 슬라이드 번호 자리 표시는 뺀다', async () => {
  const buf = await makePptx([{ file: 7, paragraphs: ['본문'], notes: ['노트 내용'] }]);
  const [s] = await parsePptx(buf, JSZip);
  assert.equal(s.notes, '노트 내용');
});

test('발표 순서 파일이 없으면 파일 번호의 숫자 순서를 따른다(slide10 은 slide2 뒤)', async () => {
  const buf = await makePptx(
    [{ file: 10, paragraphs: ['열 번째'] }, { file: 2, paragraphs: ['두 번째'] }, { file: 1, paragraphs: ['첫 번째'] }],
    { withPresentation: false },
  );
  const slides = await parsePptx(buf, JSZip);
  assert.deepEqual(slides.map((s) => s.text), ['첫 번째', '두 번째', '열 번째']);
  assert.deepEqual(slides.map((s) => s.slide), [1, 2, 3]);
});

test('발표 순서 파일이 있으면 그 순서를 따른다(파일 번호와 달라도)', async () => {
  const buf = await makePptx(
    [{ file: 1, paragraphs: ['파일 1'] }, { file: 2, paragraphs: ['파일 2'] }, { file: 3, paragraphs: ['파일 3'] }],
    { order: [3, 1, 2] },
  );
  const slides = await parsePptx(buf, JSZip);
  assert.deepEqual(slides.map((s) => s.text), ['파일 3', '파일 1', '파일 2']);
  assert.deepEqual(slides.map((s) => s.slide), [1, 2, 3]);
});

test('XML 표기를 원래 문자로 복원한다', async () => {
  const buf = await makePptx([{ paragraphs: ['It&apos;s &quot;Agent Manager&quot; &amp; more &lt;v2&gt; &#54620;&#xAE00;'] }]);
  const [s] = await parsePptx(buf, JSZip);
  assert.equal(s.text, 'It\'s "Agent Manager" & more <v2> 한글');
});

test('한 문단 안에서 여러 조각으로 나뉜 글자는 이어 붙인다', async () => {
  const zip = new JSZip();
  zip.file('ppt/slides/slide1.xml', '<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>버전 </a:t></a:r><a:r><a:rPr b="1"/><a:t>2.31</a:t></a:r><a:r><a:t xml:space="preserve"> 기준</a:t></a:r></a:p><a:p><a:r><a:t>둘째 줄</a:t></a:r></a:p><a:p></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>');
  const [s] = await parsePptx(await zip.generateAsync({ type: 'arraybuffer' }), JSZip);
  assert.equal(s.text, '버전 2.31 기준\n둘째 줄');
});

test('모델이 읽지 못하는 그림 형식(emf, svg)은 뺀다', async () => {
  const buf = await makePptx([{ paragraphs: ['그림'], images: [{ name: 'a.emf', bytes: PNG }, { name: 'b.svg', bytes: PNG }, { name: 'c.PNG', bytes: PNG }] }]);
  const [s] = await parsePptx(buf, JSZip);
  assert.deepEqual(s.images.map((i) => i.name), ['c.PNG']);
});

test('깨진 파일은 읽을 수 없다는 오류를 낸다', async () => {
  const junk = new TextEncoder().encode('이건 pptx 가 아니에요').buffer;
  await assert.rejects(() => parsePptx(junk, JSZip), /pptx 파일을 읽을 수 없어요/);
});

test('zip 이지만 슬라이드가 없으면 읽을 수 없다는 오류를 낸다', async () => {
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document/>');
  await assert.rejects(async () => parsePptx(await zip.generateAsync({ type: 'arraybuffer' }), JSZip), /pptx 파일을 읽을 수 없어요/);
});

test('60장은 되고 61장은 60장까지라는 오류를 낸다', async () => {
  const many = (n) => Array.from({ length: n }, (_, i) => ({ paragraphs: [`${i + 1}장`] }));
  const ok = await parsePptx(await makePptx(many(60)), JSZip);
  assert.equal(ok.length, 60);
  await assert.rejects(async () => parsePptx(await makePptx(many(61)), JSZip), /60장까지 검사할 수 있어요/);
});
