import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import StoreConnectorCard from '../StoreConnectorCard'

const { subscribeMock } = vi.hoisted(() => ({
  subscribeMock: vi.fn((listener) => {
    listener({})
    return () => {}
  }),
}))

vi.mock('../../services/providerAttentionStore', () => ({
  PROVIDER_LABELS: { safeway: 'Safeway', costco: 'Costco' },
  subscribe: (...args) => subscribeMock(...args),
}))

describe('StoreConnectorCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    subscribeMock.mockImplementation((listener) => {
      listener({})
      return () => {}
    })
  })

  it('SHOWS_NOT_CONNECTED_WHEN_NO_TOKENS', () => {
    render(
      <StoreConnectorCard provider="safeway" hasStoredTokens={false}>
        <button type="button">Connect Safeway</button>
      </StoreConnectorCard>
    )
    expect(screen.getByRole('heading', { name: 'Safeway' })).toBeInTheDocument()
    expect(screen.getByText('Not connected')).toBeInTheDocument()
    expect(screen.getByText(/Connect your Safeway account/i)).toBeInTheDocument()
  })

  it('SHOWS_CONNECTED_WHEN_TOKENS', () => {
    render(
      <StoreConnectorCard provider="costco" hasStoredTokens={true}>
        <button type="button">Sync Costco receipts</button>
      </StoreConnectorCard>
    )
    expect(screen.getByText('✓ Connected')).toBeInTheDocument()
    expect(screen.getByText(/ready to fetch receipts/i)).toBeInTheDocument()
  })

  it('SHOWS_NEEDS_RECONNECT_WHEN_ATTENTION_SET', () => {
    subscribeMock.mockImplementation((listener) => {
      listener({ safeway: { kind: 'needs_reconnect', updatedAt: Date.now() } })
      return () => {}
    })
    render(
      <StoreConnectorCard provider="safeway" hasStoredTokens={true}>
        <span>actions</span>
      </StoreConnectorCard>
    )
    expect(screen.getByText('Needs reconnect')).toBeInTheDocument()
    expect(screen.getByText(/session expired/i)).toBeInTheDocument()
  })

  it('NO_INNER_ONE_TAP_OR_CONNECT_LABELS', () => {
    render(
      <StoreConnectorCard provider="costco" hasStoredTokens={false}>
        <span>child</span>
      </StoreConnectorCard>
    )
    expect(screen.queryByText('One-Tap Sync')).not.toBeInTheDocument()
    expect(screen.queryByText('Connect Safeway')).not.toBeInTheDocument()
  })
})
