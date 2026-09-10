import { Preferences } from '@capacitor/preferences';

/** @type {string | null} */
let currentUserId = null;

/** @type {boolean} */
let legacyKeysDeleted = false;

const LEGACY_KEYS = [
  'sync_lastRun_safeway',
  'sync_lastRun_costco',
  'sync_attention',
  'sync_telemetry_safeway',
  'sync_telemetry_costco',
];

const PROVIDERS = ['safeway', 'costco'];

/**
 * @param {string | null | undefined} userId
 */
export function setSyncUserId(userId) {
  currentUserId = userId ?? null;
}

/**
 * @returns {string | null}
 */
export function getSyncUserId() {
  return currentUserId;
}

/**
 * @param {'safeway' | 'costco'} provider
 * @returns {string | null}
 */
export function lastRunKey(provider) {
  if (!currentUserId) return null;
  return `sync_lastRun_${provider}_${currentUserId}`;
}

/**
 * @returns {string | null}
 */
export function attentionKey() {
  if (!currentUserId) return null;
  return `sync_attention_${currentUserId}`;
}

/**
 * @returns {string | null}
 */
export function healthKey() {
  if (!currentUserId) return null;
  return `sync_health_${currentUserId}`;
}

/**
 * @param {'safeway' | 'costco'} provider
 * @returns {string | null}
 */
export function telemetryKey(provider) {
  if (!currentUserId) return null;
  return `sync_telemetry_${provider}_${currentUserId}`;
}

async function removePreferenceKey(key) {
  try {
    await Preferences.remove({ key });
  } catch {
    /* ignore */
  }
  if (typeof localStorage !== 'undefined' && typeof localStorage.removeItem === 'function') {
    localStorage.removeItem(key);
  }
}

/**
 * Delete unscoped legacy keys. Does not copy values into namespaced keys.
 */
export async function deleteLegacySyncKeys() {
  for (const key of LEGACY_KEYS) {
    await removePreferenceKey(key);
  }
  legacyKeysDeleted = true;
}

/**
 * Call before first namespaced read/write.
 */
export async function ensureLegacyKeysDeleted() {
  if (legacyKeysDeleted) return;
  await deleteLegacySyncKeys();
}

/**
 * Write namespaced lastRun. No-op if getSyncUserId() is null.
 * @param {'safeway' | 'costco'} provider
 */
export async function writeLastRun(provider) {
  await ensureLegacyKeysDeleted();
  const key = lastRunKey(provider);
  if (!key) return;
  await Preferences.set({ key, value: String(Date.now()) });
}

/**
 * Delete namespaced keys for this user. Also delete unscoped legacy keys.
 * @param {string | null | undefined} userId
 */
export async function clearUserSyncState(userId) {
  if (userId) {
    for (const provider of PROVIDERS) {
      await removePreferenceKey(`sync_lastRun_${provider}_${userId}`);
      await removePreferenceKey(`sync_telemetry_${provider}_${userId}`);
    }
    await removePreferenceKey(`sync_attention_${userId}`);
    await removePreferenceKey(`sync_health_${userId}`);
  }
  await deleteLegacySyncKeys();
}

/** @internal Reset module state for tests. */
export function __resetSyncPrefKeysForTests() {
  currentUserId = null;
  legacyKeysDeleted = false;
}
