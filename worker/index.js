// 전용 워커의 입구. 경로 나누기, 출처 제한, 입력 검사, 사용량 제한을 맡는다.
// 임의 주소를 받아 여는 경로는 만들지 않는다. 워커가 여는 주소는 검색 결과 중 공식 사이트뿐이다.

import { search as linerSearch, chatJson as linerChatJson } from './liner.js';
import { fetchPageText as realFetchPageText } from './page.js';
import { checkClaim } from './check.js';
import {
  extractMessages, judgeMessages, suggestSitesMessages, topicMessages,
  EXTRACT_SCHEMA, JUDGE_SCHEMA, SITES_SCHEMA, TOPIC_SCHEMA, KINDS, MAX_CLAIMS_PER_SLIDE,
} from './prompts.js';

const ALLOWED_ORIGINS = new Set([
  'https://vaulted-bus-346411.web.app',
  'https://vaulted-bus-346411.firebaseapp.com',
  'http://localhost:8799',
  'http://127.0.0.1:8799',
]);

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_CLAIM_CHARS = 1000;
const MAX_SLIDE_CHARS = 20000;
const MAX_SLIDES = 60;
const MAX_TIER1 = 3;
const MAX_TIER2 = 5;
const MEMORY_WINDOW_MS = 60_000;
const MEMORY_LIMIT = 120;

const DOMAIN_RE = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const bad = (code) => new HttpError(400, code);

// ---------- 입력 다듬기 ----------

// 'https://Example.com/docs' 처럼 온 값을 'example.com' 으로 다듬는다. 도메인 모양이 아니면 null.
function cleanDomain(value) {
  if (typeof value !== 'string') return null;
  let d = value.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\.+|\.+$/g, '').replace(/^www\./, '');
  return DOMAIN_RE.test(d) ? d : null;
}

// 사용자가 확인한 도메인 설정. 하나라도 이상하면 받지 않는다.
function parseDomains(input) {
  if (!input || typeof input !== 'object') throw bad('invalid_domains');
  const strict = (list, max, required) => {
    if (list === undefined && !required) return [];
    if (!Array.isArray(list) || list.length > max || (required && list.length === 0)) throw bad('invalid_domains');
    return list.map((v) => {
      if (typeof v !== 'string' || !DOMAIN_RE.test(v.trim().toLowerCase())) throw bad('invalid_domains');
      return v.trim().toLowerCase();
    });
  };
  return { tier1: strict(input.tier1, MAX_TIER1, true), tier2: strict(input.tier2, MAX_TIER2, false) };
}

function parseClaim(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('invalid_claim');
  if (typeof input.text !== 'string' || !input.text.trim()) throw bad('invalid_claim');
  if (input.text.length > MAX_CLAIM_CHARS) throw bad('claim_too_long');
  const short = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
  return {
    id: short(input.id, 40) ?? null,
    slide: Number.isInteger(input.slide) ? input.slide : null,
    origin: ['text', 'notes', 'image'].includes(input.origin) ? input.origin : 'text',
    text: input.text.trim(),
    kind: KINDS.includes(input.kind) ? input.kind : 'feature',
    query: short(input.query, 200),
    keywords: Array.isArray(input.keywords) ? input.keywords.filter((k) => typeof k === 'string').slice(0, 8).map((k) => k.slice(0, 60)) : [],
  };
}

function parseExtract(input) {
  if (!input || typeof input !== 'object') throw bad('invalid_slide');
  const { slide, text = '', notes = '', imageDataUrl = null, context = '' } = input;
  if (typeof context !== 'string') throw bad('invalid_slide');
  if (!Number.isInteger(slide) || slide < 1 || slide > MAX_SLIDES) throw bad('invalid_slide');
  if (typeof text !== 'string' || typeof notes !== 'string') throw bad('invalid_slide');
  if (text.length > MAX_SLIDE_CHARS || notes.length > MAX_SLIDE_CHARS) throw bad('slide_too_long');
  if (imageDataUrl !== null) {
    if (typeof imageDataUrl !== 'string') throw bad('invalid_image');
    const comma = imageDataUrl.indexOf(',');
    const bytes = comma === -1 ? 0 : Math.floor(((imageDataUrl.length - comma - 1) * 3) / 4);
    if (bytes > MAX_IMAGE_BYTES) throw bad('image_too_large');
    if (!IMAGE_RE.test(imageDataUrl)) throw bad('invalid_image');
  }
  return { slide, text, notes, imageDataUrl, context: context.slice(0, 500) };
}

async function readJsonBody(request) {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, 'body_too_large');
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) throw new HttpError(413, 'body_too_large');
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw bad('invalid_json');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('invalid_json');
  return body;
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

// ---------- 워커 ----------

/**
 * 네트워크를 쓰는 함수를 바꿔 끼울 수 있게 만든 워커. 시험에서는 가짜를 넣는다.
 */
export function makeWorker(deps = {}) {
  const {
    search = linerSearch,
    chatJson = linerChatJson,
    fetchPageText = realFetchPageText,
    now = () => Date.now(),
    memoryLimit = MEMORY_LIMIT,
  } = deps;

  const counters = new Map(); // 주소별 { start, count }. 바인딩이 없을 때만 쓴다.

  async function allowed(request, env) {
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    if (env?.RATE_LIMITER?.limit) {
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      return Boolean(success);
    }
    const t = now();
    if (counters.size > 5000) counters.clear();
    const c = counters.get(ip);
    if (!c || t - c.start >= MEMORY_WINDOW_MS) {
      counters.set(ip, { start: t, count: 1 });
      return true;
    }
    c.count += 1;
    return c.count <= memoryLimit;
  }

  const routes = {
    '/api/suggest-sites': async (body, env) => {
      if (typeof body.sample !== 'string' || !body.sample.trim()) throw bad('invalid_sample');
      // 모델의 기억만 믿지 않고, 자료 제목으로 먼저 검색해서 지금 실제로 나오는 사이트를 함께 보여 준다.
      // (제품 이름이나 주소가 바뀐 경우를 잡기 위해서다.) 검색이 실패해도 제안은 계속한다.
      // 검색어는 모델이 자료에서 알아낸 제품 이름으로 만든다. 못 알아내면 자료 첫 줄들을 쓴다.
      const title = body.sample.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 4).join(' ').slice(0, 120);
      let query = `${title} 공식 사이트`;
      try {
        const topic = await chatJson(topicMessages(body.sample), env, { schema: TOPIC_SCHEMA, schemaName: 'topic', maxTokens: 200 });
        if (typeof topic?.query === 'string' && topic.query.trim()) query = topic.query.trim().slice(0, 150);
      } catch {
        // 제품 이름을 못 알아내도 제안은 계속한다.
      }
      let hits = [];
      try {
        hits = await search(query, env, { maxResults: 8 });
      } catch {
        hits = [];
      }
      const out = await chatJson(suggestSitesMessages(body.sample, hits), env, { schema: SITES_SCHEMA, schemaName: 'sites', maxTokens: 400 });
      const clean = (list, max) => [...new Set((Array.isArray(list) ? list : []).map(cleanDomain).filter(Boolean))].slice(0, max);
      const tier1 = clean(out?.tier1, MAX_TIER1);
      const tier2 = clean(out?.tier2, MAX_TIER2 + MAX_TIER1).filter((d) => !tier1.includes(d)).slice(0, MAX_TIER2);
      return { tier1, tier2 };
    },

    '/api/extract': async (body, env) => {
      const input = parseExtract(body);
      if (!input.text.trim() && !input.notes.trim() && !input.imageDataUrl) return { claims: [] };
      const out = await chatJson(extractMessages(input), env, { schema: EXTRACT_SCHEMA, schemaName: 'claims', maxTokens: 2000 });
      const claims = (Array.isArray(out?.claims) ? out.claims : [])
        .filter((c) => c && typeof c.text === 'string' && c.text.trim() && KINDS.includes(c.kind))
        .slice(0, MAX_CLAIMS_PER_SLIDE)
        .map((c, i) => ({
          id: `s${input.slide}-c${i + 1}`,
          slide: input.slide,
          origin: ['text', 'notes', 'image'].includes(c.origin) ? c.origin : 'text',
          text: c.text.trim().slice(0, MAX_CLAIM_CHARS),
          kind: c.kind,
          query: typeof c.query === 'string' ? c.query.slice(0, 200) : '',
          keywords: Array.isArray(c.keywords) ? c.keywords.filter((k) => typeof k === 'string').slice(0, 8) : [],
        }));
      return { claims };
    },

    '/api/check': async (body, env) => {
      const claim = parseClaim(body.claim);
      const domains = parseDomains(body.domains);
      return checkClaim(claim, domains, {
        search: (q) => search(q, env, { maxResults: 8 }),
        fetchPage: (url) => fetchPageText(url),
        judge: (c, pages) => chatJson(judgeMessages(c, pages), env, { schema: JUDGE_SCHEMA, schemaName: 'judgement', maxTokens: 1500 }),
      });
    },
  };

  return {
    async fetch(request, env) {
      const url = new URL(request.url);

      if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true });
      if (!url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);

      // 허용한 화면에서 온 요청만 받는다.
      const origin = request.headers.get('origin');
      if (!origin || !ALLOWED_ORIGINS.has(origin)) return json({ error: 'forbidden_origin' }, 403);
      const cors = { 'access-control-allow-origin': origin, vary: 'Origin' };

      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: { ...cors, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' },
        });
      }

      try {
        const handler = routes[url.pathname];
        if (!handler) throw new HttpError(404, 'not_found');
        if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
        if (!(await allowed(request, env))) throw new HttpError(429, 'rate_limited');
        const body = await readJsonBody(request);
        if (typeof env?.LINER_API_KEY !== 'string' || !env.LINER_API_KEY.trim()) throw new HttpError(500, 'internal_error');
        return json(await handler(body, env), 200, cors);
      } catch (e) {
        if (e instanceof HttpError) return json({ error: e.code }, e.status, cors);
        // Liner 쪽 문제와 우리 쪽 문제만 구분해 알린다. 자세한 내용은 응답에 싣지 않는다.
        if (e?.name === 'LinerError') return json({ error: 'upstream_error' }, 502, cors);
        return json({ error: 'internal_error' }, 500, cors);
      }
    },
  };
}

export default makeWorker();
