/**
 * Offline stand-in for the model: keyword rules, no network, deterministic.
 *
 * Two jobs. It lets the test suite and `npm run eval -- --provider mock` run with no API key,
 * and it gives the evaluation a **baseline**: if the real model cannot beat these rules,
 * the AI is not earning its place. It is not a fallback for production traffic.
 */

/** @param {string} text @param {string[]} words @returns {boolean} */
const has = (text, words) => words.some((w) => text.includes(w));

/**
 * @param {string} user prompt text (contains the ticket or question)
 * @returns {string} JSON string shaped like the real model's reply
 */
export function mockComplete(kind, user) {
  // The SQL prompt carries the whole schema, and words like "cancelled_on" would match the
  // rules below, so only the question itself is considered.
  const text = (kind === 'sql' ? user.split(/\nQuestion\n/).pop() : user).toLowerCase();

  if (kind === 'triage') {
    let category = 'unclear';
    if (has(text, ['partnership', 'seo', 'marketing agency', 'grow your user base'])) category = 'spam';
    else if (has(text, ['data leak', 'exposed', "other company's data", 'soc 2', 'two-factor', '2fa', 'revoke', 'token still works'])) category = 'security';
    else if (has(text, ['cancel', 'pause our account', 'move to another tool'])) category = 'cancellation';
    else if (has(text, ['invoice', 'billed', 'charge', 'refund', 'vat', 'payment', 'upgrade', 'downgrade', 'quote', 'renewal'])) category = 'billing';
    else if (has(text, ['slack', 'zapier', 'quickbooks', 'webhook', 'integration'])) category = 'integration';
    else if (has(text, ['log in', 'login', 'password', 'session expired', 'change the email'])) category = 'account_access';
    else if (has(text, ['would be useful', 'roadmap', 'any plans', 'any chance', 'white-label', 'dark mode'])) category = 'feature_request';
    else if (has(text, ['error', 'fails', 'failed', 'broken', 'blank', "doesn't match", 'wrong', '500', 'slow'])) category = 'bug';
    else if (has(text, ['how do i', 'where do i', 'is there', 'do you have', 'should that be'])) category = 'how_to';

    let priority = 'normal';
    if (has(text, ['urgent', 'nobody can log in', 'completely blocking', 'data leak', 'still works', 'stop taking money'])) priority = 'urgent';
    else if (has(text, ['past due', 'suspend', 'blocking', 'lost', 'late', 'twice', 'duplicate', 'cancel'])) priority = 'high';
    else if (has(text, ['quick one', 'any chance', 'any plans', 'just wanted to say'])) priority = 'low';

    let sentiment = 'neutral';
    if (has(text, ['completely blocking', 'second time', 'nobody has replied', 'turned up two hours late', 'stop taking money'])) sentiment = 'angry';
    else if (has(text, ['still', 'again', 'chase', 'lost', "won't", 'no error'])) sentiment = 'frustrated';
    else if (has(text, ['loving', 'great', 'thanks', 'hiring'])) sentiment = 'happy';

    return JSON.stringify({
      category, priority, sentiment,
      confidence: category === 'unclear' ? 0.35 : 0.62,
      reason: 'keyword rules (mock provider)',
    });
  }

  if (kind === 'reply') {
    return JSON.stringify({
      draft: 'Thanks for getting in touch. Our help centre covers this; a member of the team will confirm the details shortly.',
      sources: [],
      answered_from_kb: false,
      confidence: 0.3,
    });
  }

  if (kind === 'sql') {
    // Enough to keep the UI and tests working offline; real questions need the model.
    if (has(text, ['churn', 'cancelled'])) {
      return JSON.stringify({ sql: "SELECT c.company, s.cancelled_on FROM subscriptions s JOIN customers c ON c.id = s.customer_id WHERE s.status = 'cancelled' ORDER BY s.cancelled_on DESC", explanation: 'Cancelled subscriptions (mock provider)' });
    }
    if (has(text, ['overdue', 'unpaid', 'past due'])) {
      return JSON.stringify({ sql: "SELECT c.company, i.amount, i.due_on FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.status = 'overdue' ORDER BY i.due_on", explanation: 'Overdue invoices (mock provider)' });
    }
    return JSON.stringify({ sql: "SELECT plan, COUNT(*) AS customers, SUM(mrr) AS mrr FROM subscriptions WHERE status = 'active' GROUP BY plan", explanation: 'Default summary (mock provider)' });
  }

  throw new Error(`mock provider has no answer for kind "${kind}"`);
}
