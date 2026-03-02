/**
 * Debug logger for One-Tap sync - sends NDJSON to ingest endpoint for analysis.
 * Used only during debug sessions. Wrap logs in #region for folding.
 * Uses backend /api/debug-ingest so logs reach the server even when Cursor ingest is unreachable.
 */

const SESSION_ID = '392e90';

function getIngestUrl() {
  try {
    const host = typeof window !== 'undefined' && window?.location?.hostname;
    const h = host && host !== 'localhost' && host !== '127.0.0.1' ? host : '127.0.0.1';
    const apiBase = import.meta.env?.VITE_API_BASE_URL || `http://${h}:5000/api`;
    const base = apiBase.replace(/\/$/, '');
    return `${base}/debug-ingest`;
  } catch (_) {}
  return 'http://127.0.0.1:5000/api/debug-ingest';
}

function log(location, message, data = {}, hypothesisId = null) {
  const payload = {
    sessionId: SESSION_ID,
    location,
    message,
    data,
    timestamp: Date.now(),
  };
  if (hypothesisId) payload.hypothesisId = hypothesisId;
  fetch(getIngestUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': SESSION_ID },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

export { log };
