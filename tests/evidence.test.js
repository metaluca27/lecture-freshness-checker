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
