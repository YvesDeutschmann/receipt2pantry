import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('monitoring', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('INIT_NOOP_WITHOUT_DSN', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '')
    const initSpy = vi.fn()
    vi.doMock('@sentry/react', () => ({
      init: initSpy,
      setUser: vi.fn(),
      captureException: vi.fn(),
      captureMessage: vi.fn(),
      withScope: vi.fn((cb) => cb({ setContext: vi.fn(), setTag: vi.fn() })),
    }))

    const { initMonitoring } = await import('../monitoring.js')
    initMonitoring()
    expect(initSpy).not.toHaveBeenCalled()
  })

  it('BEFORE_SEND_SCRUBS_SENSITIVE_HEADERS', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://example.com/1')
    let capturedBeforeSend
    vi.doMock('@sentry/react', () => ({
      init: (opts) => {
        capturedBeforeSend = opts.beforeSend
      },
      setUser: vi.fn(),
      captureException: vi.fn(),
      captureMessage: vi.fn(),
      withScope: vi.fn((cb) => cb({ setContext: vi.fn(), setTag: vi.fn() })),
    }))

    const { initMonitoring } = await import('../monitoring.js')
    initMonitoring()

    const cleaned = capturedBeforeSend({
      request: {
        headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
        cookies: { sid: 'abc' },
        data: 'secret-body',
      },
      user: { id: 'uuid', email: 'a@b.com' },
    })

    expect(cleaned.request.data).toBeUndefined()
    expect(cleaned.request.cookies).toBeUndefined()
    expect(cleaned.request.headers.Authorization).toBe('[Filtered]')
    expect(cleaned.user).toEqual({ id: 'uuid' })
  })
})
