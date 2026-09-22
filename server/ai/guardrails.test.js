/**
 * Tests for the parts that must not fail quietly: the SQL guardrail, retrieval, and the
 * JSON parsing that sits between a language model and the rest of the app.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSql } from './sqlgen.js';
import { retrieve } from './retrieve.js';
import { parseJson } from './provider.js';
import { screenTicket } from './sensitive.js';

test('validateSql accepts ordinary read-only queries', () => {
  const accepted = [
    "SELECT company FROM customers WHERE country = 'Canada'",
    'SELECT plan, SUM(mrr) AS mrr FROM subscriptions GROUP BY plan',
    'WITH recent AS (SELECT * FROM tickets) SELECT COUNT(*) FROM recent',
    'SELECT c.company FROM invoices i JOIN customers c ON c.id = i.customer_id LIMIT 10',
  ];
  accepted.forEach((sql) => assert.equal(validateSql(sql), null, sql));
});

test('validateSql refuses writes and schema changes', () => {
  const refused = [
    'DELETE FROM subscriptions',
    'DROP TABLE customers',
    'UPDATE invoices SET status = \'paid\'',
    'INSERT INTO tickets (id) VALUES (99)',
    'ALTER TABLE customers ADD COLUMN x TEXT',
    'CREATE TABLE evil (id INTEGER)',
  ];
  refused.forEach((sql) => assert.notEqual(validateSql(sql), null, sql));
});

test('validateSql blocks a write hidden after a second statement', () => {
  assert.notEqual(validateSql('SELECT 1; DROP TABLE customers'), null);
});

test('validateSql blocks comment-based smuggling', () => {
  assert.notEqual(validateSql('SELECT * FROM customers -- DROP TABLE customers'), null);
  assert.notEqual(validateSql('SELECT /* DELETE */ * FROM customers'), null);
});

test('validateSql refuses tables outside the allowlist', () => {
  assert.match(validateSql('SELECT * FROM sqlite_master'), /system tables|unknown table/);
  assert.match(validateSql('SELECT * FROM secrets'), /unknown table/);
  assert.match(validateSql('SELECT * FROM customers JOIN passwords ON 1=1'), /unknown table/);
});

test('validateSql refuses PRAGMA and ATTACH', () => {
  assert.notEqual(validateSql('PRAGMA table_info(customers)'), null);
  assert.notEqual(validateSql("SELECT * FROM customers; ATTACH DATABASE 'x' AS y"), null);
});

test('validateSql refuses an empty query', () => {
  assert.equal(validateSql(''), 'empty query');
  assert.equal(validateSql('   '), 'empty query');
});

test('retrieval finds the right article for a billing question', () => {
  const hits = retrieve('our invoices show the wrong VAT rate for a Swiss company');
  assert.ok(hits.length > 0);
  assert.match(hits[0].article, /VAT/i);
});

test('retrieval handles wording that differs from the docs', () => {
  const hits = retrieve('drivers photos vanish when they are too big');
  assert.match(hits[0].article, /upload|attachment/i);
});

test('retrieval returns nothing for an unrelated question', () => {
  assert.equal(retrieve('what is the capital of Portugal').length, 0);
});

test('the tripwire catches compliance questions that read like how-to questions', () => {
  // The exact shape the evaluation caught: a security ticket with no alarming words in it.
  const soc2 = screenTicket({
    subject: 'Need SOC 2 report for procurement',
    body: "Our client's procurement team has asked for your SOC 2 Type II report.",
  });
  assert.equal(soc2.tripped, true);
  assert.match(soc2.reason, /compliance/i);

  const twoFactor = screenTicket({
    subject: 'Two-factor authentication for our team',
    body: 'Our insurer is asking whether we enforce 2FA. Can we require it for everyone?',
  });
  assert.equal(twoFactor.tripped, true);
});

test('the tripwire catches a customer leaving, however politely they put it', () => {
  assert.equal(screenTicket({ subject: 'Pause our account for two months', body: 'Can we pause billing and keep our data?' }).tripped, true);
  assert.equal(screenTicket({ subject: 'Cancelling our subscription', body: 'Please cancel our account.' }).tripped, true);
});

test('the tripwire catches access that outlived an account', () => {
  const r = screenTicket({ subject: 'Removed user can still access the API', body: 'Please revoke it.' });
  assert.equal(r.tripped, true);
  assert.match(r.reason, /access/i);
});

test('the tripwire leaves ordinary tickets alone', () => {
  const ordinary = [
    { subject: 'How do I invite a teammate?', body: 'I cannot find the invite button anywhere.' },
    { subject: 'Wrong VAT rate on our invoice', body: 'We are a Swiss company and the invoice shows 20%.' },
    { subject: 'Love the new dashboard', body: 'Just wanted to say the new charts are great.' },
    { subject: 'Slack messages are duplicated', body: 'Every notification arrives twice in our channel.' },
  ];
  ordinary.forEach((t) => assert.equal(screenTicket(t).tripped, false, t.subject));
});

test('the tripwire matches whole words, not fragments', () => {
  // "scan" contains "scim"? no — but "audited", "canceller" and similar near-misses should not
  // trip a rule written for "audit" and "cancel".
  assert.equal(screenTicket({ subject: 'Auditorium booking export', body: 'We run a venue.' }).tripped, false);
  assert.equal(screenTicket({ subject: 'Cancellations report', body: 'cancellation' }).tripped, true);
});

test('parseJson survives markdown fences and surrounding prose', () => {
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJson('Sure! {"a":2} Hope that helps.'), { a: 2 });
  assert.throws(() => parseJson('no json at all'), /no JSON/);
});
