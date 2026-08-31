/**
 * Shared Capacitor app foreground state for silent sync deadline freeze and ingest gating.
 * One idempotent listener; login WebView does not subscribe.
 */

import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

let isActive = true;
let listenerRegistered = false;
/** @type {Set<() => void>} */
const backgroundListeners = new Set();
/** @type {Set<() => void>} */
const foregroundListeners = new Set();

function notifyBackground() {
  for (const fn of backgroundListeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

function notifyForeground() {
  for (const fn of foregroundListeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Register the single appStateChange listener (idempotent).
 */
export function ensureAppForegroundListener() {
  if (listenerRegistered || !Capacitor.isNativePlatform()) return;
  listenerRegistered = true;
  void App.addListener('appStateChange', ({ isActive: active }) => {
    const wasActive = isActive;
    isActive = active !== false;
    if (!isActive && wasActive) {
      notifyBackground();
    } else if (isActive && !wasActive) {
      notifyForeground();
    }
  });
}

/** @returns {boolean} */
export function isAppForeground() {
  ensureAppForegroundListener();
  if (!Capacitor.isNativePlatform()) return true;
  return isActive;
}

/**
 * @param {() => void} fn
 * @returns {() => void} unsubscribe
 */
export function onAppBackground(fn) {
  ensureAppForegroundListener();
  backgroundListeners.add(fn);
  return () => backgroundListeners.delete(fn);
}

/**
 * @param {() => void} fn
 * @returns {() => void} unsubscribe
 */
export function onAppForeground(fn) {
  ensureAppForegroundListener();
  foregroundListeners.add(fn);
  return () => foregroundListeners.delete(fn);
}

const FOREGROUND_WAIT_MS = 1000;

/**
 * Wait until the app is in the foreground, then allow the network stack to settle.
 * @param {object} [opts]
 * @param {string} [opts.expectedUserId] - abort wait if user logs out
 * @param {() => string|null|undefined} [opts.getCurrentUserId]
 * @returns {Promise<void>}
 */
export async function waitForAppForegroundThenSettle(opts = {}) {
  ensureAppForegroundListener();
  if (!Capacitor.isNativePlatform()) return;

  const { expectedUserId, getCurrentUserId } = opts;

  if (!isActive) {
    await new Promise((resolve, reject) => {
      const unsub = onAppForeground(() => {
        unsub();
        if (
          expectedUserId != null &&
          getCurrentUserId != null &&
          getCurrentUserId() !== expectedUserId
        ) {
          reject(new Error('user_changed'));
          return;
        }
        resolve();
      });
    });
  }

  if (
    expectedUserId != null &&
    getCurrentUserId != null &&
    getCurrentUserId() !== expectedUserId
  ) {
    throw new Error('user_changed');
  }

  await new Promise((r) => setTimeout(r, FOREGROUND_WAIT_MS));
}

/** @visibleForTesting */
export function _resetAppForegroundForTests() {
  isActive = true;
  listenerRegistered = false;
  backgroundListeners.clear();
  foregroundListeners.clear();
}
