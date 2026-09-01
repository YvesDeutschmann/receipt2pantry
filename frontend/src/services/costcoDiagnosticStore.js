/**
 * In-memory Costco diagnostic summary for the on-device overlay (dev/QA only).
 */

/** @type {Set<(state: object) => void>} */
const listeners = new Set();

/** @type {object} */
let state = {
  syncId: null,
  checkpoints: {},
  tokenExchange: null,
  lastUpdatedAt: null,
};

function notify() {
  for (const listener of listeners) {
    try {
      listener({ ...state, checkpoints: { ...state.checkpoints } });
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {string | null} syncId
 */
export function resetCostcoDiagnosticStore(syncId = null) {
  state = {
    syncId,
    checkpoints: {},
    tokenExchange: null,
    lastUpdatedAt: Date.now(),
  };
  notify();
}

/**
 * @param {'diag-checkpoint'|'token-exchange'} kind
 * @param {object} data
 * @param {object} [flat]
 */
export function recordCostcoDiagnosticEvent(kind, data, flat) {
  state.lastUpdatedAt = Date.now();
  if (kind === 'diag-checkpoint' && data?.checkpoint) {
    state.checkpoints[String(data.checkpoint)] = {
      data,
      flat: flat ?? null,
      at: Date.now(),
    };
  }
  if (kind === 'token-exchange') {
    state.tokenExchange = {
      data,
      flat: flat ?? null,
      at: Date.now(),
    };
  }
  notify();
}

/** @returns {object} */
export function getCostcoDiagnosticSummary() {
  return { ...state, checkpoints: { ...state.checkpoints } };
}

/**
 * @param {(state: object) => void} listener
 * @returns {() => void}
 */
export function subscribeCostcoDiagnostic(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Human-readable one-line verdict for the overlay pill.
 * @param {object} summary
 */
export function summarizeCostcoDiagnosticForDisplay(summary) {
  const cp = summary?.checkpoints ?? {};
  const a0 = cp.a0?.flat;
  const a1 = cp.a1?.flat;
  const tokensFound = cp['tokens-found']?.flat;
  const tok = summary?.tokenExchange?.flat;
  const tokData = summary?.tokenExchange?.data;
  const parts = [];
  if (a0) {
    parts.push(`A0 creds:${a0.censusSeen ?? 0}`);
  }
  if (tok?.tokenFired) {
    parts.push(`/token ${tok.tokenStatus ?? '?'}`);
    if (tok.tokenPolicy) parts.push(tok.tokenPolicy.slice(-12));
  } else if (tokData?.source === 'missed' || tok?.tokenSource === 'missed') {
    const sweeps = tok?.tokenSweepRuns ?? tokData?.sweepRuns ?? 0;
    parts.push(`/token missed (${sweeps} sweeps)`);
  } else if (a1 && !tok) {
    parts.push('no /token yet');
  }
  const tfp =
    tokensFound?.tfp || tokensFound?.censusTfp || a1?.censusTfp || a1?.tfp;
  if (tfp) parts.push(`tfp:${String(tfp).slice(-8)}`);
  if (cp['purge-expired']?.data?.removedCount != null) {
    parts.push(`purged:${cp['purge-expired'].data.removedCount}`);
  }
  return parts.length ? parts.join(' · ') : 'Costco diag…';
}
