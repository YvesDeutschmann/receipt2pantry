#!/usr/bin/env node
/**
 * Patches @capgo/inappbrowser so `clearAllCookies()` and `clearCache()` wipe
 * the *full* website data store (cookies + localStorage + sessionStorage +
 * IndexedDB + service workers + caches), not just cookies / disk cache.
 *
 * Why: Akamai Bot Manager stores telemetry markers (e.g. `ak_a`, `ak_ax`,
 * `_abck`, `bm_*`) in localStorage on `signin.costco.com`. The plugin's
 * stock implementation only clears `WKWebsiteDataTypeCookies` (iOS) and
 * `CookieManager.removeAllCookies` (Android), so Akamai's previous-session
 * fingerprint survives across InAppBrowser opens and the second login
 * attempt is blocked with a 403 "Access Denied" page.
 *
 * Idempotent: re-runs are no-ops once patched.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const nodeModules = path.join(__dirname, '..', 'node_modules')

const IOS_FILE = path.join(
  nodeModules,
  '@capgo/inappbrowser/ios/Sources/InAppBrowserPlugin/InAppBrowserPlugin.swift'
)
const ANDROID_FILE = path.join(
  nodeModules,
  '@capgo/inappbrowser/android/src/main/java/ee/forgr/capacitor_inappbrowser/InAppBrowserPlugin.java'
)

const PATCH_MARKER_IOS_COOKIES = '// MEALD-PATCH(clearAllCookies): clear all website data types'
const PATCH_MARKER_IOS_CACHE = '// MEALD-PATCH(clearCache): clear all website data types'
const PATCH_MARKER_ANDROID = '// MEALD-PATCH: clear all webview data'

const IOS_OLD_TYPES_BLOCK = `            let dataTypes = Set([WKWebsiteDataTypeCookies])
            let group = DispatchGroup()
            for dataStore in dataStores {
                group.enter()
                dataStore.removeData(ofTypes: dataTypes,
                                     modifiedSince: Date(timeIntervalSince1970: 0)) {
                    group.leave()
                }
            }
            group.notify(queue: .main) {
                call.resolve()
            }
        }
    }

    @objc func clearCache(_ call: CAPPluginCall) {`

const IOS_NEW_TYPES_BLOCK = `            ${PATCH_MARKER_IOS_COOKIES}
            let dataTypes = WKWebsiteDataStore.allWebsiteDataTypes()
            let group = DispatchGroup()
            for dataStore in dataStores {
                group.enter()
                dataStore.removeData(ofTypes: dataTypes,
                                     modifiedSince: Date(timeIntervalSince1970: 0)) {
                    group.leave()
                }
            }
            group.notify(queue: .main) {
                call.resolve()
            }
        }
    }

    @objc func clearCache(_ call: CAPPluginCall) {`

const IOS_OLD_CACHE_BLOCK = `            let dataTypes = Set([WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache])`

const IOS_NEW_CACHE_BLOCK = `            ${PATCH_MARKER_IOS_CACHE}
            let dataTypes = WKWebsiteDataStore.allWebsiteDataTypes()`

const ANDROID_OLD_CLEAR_CACHE = `    @PluginMethod
    public void clearCache(PluginCall call) {
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.removeAllCookies(null);
        cookieManager.flush();
        call.resolve();
    }

    @PluginMethod
    public void clearAllCookies(PluginCall call) {
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.removeAllCookies(null);
        cookieManager.flush();
        call.resolve();
    }`

const ANDROID_NEW_CLEAR_CACHE = `    @PluginMethod
    public void clearCache(PluginCall call) {
        ${PATCH_MARKER_ANDROID}
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.removeAllCookies(null);
        cookieManager.flush();
        try {
            android.webkit.WebStorage.getInstance().deleteAllData();
        } catch (Throwable ignored) {}
        try {
            android.webkit.CookieManager.getInstance().removeSessionCookies(null);
        } catch (Throwable ignored) {}
        call.resolve();
    }

    @PluginMethod
    public void clearAllCookies(PluginCall call) {
        ${PATCH_MARKER_ANDROID}
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.removeAllCookies(null);
        cookieManager.flush();
        try {
            android.webkit.WebStorage.getInstance().deleteAllData();
        } catch (Throwable ignored) {}
        try {
            android.webkit.CookieManager.getInstance().removeSessionCookies(null);
        } catch (Throwable ignored) {}
        call.resolve();
    }`

function patchFile(filePath, oldChunk, newChunk, marker, label) {
  if (!fs.existsSync(filePath)) {
    console.log(`[patch-capgo-inappbrowser] skip (${label}): file missing ${filePath}`)
    return false
  }
  let content = fs.readFileSync(filePath, 'utf8')
  if (content.includes(marker)) {
    return false
  }
  if (!content.includes(oldChunk)) {
    console.warn(
      `[patch-capgo-inappbrowser] skip (${label}): expected source block not found — plugin may have been updated upstream; please re-verify the patch.`
    )
    return false
  }
  content = content.replace(oldChunk, newChunk)
  fs.writeFileSync(filePath, content)
  console.log(`[patch-capgo-inappbrowser] patched ${label}`)
  return true
}

let any = false
any = patchFile(IOS_FILE, IOS_OLD_TYPES_BLOCK, IOS_NEW_TYPES_BLOCK, PATCH_MARKER_IOS_COOKIES, 'iOS clearAllCookies') || any
any = patchFile(IOS_FILE, IOS_OLD_CACHE_BLOCK, IOS_NEW_CACHE_BLOCK, PATCH_MARKER_IOS_CACHE, 'iOS clearCache') || any
any = patchFile(ANDROID_FILE, ANDROID_OLD_CLEAR_CACHE, ANDROID_NEW_CLEAR_CACHE, PATCH_MARKER_ANDROID, 'Android clearCache+clearAllCookies') || any

if (any) {
  console.log('[patch-capgo-inappbrowser] done. Run `npx cap sync` to copy changes into native projects.')
} else {
  console.log('[patch-capgo-inappbrowser] no changes (already patched or not applicable).')
}
