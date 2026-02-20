/**
 * Deep linking scaffold for pantryapp:// URL scheme.
 *
 * When ready to enable deep linking:
 * 1. Register pantryapp:// in AndroidManifest.xml (intent-filter) and Info.plist (URL Type)
 * 2. Import and call initDeepLinks() from main.jsx
 * 3. Implement handleDeepLink to route/navigate based on the URL
 */
import { App } from '@capacitor/app'

/**
 * Handles incoming app URL (e.g., pantryapp://return?code=xxx from OAuth callback).
 * @param {import('@capacitor/app').AppUrlOpenListenerEvent} event
 */
function handleDeepLink(event) {
  const { url } = event
  // pantryapp://return?code=xxx or pantryapp://callback?...
  console.log('[DeepLink] Received URL:', url)
  // TODO: Parse URL, extract params, navigate or process OAuth callback
}

/**
 * Registers the appUrlOpen listener for deep links.
 * Call this from main.jsx when deep linking is enabled.
 */
export function initDeepLinks() {
  App.addListener('appUrlOpen', handleDeepLink)
}
