/**
 * One place that talks to the model, so features never hardcode a vendor.
 *
 * AI_PROVIDER=groq  → Groq's OpenAI-compatible chat completions endpoint.
 * AI_PROVIDER=mock  → deterministic offline stand-in, used by the test suite and by anyone
 *                     running the demo without a key. Never intended for real traffic.
 *
 * Swapping to OpenAI or Anthropic means editing callGroq only: everything else speaks in
 * {system, user, schema} and gets parsed JSON back.
 */
import { mockComplete } from './mock.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_ATTEMPTS = 3;

/** @returns {'groq'|'mock'} */
export function activeProvider() {
  const configured = (process.env.AI_PROVIDER || 'mock').toLowerCase();
  if (configured === 'groq' && !process.env.GROQ_API_KEY) {
    console.warn('[ai] AI_PROVIDER=groq but GROQ_API_KEY is empty — falling back to the mock provider.');
    return 'mock';
  }
  return configured === 'groq' ? 'groq' : 'mock';
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pulls the first JSON object out of a model response, tolerating markdown fences and
 * any prose the model adds around it.
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
export function parseJson(text) {
  const cleaned = String(text ?? '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`model returned no JSON: ${cleaned.slice(0, 160)}`);
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * Reasoning models (the GPT-OSS family, Qwen's thinking models) emit their chain of thought
 * before the answer. Groq then rejects the response in strict JSON mode, so those models get
 * `reasoning_format: 'hidden'`, which strips the thinking server-side.
 * @param {string} model
 * @returns {boolean}
 */
function isReasoningModel(model) {
  return /gpt-oss|qwen|deepseek-r1/i.test(model);
}

/**
 * Builds the request body. `strictJson: false` drops response_format entirely, which is the
 * fallback for models that cannot honour it — parseJson copes with fences and stray prose.
 * @param {{model: string, system: string, user: string, maxTokens: number, temperature: number}} req
 * @param {boolean} strictJson
 * @returns {Record<string, unknown>}
 */
function buildBody({ model, system, user, maxTokens, temperature }, strictJson) {
  const body = {
    model,
    temperature,
    max_tokens: maxTokens,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  };
  if (strictJson) body.response_format = { type: 'json_object' };
  if (isReasoningModel(model)) {
    body.reasoning_format = 'hidden';
    body.reasoning_effort = 'low';
  }
  return body;
}

/**
 * Calls Groq, retrying on rate limits and transient 5xx errors, and falling back to
 * unconstrained output if the model cannot satisfy strict JSON mode.
 * @param {{model: string, system: string, user: string, maxTokens?: number, temperature?: number}} req
 * @returns {Promise<string>} raw assistant text
 */
async function callGroq({ model, system, user, maxTokens = 700, temperature = 0 }) {
  let strictJson = true;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify(buildBody({ model, system, user, maxTokens, temperature }, strictJson)),
    });

    if (res.ok) {
      const body = await res.json();
      return body.choices?.[0]?.message?.content ?? '';
    }

    const detail = await res.text();

    // The model wrapped its JSON in reasoning or prose. Groq returns what it generated, and
    // asking again without the constraint usually succeeds — parseJson extracts the object.
    if (res.status === 400 && detail.includes('json_validate_failed') && strictJson) {
      console.warn(`[ai] ${model} could not satisfy strict JSON mode; retrying without it.`);
      strictJson = false;
      continue;
    }

    // Some models reject the reasoning parameters outright; drop them and try once more.
    if (res.status === 400 && /reasoning_(format|effort)/i.test(detail)) {
      console.warn(`[ai] ${model} rejected the reasoning parameters; retrying without them.`);
      const plain = buildBody({ model, system, user, maxTokens, temperature }, strictJson);
      delete plain.reasoning_format;
      delete plain.reasoning_effort;
      const retry = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify(plain),
      });
      if (retry.ok) return (await retry.json()).choices?.[0]?.message?.content ?? '';
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS) {
      throw new Error(`Groq ${res.status}: ${detail.slice(0, 300)}`);
    }
    // Groq sends the wait in a header on 429; fall back to a growing backoff.
    const waitMs = Number(res.headers.get('retry-after')) * 1000 || attempt * 1500;
    console.warn(`[ai] ${res.status} from Groq, retrying in ${waitMs}ms (attempt ${attempt}/${MAX_ATTEMPTS})`);
    await sleep(waitMs);
  }
  throw new Error('unreachable');
}

/**
 * Asks the model for a JSON answer.
 * @param {{model: string, system: string, user: string, mockKind: string, maxTokens?: number}} req
 * @returns {Promise<{data: Record<string, unknown>, provider: string, ms: number}>}
 */
export async function completeJson({ model, system, user, mockKind, maxTokens }) {
  const provider = activeProvider();
  const started = Date.now();
  const raw = provider === 'groq'
    ? await callGroq({ model, system, user, maxTokens })
    : mockComplete(mockKind, user);
  return { data: parseJson(raw), provider, ms: Date.now() - started };
}
