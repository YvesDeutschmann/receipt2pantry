import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PRIVACY_URL, TERMS_URL } from '../config/legal'

const { isNativePlatformMock, inAppBrowserOpenMock } = vi.hoisted(() => ({
  isNativePlatformMock: vi.fn(() => false),
  inAppBrowserOpenMock: vi.fn(() => Promise.resolve()),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: (...args) => isNativePlatformMock(...args),
  },
}))

vi.mock('@capgo/inappbrowser', () => ({
  InAppBrowser: {
    open: (...args) => inAppBrowserOpenMock(...args),
  },
}))

import LegalLink from '../components/LegalLink'
import { openLegalPage } from '../utils/openLegalPage'

describe('legal links', () => {
  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(false)
    inAppBrowserOpenMock.mockClear()
    inAppBrowserOpenMock.mockResolvedValue(undefined)
    vi.stubGlobal('open', vi.fn(() => ({})))
    vi.stubGlobal('prompt', vi.fn())
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('renders external anchor on web', () => {
    render(<LegalLink url={PRIVACY_URL}>Privacy Policy</LegalLink>)
    const link = screen.getByRole('link', { name: 'Privacy Policy' })
    expect(link).toHaveAttribute('href', PRIVACY_URL)
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('uses InAppBrowser.open on native', async () => {
    isNativePlatformMock.mockReturnValue(true)
    render(<LegalLink url={TERMS_URL}>Terms of Service</LegalLink>)
    fireEvent.click(screen.getByRole('button', { name: 'Terms of Service' }))
    expect(inAppBrowserOpenMock).toHaveBeenCalledWith({ url: TERMS_URL })
  })

  it('openLegalPage ignores arbitrary URLs', async () => {
    await openLegalPage('https://evil.example/phish')
    expect(inAppBrowserOpenMock).not.toHaveBeenCalled()
    expect(window.prompt).not.toHaveBeenCalled()
  })

  it('openLegalPage prompts when window.open returns null on web', async () => {
    window.open.mockReturnValue(null)
    await openLegalPage(PRIVACY_URL)
    expect(window.prompt).toHaveBeenCalledWith('Copy this link:', PRIVACY_URL)
    expect(inAppBrowserOpenMock).not.toHaveBeenCalled()
  })

  it('openLegalPage does not prompt when InAppBrowser.open rejects on native', async () => {
    isNativePlatformMock.mockReturnValue(true)
    inAppBrowserOpenMock.mockRejectedValue(new Error('Activity not found'))
    await openLegalPage(TERMS_URL)
    expect(inAppBrowserOpenMock).toHaveBeenCalledWith({ url: TERMS_URL })
    expect(window.prompt).not.toHaveBeenCalled()
  })

  it('constants are pinned to api.meald.app', () => {
    expect(PRIVACY_URL).toBe('https://api.meald.app/privacy')
    expect(TERMS_URL).toBe('https://api.meald.app/terms')
  })
})
