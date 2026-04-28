/**
 * Persisted sync attempt telemetry per provider (Preferences + localStorage fallback).
 */

const STORAGE_KEY_PREFIX = 'sync_telemetry_';

const FAILURE_REASON_KEYS = new Set([
  'cookie_missing',
  'parse_error',
  'token_expired',
  'clubcard_missing',
  'auth_401',
  'auth_403',
  'network',
  'webview_timeout',
  'webview_closed_early',
  'unknown',
]);

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

function storageKey(provider) {
  return `${STORAGE_KEY_PREFIX}${provider}`;
}

function defaultTelemetryBlob() {
  return {
    tierAttempts: { t1: 0, t2: 0, t3: 0, t4: 0 },
    tierSuccesses: { t1: 0, t2: 0, t3: 0 },
    tierDurationsMs: { t2: [], t3: [] },
    lastTierUsed: null,
    lastSyncAt: null,
    failureReasons: {
      cookie_missing: 0,
      parse_error: 0,
      token_expired: 0,
      clubcard_missing: 0,
      auth_401: 0,
      auth_403: 0,
      network: 0,
      webview_timeout: 0,
      webview_closed_early: 0,
      unknown: 0,
    },
    cookieStorePersistent: null,
    getCookiesWithoutWebViewWorks: null,
  };
}

function normalizeBlob(raw) {
  const base = defaultTelemetryBlob();
  if (!raw || typeof raw !== 'object') return base;

  const out = {
    ...base,
    ...raw,
    tierAttempts: { ...base.tierAttempts, ...(raw.tierAttempts && typeof raw.tierAttempts === 'object' ? raw.tierAttempts : {}) },
    tierSuccesses: { ...base.tierSuccesses, ...(raw.tierSuccesses && typeof raw.tierSuccesses === 'object' ? raw.tierSuccesses : {}) },
    tierDurationsMs: {
      t2: Array.isArray(raw.tierDurationsMs?.t2) ? [...raw.tierDurationsMs.t2] : [...base.tierDurationsMs.t2],
      t3: Array.isArray(raw.tierDurationsMs?.t3) ? [...raw.tierDurationsMs.t3] : [...base.tierDurationsMs.t3],
    },
    failureReasons: { ...base.failureReasons, ...(raw.failureReasons && typeof raw.failureReasons === 'object' ? raw.failureReasons : {}) },
  };

  for (const k of Object.keys(base.failureReasons)) {
    const v = out.failureReasons[k];
    out.failureReasons[k] = typeof v === 'number' && !Number.isNaN(v) ? v : base.failureReasons[k];
  }

  for (const k of Object.keys(base.tierAttempts)) {
    const v = out.tierAttempts[k];
    out.tierAttempts[k] = typeof v === 'number' && !Number.isNaN(v) ? v : base.tierAttempts[k];
  }

  for (const k of Object.keys(base.tierSuccesses)) {
    const v = out.tierSuccesses[k];
    out.tierSuccesses[k] = typeof v === 'number' && !Number.isNaN(v) ? v : base.tierSuccesses[k];
  }

  out.lastTierUsed =
    raw.lastTierUsed === 't1' || raw.lastTierUsed === 't2' || raw.lastTierUsed === 't3' || raw.lastTierUsed === 't4'
      ? raw.lastTierUsed
      : null;

  out.lastSyncAt = typeof raw.lastSyncAt === 'number' && !Number.isNaN(raw.lastSyncAt) ? raw.lastSyncAt : null;
  out.cookieStorePersistent =
    raw.cookieStorePersistent === true || raw.cookieStorePersistent === false ? raw.cookieStorePersistent : null;
  out.getCookiesWithoutWebViewWorks =
    raw.getCookiesWithoutWebViewWorks === true || raw.getCookiesWithoutWebViewWorks === false
      ? raw.getCookiesWithoutWebViewWorks
      : null;

  return out;
}

async function loadBlob(provider) {
  const key = storageKey(provider);
  try {
    const usePrefs = await isPreferencesAvailable(key);
    if (usePrefs) {
      const { Preferences } = await import('@capacitor/preferences');
      const { value } = await Preferences.get({ key });
      if (value == null || value === '') return defaultTelemetryBlob();
      try {
        return normalizeBlob(JSON.parse(value));
      } catch {
        return defaultTelemetryBlob();
      }
    }
    if (typeof localStorage !== 'undefined') {
      const s = localStorage.getItem(key);
      if (s == null || s === '') return defaultTelemetryBlob();
      try {
        return normalizeBlob(JSON.parse(s));
      } catch {
        return defaultTelemetryBlob();
      }
    }
  } catch {
    return defaultTelemetryBlob();
  }
  return defaultTelemetryBlob();
}

async function saveBlob(provider, blob) {
  const key = storageKey(provider);
  const json = JSON.stringify(blob);
  try {
    const usePrefs = await isPreferencesAvailable(key);
    if (usePrefs) {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.set({ key, value: json });
      return;
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, json);
    }
  } catch {
    /* never throw */
  }
}

function appendDuration(blob, tier, durationMs) {
  if (tier !== 't2' && tier !== 't3') return;
  if (typeof durationMs !== 'number' || Number.isNaN(durationMs)) return;
  const arr = blob.tierDurationsMs[tier];
  arr.push(durationMs);
  while (arr.length > 20) arr.shift();
}

function mapFailureReason(reason) {
  if (reason == null || typeof reason !== 'string') return 'unknown';
  return FAILURE_REASON_KEYS.has(reason) ? reason : 'unknown';
}

/**
 * @param {object} entry
 * @param {'t1'|'t2'|'t3'|'t4'} entry.tier
 * @param {'attempt'|'success'|'fail'} entry.outcome
 * @param {string} [entry.reason]
 * @param {number} [entry.durationMs]
 * @param {string} entry.provider
 */
export async function record(entry) {
  try {
    const { tier, outcome, provider } = entry;
    if (!provider || typeof provider !== 'string') return;
    if (!['t1', 't2', 't3', 't4'].includes(tier)) return;
    if (!['attempt', 'success', 'fail'].includes(outcome)) return;

    const blob = await loadBlob(provider);

    if (outcome === 'attempt') {
      blob.tierAttempts[tier] = (blob.tierAttempts[tier] ?? 0) + 1;
    } else if (outcome === 'success') {
      if (blob.tierSuccesses[tier] !== undefined) {
        blob.tierSuccesses[tier] = (blob.tierSuccesses[tier] ?? 0) + 1;
      }
      blob.lastTierUsed = tier;
      blob.lastSyncAt = Date.now();
      appendDuration(blob, tier, entry.durationMs);
    } else if (outcome === 'fail') {
      const r = mapFailureReason(entry.reason);
      blob.failureReasons[r] = (blob.failureReasons[r] ?? 0) + 1;
    }

    await saveBlob(provider, blob);
  } catch {
    /* never throw */
  }
}

export async function markCookieStorePersistent(provider, ok) {
  try {
    if (!provider || typeof provider !== 'string') return;
    const blob = await loadBlob(provider);
    blob.cookieStorePersistent = Boolean(ok);
    await saveBlob(provider, blob);
  } catch {
    /* never throw */
  }
}

export async function markGetCookiesWithoutWebView(provider, ok) {
  try {
    if (!provider || typeof provider !== 'string') return;
    const blob = await loadBlob(provider);
    blob.getCookiesWithoutWebViewWorks = Boolean(ok);
    await saveBlob(provider, blob);
  } catch {
    /* never throw */
  }
}

export async function read(provider) {
  try {
    if (!provider || typeof provider !== 'string') return defaultTelemetryBlob();
    return await loadBlob(provider);
  } catch {
    return defaultTelemetryBlob();
  }
}

export async function reset(provider) {
  try {
    if (!provider || typeof provider !== 'string') return;
    await saveBlob(provider, defaultTelemetryBlob());
  } catch {
    /* never throw */
  }
}
