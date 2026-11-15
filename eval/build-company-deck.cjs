// 가상 사내 교육자료(eval/company-deck.json)를 PowerPoint 에서 열 수 있는 .pptx 로 만든다.
//   node eval/build-company-deck.cjs
// 문장은 company-deck.json 의 것을 한 글자도 바꾸지 않고 넣는다. 검사기가 읽는 글자가 측정 때와 같아야 하기 때문이다.

const fs = require('node:fs');
const path = require('node:path');
const pptxgen = require('pptxgenjs');

const deck = JSON.parse(fs.readFileSync(path.join(__dirname, 'company-deck.json'), 'utf8'));
const OUT = path.join(__dirname, '..', 'tests', 'fixtures', 'company-training-sample.pptx');

const C = { dark: '0F3D3E', mint: '2FB5A0', tint: 'EAF5F2', ink: '1B2B2B', muted: '5B6B6B', white: 'FFFFFF', line: 'CFE3DE' };
const FONT = 'Malgun Gothic';

const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9'; // 10 x 5.625 인치
pres.title = deck.slides[0].text[1];
pres.company = '한빛물산(가상의 회사)';

pres.defineSlideMaster({
  title: 'CONTENT',
  background: { color: C.white },
  objects: [
    { text: { text: '한빛물산 인재개발팀 · 2026 하반기 신입사원 교육', options: { x: 0.6, y: 5.18, w: 7, h: 0.3, fontFace: FONT, fontSize: 10, color: C.muted, margin: 0 } } },
  ],
  slideNumber: { x: 9.0, y: 5.18, w: 0.5, h: 0.3, fontFace: FONT, fontSize: 10, color: C.muted, align: 'right' },
});

const text = (slide, value, opts) => slide.addText(value, { fontFace: FONT, color: C.ink, margin: 0, isTextBox: true, ...opts });

function titleOf(slide, value) {
  text(slide, value, { x: 0.6, y: 0.45, w: 8.8, h: 0.8, fontSize: 30, bold: true, color: C.dark, valign: 'middle' });
}

// 번호 동그라미가 붙은 카드. 카드 안의 문장은 자료의 문장 그대로다.
function card(slide, { x, y, w, h, badge, sentence, fontSize = 16 }) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.12, fill: { color: C.tint }, line: { color: C.line, width: 0.75 } });
  slide.addShape(pres.shapes.OVAL, { x: x + 0.25, y: y + 0.25, w: 0.5, h: 0.5, fill: { color: C.mint }, line: { color: C.mint, width: 0 } });
  slide.addText(badge, { x: x + 0.25, y: y + 0.25, w: 0.5, h: 0.5, fontFace: FONT, fontSize: 14, bold: true, color: C.white, align: 'center', valign: 'middle', margin: 0, isTextBox: true, objectName: 'badge' });
  text(slide, sentence, { x: x + 0.25, y: y + 0.9, w: w - 0.5, h: h - 1.1, fontSize, valign: 'top', paraSpaceAfter: 4 });
}

const s = deck.slides;

// 1. 표지
{
  const slide = pres.addSlide();
  slide.background = { color: C.dark };
  slide.addShape(pres.shapes.OVAL, { x: 7.2, y: -1.2, w: 4.4, h: 4.4, fill: { color: C.mint, transparency: 78 }, line: { color: C.mint, width: 0 } });
  slide.addShape(pres.shapes.OVAL, { x: 8.3, y: 2.9, w: 2.6, h: 2.6, fill: { color: C.mint, transparency: 88 }, line: { color: C.mint, width: 0 } });
  text(slide, s[0].text[0], { x: 0.7, y: 1.3, w: 7, h: 0.4, fontSize: 16, color: 'BFE6DD' });
  text(slide, s[0].text[1], { x: 0.7, y: 1.85, w: 8, h: 1.0, fontSize: 40, bold: true, color: C.white, valign: 'middle' });
  text(slide, s[0].text[2], { x: 0.7, y: 3.0, w: 8, h: 0.5, fontSize: 20, color: C.white });
  text(slide, s[0].text[3], { x: 0.7, y: 4.5, w: 4, h: 0.4, fontSize: 14, color: 'BFE6DD' });
  slide.addNotes(s[0].notes.join('\n'));
}

// 2. 설치: 카드 세 장
{
  const slide = pres.addSlide({ masterName: 'CONTENT' });
  titleOf(slide, s[1].text[0]);
  const w = 2.8;
  ['맥', '윈', '버전'].forEach((badge, i) => {
    card(slide, { x: 0.6 + i * (w + 0.2), y: 1.5, w, h: 3.2, badge: String(i + 1), sentence: s[1].text[i + 1], fontSize: 15 });
  });
  slide.addNotes(s[1].notes.join('\n'));
}

// 3. 요금제와 사용량: 넓은 카드 두 장
{
  const slide = pres.addSlide({ masterName: 'CONTENT' });
  titleOf(slide, s[2].text[0]);
  card(slide, { x: 0.6, y: 1.5, w: 4.3, h: 3.2, badge: '1', sentence: s[2].text[1], fontSize: 18 });
  card(slide, { x: 5.1, y: 1.5, w: 4.3, h: 3.2, badge: '2', sentence: s[2].text[2], fontSize: 18 });
  slide.addNotes(s[2].notes.join('\n'));
}

// 4. 노트북 한도: 위아래 두 줄
{
  const slide = pres.addSlide({ masterName: 'CONTENT' });
  titleOf(slide, s[3].text[0]);
  [0, 1].forEach((i) => {
    const y = 1.5 + i * 1.7;
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.6, y, w: 8.8, h: 1.5, rectRadius: 0.12, fill: { color: C.tint }, line: { color: C.line, width: 0.75 } });
    slide.addShape(pres.shapes.OVAL, { x: 0.9, y: y + 0.45, w: 0.6, h: 0.6, fill: { color: C.dark }, line: { color: C.dark, width: 0 } });
    slide.addText(String(i + 1), { x: 0.9, y: y + 0.45, w: 0.6, h: 0.6, fontFace: FONT, fontSize: 16, bold: true, color: C.white, align: 'center', valign: 'middle', margin: 0, isTextBox: true });
    text(slide, s[3].text[i + 1], { x: 1.8, y: y + 0.2, w: 7.3, h: 1.1, fontSize: 20, bold: true, valign: 'middle' });
  });
  slide.addNotes(s[3].notes.join('\n'));
}

// 5. 플러그인: 왼쪽 큰 카드, 오른쪽 작은 카드
{
  const slide = pres.addSlide({ masterName: 'CONTENT' });
  titleOf(slide, s[4].text[0]);
  card(slide, { x: 0.6, y: 1.5, w: 5.0, h: 3.2, badge: '1', sentence: s[4].text[1], fontSize: 18 });
  card(slide, { x: 5.8, y: 1.5, w: 3.6, h: 3.2, badge: '2', sentence: s[4].text[2], fontSize: 16 });
  slide.addNotes(s[4].notes.join('\n'));
}

// 6. 지켜 주세요: 어두운 바탕에 세 줄
{
  const slide = pres.addSlide();
  slide.background = { color: C.dark };
  text(slide, s[5].text[0], { x: 0.7, y: 0.5, w: 8.6, h: 0.8, fontSize: 30, bold: true, color: C.white, valign: 'middle' });
  s[5].text.slice(1).forEach((line, i) => {
    const y = 1.6 + i * 1.1;
    slide.addShape(pres.shapes.OVAL, { x: 0.7, y: y + 0.1, w: 0.6, h: 0.6, fill: { color: C.mint }, line: { color: C.mint, width: 0 } });
    slide.addText(String(i + 1), { x: 0.7, y: y + 0.1, w: 0.6, h: 0.6, fontFace: FONT, fontSize: 16, bold: true, color: C.dark, align: 'center', valign: 'middle', margin: 0, isTextBox: true });
    text(slide, line, { x: 1.6, y, w: 7.7, h: 0.8, fontSize: 20, color: C.white, valign: 'middle' });
  });
  slide.addNotes(s[5].notes.join('\n'));
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
pres.writeFile({ fileName: OUT }).then(() => console.log('만듦:', path.relative(process.cwd(), OUT)));
