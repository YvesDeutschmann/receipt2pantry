import { describe, it, expect, vi, beforeEach } from 'vitest'

function wipeLocalStorage() {
  if (typeof localStorage.clear === 'function') {
    localStorage.clear()
    return
  }
  const keys = []
  for (let i = 0; i < localStorage.length; i++) {
    keys.push(localStorage.key(i))
  }
  for (const k of keys) {
    if (k) localStorage.removeItem(k)
  }
}

const { prefStore } = vi.hoisted(() => ({ prefStore: new Map() }))

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(({ key }) => Promise.resolve({ value: prefStore.has(key) ? prefStore.get(key) : null })),
    set: vi.fn(({ key, value }) => {
      prefStore.set(key, value)
      return Promise.resolve()
    }),
    remove: vi.fn(({ key }) => {
      prefStore.delete(key)
      return Promise.resolve()
    }),
  },
}))

vi.mock('capacitor-secure-storage-plugin', () => ({
  SecureStoragePlugin: {
    set: vi.fn(() => Promise.resolve()),
    get: vi.fn(() => Promise.resolve({ value: null })),
    remove: vi.fn(() => Promise.resolve()),
  },
}))

describe('createTokenStorage', () => {
  beforeEach(async () => {
    vi.resetModules()
    prefStore.clear()
    wipeLocalStorage()
  })

  async function loadTokenStorage() {
    const { createTokenStorage } = await import('../tokenStorage.js')
    return createTokenStorage
  }

  it('STORE_META_AND_GET_META_ROUNDTRIP', async () => {
    const createTokenStorage = await loadTokenStorage()
    const storage = createTokenStorage({
      prefKeys: { idToken: 'test_id', accessToken: 'test_access' },
      localStoragePrefix: 'testprovider_',
      metaKeys: ['tokenExp', 'lastSyncAt'],
    })
    await storage.storeMeta({ tokenExp: '111', lastSyncAt: '222' })
    expect(await storage.getMeta()).toEqual({ tokenExp: '111', lastSyncAt: '222' })
  })

  it('GET_META_RETURNS_NULL_FOR_UNSET_KEYS', async () => {
    const createTokenStorage = await loadTokenStorage()
    const storage = createTokenStorage({
      prefKeys: { idToken: 'p_meta_unset' },
      localStoragePrefix: 'mu_',
      metaKeys: ['tokenExp', 'lastSyncAt'],
    })
    expect(await storage.getMeta()).toEqual({ tokenExp: null, lastSyncAt: null })
  })

  it('META_KEYS_OMITTED_WHEN_CONFIG_MISSING_THEM', async () => {
    const createTokenStorage = await loadTokenStorage()
    const storage = createTokenStorage({
      prefKeys: { idToken: 'p_no_meta' },
      localStoragePrefix: 'nm_',
    })
    await storage.storeMeta({ tokenExp: 'x' })
    expect(await storage.getMeta()).toEqual({})
  })

  it('EXISTING_STORE_BEHAVIOR_UNCHANGED', async () => {
    const createTokenStorage = await loadTokenStorage()
    const storage = createTokenStorage({
      prefKeys: { idToken: 'legacy_id', accessToken: 'legacy_access' },
      localStoragePrefix: 'leg_',
    })
    await storage.store({ idToken: 'a', accessToken: 'b' })
    expect(await storage.get()).toEqual({ idToken: 'a', accessToken: 'b' })
    expect(await storage.has()).toBe(true)
    await storage.clear()
    expect(await storage.get()).toEqual({ idToken: null, accessToken: null })
    expect(await storage.has()).toBe(false)
  })
})
