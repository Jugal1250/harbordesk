/**
 * Ticket triage: category, priority, sentiment and a confidence score.
 *
 * The rule that matters commercially: anything the model is unsure about, or that touches
 * security or money, goes to a human instead of being routed automatically. A wrong
 * auto-route on a security report costs far more than a human glance at a queue.
 */
import { completeJson } from './provider.js';
import { screenTicket } from './sensitive.js';

export const CATEGORIES = ['billing', 'bug', 'how_to', 'feature_request', 'cancellation', 'integration', 'account_access', 'security', 'spam', 'unclear'];
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
export const SENTIMENTS = ['happy', 'neutral', 'frustrated', 'angry'];

/** Which team owns each category once a ticket is routed automatically. */
const TEAM_BY_CATEGORY = {
  billing: 'billing',
  bug: 'engineering',
  how_to: 'support',
  feature_request: 'product',
  cancellation: 'retention',
  integration: 'engineering',
  account_access: 'support',
  security: 'security',
  spam: 'archive',
  unclear: 'support',
};

/** Categories a human always confirms, whatever the model's confidence. */
const ALWAYS_HUMAN_CATEGORIES = new Set(['security', 'cancellation', 'unclear']);

/**
 * Priorities a human always confirms.
 *
 * This exists because of a defect the evaluation caught. The original rule looked only at the
 * category, so three tickets the model correctly marked `urgent` at 0.95 confidence were
 * auto-routed — a customer charged after cancelling, a refund chased twice, and a whole team
 * locked out. High confidence is a reason to trust the *label*, never a reason to skip the
 * person. Confidence answers "what is this ticket?"; it says nothing about what it costs to
 * get the next step wrong.
 */
const ALWAYS_HUMAN_PRIORITIES = new Set(['urgent']);

/**
 * The three routing rules, in the order they are checked, and what each one is for.
 *
 * 1. `tripwire`   — the customer's own words matched support policy (see sensitive.js). Runs
 *                   before the model and does not read its output, so it still works when the
 *                   model is confidently wrong about the category.
 * 2. `category`/`priority` — the model's label is one we never auto-route.
 * 3. `confidence` — the model told us it was unsure.
 *
 * They overlap deliberately. Rules 2 and 3 read the model's answer, so they cannot catch a
 * mislabelled ticket; rule 1 reads only the text, so it cannot catch a vague ticket with no
 * policy words in it ("it doesnt work"). Each covers the other's blind spot.
 */
function routingReason({ tripwire, category, priority, confidence, threshold }) {
  if (tripwire.tripped) return `policy: ${tripwire.reason}`;
  if (ALWAYS_HUMAN_CATEGORIES.has(category)) return `category: ${category} is never auto-routed`;
  if (ALWAYS_HUMAN_PRIORITIES.has(priority)) return `priority: ${priority}`;
  if (confidence < threshold) return `low confidence: ${confidence.toFixed(2)} < ${threshold}`;
  return null;
}

const SYSTEM = `You triage support tickets for a B2B SaaS product. Reply with JSON only:
{"category": one of ${CATEGORIES.join('|')},
 "priority": one of ${PRIORITIES.join('|')},
 "sentiment": one of ${SENTIMENTS.join('|')},
 "confidence": number 0-1,
 "reason": one short sentence}

Rules:
- category is the customer's MAIN need. A ticket mentioning an invoice while reporting a broken feature is a bug.
- "unclear" is correct when the ticket gives too little detail to act on. Do not guess a category to avoid it.
- "security" covers data exposure, access that should have been revoked, 2FA, compliance and audit requests.
- urgent = work is blocked now, money is leaving the customer's account, or data may be exposed.
  high = a deadline, a payment failure, or repeated contact about the same problem.
  low = a question with no deadline, or positive feedback.
- confidence is your own certainty. Be honest: below 0.6 when the ticket is vague or mixes two needs.`;

/**
 * @param {{subject: string, body: string}} ticket
 * @returns {Promise<{category: string, priority: string, sentiment: string, confidence: number, reason: string, routed_to: string, needs_human: boolean, provider: string, ms: number}>}
 */
export async function triageTicket(ticket) {
  const threshold = Number(process.env.CONFIDENCE_THRESHOLD ?? 0.7);
  // Screened before the model runs: the decision to involve a person must not depend on the
  // component whose mistakes it is there to catch.
  const tripwire = screenTicket(ticket);
  const { data, provider, ms } = await completeJson({
    model: process.env.TRIAGE_MODEL || 'llama-3.1-8b-instant',
    system: SYSTEM,
    mockKind: 'triage',
    maxTokens: 250,
    user: `Subject: ${ticket.subject}\n\n${ticket.body}`,
  });

  // Never trust a label the model invented: fall back to "unclear" rather than storing junk.
  const category = CATEGORIES.includes(data.category) ? data.category : 'unclear';
  const priority = PRIORITIES.includes(data.priority) ? data.priority : 'normal';
  const sentiment = SENTIMENTS.includes(data.sentiment) ? data.sentiment : 'neutral';
  const confidence = Math.max(0, Math.min(1, Number(data.confidence) || 0));

  const routing = routingReason({ tripwire, category, priority, confidence, threshold });
  const needsHuman = routing !== null;

  return {
    category,
    priority,
    sentiment,
    confidence,
    reason: String(data.reason ?? '').slice(0, 200),
    routed_to: needsHuman ? 'human-review' : TEAM_BY_CATEGORY[category],
    needs_human: needsHuman,
    // Shown in the UI next to the ticket: a queue nobody can explain is a queue nobody trusts.
    routing_reason: routing,
    provider,
    ms,
  };
}
