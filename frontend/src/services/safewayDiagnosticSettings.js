/**
 * Dev-only Safeway session diagnostic flags (bounded matrix smash).
 */

/** Meald WebView localStorage — arm S-reconnect smash on next silent sync. */
export const SAFEWAY_S_RECONNECT_SMASH_FLAG = 'SAFEWAY_S_RECONNECT_SMASH';

/** @returns {boolean} */
export function isSafewayDevDiagnosticsEnabled() {
  try {
    return (
      import.meta.env.DEV === true ||
      import.meta.env.VITE_ENABLE_DEV_SETTINGS === '1'
    );
  } catch {
    return false;
  }
}

/** @returns {boolean} Peek only — true when S-reconnect smash is armed for the next silent sync. */
export function isSafewaySReconnectSmashArmed() {
  if (!isSafewayDevDiagnosticsEnabled()) return false;
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.localStorage?.getItem === 'function' &&
      window.localStorage.getItem(SAFEWAY_S_RECONNECT_SMASH_FLAG) === '1'
    );
  } catch {
    return false;
  }
}

/** @returns {boolean} One-shot consume; returns true if the flag was armed. */
export function consumeSafewaySReconnectSmashFlag() {
  if (!isSafewaySReconnectSmashArmed()) return false;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(SAFEWAY_S_RECONNECT_SMASH_FLAG);
    }
  } catch {
    /* ignore */
  }
  return true;
}

/** Re-arm after a failed/inconclusive S-reconnect attempt. */
export function restoreSafewaySReconnectSmashFlag() {
  if (!isSafewayDevDiagnosticsEnabled()) return;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(SAFEWAY_S_RECONNECT_SMASH_FLAG, '1');
    }
  } catch {
    /* ignore */
  }
}

/** Clear on interactive login so recovery never inherits smash. */
export function clearSafewaySReconnectSmashFlag() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(SAFEWAY_S_RECONNECT_SMASH_FLAG);
    }
  } catch {
    /* ignore */
  }
}
