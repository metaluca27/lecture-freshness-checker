// 정답을 미리 아는 가상 자료로 검사기를 처음부터 끝까지 잰다.
// eval/company-deck.json 의 슬라이드로 PPT 를 만들고, 화면과 같은 흐름(추출 → 검사)으로 돌린 뒤
// 일부러 심어 둔 내용을 맞게 판정했는지 센다.
//
// 쓰는 법(워커가 켜져 있어야 한다):
//   node eval/run-deck-eval.js             한 번
//   node eval/run-deck-eval.js --runs 3    세 번 돌려 흔들림도 본다
//   node eval/run-deck-eval.js --file tests/fixtures/company-training-sample.pptx
//                                          같은 내용으로 만든 실제 PPT 파일로 잰다(eval/build_company_deck.py 가 만든다)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { parsePptx } from '../web/pptx.js';
import { runCheck } from '../web/run.js';
import { makePptx } from '../tests/helpers/make-pptx.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? true);
};
const BASE = arg('base', 'http://localhost:8798');
const ORIGIN = arg('origin', 'http://localhost:8799');
const RUNS = Math.max(1, Number(arg('runs', '1')) || 1);
const LABEL = { same: '그대로', changed: '바뀜', unverified: '확인 못 함', missing: '안 뽑힘' };

const xmlEscape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 한 번 돌린 결과를 심어 둔 정답과 맞춰 본다. 시험할 수 있게 따로 둔다. */
export function grade(planted, claims, results) {
  const byId = new Map(results.map((r) => [r.claimId, r]));
  const used = new Set();
  const rows = planted.map((p) => {
    const re = new RegExp(p.match, 'i');
    const claim = claims.find((c) => c.slide === p.slide && re.test(c.text) && !used.has(c.id));
    if (!claim) return { key: p.key, expected: p.expected, got: 'missing', claim: null, result: null };
    used.add(claim.id);
    const r = byId.get(claim.id);
    return { key: p.key, expected: p.expected, got: r?.verdict ?? 'unverified', claim, result: r ?? null };
  });
  // 심지 않은 내용인데 바뀜이라고 한 것은 억울한 바뀜이다.
  const extraChanged = claims.filter((c) => !used.has(c.id) && byId.get(c.id)?.verdict === 'changed');
  return { rows, extraChanged, extracted: claims.length };
}

async function call(pathname, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(BASE + pathname, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify(body) });
    if (res.ok) return res.json();
    if (attempt < 2 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 4000));
      continue;
    }
    throw new Error(`HTTP ${res.status}`);
  }
}

async function main() {
  const deck = JSON.parse(fs.readFileSync(path.join(here, 'company-deck.json'), 'utf8'));
  const file = arg('file', null);
  const pptx = typeof file === 'string'
    ? fs.readFileSync(file)
    : await makePptx(deck.slides.map((s) => ({ paragraphs: s.text.map(xmlEscape), notes: (s.notes ?? []).map(xmlEscape) })));

  const slides = await parsePptx(pptx, JSZip);
  const api = { extract: (i) => call('/api/extract', i), check: (i) => call('/api/check', i) };
  console.log(`가상 자료 ${slides.length}장 · 심어 둔 내용 ${deck.planted.length}개(바뀜 ${deck.planted.filter((p) => p.expected === 'changed').length}) · ${RUNS}번 · 워커 ${BASE}\n`);

  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const out = await runCheck(slides, deck.domains, api, () => {});
    const g = grade(deck.planted, out.claims, out.results);
    runs.push({ ...g, elapsedMs: out.elapsedMs });
    const ok = g.rows.filter((r) => r.got === r.expected).length;
    console.log(`${i + 1}번째: 뽑힌 내용 ${g.extracted}개 · 정답과 일치 ${ok}/${g.rows.length} · 억울한 바뀜 ${g.extraChanged.length} · ${Math.round(out.elapsedMs / 1000)}초`);
  }

  console.log('\n내용별 판정');
  let unstable = 0;
  for (const p of deck.planted) {
    const gots = runs.map((r) => r.rows.find((x) => x.key === p.key).got);
    if (new Set(gots).size > 1) unstable++;
    const mark = gots.every((g) => g === p.expected) ? '○' : gots.some((g) => g === p.expected) ? '△' : '✕';
    console.log(`${mark} [${p.slide}장 ${p.key}] 정답 ${LABEL[p.expected]} / 검사기 ${gots.map((g) => LABEL[g]).join(', ')}`);
  }

  const all = runs.flatMap((r) => r.rows);
  const count = (f) => all.filter(f).length;
  const summary = {
    runs: RUNS,
    planted: deck.planted.length,
    match: count((r) => r.got === r.expected),
    total: all.length,
    changedCaught: count((r) => r.expected === 'changed' && r.got === 'changed'),
    changedTotal: count((r) => r.expected === 'changed'),
    falseChangedPlanted: count((r) => r.expected !== 'changed' && r.got === 'changed'),
    falseChangedExtra: runs.reduce((n, r) => n + r.extraChanged.length, 0),
    overclaimed: count((r) => r.expected === 'unverified' && (r.got === 'same' || r.got === 'changed')),
    notExtracted: count((r) => r.got === 'missing'),
    unstable,
    avgSeconds: Math.round(runs.reduce((n, r) => n + r.elapsedMs, 0) / runs.length / 1000),
    avgExtracted: Math.round(runs.reduce((n, r) => n + r.extracted, 0) / runs.length),
  };

  console.log(`\n정답과 일치: ${summary.match} / ${summary.total}`);
  console.log(`심어 둔 낡은 정보를 잡아냄: ${summary.changedCaught} / ${summary.changedTotal}`);
  console.log(`맞는 내용을 바뀜이라고 함: ${summary.falseChangedPlanted} (심지 않은 내용에서는 ${summary.falseChangedExtra})`);
  console.log(`공식 문서에 없는 내용을 단정함: ${summary.overclaimed}`);
  console.log(`아예 안 뽑힌 내용: ${summary.notExtracted}`);
  if (RUNS > 1) console.log(`실행마다 판정이 달랐던 내용: ${summary.unstable} / ${summary.planted}`);
  console.log(`평균 ${summary.avgSeconds}초, 뽑힌 내용 평균 ${summary.avgExtracted}개`);

  const outDir = path.join(here, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = path.join(outDir, `deck-eval-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ summary, runs }, null, 1));
  console.log(`\n자세한 결과: ${path.relative(process.cwd(), outPath)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error('측정 실패:', e.message);
    process.exit(1);
  });
}
