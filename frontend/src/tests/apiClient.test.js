import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const getSession = vi.fn()
const maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }))

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(() => Promise.resolve({ value: null })),
    set: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
  },
}))

vi.mock('../services/supabaseClient.js', () => ({
  supabase: {
    auth: {
      getSession: (...args) => getSession(...args),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle,
        })),
      })),
    })),
  },
}))

const axiosHoisted = vi.hoisted(() => {
  let lastInstance = null

  function makeInstance(config) {
    const inst = {
      __createConfig: config,
      get: vi.fn().mockResolvedValue({ data: {} }),
      post: vi.fn().mockResolvedValue({ data: {} }),
      put: vi.fn().mockResolvedValue({ data: {} }),
      patch: vi.fn().mockResolvedValue({ data: {} }),
      delete: vi.fn().mockResolvedValue({ data: {} }),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
    }
    lastInstance = inst
    return inst
  }

  const create = vi.fn((config) => makeInstance(config))

  return { create, getLastInstance: () => lastInstance, makeInstance }
})

vi.mock('axios', () => ({
  default: {
    create: axiosHoisted.create,
  },
}))

/** Load api module after env/window setup (for base URL cases). */
async function loadApiModule() {
  const mod = await import('../services/apiClient.js')
  return mod
}

function getRequestInterceptor() {
  const inst = axiosHoisted.getLastInstance()
  const call = inst.interceptors.request.use.mock.calls[0]
  return call[0]
}

function getResponseErrorInterceptor() {
  const inst = axiosHoisted.getLastInstance()
  const call = inst.interceptors.response.use.mock.calls[0]
  return call[1]
}

describe('normalizeApiBaseUrl', () => {
  it('adds http and rewrites Vite :5173 to Flask :5000/api', async () => {
    vi.resetModules()
    const { normalizeApiBaseUrl } = await loadApiModule()
    expect(normalizeApiBaseUrl('192.168.50.33:5173')).toBe(
      'http://192.168.50.33:5000/api'
    )
    expect(normalizeApiBaseUrl('http://192.168.50.33:5173')).toBe(
      'http://192.168.50.33:5000/api'
    )
    expect(normalizeApiBaseUrl('http://192.168.50.33:5000')).toBe(
      'http://192.168.50.33:5000/api'
    )
    expect(normalizeApiBaseUrl('https://abc.ngrok-free.app')).toBe(
      'https://abc.ngrok-free.app/api'
    )
  })
})

describe('apiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSession.mockResolvedValue({ data: { session: null } })
  })

  describe('Group A — base URL', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('test_uses_VITE_API_BASE_URL_when_set', async () => {
      vi.resetModules()
      vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test/v1/api')

      await loadApiModule()

      expect(axiosHoisted.create).toHaveBeenCalled()
      const cfg = axiosHoisted.getLastInstance().__createConfig
      expect(cfg.baseURL).toBe('https://api.example.test/v1/api')
      expect(cfg.headers['ngrok-skip-browser-warning']).toBe('true')
    })

    it('test_falls_back_to_hostname_port_5000_api_when_env_unset', async () => {
      vi.resetModules()
      vi.stubEnv('VITE_API_BASE_URL', '')
      const orig = window.location
      // eslint-disable-next-line no-global-assign
      window.location = new URL('http://192.168.0.42:5173/')

      await loadApiModule()

      expect(axiosHoisted.getLastInstance().__createConfig.baseURL).toBe(
        'http://192.168.0.42:5000/api'
      )

      window.location = orig
    })

    it('test_localhost_hostname_yields_http_localhost_5000_api', async () => {
      vi.resetModules()
      vi.stubEnv('VITE_API_BASE_URL', '')
      const orig = window.location
      // eslint-disable-next-line no-global-assign
      window.location = new URL('http://localhost:5173/')

      await loadApiModule()

      expect(axiosHoisted.getLastInstance().__createConfig.baseURL).toBe(
        'http://localhost:5000/api'
      )

      window.location = orig
    })
  })

  describe('Group B — request interceptor', () => {
    beforeEach(async () => {
      vi.resetModules()
      vi.stubEnv('VITE_API_BASE_URL', 'https://fixed.test/api')
      await loadApiModule()
    })

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('test_authorization_header_set_when_session_has_access_token', async () => {
      getSession.mockResolvedValue({
        data: {
          session: {
            access_token: 'jwt-token-123',
            user: { id: 'user-abc' },
          },
        },
      })

      const config = { headers: {} }
      await getRequestInterceptor()(config)

      expect(config.baseURL).toBe('https://fixed.test/api')
      expect(config.headers.Authorization).toBe('Bearer jwt-token-123')
    })

    it('test_authorization_header_absent_when_no_session', async () => {
      getSession.mockResolvedValue({ data: { session: null } })

      const config = { headers: {} }
      await getRequestInterceptor()(config)

      expect(config.headers.Authorization).toBeUndefined()
    })

    it('test_x_user_id_set_from_session_user_id', async () => {
      getSession.mockResolvedValue({
        data: {
          session: {
            access_token: 't',
            user: { id: '11111111-1111-1111-1111-111111111111' },
          },
        },
      })

      const config = { headers: {} }
      await getRequestInterceptor()(config)

      expect(config.headers['X-User-Id']).toBe('11111111-1111-1111-1111-111111111111')
    })

    it('test_interceptor_does_not_set_bearer_undefined_on_empty_session', async () => {
      getSession.mockResolvedValue({
        data: { session: { user: { id: 'only-user' } } },
      })

      const config = { headers: {} }
      await getRequestInterceptor()(config)

      expect(config.headers.Authorization).toBeUndefined()
      expect(config.headers.Authorization).not.toBe('Bearer undefined')
      expect(config.headers['X-User-Id']).toBe('only-user')
    })
  })

  describe('Group C — method contracts', () => {
    let api

    beforeEach(async () => {
      vi.resetModules()
      vi.stubEnv('VITE_API_BASE_URL', 'https://fixed.test/api')
      ;({ api } = await loadApiModule())
    })

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('test_getReceipts_sends_user_id_and_limit_as_params', async () => {
      const inst = axiosHoisted.getLastInstance()
      await api.getReceipts('user-1', 25)
      expect(inst.get).toHaveBeenCalledWith('/receipts', {
        params: { user_id: 'user-1', limit: 25 },
      })
    })

    it('test_ingestReceipts_posts_provider_and_receipts_body', async () => {
      const inst = axiosHoisted.getLastInstance()
      const receipts = [{ id: 'r1' }]
      await api.ingestReceipts('costco', receipts, 'uid-9')
      expect(inst.post).toHaveBeenCalledWith('/receipts/ingest', {
        provider: 'costco',
        receipts,
        user_id: 'uid-9',
      })
    })

    it('test_triggerGeneration_uses_600000ms_timeout_override', async () => {
      const inst = axiosHoisted.getLastInstance()
      await api.suggestions.triggerGeneration('u1', {
        triggerReason: 'manual',
        householdId: 'hh-1',
      })
      expect(inst.post).toHaveBeenCalledWith(
        '/suggestions/pool/generate',
        expect.objectContaining({
          trigger_reason: 'manual',
          household_id: 'hh-1',
        }),
        expect.objectContaining({
          timeout: 600000,
          headers: expect.objectContaining({ 'X-User-Id': 'u1' }),
        })
      )
      const opts = inst.post.mock.calls[inst.post.mock.calls.length - 1][2]
      expect(opts.timeout).toBe(600000)
      expect(opts.timeout).not.toBe(120000)
    })

    it('test_voiceTranscribe_deletes_content_type_for_FormData', async () => {
      const inst = axiosHoisted.getLastInstance()
      const blob = new Blob([], { type: 'audio/webm' })
      await api.voiceTranscribe(blob)

      const call = inst.post.mock.calls.find((c) => c[0] === '/pantry/voice-transcribe')
      expect(call).toBeDefined()
      const options = call[2]
      expect(options.transformRequest).toBeDefined()
      const formData = new FormData()
      const headers = { 'Content-Type': 'application/json' }
      options.transformRequest(formData, headers)
      expect(headers['Content-Type']).toBeUndefined()
    })

    it('test_markCooked_sends_expected_body_shape_recipe_id_servings_ingredients_household_id', async () => {
      const inst = axiosHoisted.getLastInstance()
      const ingredients = [{ id: 1, name: 'Salt' }]
      await api.markCooked('user-x', {
        recipeId: 42,
        recipeName: 'Soup',
        servings: 4,
        ingredients,
        householdId: 'hh-2',
      })
      expect(inst.post).toHaveBeenCalledWith(
        '/pantry/cook',
        {
          recipe_id: 42,
          recipe_name: 'Soup',
          servings: 4,
          ingredients,
          household_id: 'hh-2',
        },
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-User-Id': 'user-x' }),
        })
      )
    })
  })

  describe('Group D — error handling', () => {
    beforeEach(async () => {
      vi.resetModules()
      vi.stubEnv('VITE_API_BASE_URL', 'https://fixed.test/api')
      await loadApiModule()
    })

    afterEach(() => {
      vi.unstubAllEnvs()
      vi.restoreAllMocks()
    })

    it('test_server_error_response_is_logged_and_rethrown', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const err = {
        response: {
          data: { error: 'Bad Input' },
        },
      }
      await expect(getResponseErrorInterceptor()(err)).rejects.toBe(err)
      expect(spy).toHaveBeenCalledWith('API Error:', 'Bad Input')
    })

    it('test_network_error_no_response_is_logged_and_rethrown', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const err = {
        request: {},
        message: 'Network Failure',
      }
      await expect(getResponseErrorInterceptor()(err)).rejects.toBe(err)
      expect(spy).toHaveBeenCalledWith('Network Error:', 'Network Failure')
    })
  })

  describe('Group E — namespaces', () => {
    let api

    beforeEach(async () => {
      vi.resetModules()
      vi.stubEnv('VITE_API_BASE_URL', 'https://fixed.test/api')
      ;({ api } = await loadApiModule())
    })

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('test_suggestions_namespace_exposes_getPool_getDepth_swipe_triggerGeneration', () => {
      expect(typeof api.suggestions.getPool).toBe('function')
      expect(typeof api.suggestions.getDepth).toBe('function')
      expect(typeof api.suggestions.swipe).toBe('function')
      expect(typeof api.suggestions.triggerGeneration).toBe('function')
    })

    it('test_mealPlan_namespace_exposes_wizard_lifecycle_methods', () => {
      const m = api.mealPlan
      expect(typeof m.startWizard).toBe('function')
      expect(typeof m.getSuggestions).toBe('function')
      expect(typeof m.acceptRecipe).toBe('function')
      expect(typeof m.softRejectRecipe).toBe('function')
      expect(typeof m.banRecipe).toBe('function')
      expect(typeof m.unbanRecipe).toBe('function')
      expect(typeof m.markLeftover).toBe('function')
      expect(typeof m.completeWizard).toBe('function')
    })
  })

  describe('Definition of Done — category shape checks', () => {
    let api

    beforeEach(async () => {
      vi.resetModules()
      vi.stubEnv('VITE_API_BASE_URL', 'https://fixed.test/api')
      ;({ api } = await loadApiModule())
    })

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('test_providers_listProviders_uses_relative_GET', async () => {
      const inst = axiosHoisted.getLastInstance()
      await api.listProviders()
      expect(inst.get).toHaveBeenCalledWith('/providers')
    })

    it('test_shoppingList_get_sends_include_purchased_and_household_params', async () => {
      const inst = axiosHoisted.getLastInstance()
      await api.shoppingList.get('u-shop', true, 'hh-sl')
      expect(inst.get).toHaveBeenCalledWith('/shopping-list', {
        params: { include_purchased: true, household_id: 'hh-sl' },
        headers: { 'X-User-Id': 'u-shop' },
      })
    })

    it('test_mealPlan_startWizard_posts_relative_path_with_body', async () => {
      const inst = axiosHoisted.getLastInstance()
      const payload = { foo: 'bar' }
      await api.mealPlan.startWizard('u-wiz', payload)
      expect(inst.post).toHaveBeenCalledWith('/meal-plan/wizard/start', payload, {
        headers: { 'X-User-Id': 'u-wiz' },
      })
    })

    it('test_pantry_getPantry_relative_GET_and_headers', async () => {
      const inst = axiosHoisted.getLastInstance()
      await api.getPantry('u-p', 'hh-p')
      expect(inst.get).toHaveBeenCalledWith('/pantry', {
        params: { household_id: 'hh-p' },
        headers: { 'X-User-Id': 'u-p' },
      })
    })
  })
})
