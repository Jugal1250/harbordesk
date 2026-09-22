/**
 * "Ask your data": turns a plain-English question into read-only SQL, checks it, runs it.
 *
 * The model writes SQL; it does not decide what is safe to run. Every generated statement
 * passes `validateSql` before it reaches the database, and the checks are deliberately
 * whitelist-based: anything not recognised is refused rather than allowed through.
 */
import { completeJson } from './provider.js';
import { query, SCHEMA_SQL } from '../db.js';

const ALLOWED_TABLES = new Set(['customers', 'subscriptions', 'invoices', 'tickets']);
const BANNED = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex|truncate|grant|revoke)\b/i;
const MAX_ROWS = 200;

const SYSTEM = `You write SQLite SELECT queries for a support team's analytics page. Reply with JSON only:
{"sql": string, "explanation": string, "chart": {"type": "bar"|"line"|"none", "label_column": string, "value_column": string}}

Rules:
- SELECT statements only. Never write INSERT, UPDATE, DELETE or DDL. One statement, no semicolon.
- Use only the tables and columns in the schema. Never invent a column.
- Today is 2026-09-22. Dates are TEXT in 'YYYY-MM-DD'; tickets.created_at is an ISO timestamp.
  Use date('now') only via literals like '2026-09-22'; prefer explicit comparisons.
- Always alias aggregates with readable names (SUM(mrr) AS mrr).
- Add LIMIT 200 unless the query already aggregates to fewer rows.
- chart.type is "none" unless the result has one label column and one numeric column worth plotting.
- If the question cannot be answered from this schema, return {"sql": "", "explanation": "why not", "chart": {"type":"none","label_column":"","value_column":""}}.`;

/**
 * Whitelist validation of generated SQL. Returns the reason it was refused, or null when safe.
 * @param {string} sql
 * @returns {string|null}
 */
export function validateSql(sql) {
  const text = String(sql ?? '').trim().replace(/;+\s*$/, '');
  if (!text) return 'empty query';
  if (/--|\/\*/.test(text)) return 'comments are not allowed';
  if (text.includes(';')) return 'only one statement is allowed';
  if (!/^select\b/i.test(text) && !/^with\b/i.test(text)) return 'only SELECT queries are allowed';
  if (BANNED.test(text)) return `statement contains a write or schema keyword`;

  // Names introduced by a CTE are legitimate targets for a later FROM, so collect them first.
  const cteNames = new Set([...text.matchAll(/(?:\bwith\s+|,\s*)([a-z_][a-z0-9_]*)\s+as\s*\(/gi)].map((m) => m[1].toLowerCase()));

  // Every table named after FROM or JOIN must be one we expose, or a CTE defined above.
  const referenced = [...text.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase());
  const unknown = referenced.filter((t) => !ALLOWED_TABLES.has(t) && !cteNames.has(t));
  if (unknown.length) return `unknown table: ${[...new Set(unknown)].join(', ')}`;
  if (/\bsqlite_[a-z_]+/i.test(text)) return 'system tables are not accessible';
  return null;
}

/** Adds a row cap when the model left one out. @param {string} sql @returns {string} */
function capRows(sql) {
  const text = sql.trim().replace(/;+\s*$/, '');
  return /\blimit\s+\d+/i.test(text) ? text : `${text} LIMIT ${MAX_ROWS}`;
}

/**
 * @param {string} question
 * @returns {Promise<{question: string, sql: string, explanation: string, rows: Record<string, unknown>[], columns: string[], chart: object, refused: string|null, provider: string, ms: number}>}
 */
export async function askData(question) {
  const { data, provider, ms } = await completeJson({
    model: process.env.SQL_MODEL || 'llama-3.3-70b-versatile',
    system: SYSTEM,
    mockKind: 'sql',
    maxTokens: 600,
    user: `Schema\n${SCHEMA_SQL}\n\nQuestion\n${question}`,
  });

  const explanation = String(data.explanation ?? '');
  const chart = data.chart ?? { type: 'none', label_column: '', value_column: '' };
  const sql = String(data.sql ?? '').trim();

  if (!sql) {
    return { question, sql: '', explanation, rows: [], columns: [], chart, refused: 'the model could not answer this from the schema', provider, ms };
  }

  const problem = validateSql(sql);
  if (problem) {
    console.warn(`[ask-data] refused generated SQL (${problem}): ${sql.slice(0, 120)}`);
    return { question, sql, explanation, rows: [], columns: [], chart, refused: problem, provider, ms };
  }

  try {
    const rows = query(capRows(sql));
    return {
      question,
      sql: capRows(sql),
      explanation,
      rows,
      columns: rows.length ? Object.keys(rows[0]) : [],
      chart,
      refused: null,
      provider,
      ms,
    };
  } catch (error) {
    // A query that parses but does not run (wrong column name, bad function) is reported, not hidden.
    return { question, sql, explanation, rows: [], columns: [], chart, refused: `SQLite rejected the query: ${error.message}`, provider, ms };
  }
}
