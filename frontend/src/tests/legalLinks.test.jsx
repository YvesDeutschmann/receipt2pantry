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
    openUrlMock.mockResolvedValue({ completed: true })
    vi.stubGlobal('open', vi.fn(() => ({})))
    vi.stubGlobal('prompt', vi.fn())
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
    expect(window.prompt).not.toHaveBeenCalled()
  })

  it('openLegalPage prompts when window.open returns null on web', async () => {
    window.open.mockReturnValue(null)
    await openLegalPage(PRIVACY_URL)
    expect(window.prompt).toHaveBeenCalledWith('Copy this link:', PRIVACY_URL)
    expect(openUrlMock).not.toHaveBeenCalled()
  })

  it('openLegalPage prompts when App.openUrl rejects on native', async () => {
    isNativePlatformMock.mockReturnValue(true)
    openUrlMock.mockRejectedValue(new Error('Activity not found'))
    await openLegalPage(TERMS_URL)
    expect(openUrlMock).toHaveBeenCalledWith({ url: TERMS_URL })
    expect(window.prompt).toHaveBeenCalledWith('Copy this link:', TERMS_URL)
  })

  it('openLegalPage prompts when App.openUrl returns completed false on native', async () => {
    isNativePlatformMock.mockReturnValue(true)
    openUrlMock.mockResolvedValue({ completed: false })
    await openLegalPage(PRIVACY_URL)
    expect(window.prompt).toHaveBeenCalledWith('Copy this link:', PRIVACY_URL)
  })

  it('constants are pinned to api.meald.app', () => {
    expect(PRIVACY_URL).toBe('https://api.meald.app/privacy')
    expect(TERMS_URL).toBe('https://api.meald.app/terms')
  })
})
