import { vi } from 'vitest'

/**
 * Factory for apiClient mocks used in Vitest RTL "E2E" tests.
 */
export function createMockApi(overrides = {}) {
  const api = {
    getStaplesTemplate: vi.fn(),
    getStaplesReceiptMatches: vi.fn(),
    confirmStaples: vi.fn(),
    getPantry: vi.fn().mockResolvedValue({ grouped: [] }),
    searchIngredients: vi.fn(),
    quickAddPantryItem: vi.fn(),
    updatePantryItem: vi.fn(),
    voiceTranscribe: vi.fn(),
    voiceConfirm: vi.fn(),
    depletePantryItem: vi.fn(),
    restorePantryItem: vi.fn(),
    suggestions: {
      triggerGeneration: vi.fn().mockResolvedValue({}),
    },
    ...overrides,
  }
  return api
}
