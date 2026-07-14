import { Preferences } from '@capacitor/preferences';

export const PREF_KEY = 'sync_attention';

export const PROVIDER_LABELS = {
  safeway: 'Safeway',
  costco: 'Costco',
};

/** @typedef {'safeway' | 'costco'} ProviderId */
/** @typedef {{ kind: 'needs_reconnect', updatedAt: number }} AttentionItem */

/** @type {Record<string, AttentionItem> | null} */
let cache = null;

/** @type {Set<(items: Record<string, AttentionItem>) => void>} */
const listeners = new Set();

/** @type {Promise<void>} */
let writeQueue = Promise.resolve();

/**
 * @param {() => Promise<void>} fn
 * @returns {Promise<void>}
 */
function enqueue(fn) {
  const run = () => fn();
  writeQueue = writeQueue.then(run, run);
  return writeQueue;
}

function notify() {
  const snapshot = { ...(cache ?? {}) };
  for (const listener of listeners) {
    listener(snapshot);
  }
}

/**
 * @param {string | null | undefined} raw
 * @returns {Record<string, AttentionItem>}
 */
function parseStored(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    /* ignore corrupt data */
  }
  return {};
}

async function persist(items) {
  cache = { ...items };
  await Preferences.set({ key: PREF_KEY, value: JSON.stringify(cache) });
  notify();
}

/**
 * @returns {Promise<Record<string, AttentionItem>>}
 */
export async function getAttention() {
  if (cache !== null) {
    return { ...cache };
  }
  const { value } = await Preferences.get({ key: PREF_KEY });
  cache = parseStored(value);
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
  listeners.clear();
  writeQueue = Promise.resolve();
}
