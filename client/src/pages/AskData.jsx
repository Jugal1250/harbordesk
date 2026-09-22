import { useState } from 'react';
import { api } from '../api.js';
import { Notice } from '../components/bits.jsx';

const EXAMPLES = [
  'How many active customers do we have on each plan?',
  'Which customers have overdue invoices, and how much do they owe?',
  'Show the top 5 customers by monthly recurring revenue',
  'How many customers do we have in each country?',
  'Delete all the cancelled subscriptions',
];

/** @param {number|string} v @returns {boolean} */
const isNumeric = (v) => typeof v === 'number' || (v !== '' && v !== null && !Number.isNaN(Number(v)));

/**
 * Picks a label column and a numeric column to plot, when the shape of the result suits it.
 * @param {string[]} columns
 * @param {Record<string, unknown>[]} rows
 * @param {{type?: string, label_column?: string, value_column?: string}} hint
 * @returns {{label: string, value: string}|null}
 */
function chartColumns(columns, rows, hint) {
  if (!rows.length || columns.length < 2 || rows.length > 25) return null;
  if (hint?.type === 'none') return null;
  const label = hint?.label_column && columns.includes(hint.label_column)
    ? hint.label_column
    : columns.find((c) => !isNumeric(rows[0][c]));
  const value = hint?.value_column && columns.includes(hint.value_column)
    ? hint.value_column
    : columns.find((c) => isNumeric(rows[0][c]));
  if (!label || !value || label === value) return null;
  return { label, value };
}

/**
 * Natural-language analytics. The generated SQL is always shown: an analyst can check the
 * query before trusting the number, which is the difference between a demo and something a
 * finance team will use.
 */
export default function AskData() {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const ask = async (q) => {
    const text = (q ?? question).trim();
    if (!text) return;
    setQuestion(text);
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.askData(text));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const chart = result && !result.refused ? chartColumns(result.columns, result.rows, result.chart) : null;
  const max = chart ? Math.max(...result.rows.map((r) => Number(r[chart.value]) || 0)) : 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ask your data</h1>
          <p>
            Ask in plain English. The model writes SQL, the server checks it is read-only and
            only touches permitted tables, then runs it. The query is always shown so the
            answer can be verified.
          </p>
        </div>
      </div>

      <section className="card">
        <form
          className="ask-row"
          onSubmit={(e) => { e.preventDefault(); ask(); }}
        >
          <label htmlFor="q" style={{ position: 'absolute', left: -9999 }}>Your question</label>
          <input
            id="q"
            value={question}
            placeholder="e.g. which customers have overdue invoices?"
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button type="submit" className="btn" disabled={busy || !question.trim()}>
            {busy ? 'Thinking…' : 'Ask'}
          </button>
        </form>
        <div className="chips">
          {EXAMPLES.map((e) => (
            <button key={e} type="button" className="chip" onClick={() => ask(e)}>{e}</button>
          ))}
        </div>
      </section>

      {error && <div style={{ marginTop: 16 }}><Notice tone="err">{error}</Notice></div>}

      {result && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {result.refused ? (
            <Notice tone="warn">
              <div>
                <strong>Refused.</strong> {result.refused}.
                {result.explanation ? ` ${result.explanation}` : ''}
                <div className="sub" style={{ marginTop: 6 }}>
                  The page is read-only by design, so anything that would change or reach outside
                  the permitted tables is blocked before it runs.
                </div>
              </div>
            </Notice>
          ) : (
            <>
              {result.explanation && <p className="sub">{result.explanation}</p>}

              {chart && (
                <section className="card">
                  <h3 style={{ fontSize: 15, marginBottom: 12 }}>{chart.value} by {chart.label}</h3>
                  <div className="chart">
                    {result.rows.map((row, i) => (
                      <div className="chart-row" key={i}>
                        <span>{String(row[chart.label])}</span>
                        <span className="track"><i style={{ width: `${max ? (Number(row[chart.value]) / max) * 100 : 0}%` }} /></span>
                        <span className="val">{Number(row[chart.value]).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <div className="scroll">
                <table>
                  <thead><tr>{result.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i}>{result.columns.map((c) => <td key={c}>{String(row[c] ?? '')}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.rows.length === 0 && <p className="sub">The query ran and returned no rows.</p>}
            </>
          )}

          {result.sql && (
            <section className="card">
              <h3 style={{ fontSize: 14, marginBottom: 10 }}>Generated SQL</h3>
              <pre className="sql">{result.sql}</pre>
              <p className="sub" style={{ marginTop: 10 }}>{result.provider} · {result.ms}ms</p>
            </section>
          )}
        </div>
      )}
    </>
  );
}
