import { describe, it, expect, vi, afterEach } from 'vitest'
import { decodeJwtPayload, isTokenExpired } from '../jwtUtils.js'

function base64UrlEncodeJson(obj) {
  const s = btoa(JSON.stringify(obj))
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function makeJwt(payload) {
  const header = base64UrlEncodeJson({ alg: 'none', typ: 'JWT' })
  const body = base64UrlEncodeJson(payload)
  return `${header}.${body}.signature`
}

describe('jwtUtils', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('JWT_DECODE_VALID_PAYLOAD', () => {
    const payload = { sub: 'user-42', exp: 1893456000 }
    const token = makeJwt(payload)
    expect(decodeJwtPayload(token)).toEqual(payload)
  })

  it('JWT_DECODE_MALFORMED_TOKEN_RETURNS_EMPTY_OBJECT', () => {
    expect(decodeJwtPayload('only.two')).toEqual({})
    expect(decodeJwtPayload('a.b.c')).toEqual({})
    expect(decodeJwtPayload(`${base64UrlEncodeJson({})}.!!!.x`)).toEqual({})
  })

  it('JWT_DECODE_NULL_OR_EMPTY_RETURNS_EMPTY_OBJECT', () => {
    expect(decodeJwtPayload(null)).toEqual({})
    expect(decodeJwtPayload(undefined)).toEqual({})
    expect(decodeJwtPayload('')).toEqual({})
  })

  it('IS_EXPIRED_RETURNS_TRUE_WHEN_EXP_PAST', () => {
    const past = Math.floor(Date.now() / 1000) - 120
    expect(isTokenExpired(makeJwt({ exp: past }), 60)).toBe(true)
  })

  it('IS_EXPIRED_RETURNS_FALSE_WHEN_EXP_FUTURE', () => {
    const future = Math.floor(Date.now() / 1000) + 3600
    expect(isTokenExpired(makeJwt({ exp: future }), 60)).toBe(false)
  })

  it('IS_EXPIRED_RETURNS_TRUE_WITHIN_BUFFER', () => {
    const expSec = Math.floor(Date.now() / 1000) + 30
    expect(isTokenExpired(makeJwt({ exp: expSec }), 60)).toBe(true)
  })

  it('IS_EXPIRED_RETURNS_TRUE_WHEN_EXP_MISSING', () => {
    expect(isTokenExpired(makeJwt({ sub: 'x' }), 60)).toBe(true)
  })

  it('IS_EXPIRED_RETURNS_TRUE_WHEN_TOKEN_NULL', () => {
    expect(isTokenExpired(null)).toBe(true)
  })
})
