/** Small shared pieces: badges, confidence bars, and the loading/error states. */

/** @param {{priority?: string}} props */
export function PriorityBadge({ priority }) {
  if (!priority) return <span className="badge">not triaged</span>;
  const tone = priority === 'urgent' ? 'urgent' : priority === 'high' ? 'high' : '';
  return <span className={`badge ${tone}`}>{priority}</span>;
}

/** @param {{value?: number, threshold?: number}} props */
export function Confidence({ value, threshold = 0.7 }) {
  if (value === null || value === undefined) return <span className="conf">—</span>;
  const low = value < threshold;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span className={`bar ${low ? 'low' : ''}`}><i style={{ width: `${Math.round(value * 100)}%` }} /></span>
      <span className="conf">{Math.round(value * 100)}%</span>
    </span>
  );
}

/** @param {{to?: string}} props */
export function RouteBadge({ to }) {
  if (!to) return <span className="badge">—</span>;
  return to === 'human-review'
    ? <span className="badge human">human review</span>
    : <span className="badge brand">{to}</span>;
}

/** @param {{children: React.ReactNode, tone?: 'warn'|'ok'|'err'}} props */
export function Notice({ children, tone = 'warn' }) {
  return <div className={`notice ${tone}`}>{children}</div>;
}

/** @param {{label?: string}} props */
export function Loading({ label = 'Loading…' }) {
  return <p className="sub" role="status">{label}</p>;
}
