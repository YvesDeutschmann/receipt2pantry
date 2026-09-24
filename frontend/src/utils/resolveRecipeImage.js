import { getEffectiveApiBaseUrl } from '../services/apiClient'

const STAPLE_IMAGE_RE = /^\/staples\/staple_[a-z0-9_]+\.webp$/

/**
 * Resolve recipe.image for img src (Capacitor base './' cannot load /staples from WebView).
 */
export function resolveRecipeImage(src) {
  const raw = String(src ?? '').trim()
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (lower.startsWith('javascript:') || lower.startsWith('data:')) return null
  if (lower.startsWith('http://')) return null
  if (raw.startsWith('//')) return null
  if (STAPLE_IMAGE_RE.test(raw)) {
    const apiBase = getEffectiveApiBaseUrl().url.replace(/\/+$/, '')
    const origin = apiBase.replace(/\/api$/i, '')
    return `${origin}${raw}`
  }
  if (raw.startsWith('https://')) return raw
  return null
}
