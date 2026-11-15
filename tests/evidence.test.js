import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, quoteInPage } from '../worker/evidence.js';

const cases = [
  ['공백 차이는 무시한다', 'Version 2.28.2', '... Version   2.28.2 released ...', true],
  ['줄바꿈은 무시한다', '무료 요금제를 제공합니다', '무료\n요금제를 제공합니다', true],
  ['영문 대소문자는 무시한다', 'PLUGIN market', 'the plugin market is open', true],
  ['숫자가 다르면 거짓', '60 plugins', 'over 54 plugins', false],
  ['숫자 중간에서 끊긴 일치는 거짓(뒤)', 'Version 2.28', 'Version 2.28.2', false],
  ['숫자 중간에서 끊긴 일치는 거짓(뒤, 자릿수)', 'costs $19', 'it costs $199 per month', false],
  ['숫자 중간에서 끊긴 일치는 거짓(앞)', '0 plugins available', 'there are 60 plugins available', false],
  ['숫자 뒤 마침표로 문장이 끝나면 참', 'Pro costs $19', 'Pro costs $19. Ultra costs more.', true],
  ['빈 문자열은 거짓', '', '아무 본문', false],
  ['공백뿐이면 거짓', '   \n ', '아무 본문', false],
  ['8자 미만 조각은 거짓', 'plugin', 'plugin market', false],
  ['본문이 비어 있으면 거짓', 'Version 2.28.2', '', false],
  ['Markdown 강조 기호 차이는 무시한다', 'The Pro plan costs $19.99 per month', 'The **Pro** plan costs `$19.99` per month', true],
  ['둥근 따옴표와 곧은 따옴표는 같게 본다', "it's called \"Agent Manager\"", 'it’s called “Agent Manager” now', true],
  ['끊기지 않는 공백도 공백으로 본다', 'Version 2.31 released', 'Version 2.31 released today', true],
  ['Markdown 링크와 제목 표시는 보이는 글자만 비교한다', 'v2.31.2 Latest November 11, 2026', '---\n\n### [v2.31.2](/releases?tab=hub&version=2.31.2 "View release 2.31.2")\n\nLatest\n\nNovember 11, 2026\n\n### Gemini', true],
  ['링크 주소 안에만 있는 글자는 근거가 아니다', 'releases?tab=hub', 'see [v2.31.2](/releases?tab=hub&version=2.31.2) today', false],
  ['앞 일치가 끊겨도 뒤에 온전한 일치가 있으면 참', 'Version 2.28', 'Version 2.28.2 replaced Version 2.28 last week', true],
];

for (const [name, quote, page, expected] of cases) {
  test(name, () => {
    assert.equal(quoteInPage(quote, page), expected);
  });
}

test('문자열이 아닌 값이 와도 예외 없이 거짓', () => {
  assert.equal(quoteInPage(null, 'abc'), false);
  assert.equal(quoteInPage('Version 2.28.2', undefined), false);
  assert.equal(quoteInPage({ a: 1 }, 'abc'), false);
});

test('normalizeText 는 공백을 하나로 줄이고 소문자로 만든다', () => {
  assert.equal(normalizeText('  Hello\n\n  WORLD\t!  '), 'hello world !');
});

// ---------- 숫자 대조 ----------
import { numbersIn, missingNumbers } from '../worker/evidence.js';

test('numbersIn 은 쉼표 든 숫자, 소수, 버전 번호를 가려 모은다', () => {
  assert.deepEqual(numbersIn('월 7,500원, 약 29,000원에 $19.99'), ['7500', '29000', '19.99']);
  assert.deepEqual(numbersIn('최신 버전은 2.31.2 예요. 2.28 이 아니에요.'), ['2.31.2', '2.28']);
  assert.deepEqual(numbersIn('Windows 10(64비트)과 Windows 11'), ['10', '64', '11']);
  assert.deepEqual(numbersIn('숫자가 없는 문장'), []);
  assert.deepEqual(numbersIn(null), []);
});

test('numbersIn 은 요청하면 영어 숫자 낱말과 달 이름도 숫자로 읽는다', () => {
  assert.deepEqual(numbersIn('refreshed every five hours', { words: true }), ['5']);
  assert.deepEqual(numbersIn('Jul 16, 2026', { words: true }), ['7', '16', '2026']);
  assert.deepEqual(numbersIn('starting on September 2.', { words: true }), ['9', '2']);
  assert.deepEqual(numbersIn('Four times higher than standard limits', { words: true }), ['4']);
  assert.deepEqual(numbersIn('refreshed every five hours'), [], '기본은 낱말을 숫자로 읽지 않는다');
});

test('missingNumbers 는 근거 문장에 없는 숫자를 돌려준다', () => {
  assert.deepEqual(missingNumbers('무료는 노트북 100개, 노트북당 소스 50개', ['Notebooks 100/user', 'All sources except notes 50/notebook']), []);
  assert.deepEqual(missingNumbers('Ultra: 월 119,000원 또는 300,000원, 노트북 500개', ['Notebooks 100/user 200/user 500/user']), ['119000', '300000']);
  assert.deepEqual(missingNumbers('5시간마다 다시 충전', ['refreshed every five hours until the weekly limit is reached']), []);
  assert.deepEqual(missingNumbers('2026년 7월부터 이름이 바뀌었어요', ['Jul 16, 2026']), []);
  assert.deepEqual(missingNumbers('최신 버전은 2.31.2', ['v2.31.2 Latest']), []);
  assert.deepEqual(missingNumbers('최신 버전은 2.31', ['v2.31.2 Latest']), ['2.31'], '버전은 통째로 같아야 한다');
  assert.deepEqual(missingNumbers('숫자가 없는 문장', []), []);
});

test('연도와 달을 점으로 이은 날짜(2025.11)는 연도와 달로 나눠 본다', () => {
  assert.deepEqual(numbersIn('2025.11 첫 공개'), ['2025', '11']);
  assert.deepEqual(numbersIn('2026.5 안티그라비티 2.0'), ['2026', '5', '2']);
  assert.deepEqual(missingNumbers('2025.11 첫 공개 제미나이 3와 함께', ['Released on November 18, 2025 alongside Gemini 3']), []);
  assert.deepEqual(numbersIn('버전 2.28 과 2.31.2'), ['2.28', '2.31.2'], '버전 번호는 건드리지 않는다');
});
