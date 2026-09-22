/**
 * Harbor Desk API — the existing SaaS endpoints plus the AI additions.
 *
 * The AI routes sit alongside the plain ones rather than replacing them, which is how this
 * lands in a real product: the inbox works with the AI switched off, and each AI result is
 * stored with its confidence so the team can audit what was decided automatically.
 */
import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, persist, query, run } from './db.js';
import { seedDatabase } from './seed.js';
import { activeProvider } from './ai/provider.js';
import { triageTicket } from './ai/triage.js';
import { draftReply } from './ai/reply.js';
import { askData } from './ai/sqlgen.js';
import { kbStats } from './ai/retrieve.js';
 
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
app.use(express.json({ limit: '1mb' }));
 
await getDb();
 
/**
 * Seeds the database on first boot if it is empty.
 *
 * Hosted free tiers give you a disk that is wiped on every deploy and often on every restart,
 * so "run the seed once by hand" is not a deployment step that survives. This makes an empty
 * database self-healing instead: the app comes up with its demo data whatever the host did to
 * the disk, and does nothing when data is already there.
 */
async function ensureSeeded() {
  const seeded = query("SELECT name FROM sqlite_master WHERE type='table' AND name='tickets'").length
    && query('SELECT COUNT(*) AS n FROM tickets')[0].n > 0;
  if (seeded) return;
  console.log('[boot] database is empty — seeding');
  const counts = await seedDatabase();
  console.log(`[boot] seeded ${counts.customers} customers, ${counts.invoices} invoices, ${counts.tickets} tickets`);
}
await ensureSeeded();
 
/**
 * A crude per-IP budget on the routes that spend money.
 *
 * The demo is public, the API key is not. Without this, one person with a loop empties the
 * day's quota and everyone who opens the link afterwards sees errors. A real product bills the
 * customer and rate-limits per account; a demo just needs a ceiling, so this is deliberately
 * the simplest thing that works: an in-memory sliding hour, no dependency, no store.
 *
 * @param {number} cost model calls this route makes, so a 40-ticket batch is not charged as one
 * @returns {import('express').RequestHandler}
 */
const HOUR_MS = 60 * 60 * 1000;
const spend = new Map();
function budget(cost) {
  const ceiling = Number(process.env.DEMO_RATE_LIMIT || 60);
  return (req, res, next) => {
    if (!ceiling) return next();
    const now = Date.now();
    const key = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;
    const recent = (spend.get(key) ?? []).filter((t) => now - t < HOUR_MS);
    if (recent.length + cost > ceiling) {
      console.warn(`[api] budget reached for ${key}: ${recent.length}/${ceiling}`);
      // Tell them when they can retry: an error without a next step is just a dead end.
      const waitMin = Math.max(1, Math.ceil((HOUR_MS - (now - recent[0])) / 60000));
      return res.status(429).json({
        error: `This public demo allows ${ceiling} AI calls per hour and you have used ${recent.length}. Try again in about ${waitMin} minute${waitMin === 1 ? '' : 's'}, or clone the repository (linked in the sidebar) and run it with your own key.`,
      });
    }
    spend.set(key, [...recent, ...Array(cost).fill(now)]);
    return next();
  };
}
 
/** Wraps an async route so a thrown error becomes a JSON 500 instead of a hung request. */
const route = (handler) => (req, res) => {
  handler(req, res).catch((error) => {
    console.error(`[api] ${req.method} ${req.path} failed:`, error.message);
    res.status(500).json({ error: error.message });
  });
};
 
/** Posts an event to n8n when a webhook is configured. Failures never block the API. */
async function notifyN8n(event, payload) {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, ...payload }),
    });
    console.log(`[n8n] sent ${event}`);
  } catch (error) {
    console.warn(`[n8n] could not send ${event}: ${error.message}`);
  }
}
 
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    provider: activeProvider(),
    models: {
      triage: process.env.TRIAGE_MODEL || 'llama-3.1-8b-instant',
      reply: process.env.REPLY_MODEL || 'llama-3.3-70b-versatile',
      sql: process.env.SQL_MODEL || 'llama-3.3-70b-versatile',
    },
    confidence_threshold: Number(process.env.CONFIDENCE_THRESHOLD ?? 0.7),
    knowledge_base: kbStats(),
  });
});
 
// --- the SaaS as it existed before the AI work -------------------------------
app.get('/api/tickets', route(async (_req, res) => {
  res.json(query(`
    SELECT t.*, c.company, c.contact_name
    FROM tickets t JOIN customers c ON c.id = t.customer_id
    ORDER BY t.created_at DESC`));
}));
 
app.get('/api/tickets/:id', route(async (req, res) => {
  const rows = query(`
    SELECT t.*, c.company, c.contact_name, c.email, c.country,
           s.plan, s.seats, s.mrr, s.status AS subscription_status
    FROM tickets t
    JOIN customers c ON c.id = t.customer_id
    LEFT JOIN subscriptions s ON s.customer_id = c.id
    WHERE t.id = ?`, [Number(req.params.id)]);
  if (!rows.length) return res.status(404).json({ error: 'ticket not found' });
  res.json(rows[0]);
}));
 
app.get('/api/stats', route(async (_req, res) => {
  res.json({
    tickets: query('SELECT COUNT(*) AS total, SUM(triaged_at IS NOT NULL) AS triaged, SUM(routed_to = \'human-review\') AS human_review FROM tickets')[0],
    by_category: query('SELECT category, COUNT(*) AS n FROM tickets WHERE category IS NOT NULL GROUP BY category ORDER BY n DESC'),
    by_priority: query('SELECT priority, COUNT(*) AS n FROM tickets WHERE priority IS NOT NULL GROUP BY priority'),
    mrr: query('SELECT SUM(mrr) AS active_mrr FROM subscriptions WHERE status = \'active\'')[0],
  });
}));
 
// --- AI feature 1: triage ----------------------------------------------------
app.post('/api/tickets/:id/triage', budget(1), route(async (req, res) => {
  const id = Number(req.params.id);
  const rows = query('SELECT * FROM tickets WHERE id = ?', [id]);
  if (!rows.length) return res.status(404).json({ error: 'ticket not found' });
 
  const result = await triageTicket(rows[0]);
  run(`UPDATE tickets SET category = ?, priority = ?, sentiment = ?, confidence = ?, routed_to = ?, routing_reason = ?, triaged_at = ? WHERE id = ?`,
    [result.category, result.priority, result.sentiment, result.confidence, result.routed_to, result.routing_reason, new Date().toISOString(), id]);
  persist();
 
  if (result.priority === 'urgent' || result.category === 'security') {
    await notifyN8n('ticket.urgent', { ticket: { id, subject: rows[0].subject, ...result } });
  }
  res.json({ id, ...result });
}));
 
app.post('/api/triage/run-all', budget(40), route(async (_req, res) => {
  const pending = query('SELECT * FROM tickets WHERE triaged_at IS NULL ORDER BY id');
  const results = [];
  for (const ticket of pending) {
    const result = await triageTicket(ticket);
    run(`UPDATE tickets SET category = ?, priority = ?, sentiment = ?, confidence = ?, routed_to = ?, routing_reason = ?, triaged_at = ? WHERE id = ?`,
      [result.category, result.priority, result.sentiment, result.confidence, result.routed_to, result.routing_reason, new Date().toISOString(), ticket.id]);
    results.push({ id: ticket.id, subject: ticket.subject, ...result });
  }
  persist();
  console.log(`[triage] processed ${results.length} tickets, ${results.filter((r) => r.needs_human).length} sent to human review`);
  res.json({ processed: results.length, human_review: results.filter((r) => r.needs_human).length, results });
}));
 
// --- AI feature 2: grounded reply drafts -------------------------------------
app.post('/api/tickets/:id/draft-reply', budget(1), route(async (req, res) => {
  const rows = query(`
    SELECT t.*, c.contact_name FROM tickets t JOIN customers c ON c.id = t.customer_id WHERE t.id = ?`,
    [Number(req.params.id)]);
  if (!rows.length) return res.status(404).json({ error: 'ticket not found' });
  res.json(await draftReply(rows[0]));
}));
 
// --- AI feature 3: ask your data ---------------------------------------------
app.post('/api/ask-data', budget(1), route(async (req, res) => {
  const question = String(req.body?.question ?? '').trim();
  if (!question) return res.status(400).json({ error: 'question is required' });
  res.json(await askData(question));
}));
 
/**
 * The most recent `npm run eval` result, so the console can show how well the AI scored
 * rather than only what it produced. Returns 404 until an evaluation has been run.
 */
app.get('/api/eval-report', route(async (_req, res) => {
  const file = path.join(ROOT, 'eval', 'report.json');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'no evaluation has been run yet' });
  res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
}));
 
/**
 * Puts the demo back to a first-visit state: 40 untriaged tickets.
 *
 * The AI's decisions are stored server-side, which is right for a product and awkward for a
 * demo — after one walkthrough every ticket is already triaged, and the next person to open
 * the link sees the ending rather than the beginning. This is the reset, so the demo can be
 * shown twice.
 *
 * Costs no model calls, so it sits outside the AI budget.
 */
app.post('/api/demo/reset', route(async (_req, res) => {
  const counts = await seedDatabase();
  console.log(`[demo] reset to ${counts.tickets} untriaged tickets`);
  res.json({ ok: true, ...counts });
}));
 
app.use(express.static(path.join(ROOT, 'dist')));
 
const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`[api] http://localhost:${port} — provider: ${activeProvider()}`);
});
 