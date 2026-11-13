// 정답지 측정. 사람이 판정한 정답(eval/answer-key.json)과 검사기의 판정을 비교한다.
//
// 쓰는 법(워커가 켜져 있어야 한다):
//   node eval/run-eval.js                 한 번씩 검사
//   node eval/run-eval.js --runs 3        세 번씩 검사해 판정이 흔들리는지도 본다
//   node eval/run-eval.js --base https://…  배포된 워커로 측정
//
// 정답지 형식: { domains: { tier1, tier2 }, items: [{ id, slide, origin, kind, text, query, keywords, expected, memo }] }

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchPageText } from '../worker/page.js';
import { quoteInPage } from '../worker/evidence.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const BASE = arg('base', 'http://localhost:8798');
const ORIGIN = arg('origin', 'http://localhost:8799');
const RUNS = Math.max(1, Number(arg('runs', '1')));
const KEY_PATH = arg('key', path.join(here, 'answer-key.json'));
const LABEL = { same: '그대로', changed: '바뀜', unverified: '확인 못 함' };

/** 정답과 판정 목록으로 수치를 낸다. 시험할 수 있게 따로 둔다. */
export function score(rows) {
  const total = rows.length;
  const match = rows.filter((r) => r.got === r.expected).length;
  const changedTotal = rows.filter((r) => r.expected === 'changed').length;
  const changedCaught = rows.filter((r) => r.expected === 'changed' && r.got === 'changed').length;
  const falseChanged = rows.filter((r) => r.expected !== 'changed' && r.got === 'changed').length;
  const overclaimed = rows.filter((r) => r.expected === 'unverified' && r.got !== 'unverified').length;
  const missed = rows.filter((r) => r.expected !== 'unverified' && r.got === 'unverified').length;
  return { total, match, changedTotal, changedCaught, falseChanged, overclaimed, missed };
}

async function check(claim, domains) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}/api/check`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ claim, domains }) });
    if (res.ok) return res.json();
    if (attempt < 2 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 4000));
      continue;
    }
    throw new Error(`HTTP ${res.status}`);
  }
}

// 근거 문장이 그 주소의 본문에 정말 있는지 워커와 따로 다시 확인한다. 0이 아니면 버그다.
const pageCache = new Map();
async function evidenceMissing(result) {
  let missing = 0;
  for (const e of result.evidence ?? []) {
    if (!pageCache.has(e.url)) pageCache.set(e.url, fetchPageText(e.url).then((p) => p.text, () => null));
    const text = await pageCache.get(e.url);
    if (text === null || !quoteInPage(e.quote, text)) missing++;
  }
  return missing;
}

async function main() {
  const key = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
  const items = key.items.filter((it) => Object.hasOwn(LABEL, it.expected));
  console.log(`정답지 ${items.length}개 · ${RUNS}번씩 · 워커 ${BASE}\n`);

  const started = Date.now();
  const rows = [];
  let unsupported = 0;
  for (const it of items) {
    const claim = { id: it.id, slide: it.slide, origin: it.origin, kind: it.kind, text: it.text, query: it.query, keywords: it.keywords };
    const verdicts = [];
    const details = [];
    for (let i = 0; i < RUNS; i++) {
      let r;
      try {
        r = await check(claim, key.domains);
      } catch (e) {
        r = { verdict: 'unverified', reason: 'request_failed', evidence: [], suggestion: null, humanTask: null };
      }
      unsupported += await evidenceMissing(r);
      verdicts.push(r.verdict);
      details.push({ verdict: r.verdict, reason: r.reason, suggestion: r.suggestion, evidence: (r.evidence ?? []).map((e) => ({ url: e.url, tier: e.tier, quote: e.quote })) });
    }
    // 여러 번 돌렸으면 가장 많이 나온 판정을 대표로 삼는다.
    const counts = verdicts.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map());
    const got = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const stable = counts.size === 1;
    rows.push({ id: it.id, slide: it.slide, text: it.text, expected: it.expected, memo: it.memo ?? '', got, stable, verdicts, details });
    const mark = got === it.expected ? '○' : '✕';
    console.log(`${mark} [${it.slide}장] ${it.text.replace(/\s+/g, ' ').slice(0, 50)}  정답 ${LABEL[it.expected]} / 검사기 ${verdicts.map((v) => LABEL[v]).join(', ')}`);
  }

  const s = score(rows);
  const unstable = rows.filter((r) => !r.stable).length;
  const summary = {
    ...s,
    unsupportedEvidence: unsupported,
    unstable,
    runs: RUNS,
    elapsedSec: Math.round((Date.now() - started) / 1000),
  };

  console.log(`\n판정이 정답과 일치: ${s.match} / ${s.total}`);
  console.log(`정답이 바뀜인 것을 잡아냄: ${s.changedCaught} / ${s.changedTotal}`);
  console.log(`바뀌지 않았는데 바뀜이라고 함: ${s.falseChanged}`);
  console.log(`정답이 확인 못 함인데 그대로나 바뀜이라고 함: ${s.overclaimed}`);
  console.log(`답이 있는데 확인 못 함이라고 함: ${s.missed}`);
  console.log(`근거가 본문에 없는 판정: ${unsupported}${unsupported ? '  <- 버그!' : ''}`);
  if (RUNS > 1) console.log(`${RUNS}번 가운데 판정이 흔들린 내용: ${unstable}`);

  const outDir = path.join(here, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = path.join(outDir, `eval-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ summary, rows }, null, 1));
  console.log(`\n자세한 결과: ${path.relative(process.cwd(), outPath)}`);
}

// 직접 실행했을 때만 측정한다(시험에서 score 만 불러 쓸 수 있게).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error('측정 실패:', e.message);
    process.exit(1);
  });
}
