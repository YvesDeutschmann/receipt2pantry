import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const enableFunnelTelemetryExport = vi.fn()

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signInWithApple: vi.fn(),
    signInWithGoogle: vi.fn(),
  }),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'web' },
}))

vi.mock('../services/funnelTelemetryExport', () => ({
  enableFunnelTelemetryExport: (...args) => enableFunnelTelemetryExport(...args),
}))

import Auth from '../pages/Auth'

describe('Auth funnel dump enable', () => {
  beforeEach(() => {
    enableFunnelTelemetryExport.mockReset()
  })

  it('FIVE_TAPS_ON_TITLE_ENABLES_FUNNEL_EXPORT', () => {
    render(
      <MemoryRouter>
        <Auth />
      </MemoryRouter>
    )
    const title = screen.getByRole('heading', { name: 'Meald' })
    for (let i = 0; i < 4; i++) {
      fireEvent.click(title)
    }
    expect(enableFunnelTelemetryExport).not.toHaveBeenCalled()
    fireEvent.click(title)
    expect(enableFunnelTelemetryExport).toHaveBeenCalledTimes(1)
  })
})
