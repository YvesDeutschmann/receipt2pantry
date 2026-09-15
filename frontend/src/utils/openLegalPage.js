import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { PRIVACY_URL, TERMS_URL } from '../config/legal'

/**
 * Open a legal page in the system browser on native; web uses default link behavior.
 * Only PRIVACY_URL and TERMS_URL are supported — no arbitrary URL helper.
 */
export async function openLegalPage(url) {
  if (url !== PRIVACY_URL && url !== TERMS_URL) {
    return
  }
  if (!Capacitor.isNativePlatform()) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }
  const result = await App.openUrl({ url })
  if (result?.completed === false) {
    window.prompt('Copy this link:', url)
  }
}
