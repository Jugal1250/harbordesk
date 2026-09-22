/**
 * A deterministic screen over the customer's own words, run *before* the model.
 *
 * Why this exists, and why it is not just more prompt engineering:
 *
 * The routing rules in triage.js read the model's output — its category, its priority, its
 * confidence. That works right up until the model is confidently wrong about the category,
 * and then every rule downstream of it is reading a label that is already incorrect. The
 * evaluation caught exactly that: a security ticket ("our insurer is asking whether we
 * enforce 2FA", "procurement wants your SOC 2 report") reads like a how-to question, so the
 * model answers how-to at high confidence and the `security ⇒ human` rule never fires,
 * because as far as the rule can see there is no security ticket.
 *
 * You cannot fix that with a better prompt, because you would be trusting the same component
 * that just failed. So this file does not ask the model anything. It matches terms against
 * the raw ticket, and a match sends the ticket to a person whatever the model later says.
 *
 * The term lists are written from support policy — what a company would put in a runbook as
 * "never answer this without a human" — not from the tickets that failed. Three things
 * qualify: a written commitment about security or compliance, a report that someone's access
 * outlived their account, and a customer telling us they are leaving. Getting any of those
 * wrong is expensive; a false trip costs one person thirty seconds.
 *
 * The cost is measured, not assumed: `npm run eval` reports `unnecessary human review`, which
 * is how many correctly-classified tickets this screen queues for no reason.
 */

/**
 * @typedef {{tripped: boolean, reason: string|null, matched: string|null}} Tripwire
 */

/**
 * Terms grouped by the policy reason they exist, so the list can be argued with rather than
 * just extended. Each entry is matched whole-word against the lowercased ticket.
 */
const POLICY_TERMS = {
  'security or compliance commitment': [
    'soc 2', 'soc2', 'soc ii', 'iso 27001', 'gdpr', 'hipaa', 'pci dss',
    'dpa', 'data processing agreement', 'subprocessor', 'sub-processor', 'nda',
    'penetration test', 'pen test', 'vulnerability', 'security questionnaire',
    'security review', 'compliance', 'audit', 'audit log', 'retention policy',
    'two-factor', 'two factor', '2fa', 'mfa', 'sso', 'saml', 'scim',
  ],
  'access that may have outlived the account': [
    'revoke', 'revoked', 'revoking', 'deprovision', 'offboard', 'offboarding',
    'former employee', 'ex-employee', 'still has access', 'still have access',
    'still works', 'still active', 'removed user', 'deleted user',
  ],
  'possible data exposure': [
    'data leak', 'leaked', 'breach', 'breached', 'exposed', 'unauthorised', 'unauthorized',
    "another company's", 'someone else', 'not our data', 'wrong account',
  ],
  'customer signalling they may leave': [
    'cancel', 'cancelling', 'canceling', 'cancellation', 'cancelled', 'canceled',
    'terminate', 'termination', 'not renewing', 'non-renewal', 'downgrade',
    'pause billing', 'pause our account', 'pause the account', 'switching to', 'moving to another',
  ],
};

/** Terms that need a word boundary rather than a substring match, to avoid daft hits. */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Precompiled once: matching runs on every ticket. */
const COMPILED = Object.entries(POLICY_TERMS).flatMap(([reason, terms]) =>
  terms.map((term) => ({ reason, term, re: new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}([^a-z0-9]|$)`, 'i') })));

/**
 * Screens a ticket against the policy terms.
 *
 * @param {{subject?: string, body?: string}} ticket
 * @returns {Tripwire} `tripped` true means a human must see this ticket regardless of the model
 */
export function screenTicket(ticket) {
  const text = `${ticket?.subject ?? ''}\n${ticket?.body ?? ''}`.toLowerCase();
  for (const { reason, term, re } of COMPILED) {
    if (re.test(text)) {
      // Gated: the evaluation triages 40 tickets in a row and the progress line has to stay readable.
      if (process.env.AI_DEBUG) console.log(`[triage] tripwire: "${term}" → ${reason}`);
      return { tripped: true, reason, matched: term };
    }
  }
  return { tripped: false, reason: null, matched: null };
}

/** Exported for the tests and for anyone auditing what the screen covers. */
export { POLICY_TERMS };
