/**
 * Thin wrapper over the API. Every call surfaces server errors as thrown Errors so pages
 * can show what went wrong instead of rendering an empty state and hiding the problem.
 */

/**
 * @param {string} path
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}

export const api = {
  health: () => request('/health'),
  tickets: () => request('/tickets'),
  ticket: (id) => request(`/tickets/${id}`),
  stats: () => request('/stats'),
  triage: (id) => request(`/tickets/${id}/triage`, { method: 'POST' }),
  triageAll: () => request('/triage/run-all', { method: 'POST' }),
  draftReply: (id) => request(`/tickets/${id}/draft-reply`, { method: 'POST' }),
  askData: (question) => request('/ask-data', { method: 'POST', body: JSON.stringify({ question }) }),
};
