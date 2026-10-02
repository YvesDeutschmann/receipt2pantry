import { describe, it, expect } from 'vitest'
import { getStoreConnectionDisplay } from '../storeConnectionDisplay'

describe('getStoreConnectionDisplay', () => {
  it('not_connected without tokens', () => {
    const d = getStoreConnectionDisplay('safeway', false, undefined)
    expect(d.kind).toBe('not_connected')
    expect(d.badge).toBe('Not connected')
  })

  it('connected with tokens', () => {
    const d = getStoreConnectionDisplay('costco', true, undefined)
    expect(d.kind).toBe('connected')
    expect(d.badge).toBe('Connected')
  })

  it('needs_reconnect overrides connected tokens', () => {
    const d = getStoreConnectionDisplay('costco', true, 'needs_reconnect')
    expect(d.kind).toBe('needs_reconnect')
    expect(d.badge).toBe('Needs reconnect')
  })
})
