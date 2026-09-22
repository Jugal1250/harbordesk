import { useState } from 'react';
import { api } from '../api.js';
import { Confidence, Loading, Notice, PriorityBadge, RouteBadge } from '../components/bits.jsx';

/**
 * The support inbox. It works with the AI switched off — triage simply leaves those columns
 * empty — which is how the feature would be introduced to a live product.
 *
 * @param {{tickets: object[], stats: object|null, threshold: number, busy: boolean, onOpen: (id: number) => void, onRefresh: () => Promise<void>}} props
 */
export default function Inbox({ tickets, stats, threshold, onOpen, onRefresh }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const untriaged = tickets.filter((t) => !t.triaged_at).length;

  const runTriage = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.triageAll();
      setResult(res);
      await onRefresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Inbox</h1>
          <p>
            Every ticket that arrived this week. Triage fills in the category, priority and
            sentiment, and routes each ticket — unless it is unsure, in which case a person
            decides.
          </p>
        </div>
        <button type="button" className="btn" onClick={runTriage} disabled={running || untriaged === 0}>
          {running ? 'Triaging…' : untriaged ? `Triage ${untriaged} new tickets` : 'All tickets triaged'}
        </button>
      </div>

      {error && <Notice tone="err">Triage failed: {error}</Notice>}
      {result && (
        <Notice tone="ok">
          Triaged {result.processed} tickets. {result.human_review} went to human review because
          the model was unsure or the ticket touches security, cancellation or money.
        </Notice>
      )}

      {stats && (
        <div className="grid-stats" style={{ marginTop: result || error ? 16 : 0 }}>
          <div className="stat"><div className="n">{stats.tickets.total}</div><div className="l">tickets</div></div>
          <div className="stat"><div className="n">{stats.tickets.triaged ?? 0}</div><div className="l">triaged by AI</div></div>
          <div className="stat"><div className="n">{stats.tickets.human_review ?? 0}</div><div className="l">waiting on a human</div></div>
          <div className="stat"><div className="n">${Math.round(stats.mrr.active_mrr ?? 0).toLocaleString()}</div><div className="l">active MRR</div></div>
        </div>
      )}

      {tickets.length === 0 ? <Loading /> : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th style={{ width: 52 }}>#</th>
                <th>Subject</th>
                <th style={{ width: 150 }}>Category</th>
                <th style={{ width: 110 }}>Priority</th>
                <th style={{ width: 140 }}>Confidence</th>
                <th style={{ width: 140 }}>Routed to</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} className="clickable" onClick={() => onOpen(t.id)}>
                  <td className="sub">{t.id}</td>
                  <td>
                    <div className="subject">{t.subject}</div>
                    <div className="sub">{t.company} · {t.channel}</div>
                  </td>
                  <td>{t.category ? <span className="badge">{t.category}</span> : <span className="sub">—</span>}</td>
                  <td><PriorityBadge priority={t.priority} /></td>
                  <td><Confidence value={t.confidence} threshold={threshold} /></td>
                  <td><RouteBadge to={t.routed_to} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
