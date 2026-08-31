import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  getCheckpointEmitScript,
  getPurgeExpiredScript,
  getTokenVerdictScript,
  getTokenWrapInstallScript,
} from '../costcoDiagnosticProbe.js'
import { makeTestJwt } from '../costcoMsalTokenHelpers.js'

function makeBrowserStorage() {
  const map = new Map()
  return {
    get length() {
      return map.size
    },
    key(i) {
      return [...map.keys()][i] ?? null
    },
    getItem(k) {
      return map.has(k) ? map.get(k) : null
    },
    setItem(k, v) {
      map.set(k, String(v))
    },
    removeItem(k) {
      map.delete(k)
    },
    clear() {
      map.clear()
    },
  }
}

function runScript(code) {
  // eslint-disable-next-line no-new-func
  new Function(code)()
}

describe('costcoDiagnosticProbe', () => {
  let posts

  beforeEach(() => {
    posts = []
    window.mobileApp = { postMessage: (m) => posts.push(m) }
    vi.stubGlobal('localStorage', makeBrowserStorage())
    vi.stubGlobal('sessionStorage', makeBrowserStorage())
    vi.stubGlobal('location', {
      hostname: 'www.costco.com',
      href: 'https://www.costco.com/myaccount',
      hash: '',
    })
    window.__costcoDiagProbePageKey = undefined
    window.__costcoFetchWrapped = undefined
    window.__costcoXhrWrapped = undefined
    window.__costcoTokenExchangePosted = 0
    window.__costcoTokenSweepRuns = 0
    window.__costcoTokenSeen = false
    window.__costcoTokenSeenKeys = {}
    window.__costcoTokenVerdictPosted = undefined
  })

  afterEach(() => {
    delete window.mobileApp
    vi.unstubAllGlobals()
  })

  it('emits diag-checkpoint with census on success path', () => {
    localStorage.setItem(
      'msal.id',
      JSON.stringify({
        credentialType: 'IdToken',
        environment: 'signin.costco.com',
        secret: makeTestJwt(3600),
      })
    )
    sessionStorage.setItem('getTokenFailureCount', '0')
    runScript(getCheckpointEmitScript('a0'))
    const msg = posts.find((p) => p?.detail?.message === 'diag-checkpoint')
    expect(msg).toBeDefined()
    expect(msg.detail.data.checkpoint).toBe('a0')
    expect(msg.detail.data.ls.idTokens).toBe(1)
    expect(msg.detail.data.tokenFailureCount).toBe('0')
  })

  it('does not read 2xx /token response body', async () => {
    const bodySpy = vi.fn().mockResolvedValue({ id_token: 'secret' })
    const resp = {
      status: 200,
      clone: () => ({ json: bodySpy }),
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp))
    runScript(getTokenWrapInstallScript())
    await window.fetch('https://signin.costco.com/oauth2/v2.0/token?p=b2c_1a_test')
    expect(bodySpy).not.toHaveBeenCalled()
    const msg = posts.find((p) => p?.detail?.message === 'token-exchange')
    expect(msg?.detail?.data?.status).toBe(200)
    expect(msg?.detail?.data?.policy).toContain('b2c')
  })

  it('captures error_description on non-2xx /token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 400,
        clone: () => ({
          json: () =>
            Promise.resolve({
              error: 'invalid_grant',
              error_description: 'policy mismatch',
            }),
        }),
      })
    )
    runScript(getTokenWrapInstallScript())
    await window.fetch('https://signin.costco.com/oauth2/v2.0/token')
    const msg = posts.find((p) => p?.detail?.message === 'token-exchange')
    expect(msg?.detail?.data?.error).toBe('invalid_grant')
    expect(msg?.detail?.data?.errorDescription).toBe('policy mismatch')
  })

  it('purge removes only expired IdToken/AccessToken not RefreshToken', () => {
    localStorage.setItem(
      'msal.id',
      JSON.stringify({
        credentialType: 'IdToken',
        environment: 'signin.costco.com',
        secret: makeTestJwt(-3600),
      })
    )
    localStorage.setItem(
      'msal.rt',
      JSON.stringify({
        credentialType: 'RefreshToken',
        environment: 'signin.costco.com',
        secret: 'x'.repeat(80),
      })
    )
    localStorage.setItem(
      'msal.acc',
      JSON.stringify({
        credentialType: 'AccessToken',
        environment: 'signin.costco.com',
        secret: makeTestJwt(3600),
      })
    )
    runScript(getPurgeExpiredScript())
    expect(localStorage.getItem('msal.id')).toBeNull()
    expect(localStorage.getItem('msal.rt')).toBeTruthy()
    expect(localStorage.getItem('msal.acc')).toBeTruthy()
    const msg = posts.find((p) => p?.detail?.data?.checkpoint === 'purge-expired')
    expect(msg?.detail?.data?.removedCount).toBe(1)
  })

  it('resource timing sweep records /token without fetch wrap hit', () => {
    runScript(getTokenWrapInstallScript())
    vi.stubGlobal('performance', {
      getEntriesByType: () => [
        {
          name: 'https://signin.costco.com/oauth2/v2.0/token?p=b2c_1a_sso_wcs_signup_signin_209',
          responseStatus: 200,
          startTime: 42,
        },
      ],
    })
    window.__costcoSweepResourceTiming()
    const msg = posts.find((p) => p?.detail?.message === 'token-exchange')
    expect(msg?.detail?.data?.source).toBe('resource-timing')
    expect(msg?.detail?.data?.status).toBe(200)
    expect(window.__costcoTokenSweepRuns).toBe(1)
  })

  it('dedupes identical resource timing entries', () => {
    runScript(getTokenWrapInstallScript())
    const entry = {
      name: 'https://signin.costco.com/oauth2/v2.0/token?p=b2c_test',
      responseStatus: 200,
      startTime: 99,
    }
    vi.stubGlobal('performance', {
      getEntriesByType: () => [entry],
    })
    window.__costcoSweepResourceTiming()
    window.__costcoSweepResourceTiming()
    const msgs = posts.filter((p) => p?.detail?.message === 'token-exchange')
    expect(msgs.length).toBe(1)
  })

  it('getTokenVerdictScript emits missed when no /token seen', () => {
    window.__costcoTokenSweepRuns = 12
    window.__costcoTokenSeen = false
    runScript(getTokenVerdictScript())
    const msg = posts.find((p) => p?.detail?.message === 'token-exchange')
    expect(msg?.detail?.data?.fired).toBe(false)
    expect(msg?.detail?.data?.source).toBe('missed')
    expect(msg?.detail?.data?.sweepRuns).toBe(12)
  })

  it('getTokenVerdictScript is silent when /token was already seen', () => {
    window.__costcoTokenSeen = true
    runScript(getTokenVerdictScript())
    const msg = posts.find((p) => p?.detail?.message === 'token-exchange')
    expect(msg).toBeUndefined()
  })
})
