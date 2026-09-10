import { Preferences } from '@capacitor/preferences';
import { attentionKey, ensureLegacyKeysDeleted } from './syncPrefKeys';

/** @deprecated Use attentionKey() — kept for tests that import the symbol. */
export const PREF_KEY = 'sync_attention';

export const PROVIDER_LABELS = {
  safeway: 'Safeway',
  costco: 'Costco',
};

const VALID_PROVIDERS = new Set(['safeway', 'costco']);
const VALID_KINDS = new Set(['needs_reconnect', 'fetch_failed']);

/** @typedef {'safeway' | 'costco'} ProviderId */
/** @typedef {{ kind: 'needs_reconnect' | 'fetch_failed', updatedAt: number }} AttentionItem */

/** @type {Record<string, AttentionItem> | null} */
let cache = null;

/** @type {string | null} */
let cacheKey = null;

/** @type {Set<(items: Record<string, AttentionItem>) => void>} */
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
 * @param {unknown} item
 * @returns {AttentionItem | null}
 */
function sanitizeItem(item) {
  if (!item || typeof item !== 'object') return null;
  const kind = item.kind;
  if (!VALID_KINDS.has(kind)) return null;
  const updatedAt = Number(item.updatedAt);
  if (!Number.isFinite(updatedAt)) return null;
  return { kind, updatedAt };
}

/**
 * @param {string | null | undefined} raw
 * @returns {Record<string, AttentionItem>}
 */
function parseStored(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const items = {};
    for (const [provider, item] of Object.entries(parsed)) {
      if (!VALID_PROVIDERS.has(provider)) continue;
      const sanitized = sanitizeItem(item);
      if (sanitized) items[provider] = sanitized;
    }
    return items;
  } catch {
    return {};
  }
}

async function persist(items) {
  const key = attentionKey();
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
 * @returns {Promise<Record<string, AttentionItem>>}
 */
export async function getAttention() {
  const key = attentionKey();
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
 */
export async function setNeedsReconnect(provider) {
  return enqueue(async () => {
    const items = await getAttention();
    items[provider] = { kind: 'needs_reconnect', updatedAt: Date.now() };
    await persist(items);
  });
}

/**
 * @param {ProviderId} provider
 */
export async function setFetchFailed(provider) {
  return enqueue(async () => {
    const items = await getAttention();
    items[provider] = { kind: 'fetch_failed', updatedAt: Date.now() };
    await persist(items);
  });
}

/**
 * @param {ProviderId} provider
 */
export async function clearProvider(provider) {
  return enqueue(async () => {
    const items = await getAttention();
    if (!(provider in items)) return;
    delete items[provider];
    await persist(items);
  });
}

/**
 * @param {(items: Record<string, AttentionItem>) => void} listener
 * @returns {() => void}
 */
export function subscribe(listener) {
  listeners.add(listener);
  void getAttention().then((items) => listener(items));
  return () => listeners.delete(listener);
}

/** @internal Reset module state for tests. */
export function __resetAttentionStoreForTests() {
  cache = null;
  cacheKey = null;
  listeners.clear();
  writeQueue = Promise.resolve();
}
