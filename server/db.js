/**
 * SQLite access through sql.js (WASM), so the demo runs anywhere with no native build step.
 * The whole database lives in one file under data/ and is flushed after every write.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_FILE = path.join(ROOT, 'data', 'harbordesk.sqlite');

let db = null;

/**
 * Opens the database, creating the file on first use.
 * @returns {Promise<import('sql.js').Database>}
 */
export async function getDb() {
  if (db) return db;
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(ROOT, 'node_modules', 'sql.js', 'dist', file),
  });
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  db = fs.existsSync(DB_FILE) ? new SQL.Database(fs.readFileSync(DB_FILE)) : new SQL.Database();
  return db;
}

/** Writes the in-memory database back to disk. Call after any INSERT/UPDATE. */
export function persist() {
  if (!db) return;
  fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
}

/**
 * Runs a SELECT and returns plain row objects.
 * @param {string} sql
 * @param {unknown[]} [params]
 * @returns {Record<string, unknown>[]}
 */
export function query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

/**
 * Runs a statement that returns no rows.
 * @param {string} sql
 * @param {unknown[]} [params]
 */
export function run(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
}

/** The schema shown to the natural-language-to-SQL model; keep it in step with seed.js. */
export const SCHEMA_SQL = `
CREATE TABLE customers (
  id            INTEGER PRIMARY KEY,
  company       TEXT NOT NULL,
  contact_name  TEXT NOT NULL,
  email         TEXT NOT NULL,
  country       TEXT NOT NULL,
  signed_up_on  TEXT NOT NULL              -- YYYY-MM-DD
);

CREATE TABLE subscriptions (
  id            INTEGER PRIMARY KEY,
  customer_id   INTEGER NOT NULL REFERENCES customers(id),
  plan          TEXT NOT NULL,             -- 'starter' | 'growth' | 'scale'
  seats         INTEGER NOT NULL,
  mrr           REAL NOT NULL,             -- monthly recurring revenue, USD
  status        TEXT NOT NULL,             -- 'active' | 'past_due' | 'cancelled'
  started_on    TEXT NOT NULL,
  cancelled_on  TEXT                       -- NULL unless status = 'cancelled'
);

CREATE TABLE invoices (
  id            INTEGER PRIMARY KEY,
  customer_id   INTEGER NOT NULL REFERENCES customers(id),
  issued_on     TEXT NOT NULL,
  due_on        TEXT NOT NULL,
  amount        REAL NOT NULL,
  status        TEXT NOT NULL              -- 'paid' | 'open' | 'overdue' | 'refunded'
);

CREATE TABLE tickets (
  id             INTEGER PRIMARY KEY,
  customer_id    INTEGER NOT NULL REFERENCES customers(id),
  subject        TEXT NOT NULL,
  body           TEXT NOT NULL,
  channel        TEXT NOT NULL,            -- 'email' | 'chat' | 'portal'
  created_at     TEXT NOT NULL,            -- ISO timestamp
  status         TEXT NOT NULL,            -- 'open' | 'pending' | 'closed'
  category       TEXT,                     -- set by AI triage
  priority       TEXT,                     -- set by AI triage: 'low' | 'normal' | 'high' | 'urgent'
  sentiment      TEXT,                     -- set by AI triage: 'happy' | 'neutral' | 'frustrated' | 'angry'
  confidence     REAL,                     -- 0..1 from the triage model
  routed_to      TEXT,                     -- team name, or 'human-review'
  routing_reason TEXT,                     -- why a human was involved: policy, category, priority or confidence
  triaged_at     TEXT
);
`;
