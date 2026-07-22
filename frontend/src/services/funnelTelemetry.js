/**
 * Client-only activation funnel telemetry (Preferences + localStorage fallback).
 * Fire-and-forget; no network calls.
 */

const STORAGE_KEY = 'funnel_telemetry';
const MAX_EVENTS = 200;

/** @enum {string} */
export const FunnelEvent = {
  SIGN_IN: 'funnel_sign_in',
  STORE_CONNECTED: 'funnel_store_connected',
  RECEIPTS_SYNCED: 'funnel_receipts_synced',
  STAPLES_CONFIRMED: 'funnel_staples_confirmed',
  FIRST_SUGGESTION_VIEWED: 'funnel_first_suggestion_viewed',
  FIRST_COOK_LOGGED: 'funnel_first_cook_logged',
};

const sessionId = crypto.randomUUID();

/** @type {boolean | null} */
let _preferencesAvailableCache = null;

async function isPreferencesAvailable(probeKey) {
  if (_preferencesAvailableCache !== null) return _preferencesAvailableCache;
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.get({ key: probeKey });
    _preferencesAvailableCache = true;
  } catch {
    _preferencesAvailableCache = false;
  }
  return _preferencesAvailableCache;
}

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(metadata)) {
    const t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

async function loadEvents() {
  try {
    const usePrefs = await isPreferencesAvailable(STORAGE_KEY);
    if (usePrefs) {
      const { Preferences } = await import('@capacitor/preferences');
      const { value } = await Preferences.get({ key: STORAGE_KEY });
      if (value == null || value === '') return [];
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    if (typeof localStorage !== 'undefined') {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s == null || s === '') return [];
      try {
        const parsed = JSON.parse(s);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
  } catch (e) {
    console.warn('[FunnelTelemetry] storage error:', e);
  }
  return [];
}

async function saveEvents(events) {
  const json = JSON.stringify(events);
  try {
    const usePrefs = await isPreferencesAvailable(STORAGE_KEY);
    if (usePrefs) {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.set({ key: STORAGE_KEY, value: json });
      return;
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, json);
    }
  } catch (e) {
    console.warn('[FunnelTelemetry] storage error:', e);
  }
}

/**
 * Record a funnel event. Idempotent: if this event has already been recorded
 * for this userId, the call is a silent no-op.
 * @param {FunnelEvent} event
 * @param {string} userId - Supabase user.id (required; opaque UUID only)
 * @param {object} [metadata] - optional primitive-value context
 * @param {{ now?: number }} [options] - override timestamp for tests
 * @returns {Promise<void>}
 */
export async function emit(event, userId, metadata = {}, options = {}) {
  try {
    if (!userId) return;

    const stored = await loadEvents();
    if (stored.some((entry) => entry.event === event && entry.userId === userId)) {
      return;
    }

    const entry = {
      event,
      userId,
      timestamp: options.now ?? Date.now(),
      sessionId,
      metadata: sanitizeMetadata(metadata),
    };

    stored.push(entry);
    while (stored.length > MAX_EVENTS) {
      stored.shift();
    }

    await saveEvents(stored);
  } catch (e) {
    console.warn('[FunnelTelemetry] storage error:', e);
  }
}

/**
 * Return all stored funnel events. Dev/QA use only.
 * @returns {Promise<Array>}
 */
export async function dump() {
  try {
    return await loadEvents();
  } catch (e) {
    console.warn('[FunnelTelemetry] storage error:', e);
    return [];
  }
}

/**
 * Wipe all stored funnel events. Test/QA use only.
 * @returns {Promise<void>}
 */
export async function reset() {
  try {
    const usePrefs = await isPreferencesAvailable(STORAGE_KEY);
    if (usePrefs) {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.remove({ key: STORAGE_KEY });
      return;
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch (e) {
    console.warn('[FunnelTelemetry] storage error:', e);
  }
}

/**
 * Returns the module-level session ID for the current app launch.
 * @returns {string}
 */
export function getSessionId() {
  return sessionId;
}

function isDevPanelEnabled() {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.localStorage?.getItem === 'function' &&
      window.localStorage.getItem('FUNNEL_TELEMETRY_DEV_PANEL') === '1'
    );
  } catch {
    return false;
  }
}

if (isDevPanelEnabled()) {
  window.__funnelTelemetry = { dump, reset, getSessionId };
}
