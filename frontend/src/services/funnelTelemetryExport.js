/**
 * Dev/QA export of funnel telemetry to /api/dev/log so a device run
 * does not need Chrome DevTools attached during receipt fetch.
 */

import { postDevLog } from './apiClient';
import { dump, subscribe, getSessionId, reset, FunnelEvent } from './funnelTelemetry';

export const FUNNEL_TELEMETRY_FLAG = 'FUNNEL_TELEMETRY_DEV_PANEL';
export const FUNNEL_TELEMETRY_EXPORT_CHANGED = 'funnel-telemetry-export-changed';

let started = false;

function readLocalFlag() {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.localStorage?.getItem === 'function' &&
      window.localStorage.getItem(FUNNEL_TELEMETRY_FLAG) === '1'
    );
  } catch {
    return false;
  }
}

function readBuildFlag() {
  try {
    return (
      import.meta.env.VITE_FUNNEL_TELEMETRY_DEV_PANEL === '1' ||
      import.meta.env.VITE_ENABLE_DEV_SETTINGS === '1'
    );
  } catch {
    return false;
  }
}

/**
 * True when the on-device dump overlay / /dev/log export should run.
 * @returns {boolean}
 */
export function isFunnelTelemetryExportEnabled() {
  return readLocalFlag() || readBuildFlag();
}

function attachWindowHook() {
  if (typeof window === 'undefined') return;
  const prev = window.__funnelTelemetry && typeof window.__funnelTelemetry === 'object'
    ? window.__funnelTelemetry
    : {};
  window.__funnelTelemetry = {
    dump: prev.dump ?? dump,
    reset: prev.reset ?? reset,
    getSessionId: prev.getSessionId ?? getSessionId,
    exportDump: () => exportDumpToDevLog('manual'),
  };
}

/**
 * Persist the localStorage flag and expose dump/export on window.
 * Safe to call from a 5-tap gesture before sign-in.
 */
export function enableFunnelTelemetryExport() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(FUNNEL_TELEMETRY_FLAG, '1');
    }
  } catch {
    /* ignore */
  }
  attachWindowHook();
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(FUNNEL_TELEMETRY_EXPORT_CHANGED));
    }
  } catch {
    /* ignore */
  }
}

/**
 * Compact proof object for backend logs and the on-device overlay.
 * @param {Array} events
 */
export function summarizeDump(events) {
  const list = Array.isArray(events) ? events : [];
  const byName = {};
  for (const entry of list) {
    if (entry && typeof entry.event === 'string') {
      byName[entry.event] = entry;
    }
  }
  const signIn = byName[FunnelEvent.SIGN_IN];
  const receipts = byName[FunnelEvent.RECEIPTS_SYNCED];
  const firstSuggestion = byName[FunnelEvent.FIRST_SUGGESTION_VIEWED];
  const sessionIds = new Set(list.map((entry) => entry?.sessionId).filter(Boolean));
  const matchCount = receipts?.metadata?.matchCount;
  return {
    count: list.length,
    events: list.map((entry) => entry?.event).filter(Boolean),
    sessionId: list[0]?.sessionId ?? null,
    sameSession: sessionIds.size <= 1,
    userId: list[0]?.userId ?? null,
    receiptsSynced: Boolean(receipts),
    matchCount: typeof matchCount === 'number' ? matchCount : null,
    coldStartDeltaMs:
      signIn &&
      firstSuggestion &&
      typeof signIn.timestamp === 'number' &&
      typeof firstSuggestion.timestamp === 'number'
        ? firstSuggestion.timestamp - signIn.timestamp
        : null,
  };
}

function safePostDevLog(tag, payload) {
  if (typeof postDevLog !== 'function') return;
  try {
    postDevLog(tag, JSON.stringify(payload));
  } catch {
    /* never throw */
  }
}

/**
 * POST a summary + full dump to /api/dev/log. No-op when export is disabled.
 * @param {'emit'|'receipts_synced'|'manual'} reason
 * @param {{ lastEvent?: object, events?: Array }} [options]
 */
export async function exportDumpToDevLog(reason, options = {}) {
  try {
    if (!isFunnelTelemetryExportEnabled()) return;
    const events = Array.isArray(options.events) ? options.events : await dump();
    const summary = summarizeDump(events);
    safePostDevLog('funnelTelemetry', {
      reason,
      lastEvent: options.lastEvent?.event ?? null,
      summary,
    });
    safePostDevLog('funnelTelemetryDump', events);
  } catch (e) {
    console.warn('[FunnelTelemetryExport] export failed:', e);
  }
}

/**
 * Start shipping a dump line on every newly persisted funnel event.
 * Safe to call once at app boot.
 */
export function startFunnelTelemetryExport() {
  if (started) return;
  started = true;
  if (isFunnelTelemetryExportEnabled()) {
    attachWindowHook();
  }
  subscribe((entry, all) => {
    if (!isFunnelTelemetryExportEnabled()) return;
    const reason =
      entry?.event === FunnelEvent.RECEIPTS_SYNCED ? 'receipts_synced' : 'emit';
    void exportDumpToDevLog(reason, { lastEvent: entry, events: all });
  });
}
