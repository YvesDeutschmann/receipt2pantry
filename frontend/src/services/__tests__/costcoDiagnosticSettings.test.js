import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  COSTCO_S3_SMASH_RT_FLAG,
  clearCostcoS3SmashFlag,
  consumeCostcoS3SmashFlag,
  isCostcoS3SmashArmed,
  restoreCostcoS3SmashFlag,
} from '../costcoDiagnosticSettings.js';

function makeLocalStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}

describe('costcoDiagnosticSettings S3 smash flag', () => {
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

  it('isCostcoS3SmashArmed is false when diagnostics disabled', () => {
    import.meta.env.DEV = false;
    import.meta.env.VITE_ENABLE_DEV_SETTINGS = undefined;
    localStorage.setItem(COSTCO_S3_SMASH_RT_FLAG, '1');
    expect(isCostcoS3SmashArmed()).toBe(false);
  });

  it('isCostcoS3SmashArmed peeks without consuming', () => {
    localStorage.setItem(COSTCO_S3_SMASH_RT_FLAG, '1');
    expect(isCostcoS3SmashArmed()).toBe(true);
    expect(localStorage.getItem(COSTCO_S3_SMASH_RT_FLAG)).toBe('1');
  });

  it('consumeCostcoS3SmashFlag is one-shot', () => {
    localStorage.setItem(COSTCO_S3_SMASH_RT_FLAG, '1');
    expect(consumeCostcoS3SmashFlag()).toBe(true);
    expect(isCostcoS3SmashArmed()).toBe(false);
    expect(consumeCostcoS3SmashFlag()).toBe(false);
  });

  it('restoreCostcoS3SmashFlag re-arms', () => {
    consumeCostcoS3SmashFlag();
    restoreCostcoS3SmashFlag();
    expect(isCostcoS3SmashArmed()).toBe(true);
  });

  it('clearCostcoS3SmashFlag removes the key', () => {
    localStorage.setItem(COSTCO_S3_SMASH_RT_FLAG, '1');
    clearCostcoS3SmashFlag();
    expect(isCostcoS3SmashArmed()).toBe(false);
  });
});
