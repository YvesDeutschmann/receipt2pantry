import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SAFEWAY_S_RECONNECT_SMASH_FLAG,
  clearSafewaySReconnectSmashFlag,
  consumeSafewaySReconnectSmashFlag,
  isSafewaySReconnectSmashArmed,
  restoreSafewaySReconnectSmashFlag,
} from '../safewayDiagnosticSettings.js';

function makeLocalStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}

describe('safewayDiagnosticSettings S-reconnect smash flag', () => {
  const prevDev = import.meta.env.DEV;
  const prevDevSettings = import.meta.env.VITE_ENABLE_DEV_SETTINGS;
  let prevLs;

  beforeEach(() => {
    prevLs = window.localStorage;
    vi.stubGlobal('localStorage', makeLocalStorage());
    import.meta.env.DEV = true;
    import.meta.env.VITE_ENABLE_DEV_SETTINGS = undefined;
  });

  afterEach(() => {
    import.meta.env.DEV = prevDev;
    import.meta.env.VITE_ENABLE_DEV_SETTINGS = prevDevSettings;
    vi.stubGlobal('localStorage', prevLs);
  });

  it('isSafewaySReconnectSmashArmed is false when diagnostics disabled', () => {
    import.meta.env.DEV = false;
    import.meta.env.VITE_ENABLE_DEV_SETTINGS = undefined;
    localStorage.setItem(SAFEWAY_S_RECONNECT_SMASH_FLAG, '1');
    expect(isSafewaySReconnectSmashArmed()).toBe(false);
  });

  it('consumeSafewaySReconnectSmashFlag is one-shot', () => {
    localStorage.setItem(SAFEWAY_S_RECONNECT_SMASH_FLAG, '1');
    expect(consumeSafewaySReconnectSmashFlag()).toBe(true);
    expect(isSafewaySReconnectSmashArmed()).toBe(false);
    expect(consumeSafewaySReconnectSmashFlag()).toBe(false);
  });

  it('restoreSafewaySReconnectSmashFlag re-arms', () => {
    consumeSafewaySReconnectSmashFlag();
    restoreSafewaySReconnectSmashFlag();
    expect(isSafewaySReconnectSmashArmed()).toBe(true);
  });

  it('clearSafewaySReconnectSmashFlag removes the key', () => {
    localStorage.setItem(SAFEWAY_S_RECONNECT_SMASH_FLAG, '1');
    clearSafewaySReconnectSmashFlag();
    expect(isSafewaySReconnectSmashArmed()).toBe(false);
  });
});
