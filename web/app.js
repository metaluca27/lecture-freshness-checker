// 화면 상태와 이벤트. 올리기 → 공식 사이트 확인 → 검사 중 → 결과.
// 페이지나 모델에서 온 글은 textContent 로만 넣는다(innerHTML 을 쓰지 않는다).

import { API_BASE, MAX_FILE_BYTES } from './config.js';
import { parsePptx } from './pptx.js';
import { runCheck } from './run.js';
import { summarize, toMarkdown, VERDICT_LABEL, formatElapsed } from './report.js';

const $ = (id) => document.getElementById(id);
const DOMAIN_RE = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const ORIGIN_LABEL = { text: '슬라이드 글자', notes: '발표 노트', image: '슬라이드 그림' };
const VERDICT_ORDER = ['changed', 'unverified', 'same'];

const state = { fileName: '', slides: [], domains: null, run: null, controller: null, filter: 'all' };

// ---------- 작은 도구 ----------

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) node.append(c);
  return node;
}

function show(step) {
  for (const id of ['step-upload', 'step-sites', 'step-run', 'step-result']) $(id).hidden = id !== step;
  $(step).scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setStatus(id, message, isError = false) {
  const node = $(id);
  node.textContent = message;
  node.classList.toggle('error', isError);
}

// 워커 호출. 잠깐의 혼잡(429, 5xx)은 한 번 기다렸다 다시 보낸다.
async function callApi(path, body, signal) {
  if (!API_BASE) throw new Error('워커 주소가 설정되지 않았어요.');
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API_BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
    if (res.ok) return res.json();
    if (attempt === 0 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, res.status === 429 ? 5000 : 1500));
      continue;
    }
    throw new Error(`요청 실패 (${res.status})`);
  }
}

function parseDomainInput(value) {
  const items = value.split(/[,\s]+/).map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')).filter(Boolean);
  return { items: [...new Set(items)], invalid: items.filter((d) => !DOMAIN_RE.test(d)) };
}

// ---------- 1. 올리기 ----------

async function handleFile(file) {
  if (!file) return;
  if (!/\.pptx$/i.test(file.name)) return setStatus('upload-status', '.pptx 파일만 검사할 수 있어요. PowerPoint에서 "다른 이름으로 저장"으로 .pptx로 바꿔 주세요.', true);
  if (file.size > MAX_FILE_BYTES) return setStatus('upload-status', '파일이 너무 커요. 80MB까지 검사할 수 있어요.', true);

  setStatus('upload-status', '파일을 읽고 있어요…');
  let slides;
  try {
    slides = await parsePptx(await file.arrayBuffer(), window.JSZip);
  } catch (e) {
    return setStatus('upload-status', e?.message || 'pptx 파일을 읽을 수 없어요', true);
  }
  const withText = slides.filter((s) => s.text.trim() || s.notes.trim()).length;
  if (withText === 0) return setStatus('upload-status', '슬라이드에서 글자를 찾지 못했어요. 글자가 그림으로만 들어 있는 자료일 수 있어요.', true);

  state.fileName = file.name;
  state.slides = slides;
  setStatus('upload-status', '');
  $('tier1').value = '';
  $('tier2').value = '';
  $('confirm').checked = false;
  updateStart();
  show('step-sites');
  setStatus('sites-status', `${file.name} · 슬라이드 ${slides.length}장을 읽었어요. 공식 사이트를 제안받는 중이에요…`);

  // 주제를 보고 공식 사이트를 제안받는다. 실패해도 직접 적으면 된다.
  try {
    const sample = slides.map((s) => s.text).join('\n').slice(0, 3000);
    const out = await callApi('/api/suggest-sites', { sample });
    if (!$('tier1').value) $('tier1').value = (out.tier1 ?? []).join(', ');
    if (!$('tier2').value) $('tier2').value = (out.tier2 ?? []).join(', ');
    setStatus('sites-status', `${file.name} · 슬라이드 ${slides.length}장. AI가 제안한 사이트예요. 맞는지 확인하고 필요하면 고쳐 주세요.`);
  } catch {
    setStatus('sites-status', `${file.name} · 슬라이드 ${slides.length}장. 사이트 제안을 받지 못했어요. 공식 사이트 도메인을 직접 적어 주세요.`);
  }
  updateStart();
}

// ---------- 2. 공식 사이트 확인 ----------

function readDomains() {
  const t1 = parseDomainInput($('tier1').value);
  const t2 = parseDomainInput($('tier2').value);
  if (t1.items.length === 0) return { error: '공식 사이트를 하나 이상 적어 주세요.' };
  const invalid = [...t1.invalid, ...t2.invalid];
  if (invalid.length) return { error: `도메인 모양이 아니에요: ${invalid.join(', ')} (예: example.com)` };
  if (t1.items.length > 3) return { error: '공식 사이트는 3개까지 적을 수 있어요.' };
  if (t2.items.length > 5) return { error: '다른 공식 채널은 5개까지 적을 수 있어요.' };
  return { domains: { tier1: t1.items, tier2: t2.items.filter((d) => !t1.items.includes(d)) } };
}

function updateStart() {
  const { domains } = readDomains();
  $('start').disabled = !(domains && $('confirm').checked);
}

// ---------- 3. 검사 ----------

async function startRun() {
  const { domains, error } = readDomains();
  if (error) return setStatus('sites-status', error, true);
  state.domains = domains;
  state.controller = new AbortController();
  const signal = state.controller.signal;

  $('live').replaceChildren();
  $('bar-fill').style.width = '0%';
  $('run-phase').textContent = '슬라이드에서 낡을 수 있는 내용을 고르는 중이에요';
  $('run-count').textContent = '';
  $('stop').disabled = false;
  show('step-run');

  const api = {
    extract: (input) => callApi('/api/extract', input, undefined),
    check: (input) => callApi('/api/check', input, undefined),
  };

  state.run = await runCheck(state.slides, domains, api, onProgress, { signal });
  renderResult();
  show('step-result');
}

function onProgress(e) {
  if (e.phase === 'extract') {
    $('run-phase').textContent = '슬라이드에서 낡을 수 있는 내용을 고르는 중이에요';
    $('run-count').textContent = `슬라이드 ${e.done} / ${e.total}`;
    $('bar-fill').style.width = `${Math.round((e.done / Math.max(1, e.total)) * 30)}%`;
  } else if (e.phase === 'check') {
    $('run-phase').textContent = '공식 문서와 대조하는 중이에요';
    $('run-count').textContent = `내용 ${e.done} / ${e.total}`;
    $('bar-fill').style.width = `${30 + Math.round((e.done / Math.max(1, e.total)) * 70)}%`;
    const item = el('li', {}, [
      el('span', { class: `badge ${e.result.verdict}`, text: VERDICT_LABEL[e.result.verdict] ?? '확인 못 함' }),
      el('span', { class: 'text', text: `슬라이드 ${e.claim.slide} · ${e.claim.text}` }),
    ]);
    $('live').prepend(item);
    while ($('live').children.length > 5) $('live').lastElementChild.remove();
  }
}

// ---------- 4. 결과 ----------

function renderResult() {
  const { claims, results, elapsedMs, skipped, stopped, failedSlides } = state.run;
  const sum = summarize(results);

  $('summary').replaceChildren(
    stat('changed', sum.changed, '바뀜'),
    stat('unverified', sum.unverified, '확인 못 함'),
    stat('same', sum.same, '그대로'),
    stat('', formatElapsed(elapsedMs), `걸린 시간 · 슬라이드 ${state.slides.length}장`),
  );

  const notes = [];
  if (stopped) notes.push('중간에 중단해서 그때까지의 결과만 보여요.');
  if (skipped) notes.push(`내용이 많아 ${skipped}개는 검사하지 않았어요.`);
  if (failedSlides.length) notes.push(`슬라이드 ${failedSlides.join(', ')}장은 내용을 고르지 못했어요.`);
  if (claims.length === 0 && !stopped) notes.push('낡을 수 있는 내용(버전, 요금, 숫자, 날짜, 메뉴, 기능)을 찾지 못했어요.');
  setStatus('result-notes', notes.join(' '));

  state.filter = sum.changed > 0 ? 'changed' : 'all';
  renderFilters(sum);
  renderCards();
}

function stat(kind, number, label) {
  return el('div', { class: `stat ${kind}` }, [el('span', { class: 'n', text: String(number) }), el('span', { class: 'l', text: label })]);
}

function renderFilters(sum) {
  const options = [['all', `전체 ${sum.total}`], ['changed', `바뀜 ${sum.changed}`], ['unverified', `확인 못 함 ${sum.unverified}`], ['same', `그대로 ${sum.same}`]];
  $('filters').replaceChildren(...options.map(([key, label]) => {
    const b = el('button', { type: 'button', 'aria-pressed': String(state.filter === key), text: label });
    b.addEventListener('click', () => { state.filter = key; renderFilters(sum); renderCards(); });
    return b;
  }));
}

function renderCards() {
  const { claims, results } = state.run;
  const byId = new Map(results.map((r) => [r.claimId, r]));
  const rows = [];

  for (const slide of state.slides) {
    const items = claims
      .filter((c) => c.slide === slide.slide && byId.has(c.id))
      .map((c) => ({ claim: c, result: byId.get(c.id) }))
      .filter((x) => state.filter === 'all' || x.result.verdict === state.filter)
      .sort((a, b) => VERDICT_ORDER.indexOf(a.result.verdict) - VERDICT_ORDER.indexOf(b.result.verdict));
    if (items.length === 0) continue;

    rows.push(el('section', { class: 'slide-row' }, [
      el('div', { class: 'slide-side' }, [
        el('p', { class: 'slide-no', text: `슬라이드 ${slide.slide}` }),
        el('p', { class: 'slide-text', text: slide.text || '(글자 없음)' }),
      ]),
      el('div', { class: 'slide-cards' }, items.map(card)),
    ]));
  }

  $('cards').replaceChildren(...(rows.length ? rows : [el('p', { class: 'empty', text: '이 판정에 해당하는 내용이 없어요.' })]));
}

function safeLink(url, label) {
  // https 주소만 링크로 만든다.
  if (typeof url === 'string' && url.startsWith('https://')) {
    return el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: label });
  }
  return el('span', { text: label });
}

function card({ claim, result }) {
  const v = result.verdict;
  const node = el('article', { class: `card ${v}` }, [
    el('div', { class: 'card-head' }, [
      el('span', { class: `badge ${v}`, text: VERDICT_LABEL[v] ?? '확인 못 함' }),
      el('p', { class: 'claim' }, [claim.text + ' ', el('span', { class: 'origin', text: `· ${ORIGIN_LABEL[claim.origin] ?? ''}` })]),
    ]),
  ]);

  if (v === 'changed' && result.suggestion) {
    node.append(el('div', { class: 'row' }, [el('span', { class: 'k', text: '수정안' }), el('div', { class: 'fix', text: result.suggestion })]));
  }
  if (v === 'unverified' && result.humanTask) {
    node.append(el('div', { class: 'row' }, [el('span', { class: 'k', text: '직접 확인할 일' }), el('div', { class: 'todo', text: result.humanTask })]));
  }

  for (const e of result.evidence ?? []) {
    node.append(el('div', { class: 'row' }, [
      el('span', { class: 'k', text: '공식 문서의 근거 문장' }),
      el('blockquote', { class: 'quote', text: e.quote }),
      el('span', { class: 'src' }, [el('span', { class: `tag t${e.tier}`, text: `${e.tier}등급` }), safeLink(e.url, e.hostname)]),
    ]));
  }

  if (result.references?.length) {
    node.append(el('div', { class: 'row' }, [
      el('span', { class: 'k' }, ['참고로만 보는 출처 ', el('span', { class: 'tag t3', text: '3등급 · 판정 근거 아님' })]),
      el('ul', { class: 'refs' }, result.references.map((r) => el('li', {}, [safeLink(r.url, r.hostname), r.title ? ` · ${r.title}` : '']))),
    ]));
  }
  return node;
}

function markdown() {
  const { claims, results, elapsedMs, skipped, stopped } = state.run;
  const d = new Date();
  const checkedAt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return toMarkdown(claims, results, { fileName: state.fileName, domains: state.domains, elapsedMs, checkedAt, skipped, stopped });
}

// ---------- 이벤트 ----------

function reset() {
  state.controller?.abort();
  Object.assign(state, { fileName: '', slides: [], domains: null, run: null, controller: null, filter: 'all' });
  $('file').value = '';
  setStatus('upload-status', '');
  show('step-upload');
}

$('file').addEventListener('change', (e) => handleFile(e.target.files[0]));
const drop = $('drop');
for (const type of ['dragenter', 'dragover']) drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const type of ['dragleave', 'drop']) drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.remove('over'); });
drop.addEventListener('drop', (e) => handleFile(e.dataTransfer?.files?.[0]));
// 파일을 창 아무 데나 떨어뜨려도 브라우저가 그 파일을 열어 버리지 않게 한다.
for (const type of ['dragover', 'drop']) window.addEventListener(type, (e) => e.preventDefault());

for (const id of ['tier1', 'tier2']) {
  $(id).addEventListener('input', () => {
    $('confirm').checked = false; // 사이트를 고치면 다시 확인받는다.
    const { error } = readDomains();
    if (error && $(id).value.trim()) setStatus('sites-status', error, true);
    else if ($('sites-status').classList.contains('error')) setStatus('sites-status', '');
    updateStart();
  });
}
$('confirm').addEventListener('change', updateStart);
$('start').addEventListener('click', startRun);
$('stop').addEventListener('click', () => {
  state.controller?.abort();
  $('stop').disabled = true;
  $('run-phase').textContent = '진행 중인 요청만 마치고 멈출게요…';
});
$('reset-1').addEventListener('click', reset);
$('reset-2').addEventListener('click', reset);

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(markdown());
    $('copy').textContent = '복사했어요';
  } catch {
    $('copy').textContent = '복사하지 못했어요';
  }
  setTimeout(() => { $('copy').textContent = '수정 목록 복사'; }, 1800);
});

$('download').addEventListener('click', () => {
  const blob = new Blob([markdown()], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `${state.fileName.replace(/\.pptx$/i, '')}_검사결과.md` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
