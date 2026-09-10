import { Preferences } from '@capacitor/preferences';
import { healthKey, ensureLegacyKeysDeleted } from './syncPrefKeys';
import { SYNC_OUTCOMES } from './syncOutcomeMapper';

/** @typedef {'safeway' | 'costco'} ProviderId */
/** @typedef {{ lastAttemptAt: number, lastOutcome: string, lastCompletedAt: number | null, receiptsStored: number, lastToastedOutcome: string | null }} HealthRecord */

const VALID_PROVIDERS = new Set(['safeway', 'costco']);
const TERMINAL_OUTCOMES = new Set([
  SYNC_OUTCOMES.COMPLETED_EMPTY,
  SYNC_OUTCOMES.COMPLETED_ITEMS,
  SYNC_OUTCOMES.FAILED,
  SYNC_OUTCOMES.NEEDS_RECONNECT,
]);

/** @type {Record<string, HealthRecord> | null} */
let cache = null;

/** @type {string | null} */
let cacheKey = null;

/** @type {Set<(items: Record<string, HealthRecord>) => void>} */
const listeners = new Set();

/** @type {Promise<void>} */
let writeQueue = Promise.resolve();

/**
 * @param {() => Promise<void>} fn
 * @returns {Promise<void>}
 */
function enqueue(fn) {
  const result = writeQueue.then(fn);
  writeQueue = result.catch(() => {});
  return result;
}

function notify() {
  const snapshot = { ...(cache ?? {}) };
  for (const listener of listeners) {
    listener(snapshot);
  }
}

/**
 * @param {unknown} record
 * @returns {HealthRecord | null}
 */
function sanitizeRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const lastOutcome = record.lastOutcome;
  if (typeof lastOutcome !== 'string' || !TERMINAL_OUTCOMES.has(lastOutcome)) {
    return null;
  }
  const lastAttemptAt = Number(record.lastAttemptAt);
  if (!Number.isFinite(lastAttemptAt)) return null;

  const lastCompletedAt =
    record.lastCompletedAt == null ? null : Number(record.lastCompletedAt);
  if (lastCompletedAt != null && !Number.isFinite(lastCompletedAt)) return null;

  const receiptsStored = Number(record.receiptsStored ?? 0);
  const lastToastedOutcome =
    record.lastToastedOutcome == null || typeof record.lastToastedOutcome === 'string'
      ? record.lastToastedOutcome
      : null;

  return {
    lastAttemptAt,
    lastOutcome,
    lastCompletedAt: lastCompletedAt == null ? null : lastCompletedAt,
    receiptsStored: Number.isFinite(receiptsStored) ? receiptsStored : 0,
    lastToastedOutcome,
  };
}

/**
 * @param {string | null | undefined} raw
 * @returns {Record<string, HealthRecord>}
 */
function parseStored(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const items = {};
    for (const [provider, record] of Object.entries(parsed)) {
      if (!VALID_PROVIDERS.has(provider)) continue;
      const sanitized = sanitizeRecord(record);
      if (sanitized) items[provider] = sanitized;
    }
    return items;
  } catch {
    return {};
  }
}

async function persist(items) {
  const key = healthKey();
  if (!key) {
    cache = { ...items };
    cacheKey = null;
    notify();
    return;
  }

  await ensureLegacyKeysDeleted();
  await Preferences.set({ key, value: JSON.stringify(items) });
  cache = { ...items };
  cacheKey = key;
  notify();
}

/**
 * @returns {Promise<Record<string, HealthRecord>>}
 */
export async function getAllHealth() {
  const key = healthKey();
  if (cache !== null && cacheKey !== key) {
    cache = null;
  }

  if (cache !== null) {
    return { ...cache };
  }

  if (!key) {
    cache = {};
    cacheKey = null;
    return { ...cache };
  }

  await ensureLegacyKeysDeleted();
  const { value } = await Preferences.get({ key });
  cache = parseStored(value);
  cacheKey = key;
  return { ...cache };
}

/**
 * @param {ProviderId} provider
 * @returns {Promise<HealthRecord | null>}
 */
export async function getHealth(provider) {
  const all = await getAllHealth();
  return all[provider] ?? null;
}

/**
 * @param {ProviderId} provider
 * @param {{ outcome: string, receiptsStored?: number }} params
 */
export async function recordTerminalOutcome(provider, { outcome, receiptsStored = 0 }) {
  if (!TERMINAL_OUTCOMES.has(outcome)) return;

  return enqueue(async () => {
    const items = await getAllHealth();
    const now = Date.now();
    const prev = items[provider];
    const isCompleted =
      outcome === SYNC_OUTCOMES.COMPLETED_EMPTY || outcome === SYNC_OUTCOMES.COMPLETED_ITEMS;

    items[provider] = {
      lastAttemptAt: now,
      lastOutcome: outcome,
      lastCompletedAt: isCompleted ? now : (prev?.lastCompletedAt ?? null),
      receiptsStored: isCompleted ? receiptsStored : (prev?.receiptsStored ?? 0),
      lastToastedOutcome: prev?.lastToastedOutcome ?? null,
    };
    await persist(items);
  });
}

const TOAST_OUTCOME_MAP = {
  needs_reconnect: SYNC_OUTCOMES.NEEDS_RECONNECT,
  error: SYNC_OUTCOMES.FAILED,
  ok: SYNC_OUTCOMES.COMPLETED_ITEMS,
};

/**
 * @param {ProviderId} provider
 * @param {string | null} outcomeKey
 */
export async function setLastToastedOutcome(provider, outcomeKey) {
  return enqueue(async () => {
    const items = await getAllHealth();
    const prev = items[provider];
    const now = Date.now();
    const inferredOutcome =
      prev?.lastOutcome ?? TOAST_OUTCOME_MAP[outcomeKey] ?? SYNC_OUTCOMES.FAILED;

    items[provider] = {
      lastAttemptAt: prev?.lastAttemptAt ?? now,
      lastOutcome: inferredOutcome,
      lastCompletedAt:
        prev?.lastCompletedAt ??
        (outcomeKey === 'ok' ? now : null),
      receiptsStored: prev?.receiptsStored ?? 0,
      lastToastedOutcome: outcomeKey,
    };
    await persist(items);
  });
}

/**
 * @param {(items: Record<string, HealthRecord>) => void} listener
 * @returns {() => void}
 */
export function subscribeHealth(listener) {
  listeners.add(listener);
  void getAllHealth().then((items) => listener(items));
  return () => listeners.delete(listener);
}

/** @internal Reset module state for tests. */
export function __resetHealthStoreForTests() {
  cache = null;
  cacheKey = null;
  listeners.clear();
  writeQueue = Promise.resolve();
}
