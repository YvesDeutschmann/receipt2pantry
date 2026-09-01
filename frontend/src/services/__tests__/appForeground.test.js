import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ensureAppForegroundListener,
  isAppForeground,
  onAppBackground,
  onAppForeground,
  _resetAppForegroundForTests,
} from '../appForeground.js';

const addListenerMock = vi.fn();

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (...args) => addListenerMock(...args),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
  },
}));

describe('appForeground', () => {
  let stateHandler;

  beforeEach(() => {
    _resetAppForegroundForTests();
    addListenerMock.mockReset();
    addListenerMock.mockImplementation((_event, handler) => {
      stateHandler = handler;
      return Promise.resolve({ remove: vi.fn() });
    });
  });

  it('registers listener once', () => {
    ensureAppForegroundListener();
    ensureAppForegroundListener();
    expect(addListenerMock).toHaveBeenCalledTimes(1);
    expect(isAppForeground()).toBe(true);
  });

  it('notifies background and foreground subscribers', () => {
    ensureAppForegroundListener();
    const bg = vi.fn();
    const fg = vi.fn();
    onAppBackground(bg);
    onAppForeground(fg);

    stateHandler({ isActive: false });
    expect(bg).toHaveBeenCalledTimes(1);
    expect(isAppForeground()).toBe(false);

    stateHandler({ isActive: true });
    expect(fg).toHaveBeenCalledTimes(1);
    expect(isAppForeground()).toBe(true);
  });
});
