/**
 * InAppBrowser instance-id registry (dump layer). Policy lives in webViewBridge.js.
 * Does not import webViewBridge.
 */

import { InAppBrowser } from '@capgo/inappbrowser';
import { logPhase, SyncPhase } from './syncEventLog';

/** @typedef {{ firstSeenAt: number, lastSeenAt: number, ownerSessionId: number | null }} LiveInstance */

/** @type {Map<string, LiveInstance>} */
const liveIds = new Map();

/** @type {Map<number, string>} */
const sessionToInstance = new Map();

let believedOpen = false;
let closeEventListener = null;
let closeEventListenerPromise = null;

const REAP_WAIT_MS = 1000;
const CLOSE_RETRY_MS = 300;
const CLOSE_ATTEMPTS = 3;

/**
 * @param {unknown} event
 * @returns {string | null}
 */
export function getEventInstanceId(event) {
  if (!event || typeof event !== 'object') return null;
  const raw = /** @type {{ id?: unknown }} */ (event).id;
  if (raw == null || raw === '') return null;
  return String(raw);
}

export function isWebViewInstrumentationEnabled() {
  try {
    return (
      import.meta.env.DEV === true ||
      import.meta.env.VITE_ENABLE_DEV_SETTINGS === '1'
    );
  } catch {
    return false;
  }
}

export function getBelievedOpen() {
  return believedOpen;
}

export function markWebViewOpening() {
  believedOpen = true;
}

export function snapshotIds() {
  return new Set(liveIds.keys());
}

/**
 * @param {string} id
 */
export function noteId(id) {
  if (!id) return;
  const now = Date.now();
  const existing = liveIds.get(id);
  if (existing) {
    existing.lastSeenAt = now;
  } else {
    liveIds.set(id, { firstSeenAt: now, lastSeenAt: now, ownerSessionId: null });
  }
}

/**
 * @param {number} sessionId
 * @param {string} instanceId
 */
export function claimInstance(sessionId, instanceId) {
  if (!instanceId) return;
  noteId(instanceId);
  const row = liveIds.get(instanceId);
  if (row) row.ownerSessionId = sessionId;
  sessionToInstance.set(sessionId, instanceId);
}

/**
 * @param {number} sessionId
 * @returns {string | null}
 */
export function getSessionInstanceId(sessionId) {
  return sessionToInstance.get(sessionId) ?? null;
}

/**
 * @param {number} sessionId
 * @param {string} instanceId
 * @param {Set<string>} snapshot
 * @returns {boolean}
 */
export function claimIfNew(sessionId, instanceId, snapshot) {
  if (!instanceId) return false;
  if (sessionToInstance.has(sessionId)) {
    return sessionToInstance.get(sessionId) === instanceId;
  }
  if (snapshot.has(instanceId)) return false;
  claimInstance(sessionId, instanceId);
  return true;
}

/**
 * @param {number} sessionId
 */
export function releaseInstanceSession(sessionId) {
  const instanceId = sessionToInstance.get(sessionId);
  if (instanceId) {
    const row = liveIds.get(instanceId);
    if (row && row.ownerSessionId === sessionId) {
      row.ownerSessionId = null;
    }
  }
  sessionToInstance.delete(sessionId);
}

function ensureCloseEventListener() {
  if (closeEventListenerPromise) return closeEventListenerPromise;
  closeEventListenerPromise = InAppBrowser.addListener('closeEvent', (event) => {
    const id = getEventInstanceId(event);
    if (id) {
      liveIds.delete(id);
      for (const [sid, iid] of sessionToInstance.entries()) {
        if (iid === id) sessionToInstance.delete(sid);
      }
    }
    const anyOwned = [...liveIds.values()].some((r) => r.ownerSessionId != null);
    if (!anyOwned) {
      believedOpen = false;
    }
  })
    .then((handle) => {
      closeEventListener = handle;
    })
    .catch(() => {});
  return closeEventListenerPromise;
}

/**
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function closeInstanceById(id) {
  if (!id) return false;
  await ensureCloseEventListener();
  for (let attempt = 1; attempt <= CLOSE_ATTEMPTS; attempt++) {
    try {
      await InAppBrowser.close({ id });
      return true;
    } catch {
      if (attempt < CLOSE_ATTEMPTS) await new Promise((r) => setTimeout(r, CLOSE_RETRY_MS));
    }
  }
  return false;
}

/**
 * @param {string} reason
 * @param {string} provider
 * @param {'login' | 'silent'} mode
 * @returns {Promise<number>}
 */
export async function reapKnownUnowned(reason, provider, mode) {
  await ensureCloseEventListener();
  const toClose = [...liveIds.entries()]
    .filter(([, row]) => row.ownerSessionId == null)
    .map(([id]) => id);
  if (toClose.length === 0) return 0;

  const pending = new Set(toClose);
  let resolveWait;
  const waitPromise = new Promise((resolve) => {
    resolveWait = resolve;
  });
  const deadline = setTimeout(() => resolveWait?.(), REAP_WAIT_MS);

  const onClose = async (event) => {
    const id = getEventInstanceId(event);
    if (!id || !pending.has(id)) return;
    pending.delete(id);
    const row = liveIds.get(id);
    const ageMs = row ? Date.now() - row.firstSeenAt : 0;
    void logPhase(provider, SyncPhase.WEBVIEW_ORPHAN_CLOSED, {
      mode,
      reason,
      metadata: { instanceAgeMs: ageMs },
    });
    if (pending.size === 0) {
      clearTimeout(deadline);
      resolveWait?.();
    }
  };

  let reapListener;
  try {
    reapListener = await InAppBrowser.addListener('closeEvent', onClose);
  } catch {
    /* ignore */
  }

  await Promise.all(
    toClose.map(async (id) => {
      const closed = await closeInstanceById(id);
      if (!closed && provider) {
        const row = liveIds.get(id);
        const ageMs = row ? Date.now() - row.firstSeenAt : 0;
        void logPhase(provider, SyncPhase.WEBVIEW_ORPHAN_CLOSED, {
          mode,
          reason: `${reason}_close_failed`,
          metadata: { instanceAgeMs: ageMs },
        });
      }
    })
  );

  await waitPromise;
  reapListener?.remove?.();

  for (const id of toClose) {
    if (liveIds.has(id) && liveIds.get(id)?.ownerSessionId == null) {
      liveIds.delete(id);
    }
  }

  return toClose.length;
}

/**
 * Close every known instance and reset registry (manual / emergency).
 * @returns {Promise<number>}
 */
export async function closeAllKnownInstances() {
  await ensureCloseEventListener();
  const ids = [...liveIds.keys()];
  for (const id of ids) {
    await closeInstanceById(id);
  }
  liveIds.clear();
  sessionToInstance.clear();
  believedOpen = false;
  return ids.length;
}

/**
 * @returns {Array<{ id: string, ageMs: number, owned: boolean }>}
 */
export function listKnownInstances() {
  const now = Date.now();
  return [...liveIds.entries()].map(([id, row]) => ({
    id,
    ageMs: now - row.firstSeenAt,
    owned: row.ownerSessionId != null,
  }));
}

/** @visibleForTesting */
export function _resetWebViewInstancesForTests() {
  liveIds.clear();
  sessionToInstance.clear();
  believedOpen = false;
  closeEventListener?.remove?.();
  closeEventListener = null;
  closeEventListenerPromise = null;
}
