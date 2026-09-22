import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import Inbox from './pages/Inbox.jsx';
import Ticket from './pages/Ticket.jsx';
import AskData from './pages/AskData.jsx';
import Evaluation from './pages/Evaluation.jsx';

const PAGES = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'ask', label: 'Ask your data' },
  { id: 'eval', label: 'Evaluation' },
];

/** Harbor Desk console: an existing support product with three AI features added to it. */
export default function App() {
  const [page, setPage] = useState('inbox');
  const [openTicket, setOpenTicket] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [stats, setStats] = useState(null);
  const [health, setHealth] = useState(null);
  const [resetting, setResetting] = useState(false);

  const refresh = useCallback(async () => {
    const [t, s] = await Promise.all([api.tickets(), api.stats()]);
    setTickets(t);
    setStats(s);
  }, []);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
    refresh().catch((e) => console.error('[app] could not load tickets:', e.message));
  }, [refresh]);

  const threshold = health?.confidence_threshold ?? 0.7;
  const humanQueue = tickets.filter((t) => t.routed_to === 'human-review').length;

  const go = (id) => { setPage(id); setOpenTicket(null); };

  /**
   * Puts the demo back to 40 untriaged tickets. Confirmed first, because the triage results
   * are shared — whoever else has the link open is looking at the same data.
   */
  const reset = async () => {
    if (!window.confirm('Reset the demo? Every ticket goes back to untriaged, for everyone with this link open.')) return;
    setResetting(true);
    try {
      await api.resetDemo();
      setOpenTicket(null);
      setPage('inbox');
      await refresh();
    } catch (e) {
      console.error('[app] reset failed:', e.message);
      window.alert(`Could not reset: ${e.message}`);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><span aria-hidden="true" />Harbor Desk</div>
        <nav className="nav" aria-label="Sections">
          {PAGES.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-current={page === p.id}
              onClick={() => go(p.id)}
            >
              {p.label}
              {p.id === 'inbox' && humanQueue > 0 && <span className="count">{humanQueue}</span>}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          {health ? (
            <>
              <span>Provider: <code>{health.provider}</code></span>
              <span>Triage: <code>{health.models.triage}</code></span>
              <span>Confidence gate: <code>{health.confidence_threshold}</code></span>
              <span>{health.knowledge_base.count} help articles indexed</span>
            </>
          ) : <span>API not reachable</span>}
          <button type="button" className="btn ghost small" onClick={reset} disabled={resetting} style={{ marginTop: 10 }}>
            {resetting ? 'Resetting…' : 'Reset demo'}
          </button>
          <a className="sub" href="https://github.com/Jugal1250/harbordesk" target="_blank" rel="noreferrer" style={{ marginTop: 8 }}>
            Source on GitHub →
          </a>
        </div>
      </aside>

      <main className="main">
        {page === 'inbox' && (openTicket
          ? <Ticket id={openTicket} threshold={threshold} onBack={() => setOpenTicket(null)} onChanged={refresh} />
          : <Inbox tickets={tickets} stats={stats} threshold={threshold} onOpen={setOpenTicket} onRefresh={refresh} />)}
        {page === 'ask' && <AskData />}
        {page === 'eval' && <Evaluation />}
      </main>
    </div>
  );
}
