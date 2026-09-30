import { InAppBrowser } from '@capgo/inappbrowser'
import { Capacitor } from '@capacitor/core'
import { LEGAL_PAGE_URLS } from '../config/legal'

const COPY_LINK_PROMPT = 'Copy this link:'

function promptCopyLink(url) {
  window.prompt(COPY_LINK_PROMPT, url)
}

/**
 * Open a legal page in the system browser on native; web uses default link behavior.
 * Only compile-time legal URLs from config/legal.js are supported.
 */
export async function openLegalPage(url) {
  if (!LEGAL_PAGE_URLS.includes(url)) {
    return
  }
  if (!Capacitor.isNativePlatform()) {
    const opened = window.open(url, '_blank', 'noopener,noreferrer')
    if (opened == null) {
      promptCopyLink(url)
    }
    return
  }
  try {
    await InAppBrowser.open({ url })
  } catch (err) {
    console.warn('[openLegalPage] InAppBrowser.open failed:', err?.message ?? err)
  }
}
