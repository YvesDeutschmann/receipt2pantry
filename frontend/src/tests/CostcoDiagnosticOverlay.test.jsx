import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CostcoDiagnosticOverlay from '../components/CostcoDiagnosticOverlay.jsx'

vi.mock('../services/costcoDiagnosticSettings.js', () => ({
  isCostcoDevDiagnosticsEnabled: () => true,
}))

vi.mock('../services/costcoDiagnosticStore.js', () => ({
  getCostcoDiagnosticSummary: () => ({
    checkpoints: {
      a0: { flat: { censusSeen: 1 } },
    },
    tokenExchange: { flat: { tokenFired: true, tokenStatus: 200, tokenPolicy: 'b2c_209' } },
  }),
  subscribeCostcoDiagnostic: () => () => {},
  summarizeCostcoDiagnosticForDisplay: () => 'A0 creds:1 · /token 200 · 209',
}))

describe('CostcoDiagnosticOverlay', () => {
  it('renders summary pill when dev diagnostics enabled', () => {
    render(<CostcoDiagnosticOverlay />)
    expect(screen.getByTestId('costco-diagnostic-overlay')).toBeInTheDocument()
    expect(screen.getByText(/A0 creds:1/)).toBeInTheDocument()
  })
})
