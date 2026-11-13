// Liner Search 와 Liner Model 호출. 요청 형식은 docs/api-notes.md 에서 실제로 확인한 것만 쓴다.
// 키는 env.LINER_API_KEY 에서만 읽고, 오류 메시지나 기록에 넣지 않는다.

export const MODEL = 'liner-mark-1.3';

const SEARCH_URL = 'https://platform.liner.com/api/v1/tools/search/web';
const CHAT_URL = 'https://platform.liner.com/api/v1/chat/completions';

const MAX_RETRIES = 2;
const MAX_WAIT_MS = 10_000;
const BASE_WAIT_MS = 800;
const REQUEST_TIMEOUT_MS = 60_000;

export class LinerError extends Error {
  /**
   * @param {string} code 짧은 사유 코드
   * @param {number} status HTTP 상태(네트워크 오류는 0)
   */
  constructor(code, status = 0) {
    super(`liner_${code}${status ? ` (${status})` : ''}`);
    this.name = 'LinerError';
    this.code = code;
    this.status = status;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function keyOf(env) {
  const key = env?.LINER_API_KEY;
  if (typeof key !== 'string' || !key.trim()) throw new LinerError('missing_api_key');
  return key.trim();
}

function waitFor(res, attempt) {
  const header = Number(res?.headers?.get('retry-after'));
  const ms = Number.isFinite(header) && header > 0 ? header * 1000 : BASE_WAIT_MS * 2 ** attempt;
  return Math.min(ms, MAX_WAIT_MS);
}

// 오류 본문에서 코드만 꺼낸다. 서버가 보낸 메시지는 키가 섞여 있을 수 있어 쓰지 않는다.
async function errorInfo(res) {
  try {
    const j = await res.json();
    const code = typeof j?.error?.code === 'string' && /^[a-z0-9_]{1,60}$/i.test(j.error.code) ? j.error.code : `http_${res.status}`;
    return { code, retryable: j?.error?.retryable };
  } catch {
    return { code: `http_${res.status}`, retryable: undefined };
  }
}

function shouldRetry(status, retryable) {
  if (retryable === false) return false;
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

// 재시도 규칙을 한곳에 모은 POST. 성공하면 풀어 놓은 JSON 을 돌려준다.
async function postJson(url, headers, body, { fetchImpl = fetch, sleep = defaultSleep } = {}) {
  let lastError = new LinerError('unknown');
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      lastError = new LinerError('network_error');
      if (attempt < MAX_RETRIES) await sleep(Math.min(BASE_WAIT_MS * 2 ** attempt, MAX_WAIT_MS));
      continue;
    }

    if (res.ok) {
      try {
        return await res.json();
      } catch {
        throw new LinerError('bad_response', res.status);
      }
    }

    const info = await errorInfo(res);
    lastError = new LinerError(info.code, res.status);
    if (!shouldRetry(res.status, info.retryable)) throw lastError;
    if (attempt < MAX_RETRIES) await sleep(waitFor(res, attempt));
  }
  throw lastError;
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Liner Search. 요약과 주소만 온다. 본문은 worker/page.js 가 따로 읽는다.
 * @returns {Promise<Array<{ url: string, title: string, description: string, hostname: string, date: string|null }>>}
 */
export async function search(query, env, options = {}) {
  const key = keyOf(env);
  const { maxResults = 6 } = options;
  const data = await postJson(SEARCH_URL, { 'x-api-key': key }, { query, max_results: maxResults }, options);
  const results = Array.isArray(data?.results) ? data.results : [];
  return results
    .filter((r) => r && typeof r.url === 'string' && r.url)
    .map((r) => ({
      url: r.url,
      title: typeof r.title === 'string' ? r.title : '',
      description: typeof r.description === 'string' ? r.description : '',
      hostname: typeof r.hostname === 'string' && r.hostname ? r.hostname.toLowerCase() : hostnameOf(r.url),
      date: typeof r.date === 'string' ? r.date : null,
    }));
}

function parseJsonObject(content) {
  if (typeof content !== 'string') return null;
  const stripped = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const value = JSON.parse(stripped);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Liner Model 에 물어 JSON 객체 하나를 받는다.
 * @param {Array} messages OpenAI 형식 메시지
 * @param {{ LINER_API_KEY: string }} env
 * @param {{ schema: object, schemaName?: string, maxTokens?: number, fetchImpl?: typeof fetch, sleep?: Function }} options
 */
export async function chatJson(messages, env, options = {}) {
  const key = keyOf(env);
  const { schema, schemaName = 'answer', maxTokens = 2000 } = options;
  const body = {
    model: MODEL,
    messages,
    max_completion_tokens: maxTokens,
    response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } },
  };

  // 형식이 틀린 답은 한 번만 다시 요청한다.
  for (let attempt = 0; attempt < 2; attempt++) {
    const data = await postJson(CHAT_URL, { authorization: `Bearer ${key}` }, body, options);
    const parsed = parseJsonObject(data?.choices?.[0]?.message?.content);
    if (parsed) return parsed;
  }
  throw new LinerError('bad_json');
}
