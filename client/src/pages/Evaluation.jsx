import { useEffect, useState } from 'react';
import { Loading, Notice } from '../components/bits.jsx';

/** @param {number} n @returns {string} */
const pct = (n) => `${(n * 100).toFixed(1)}%`;

/** @param {{n: string, l: string, h?: string}} props */
function Metric({ n, l, h }) {
  return (
    <div className="metric">
      <div className="n">{n}</div>
      <div className="l">{l}</div>
      {h && <div className="h">{h}</div>}
    </div>
  );
}

/**
 * Shows the last `npm run eval` result. This page is the point of the project: anyone can
 * bolt a model onto a product, and this is the evidence that it does the job well enough to
 * put in front of customers.
 */
export default function Evaluation() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/eval-report')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('No evaluation has been run yet. Run `npm run eval` and reload.'))))
      .then(setReport)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <><div className="page-head"><h1>Evaluation</h1></div><Notice tone="warn">{error}</Notice></>;
  if (!report) return <Loading label="Loading the last evaluation…" />;

  const t = report.triage;
  const a = report.ask_data;
  const wrong = t?.rows.filter((r) => !r.correct.category) ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Evaluation</h1>
          <p>
            Scored against 40 hand-labelled tickets and 17 analytics questions, 2 of which are
            safety checks the system is supposed to refuse. Run <code>npm run eval</code> to
            reproduce.
          </p>
        </div>
        <span className="badge brand">{report.provider}{report.provider === 'mock' ? ' — rules baseline' : ''}</span>
      </div>

      {t && (
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, marginBottom: 12 }}>Ticket triage</h2>
          <div className="eval-grid">
            <Metric n={pct(t.category_accuracy)} l="category correct" h={`${Math.round(t.category_accuracy * t.total)} of ${t.total} tickets`} />
            <Metric n={pct(t.priority_accuracy)} l="priority correct" />
            <Metric n={pct(t.sentiment_accuracy)} l="sentiment correct" />
            <Metric n={String(t.missed_escalations)} l="missed escalations" h="tickets a human should have seen that were auto-routed — the expensive mistake" />
            <Metric n={String(t.unnecessary_human_review)} l="sent to a human unnecessarily" h="the cheap mistake: correct label, still queued" />
            <Metric n={`${t.avg_ms}ms`} l="average latency per ticket" />
          </div>
        </section>
      )}

      {a && (
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, marginBottom: 12 }}>Ask your data</h2>
          <div className="eval-grid">
            <Metric n={`${a.correct}/${a.answerable}`} l="questions answered correctly" h="the generated SQL returns the same rows as a hand-written reference query" />
            <Metric n={`${a.refused_correctly}/${a.safety_checks}`} l="safety checks refused" h="a delete request and an unanswerable question" />
            <Metric n={String(a.unsafe_queries_generated)} l="unsafe queries that reached the database" h="blocked by the validator before execution" />
          </div>
        </section>
      )}

      {wrong.length > 0 && (
        <section>
          <h2 style={{ fontSize: 17, marginBottom: 12 }}>Where triage disagreed with the labels</h2>
          <div className="scroll">
            <table>
              <thead>
                <tr><th style={{ width: 52 }}>#</th><th>Subject</th><th style={{ width: 140 }}>Expected</th><th style={{ width: 140 }}>Model said</th><th style={{ width: 110 }}>Confidence</th></tr>
              </thead>
              <tbody>
                {wrong.map((r) => (
                  <tr key={r.id}>
                    <td className="sub">{r.id}</td>
                    <td className="subject">{r.subject}</td>
                    <td><span className="badge ok">{r.expected.category}</span></td>
                    <td><span className="badge high">{r.got.category}</span></td>
                    <td className="conf">{Math.round(r.confidence * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="sub" style={{ marginTop: 10 }}>
            Listing the failures matters more than the headline number: it shows which ticket
            types would need a better prompt, more examples, or a human in the loop.
          </p>
        </section>
      )}
    </>
  );
}
