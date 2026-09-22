import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Confidence, Loading, Notice, PriorityBadge, RouteBadge } from '../components/bits.jsx';

/**
 * One ticket, with the two AI actions an agent would actually use: triage it, and draft a
 * reply from the help centre. The draft is never sent automatically — it is put in front of
 * an agent with its sources, so they can check the answer before it reaches a customer.
 *
 * @param {{id: number, threshold: number, onBack: () => void, onChanged: () => Promise<void>}} props
 */
export default function Ticket({ id, threshold, onBack, onChanged }) {
  const [ticket, setTicket] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setTicket(null);
    setDraft(null);
    setError(null);
    api.ticket(id).then(setTicket).catch((e) => setError(e.message));
  }, [id]);

  const act = async (kind, fn) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const runTriage = () => act('triage', async () => {
    await api.triage(id);
    setTicket(await api.ticket(id));
    await onChanged();
  });

  const runDraft = () => act('draft', async () => {
    setDraft(await api.draftReply(id));
    setCopied(false);
  });

  const copyDraft = async () => {
    try {
      await navigator.clipboard.writeText(draft.draft);
      setCopied(true);
    } catch {
      setError('Your browser blocked clipboard access. Select the draft text and copy it manually.');
    }
  };

  if (error && !ticket) return <Notice tone="err">{error}</Notice>;
  if (!ticket) return <Loading label="Loading ticket…" />;

  return (
    <>
      <div className="page-head">
        <div>
          <button type="button" className="btn ghost small" onClick={onBack}>Back to inbox</button>
          <h1 style={{ marginTop: 12 }}>{ticket.subject}</h1>
          <div className="meta" style={{ marginTop: 8 }}>
            <span>#{ticket.id}</span>
            <span>{ticket.company}</span>
            <span>{ticket.contact_name}</span>
            <span>{ticket.channel}</span>
            <span>{new Date(ticket.created_at).toLocaleString('en-GB')}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn ghost" onClick={runTriage} disabled={busy}>
            {busy === 'triage' ? 'Triaging…' : ticket.triaged_at ? 'Re-run triage' : 'Triage'}
          </button>
          <button type="button" className="btn" onClick={runDraft} disabled={busy}>
            {busy === 'draft' ? 'Drafting…' : 'Draft a reply'}
          </button>
        </div>
      </div>

      {error && <Notice tone="err">{error}</Notice>}

      <div className="detail" style={{ marginTop: error ? 16 : 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <section className="card">
            <h3>Customer message</h3>
            <p className="ticket-body">{ticket.body}</p>
          </section>

          {draft && (
            <section className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <h3>Suggested reply</h3>
                <button type="button" className="btn ghost small" onClick={copyDraft}>{copied ? 'Copied' : 'Copy draft'}</button>
              </div>

              {draft.needs_human ? (
                <Notice tone="warn">
                  {draft.answered_from_kb
                    ? 'The help centre only partly covers this. Check the draft before sending.'
                    : 'The help centre does not cover this question, so the draft makes no promises. A specialist should answer.'}
                </Notice>
              ) : (
                <Notice tone="ok">Answered from the help centre, with sources below. Still worth a glance before sending.</Notice>
              )}

              <p className="draft">{draft.draft}</p>

              {draft.sources.length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, marginTop: 18 }}>Sources used</h3>
                  <ul className="sources">
                    {draft.sources.map((s) => (
                      <li key={`${s.article}-${s.heading}`}>
                        <span>{s.article}{s.heading !== s.article ? ` — ${s.heading}` : ''}</span>
                        <span className="conf">match {s.score}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="sub" style={{ marginTop: 14 }}>
                {draft.provider} · {draft.ms}ms · confidence {Math.round(draft.confidence * 100)}%
              </p>
            </section>
          )}
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <section className="card">
            <h3>AI triage</h3>
            {ticket.triaged_at ? (
              <dl className="kv" style={{ marginTop: 12 }}>
                <dt>Category</dt><dd><span className="badge">{ticket.category}</span></dd>
                <dt>Priority</dt><dd><PriorityBadge priority={ticket.priority} /></dd>
                <dt>Sentiment</dt><dd><span className="badge">{ticket.sentiment}</span></dd>
                <dt>Confidence</dt><dd><Confidence value={ticket.confidence} threshold={threshold} /></dd>
                <dt>Routed to</dt><dd><RouteBadge to={ticket.routed_to} /></dd>
                {ticket.routing_reason && (
                  <>
                    <dt>Why</dt><dd className="sub">{ticket.routing_reason}</dd>
                  </>
                )}
              </dl>
            ) : (
              <p className="sub" style={{ marginTop: 8 }}>Not triaged yet. The inbox works either way.</p>
            )}
          </section>

          <section className="card">
            <h3>Account</h3>
            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>Company</dt><dd>{ticket.company}</dd>
              <dt>Contact</dt><dd>{ticket.contact_name}</dd>
              <dt>Country</dt><dd>{ticket.country}</dd>
              <dt>Plan</dt><dd>{ticket.plan} · {ticket.seats} seats</dd>
              <dt>MRR</dt><dd>${ticket.mrr}</dd>
              <dt>Status</dt><dd>
                <span className={`badge ${ticket.subscription_status === 'active' ? 'ok' : 'high'}`}>
                  {ticket.subscription_status}
                </span>
              </dd>
            </dl>
          </section>
        </aside>
      </div>
    </>
  );
}
