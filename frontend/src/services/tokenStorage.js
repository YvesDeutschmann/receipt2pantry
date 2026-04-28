/**
 * Generic token storage for WebView bridge providers.
 * Uses @capacitor/preferences for most tokens; SecureStorage for sensitive ones (e.g. refresh token).
 * Falls back to localStorage when Preferences is unavailable.
 */

import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

let _preferencesAvailableCache = null;

/**
 * Check if @capacitor/preferences is available (some Android setups report "not implemented").
 * @param {string} testKey - A key to probe (e.g. any existing pref key)
 */
async function isPreferencesAvailable(testKey) {
  if (_preferencesAvailableCache !== null) return _preferencesAvailableCache;
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.get({ key: testKey });
    _preferencesAvailableCache = true;
  } catch {
    _preferencesAvailableCache = false;
  }
  return _preferencesAvailableCache;
}

/**
 * Create a token storage instance for a provider.
 *
 * @param {Object} config
 * @param {Record<string, string>} config.prefKeys - Maps value keys to Preferences keys, e.g. { idToken: 'costco_idToken', accessToken: 'costco_accessToken' }
 * @param {Record<string, string>} [config.secureKeys] - Maps value keys to SecureStorage keys (preferred over prefKeys for those). e.g. { refreshToken: 'costco_refreshToken_secure' }
 * @param {string} [config.localStoragePrefix] - Prefix for localStorage keys when Preferences unavailable, e.g. 'costco_'
 * @param {string} [config.hasCheckKeys] - Keys to check for has(). Defaults to ['idToken','accessToken'] - override for providers with different primary tokens
 * @param {string[]} [config.metaKeys] - Metadata keys stored under `${localStoragePrefix}meta_<key>` for storeMeta/getMeta
 */
export function createTokenStorage(config) {
  const {
    prefKeys,
    secureKeys = {},
    localStoragePrefix = '',
    hasCheckKeys = ['idToken', 'accessToken'],
    metaKeys,
  } = config;

  const allKeys = [...new Set([...Object.keys(prefKeys), ...Object.keys(secureKeys)])];
  const testKey = prefKeys[allKeys[0]] || Object.values(prefKeys)[0] || 'token_storage_test';

  function getLocalStorageKey(valueKey) {
    return `${localStoragePrefix}${valueKey}`;
  }

  return {
    async store(values) {
      const usePrefs = await isPreferencesAvailable(testKey);

      if (usePrefs) {
        const { Preferences } = await import('@capacitor/preferences');

        for (const key of allKeys) {
          const prefKey = prefKeys[key];
          const secureKey = secureKeys[key];
          const value = values[key];

          if (secureKey) {
            if (value) {
              try {
                await SecureStoragePlugin.set({ key: secureKey, value: String(value) });
              } catch {
                if (prefKey) await Preferences.set({ key: prefKey, value: value || '' });
              }
            } else {
              try {
                await SecureStoragePlugin.remove({ key: secureKey });
              } catch {}
              if (prefKey) await Preferences.remove({ key: prefKey });
            }
          } else if (prefKey) {
            await Preferences.set({ key: prefKey, value: value || '' });
          }
        }
      } else if (typeof localStorage !== 'undefined') {
        for (const key of allKeys) {
          const lsKey = getLocalStorageKey(key);
          const value = values[key];
          if (value != null && value !== '') {
            localStorage.setItem(lsKey, String(value));
          } else {
            localStorage.removeItem(lsKey);
          }
        }
      }
    },

    async get() {
      const usePrefs = await isPreferencesAvailable(testKey);
      const result = {};

      if (usePrefs) {
        const { Preferences } = await import('@capacitor/preferences');

        for (const key of allKeys) {
          const prefKey = prefKeys[key];
          const secureKey = secureKeys[key];

          if (secureKey) {
            try {
              const r = await SecureStoragePlugin.get({ key: secureKey });
              result[key] = r?.value ?? null;
            } catch {
              if (prefKey) {
                const { value } = await Preferences.get({ key: prefKey });
                result[key] = value ?? null;
              } else {
                result[key] = null;
              }
            }
          } else if (prefKey) {
            const { value } = await Preferences.get({ key: prefKey });
            result[key] = value ?? null;
          }
        }
      } else if (typeof localStorage !== 'undefined') {
        for (const key of allKeys) {
          result[key] = localStorage.getItem(getLocalStorageKey(key));
        }
      } else {
        for (const key of allKeys) {
          result[key] = null;
        }
      }

      return result;
    },

    async has() {
      const tokens = await this.get();
      return hasCheckKeys.some((k) => tokens[k]);
    },

    async clear() {
      const usePrefs = await isPreferencesAvailable(testKey);

      if (usePrefs) {
        const { Preferences } = await import('@capacitor/preferences');
        for (const key of allKeys) {
          const prefKey = prefKeys[key];
          const secureKey = secureKeys[key];
          if (prefKey) await Preferences.remove({ key: prefKey });
          if (secureKey) {
            try {
              await SecureStoragePlugin.remove({ key: secureKey });
            } catch {}
          }
        }
      } else if (typeof localStorage !== 'undefined') {
        for (const key of allKeys) {
          localStorage.removeItem(getLocalStorageKey(key));
        }
      }
    },

    /**
     * Store arbitrary metadata alongside tokens. Keys are stored under `${localStoragePrefix}meta_${key}` in Preferences or localStorage.
     * @param {Record<string, string | null | undefined>} values
     */
    async storeMeta(values) {
      const usePrefs = await isPreferencesAvailable(testKey);

      if (usePrefs) {
        const { Preferences } = await import('@capacitor/preferences');
        for (const key of Object.keys(values)) {
          const storageKey = `${localStoragePrefix}meta_${key}`;
          const value = values[key];
          if (value != null && value !== '') {
            await Preferences.set({ key: storageKey, value: String(value) });
          } else {
            await Preferences.remove({ key: storageKey });
          }
        }
      } else if (typeof localStorage !== 'undefined') {
        for (const key of Object.keys(values)) {
          const lsKey = `${localStoragePrefix}meta_${key}`;
          const value = values[key];
          if (value != null && value !== '') {
            localStorage.setItem(lsKey, String(value));
          } else {
            localStorage.removeItem(lsKey);
          }
        }
      }
    },

    /**
     * Retrieve metadata for configured metaKeys. Returns `{ [k]: string | null }`.
     * @returns {Promise<Record<string, string | null>>}
     */
    async getMeta() {
      if (!metaKeys || metaKeys.length === 0) return {};

      const usePrefs = await isPreferencesAvailable(testKey);
      const result = {};

      if (usePrefs) {
        const { Preferences } = await import('@capacitor/preferences');
        for (const key of metaKeys) {
          const storageKey = `${localStoragePrefix}meta_${key}`;
          const { value } = await Preferences.get({ key: storageKey });
          result[key] = value ?? null;
        }
      } else if (typeof localStorage !== 'undefined') {
        for (const key of metaKeys) {
          const lsKey = `${localStoragePrefix}meta_${key}`;
          result[key] = localStorage.getItem(lsKey);
        }
      } else {
        for (const key of metaKeys) {
          result[key] = null;
        }
      }

      return result;
    },
  };
}
