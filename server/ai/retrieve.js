/**
 * Retrieval over the help centre: BM25 lexical search across heading-level chunks.
 *
 * Why BM25 and not embeddings: the corpus is 15 short articles of product documentation
 * where the customer's words and the article's words overlap heavily ("VAT", "webhook",
 * "past due"). BM25 needs no extra API, no key, no index to rebuild, and is easy for a
 * client to reason about. Swapping in an embedding index means replacing this one file,
 * and is worth doing once a corpus is large or users paraphrase heavily.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'kb');
const K1 = 1.5;
const B = 0.75;
/**
 * Below this BM25 score a "match" is incidental word overlap, not a relevant article.
 * Returning nothing is the useful answer there: it is what tells the reply step to hand the
 * ticket to a human instead of drafting from an article that does not apply.
 * Calibrated on the current corpus: genuine matches score 12–20, noise scores under 2.
 */
const MIN_SCORE = 3;

/** Words carrying no signal in a support corpus. */
const STOP = new Set('a an the and or of to in on for is are was were be been it its this that we you your our i my do does did can could would should will if not no yes with from at by as so but have has had there their them they he she his her about into over under more most other some such only own same than too very just get got please thanks hi hello'.split(' '));

/** Product words a customer is likely to phrase differently from the docs. */
const SYNONYMS = {
  invoice: ['billing', 'charge', 'bill'],
  charged: ['billing', 'charge', 'invoice'],
  refund: ['credit', 'billing'],
  vat: ['tax', 'gst'],
  tax: ['vat', 'gst'],
  login: ['sign', 'password', 'session'],
  'log': ['sign', 'password', 'session'],
  password: ['reset', 'login', 'sign'],
  seat: ['plan', 'member', 'user'],
  seats: ['plan', 'member', 'user'],
  upgrade: ['plan', 'downgrade'],
  downgrade: ['plan', 'upgrade'],
  cancel: ['cancellation', 'pause'],
  pause: ['cancel', 'seasonal'],
  photo: ['attachment', 'upload', 'file'],
  photos: ['attachment', 'upload', 'file'],
  attachment: ['upload', 'file'],
  timezone: ['time', 'zone', 'scheduling'],
  signature: ['webhook', 'hmac'],
  '2fa': ['two', 'factor', 'authentication'],
  sso: ['saml', 'scim', 'authentication'],
  token: ['api', 'revoke'],
  csv: ['export'],
  export: ['csv', 'download'],
  duplicate: ['idempotency', 'retry', 'webhook'],
};

/** @param {string} text @returns {string[]} */
function tokenize(text) {
  return String(text).toLowerCase().match(/[a-z0-9]+/g)?.filter((t) => t.length > 1 && !STOP.has(t)) ?? [];
}

/**
 * Splits each article into chunks at `##` headings, keeping the article title on every chunk
 * so a citation always names something a human can find.
 * @returns {{id: string, article: string, heading: string, text: string, tokens: string[]}[]}
 */
function loadChunks() {
  const chunks = [];
  for (const file of fs.readdirSync(KB_DIR).filter((f) => f.endsWith('.md')).sort()) {
    const raw = fs.readFileSync(path.join(KB_DIR, file), 'utf8');
    const title = raw.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? file;
    const body = raw.replace(/^#\s+.+$/m, '').trim();
    const parts = body.split(/\n(?=##\s)/).filter((p) => p.trim());
    (parts.length ? parts : [body]).forEach((part, i) => {
      const heading = part.match(/^##\s+(.+)$/m)?.[1]?.trim() ?? title;
      const text = `${title}\n${part}`.trim();
      chunks.push({ id: `${file}#${i}`, article: title, file, heading, text, tokens: tokenize(text) });
    });
  }
  return chunks;
}

const CHUNKS = loadChunks();
const AVG_LEN = CHUNKS.reduce((n, c) => n + c.tokens.length, 0) / CHUNKS.length;

/** Document frequency per term, for the IDF part of BM25. */
const DF = CHUNKS.reduce((map, c) => {
  new Set(c.tokens).forEach((t) => map.set(t, (map.get(t) ?? 0) + 1));
  return map;
}, new Map());

/** @param {string[]} terms @returns {string[]} terms plus their product synonyms */
function expand(terms) {
  const out = new Set(terms);
  terms.forEach((t) => (SYNONYMS[t] ?? []).forEach((s) => out.add(s)));
  return [...out];
}

/**
 * Ranks help-centre chunks against a question.
 * @param {string} question
 * @param {number} [topK]
 * @returns {{id: string, article: string, heading: string, text: string, score: number}[]}
 */
export function retrieve(question, topK = 3) {
  const terms = expand(tokenize(question));
  const scored = CHUNKS.map((chunk) => {
    let score = 0;
    for (const term of terms) {
      const tf = chunk.tokens.filter((t) => t === term).length;
      if (!tf) continue;
      const idf = Math.log(1 + (CHUNKS.length - (DF.get(term) ?? 0) + 0.5) / ((DF.get(term) ?? 0) + 0.5));
      score += idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (chunk.tokens.length / AVG_LEN))));
    }
    return { ...chunk, score };
  });
  return scored
    .filter((c) => c.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ id, article, heading, text, score }) => ({ id, article, heading, text, score: Number(score.toFixed(2)) }));
}

/** @returns {{count: number, articles: string[]}} */
export function kbStats() {
  return { count: CHUNKS.length, articles: [...new Set(CHUNKS.map((c) => c.article))] };
}
