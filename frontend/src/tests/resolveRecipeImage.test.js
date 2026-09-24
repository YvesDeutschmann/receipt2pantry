import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveRecipeImage } from '../utils/resolveRecipeImage'

vi.mock('../services/apiClient', () => ({
  getEffectiveApiBaseUrl: vi.fn(() => ({ url: 'https://api.meald.app/api' })),
}))

describe('resolveRecipeImage', () => {
  it('prefixes_staple_path_with_api_origin', () => {
    expect(resolveRecipeImage('/staples/staple_omelette.webp')).toBe(
      'https://api.meald.app/staples/staple_omelette.webp'
    )
  })

  it('allows_https_spoonacular', () => {
    expect(resolveRecipeImage('https://img.spoonacular.com/x.jpg')).toBe(
      'https://img.spoonacular.com/x.jpg'
    )
  })

  it('rejects_javascript', () => {
    expect(resolveRecipeImage('javascript:alert(1)')).toBeNull()
  })

  it('rejects_http', () => {
    expect(resolveRecipeImage('http://evil.test/x.jpg')).toBeNull()
  })
})
