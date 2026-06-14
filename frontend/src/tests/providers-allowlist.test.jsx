import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import Providers from '../pages/Providers'
import { api } from '../services/apiClient'

const __dirname = dirname(fileURLToPath(import.meta.url))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
    onboardingComplete: true,
  }),
}))

vi.mock('../services/apiClient', () => ({
  api: {
    listProviders: vi.fn(),
    getProviderStatus: vi.fn(() =>
      Promise.resolve({ configured: false, active: false })
    ),
  },
}))

vi.mock('../components/SafewayConnectCard', () => ({
  default: () => <div data-testid="safeway-card">Safeway Connect</div>,
}))

vi.mock('../components/CostcoOneTapSync', () => ({
  default: () => <div data-testid="costco-sync">Costco One-Tap</div>,
}))

function renderProviders() {
  return render(
    <MemoryRouter>
      <Providers />
    </MemoryRouter>
  )
}

describe('Providers MVP allowlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('PROVIDERS_ALLOWLIST_FILTERS_UNKNOWN_PROVIDER', async () => {
    vi.mocked(api.listProviders).mockResolvedValue({
      providers: ['safeway', 'costco', 'qfc'],
    })
    renderProviders()
    await waitFor(() => {
      expect(screen.getByText('safeway')).toBeInTheDocument()
      expect(screen.getByText('costco')).toBeInTheDocument()
    })
    expect(screen.queryByText('qfc')).not.toBeInTheDocument()
    expect(screen.queryByText('Test Connection')).not.toBeInTheDocument()
  })

  it('PROVIDERS_ALLOWLIST_RENDERS_SAFEWAY_AND_COSTCO', async () => {
    vi.mocked(api.listProviders).mockResolvedValue({
      providers: ['safeway', 'costco'],
    })
    renderProviders()
    await waitFor(() => {
      expect(screen.getByText('safeway')).toBeInTheDocument()
      expect(screen.getByText('costco')).toBeInTheDocument()
    })
    expect(screen.getByTestId('safeway-card')).toBeInTheDocument()
    expect(screen.getByTestId('costco-sync')).toBeInTheDocument()
  })

  it('PROVIDERS_ALLOWLIST_EMPTY_WHEN_NO_KNOWN_PROVIDERS', async () => {
    vi.mocked(api.listProviders).mockResolvedValue({
      providers: ['qfc', 'walmart'],
    })
    renderProviders()
    await waitFor(() => {
      expect(
        screen.getByText('No providers available yet.')
      ).toBeInTheDocument()
    })
    expect(screen.queryByText('qfc')).not.toBeInTheDocument()
    expect(screen.queryByText('walmart')).not.toBeInTheDocument()
  })

  it('VOICE_INPUT_SHEET_NOT_IMPORTED_IN_RECIPES', () => {
    const recipesPath = resolve(__dirname, '../pages/Recipes.jsx')
    const source = readFileSync(recipesPath, 'utf-8')
    expect(source).not.toMatch(/VoiceInputSheet/)
    expect(source).not.toMatch(/VoiceWaveform/)
    expect(source).not.toMatch(/components\/voice/)
  })
})
