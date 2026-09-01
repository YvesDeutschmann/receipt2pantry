/**
 * Dev-only Costco token diagnostic flags (Run A/B/C capture without Chrome DevTools).
 */

export const COSTCO_DIAG_PURGE_FLAG = 'COSTCO_DIAG_PURGE_EXPIRED';

/** Meald WebView localStorage — arm S3 (revoked page RT) on next silent sync. */
export const COSTCO_S3_SMASH_RT_FLAG = 'COSTCO_S3_SMASH_RT';

/** @returns {boolean} */
export function isCostcoDevDiagnosticsEnabled() {
  try {
    return (
      import.meta.env.DEV === true ||
      import.meta.env.VITE_ENABLE_DEV_SETTINGS === '1'
    );
  } catch {
    return false;
  }
}

/** @returns {boolean} */
export function isCostcoDiagnosticPurgeEnabled() {
  if (!isCostcoDevDiagnosticsEnabled()) return false;
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.localStorage?.getItem === 'function' &&
      window.localStorage.getItem(COSTCO_DIAG_PURGE_FLAG) === '1'
    );
  } catch {
    return false;
  }
}

/** @param {boolean} enabled */
export function setCostcoDiagnosticPurgeEnabled(enabled) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (enabled) {
        window.localStorage.setItem(COSTCO_DIAG_PURGE_FLAG, '1');
      } else {
        window.localStorage.removeItem(COSTCO_DIAG_PURGE_FLAG);
      }
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('costco-diagnostic-settings-changed'));
    }
  } catch {
    /* ignore */
  }
}

/** @returns {number} */
export function getCostcoLoginTimeoutMs() {
  return isCostcoDevDiagnosticsEnabled() ? 15 * 60 * 1000 : 5 * 60 * 1000;
}

/** @returns {boolean} Peek only — true when S3 smash is armed for the next silent sync. */
export function isCostcoS3SmashArmed() {
  if (!isCostcoDevDiagnosticsEnabled()) return false;
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.localStorage?.getItem === 'function' &&
      window.localStorage.getItem(COSTCO_S3_SMASH_RT_FLAG) === '1'
    );
  } catch {
    return false;
  }
}

/** @returns {boolean} One-shot consume; returns true if the flag was armed. */
export function consumeCostcoS3SmashFlag() {
  if (!isCostcoS3SmashArmed()) return false;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(COSTCO_S3_SMASH_RT_FLAG);
    }
  } catch {
    /* ignore */
  }
  return true;
}

/** Re-arm after a failed/inconclusive S3 attempt (e.g. smash inject missed, CORS). */
export function restoreCostcoS3SmashFlag() {
  if (!isCostcoDevDiagnosticsEnabled()) return;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(COSTCO_S3_SMASH_RT_FLAG, '1');
    }
  } catch {
    /* ignore */
  }
}

/** Clear on interactive login so recovery never inherits smash. */
export function clearCostcoS3SmashFlag() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(COSTCO_S3_SMASH_RT_FLAG);
    }
  } catch {
    /* ignore */
  }
}
