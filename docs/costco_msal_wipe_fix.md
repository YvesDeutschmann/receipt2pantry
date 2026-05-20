# Costco one-tap — MSAL tokens wiped before extraction

The Costco "Sign in / Sync" flow on iPad reaches the `ordersandpurchases` view but the in-WebView extraction script never finds MSAL tokens, the sync overlay never appears, and the bridge eventually times out with `closeEvent: user closed before tokens`.

## Symptom (from backend dev-log, 2026-05-05)

Two full Costco login attempts. The user navigates to `ordersandpurchases` three times during attempt 1 and three times during attempt 2.

```
14:23:11  [costcoLogin] urlChange: https://signin.costco.com/.../authorize  isExtract=false skipInjection=true
14:25:36  [costcoLogin] urlChange: https://signin.costco.com/.../CombinedSigninAndSignup/confirmed
14:25:37  [costcoLogin] urlChange: https://www.costco.com/OAuthLogonCmd     isExtract=true  skipInjection=false
14:25:38  [costcoLogin] urlChange: https://www.costco.com/?krypto=...        isExtract=true  skipInjection=false
14:26:04  [costcoLogin] urlChange: https://www.costco.com/myaccount/#/.../ordersandpurchases  isExtract=true  skipInjection=false
...
14:27:48  [costcoLogin] login timeout 300s
14:30:20  [costcoLogin] closeEvent: user closed before tokens
```

There are **zero** `tryPost-tick`, `page-diagnostic`, or `msal-tokens-found` debug events from the Costco WebView in the entire log, even though the user reached `ordersandpurchases` six times across the two sessions. The injected script ran (we see `script_run` events on Safeway flows). It just never saw any MSAL token in `localStorage`.

## Root cause

Costco's bridge sets `clearBrowserSessionBeforeLogin: true`:

```81:90:frontend/src/services/costcoWebViewBridge.js
export const {
  startLogin,
  startSilentSync,
  storeTokens: storeCostcoTokens,
  getStoredTokens: getStoredCostcoTokens,
  hasStoredTokens,
  clearStoredTokens,
} = createWebViewBridge({
  provider: 'costco',
  ...
  clearBrowserSessionBeforeLogin: true,
```

That flag activates `wipeAkamaiAndMsalStorageOnce()` in the shared bridge:

```224:237:frontend/src/services/webViewBridge.js
const wipeAkamaiAndMsalStorageOnce = async () => {
  if (!clearBrowserSessionBeforeLogin || tokensReceived) return;
  let host = '';
  try {
    host = new URL(lastBrowserUrl).hostname;
  } catch {
    return;
  }
  if (!host || wipedHosts.has(host)) return;
  if (!extractDomains.some((d) => host.includes(d))) return;
  wipedHosts.add(host);
  const code = `(function(){try{var KEYS=['ak_a','ak_ax','ak_bm_tab_id','_abck','bm_sz','bm_sv','bm_mi','bm_so','bm_lso','RT'];function nuke(s){try{KEYS.forEach(function(k){try{s.removeItem(k);}catch(_){ }});for(var i=s.length-1;i>=0;i--){try{var k=s.key(i);if(!k)continue;if(k.indexOf('msal.')===0||k.indexOf('signin.costco.com')>=0||k.indexOf('b2clogin.com')>=0){s.removeItem(k);}}catch(_){}}}catch(_){}}nuke(localStorage);nuke(sessionStorage);try{if(window.indexedDB&&indexedDB.databases){indexedDB.databases().then(function(dbs){(dbs||[]).forEach(function(d){try{indexedDB.deleteDatabase(d.name);}catch(_){}});}).catch(function(){});}}catch(_){}}catch(_){}})();`;
  await InAppBrowser.executeScript({ code }).catch(() => {});
};
```

The wipe runs the first time we see a URL whose host matches `extractDomains` (`['costco.com']`). That includes `www.costco.com`. After the B2C dance, MSAL writes `IdToken` / `AccessToken` / `RefreshToken` into `www.costco.com` localStorage during the `OAuthLogonCmd` -> `?krypto=...` redirects. Then `urlChangeEvent` fires for `www.costco.com` and the wipe deletes every key starting with `msal.` — exactly the keys MSAL just wrote.

By the time `tryPost()` polls `ordersandpurchases`, localStorage is empty, the host gate (`host !== 'www.costco.com' && host !== 'costco.com'`) lets us in, but `findIdToken` / `findAccessToken` return null, the function exits, and we keep polling forever.

```mermaid
sequenceDiagram
  participant User
  participant WebView
  participant LocalStorage
  participant Bridge
  User->>WebView: open www.costco.com
  Bridge->>LocalStorage: wipe Akamai + msal.* on www.costco.com
  Note over LocalStorage: empty (expected, pre-login)
  User->>WebView: sign in (signin.costco.com)
  WebView->>WebView: B2C confirms
  WebView->>WebView: redirect www.costco.com/OAuthLogonCmd
  WebView->>LocalStorage: MSAL writes IdToken/AccessToken/RefreshToken
  Bridge->>LocalStorage: wipe runs again? No — wipedHosts.has(www.costco.com) blocks
  Note right of LocalStorage: in this run we are lucky;<br/>but in fresh-install run wipe and MSAL race
  User->>WebView: navigate ordersandpurchases
  Bridge->>WebView: tryPost() reads localStorage
  LocalStorage-->>Bridge: no msal.* keys (wiped earlier or never written)
  Bridge->>Bridge: poll until 300s timeout
```

The `wipedHosts.add(host)` guard means the wipe only runs once per host per login session — which sounds safe, but the order of events is:

1. `urlChange` to `www.costco.com/OAuthLogonCmd` -> wipe schedules.
2. `wipeAkamaiAndMsalStorageOnce()` runs -> nukes everything matching `msal.` (already-written tokens included).
3. MSAL re-runs and re-writes some tokens — sometimes.

Empirically the user's session never recovers. Costco's MSAL flow does not unconditionally re-issue tokens after the first OAuth completion, so deleting them mid-flow is fatal.

## Fix options

### Option 1 (recommended): scope the storage wipe to auth hosts only

Add an explicit `wipeStorageHosts: string[]` field to `createWebViewBridge` config. Default to "all extract domains" for backwards compatibility, but Costco's `costcoWebViewBridge.js` should pass `wipeStorageHosts: ['signin.costco.com', 'b2clogin.com']`. Update `wipeAkamaiAndMsalStorageOnce()` to check membership against `wipeStorageHosts` instead of `extractDomains`.

This preserves the original purpose (kill Akamai bot-manager state on the auth host before retry) without ever touching `www.costco.com`.

### Option 2: stop wiping LocalStorage at all

Drop `wipeAkamaiAndMsalStorageOnce`. Rely on the upstream `clearAllCookies + clearCache` work added by `scripts/patch-capgo-inappbrowser.js` (documented in [costco-webview-diagnostics.md](costco-webview-diagnostics.md)) to handle the Akamai problem at the iOS / Android plugin level. Riskier — we lose the JS belt-and-suspenders for keys the patch misses.

### Option 3 (defensive, ship alongside whichever fix wins)

Already added the `tryPost-tick` rate-limited debug at [frontend/src/services/costcoExtractScript.js](../frontend/src/services/costcoExtractScript.js). Extend it on `host==='www.costco.com'` to also include the names of the first 5 `localStorage` keys, so we can prove tokens land then disappear (or never land) on subsequent runs.

## Validation

After Option 1 lands and a TestFlight rebuild:

1. Re-run Costco One-Tap on iPad with a fresh install.
2. Watch backend log for:
   - `tryPost-tick {host:"www.costco.com", hasIdT:true, ...}` shortly after the `OAuthLogonCmd` redirect.
   - `msal-tokens-found` (`postMsalTokensDiag`) — proves we got past the host gate with tokens.
   - `injectSyncOverlay` / "Syncing Costco Receipts" overlay visible to the user.
   - `costco-receipts` or `costco-tokens` `messageFromWebview` event — bridge resolves.
3. The extraction debug entries on `signin.costco.com` should still report a clean `lsKeys` set on retry (Akamai keys gone), proving the wipe still does its job on the auth host.

---

## Resolution (Option A, 2026-05)

The preemptive wipe path described above has been **fully removed** from production:

- **[`webViewBridge.js`](../frontend/src/services/webViewBridge.js)** — Deleted `clearBrowserSessionBeforeLogin`, `wipeStorageHosts`, `wipeAkamaiAndMsalStorageOnce`, and every hook that invoked them.
- **[`costcoWebViewBridge.js`](../frontend/src/services/costcoWebViewBridge.js)** — Costco no longer sets wipe-related flags; **`clearCostcoInAppBrowserSession()`** remains exported for on-demand clearing after token errors (via [`useCostcoSync.js`](../frontend/src/hooks/useCostcoSync.js)).
- **`frontend/scripts/patch-capgo-inappbrowser.js`** — **Removed.** `@capgo/inappbrowser` is consumed **unpatched**. [`package.json`](../frontend/package.json) `cap:patch` no longer runs this script.
- **Supabase** — Native auth storage uses [`Capacitor Preferences`](../frontend/src/services/supabaseClient.js) so incidental `clearAllCookies` calls do not log users out of the main WebView.

**Developer hygiene:** After pulling, reinstall frontend deps (`cd frontend && rm -rf node_modules && npm install`) so vendored plugin sources revert to upstream (no stale in-place patches).

Historical sections above document why wiping existed and why it broke MSAL; Option A supersedes Options 1–2 here by deleting wiping entirely rather than scoping it.
