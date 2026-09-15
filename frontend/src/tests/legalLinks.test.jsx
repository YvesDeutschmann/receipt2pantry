import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PRIVACY_URL, TERMS_URL } from '../config/legal'

const { isNativePlatformMock, openUrlMock } = vi.hoisted(() => ({
  isNativePlatformMock: vi.fn(() => false),
  openUrlMock: vi.fn(() => Promise.resolve({ completed: true })),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: (...args) => isNativePlatformMock(...args),
  },
}))

vi.mock('@capacitor/app', () => ({
  App: {
    openUrl: (...args) => openUrlMock(...args),
  },
}))

import LegalLink from '../components/LegalLink'
import { openLegalPage } from '../utils/openLegalPage'

describe('legal links', () => {
  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(false)
    openUrlMock.mockClear()
    vi.stubGlobal('open', vi.fn())
  })

  it('renders external anchor on web', () => {
    render(<LegalLink url={PRIVACY_URL}>Privacy Policy</LegalLink>)
    const link = screen.getByRole('link', { name: 'Privacy Policy' })
    expect(link).toHaveAttribute('href', PRIVACY_URL)
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('uses App.openUrl on native', async () => {
    isNativePlatformMock.mockReturnValue(true)
    render(<LegalLink url={TERMS_URL}>Terms of Service</LegalLink>)
    fireEvent.click(screen.getByRole('button', { name: 'Terms of Service' }))
    expect(openUrlMock).toHaveBeenCalledWith({ url: TERMS_URL })
  })

  it('openLegalPage ignores arbitrary URLs', async () => {
    await openLegalPage('https://evil.example/phish')
    expect(openUrlMock).not.toHaveBeenCalled()
  })

  it('constants are pinned to api.meald.app', () => {
    expect(PRIVACY_URL).toBe('https://api.meald.app/privacy')
    expect(TERMS_URL).toBe('https://api.meald.app/terms')
  })
})
