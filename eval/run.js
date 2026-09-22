/**
 * Evaluation harness — the part that turns "we added AI" into "here is how well it works".
 *
 * Two suites:
 *   1. Triage, scored against 40 hand-labelled tickets (category, priority, sentiment),
 *      plus the routing decision: did a ticket a human should have seen reach a human?
 *   2. Ask-your-data, scored by running the model's SQL and the reference SQL and comparing
 *      the result sets, so a differently-written but correct query still passes. Two questions
 *      are safety checks that must be refused.
 *
 * Run: npm run eval                (uses .env)
 *      npm run eval -- --provider mock   (offline rules baseline)
 *      npm run eval -- --only triage
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, query } from '../server/db.js';
import { triageTicket } from '../server/ai/triage.js';
import { askData } from '../server/ai/sqlgen.js';
import { activeProvider } from '../server/ai/provider.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argValue = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
if (argValue('--provider')) process.env.AI_PROVIDER = argValue('--provider');
const only = argValue('--only');
/** Pause between calls so a free-tier rate limit does not end the run. */
const GAP_MS = Number(argValue('--gap') ?? (activeProvider() === 'groq' ? 900 : 0));

const TICKETS = JSON.parse(fs.readFileSync(path.join(HERE, 'tickets.json'), 'utf8'));
const QUESTIONS = JSON.parse(fs.readFileSync(path.join(HERE, 'questions.json'), 'utf8'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a');

/** Categories where a wrong automatic route is expensive, used for the routing check. */
const MUST_REACH_HUMAN = new Set(['security', 'cancellation', 'unclear']);

/**
 * Scores triage against the labelled set.
 * @returns {Promise<object>}
 */
async function evalTriage() {
  const rows = [];
  let category = 0; let priority = 0; let sentiment = 0; let exact = 0;
  let missedEscalation = 0; let unnecessaryHuman = 0;
  /** Which of the four routing rules actually caught each ticket sent to a human. */
  const byRule = { policy: 0, category: 0, priority: 0, 'low confidence': 0 };

  for (const ticket of TICKETS) {
    const result = await triageTicket(ticket);
    const ok = {
      category: result.category === ticket.label.category,
      priority: result.priority === ticket.label.priority,
      sentiment: result.sentiment === ticket.label.sentiment,
    };
    category += ok.category ? 1 : 0;
    priority += ok.priority ? 1 : 0;
    sentiment += ok.sentiment ? 1 : 0;
    exact += ok.category && ok.priority && ok.sentiment ? 1 : 0;

    // The costly mistake: a ticket that should have had human eyes was routed automatically.
    const shouldReachHuman = MUST_REACH_HUMAN.has(ticket.label.category) || ticket.label.priority === 'urgent';
    if (shouldReachHuman && !result.needs_human) missedEscalation += 1;
    if (!shouldReachHuman && result.needs_human && ok.category) unnecessaryHuman += 1;

    const rule = (result.routing_reason ?? '').split(':')[0];
    if (rule in byRule) byRule[rule] += 1;

    rows.push({
      id: ticket.id,
      subject: ticket.subject,
      expected: ticket.label,
      got: { category: result.category, priority: result.priority, sentiment: result.sentiment },
      confidence: Number(result.confidence.toFixed(2)),
      routed_to: result.routed_to,
      routing_reason: result.routing_reason,
      should_reach_human: shouldReachHuman,
      correct: ok,
      ms: result.ms,
    });
    process.stdout.write(ok.category ? '.' : 'x');
    if (GAP_MS) await sleep(GAP_MS);
  }
  process.stdout.write('\n');

  const n = TICKETS.length;
  return {
    total: n,
    category_accuracy: category / n,
    priority_accuracy: priority / n,
    sentiment_accuracy: sentiment / n,
    all_three_correct: exact / n,
    missed_escalations: missedEscalation,
    unnecessary_human_review: unnecessaryHuman,
    routed_by_rule: byRule,
    avg_ms: Math.round(rows.reduce((s, r) => s + r.ms, 0) / n),
    rows,
  };
}

/**
 * A row reduced to its values, normalised so float formatting and column order do not matter.
 * @param {Record<string, unknown>} row
 * @returns {string[]}
 */
function rowValues(row) {
  return Object.values(row)
    .map((v) => (typeof v === 'number' ? String(Number(v.toFixed(2))) : String(v ?? '')))
    .sort();
}

/**
 * Compares the model's result against the reference.
 *
 * Deliberately not an exact match. A query that answers the question but also selects a
 * useful extra column ("company, owed, due_on" where the reference asked for "company, owed")
 * is right by any standard a business user would apply, and an evaluation that marks it wrong
 * measures conformity rather than correctness. So: same number of rows, and every reference
 * row's values must appear in a distinct row of the answer.
 *
 * @param {Record<string, unknown>[]} actual
 * @param {Record<string, unknown>[]} expected
 * @returns {{pass: boolean, reason: string}}
 */
function compareResults(actual, expected) {
  if (actual.length !== expected.length) {
    return { pass: false, reason: `returned ${actual.length} rows, reference returns ${expected.length}` };
  }
  const pool = actual.map(rowValues);
  for (const row of expected) {
    const want = rowValues(row);
    const index = pool.findIndex((got) => want.every((v) => got.includes(v)));
    if (index === -1) {
      return { pass: false, reason: `row not found in the answer: ${want.join(' | ').slice(0, 80)}` };
    }
    pool.splice(index, 1);
  }
  const extra = Object.keys(actual[0] ?? {}).length - Object.keys(expected[0] ?? {}).length;
  return { pass: true, reason: extra > 0 ? `correct (with ${extra} extra column${extra > 1 ? 's' : ''})` : '' };
}

/** @returns {Promise<object>} */
async function evalAskData() {
  const rows = [];
  let correct = 0; let refusedCorrectly = 0; let unsafeGenerated = 0;
  const answerable = QUESTIONS.filter((q) => !q.expect_refusal);
  const safety = QUESTIONS.filter((q) => q.expect_refusal);

  for (const q of QUESTIONS) {
    const result = await askData(q.question);
    let pass = false;
    let detail = '';

    if (q.expect_refusal) {
      pass = Boolean(result.refused) || !result.sql;
      if (pass) refusedCorrectly += 1;
      else { unsafeGenerated += 1; detail = `ran: ${result.sql.slice(0, 90)}`; }
    } else if (result.refused) {
      detail = `refused: ${result.refused}`;
    } else {
      const outcome = compareResults(result.rows, query(q.reference_sql));
      pass = outcome.pass;
      detail = outcome.reason;
      if (pass) correct += 1;
    }

    rows.push({ id: q.id, question: q.question, sql: result.sql, pass, detail, ms: result.ms });
    process.stdout.write(pass ? '.' : 'x');
    if (GAP_MS) await sleep(GAP_MS);
  }
  process.stdout.write('\n');

  return {
    answerable: answerable.length,
    correct,
    accuracy: correct / answerable.length,
    safety_checks: safety.length,
    refused_correctly: refusedCorrectly,
    unsafe_queries_generated: unsafeGenerated,
    avg_ms: Math.round(rows.reduce((s, r) => s + r.ms, 0) / rows.length),
    rows,
  };
}

await getDb();
const provider = activeProvider();
console.log(`\nHarbor Desk AI evaluation — provider: ${provider}${provider === 'mock' ? ' (rules baseline, no model)' : ''}\n`);

const report = { run_at: new Date().toISOString(), provider, models: { triage: process.env.TRIAGE_MODEL, sql: process.env.SQL_MODEL } };

if (only !== 'ask-data') {
  console.log(`Triage — ${TICKETS.length} labelled tickets`);
  report.triage = await evalTriage();
  const t = report.triage;
  console.log(`  category   ${pct(t.category_accuracy * t.total, t.total)}`);
  console.log(`  priority   ${pct(t.priority_accuracy * t.total, t.total)}`);
  console.log(`  sentiment  ${pct(t.sentiment_accuracy * t.total, t.total)}`);
  console.log(`  all three  ${pct(t.all_three_correct * t.total, t.total)}`);
  console.log(`  missed escalations      ${t.missed_escalations}  (tickets a human should have seen but were auto-routed)`);
  console.log(`  unnecessary human review ${t.unnecessary_human_review}  (correctly labelled but still queued for a human)`);
  console.log(`  average latency ${t.avg_ms}ms`);
  console.log(`  routed to a human by:   ${Object.entries(t.routed_by_rule).map(([k, v]) => `${k} ${v}`).join(' · ')}`);

  // Printed here so a failure never needs a separate command to diagnose.
  const missed = t.rows.filter((r) => r.should_reach_human && r.routed_to !== 'human-review');
  if (missed.length) {
    console.log('\n  Missed escalations in detail:');
    missed.forEach((r) => console.log(`    #${r.id} ${r.subject}\n       expected ${r.expected.category}/${r.expected.priority} · model said ${r.got.category}/${r.got.priority} at ${r.confidence} confidence`));
  }
  console.log('');
}

if (only !== 'triage') {
  console.log(`Ask your data — ${QUESTIONS.length} questions`);
  report.ask_data = await evalAskData();
  const a = report.ask_data;
  console.log(`  correct answers  ${a.correct}/${a.answerable}  (${pct(a.correct, a.answerable)})`);
  console.log(`  safety checks refused  ${a.refused_correctly}/${a.safety_checks}`);
  console.log(`  unsafe queries generated  ${a.unsafe_queries_generated}`);
  console.log(`  average latency ${a.avg_ms}ms\n`);
  a.rows.filter((r) => !r.pass).forEach((r) => console.log(`  FAIL ${r.id}: ${r.question}\n       ${r.detail}`));
}

fs.writeFileSync(path.join(HERE, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\nFull report written to eval/report.json`);
