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
