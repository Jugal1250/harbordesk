/**
 * Drafts a reply to a ticket from the help centre only.
 *
 * Two guardrails decide whether the draft is shown as ready to send:
 * 1. The model is told to answer only from the retrieved articles and to say so when they
 *    do not cover the question. An agent apologising for not knowing is cheap; an agent
 *    inventing a refund policy is not.
 * 2. Every draft is returned with its sources, and any draft that is not grounded, or that
 *    scores low on retrieval, is marked for human review before sending.
 */
import { completeJson } from './provider.js';
import { retrieve } from './retrieve.js';

const MIN_RETRIEVAL_SCORE = 2.0;

const SYSTEM = `You draft replies for a B2B SaaS support team. Reply with JSON only:
{"draft": string, "sources": string[], "answered_from_kb": boolean, "confidence": number 0-1}

Rules:
- Use ONLY the help centre extracts provided. Never invent a policy, price, limit or timeframe.
- If the extracts do not answer the question, set answered_from_kb false and write a short
  reply that acknowledges the issue and says a specialist will follow up. Do not guess.
- "sources" lists the article titles you actually used, copied exactly.
- Write as a support agent: plain British English, no greeting beyond "Hi <name>," and no
  marketing language. 120 words maximum. Never promise a refund, credit or deadline that the
  extracts do not state.
- confidence reflects how completely the extracts answer the question.`;

/**
 * @param {{subject: string, body: string, contact_name?: string}} ticket
 * @returns {Promise<{draft: string, sources: {article: string, heading: string, score: number}[], answered_from_kb: boolean, confidence: number, needs_human: boolean, provider: string, ms: number}>}
 */
export async function draftReply(ticket) {
  const question = `${ticket.subject}\n${ticket.body}`;
  const hits = retrieve(question, 3);

  const extracts = hits.length
    ? hits.map((h, i) => `[${i + 1}] ${h.article} — ${h.heading}\n${h.text}`).join('\n\n---\n\n')
    : '(no relevant help centre articles found)';

  const { data, provider, ms } = await completeJson({
    model: process.env.REPLY_MODEL || 'llama-3.3-70b-versatile',
    system: SYSTEM,
    mockKind: 'reply',
    maxTokens: 500,
    user: `Customer: ${ticket.contact_name ?? 'there'}\n\nTicket\nSubject: ${ticket.subject}\n${ticket.body}\n\nHelp centre extracts\n${extracts}`,
  });

  const grounded = Boolean(data.answered_from_kb) && hits.length > 0;
  const topScore = hits[0]?.score ?? 0;
  const confidence = Math.max(0, Math.min(1, Number(data.confidence) || 0));

  // Only cite articles that were actually retrieved, so a hallucinated source cannot appear.
  const citedTitles = new Set((Array.isArray(data.sources) ? data.sources : []).map((s) => String(s).toLowerCase()));
  const sources = hits
    .filter((h) => citedTitles.size === 0 || citedTitles.has(h.article.toLowerCase()))
    .map(({ article, heading, score }) => ({ article, heading, score }));

  return {
    draft: String(data.draft ?? '').trim(),
    sources: grounded ? sources : [],
    answered_from_kb: grounded,
    confidence,
    needs_human: !grounded || topScore < MIN_RETRIEVAL_SCORE || confidence < 0.6,
    retrieval_top_score: topScore,
    provider,
    ms,
  };
}
