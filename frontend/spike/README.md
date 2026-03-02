# Costco One-Tap Sync – Technical Spike

A WebView-based authentication bridge that extracts Costco MSAL tokens after login, fetches receipts via native device HTTP (avoiding Akamai bot detection), and submits them to the app backend.

## Architecture

```
User taps "Sync" → WebView opens (Costco login) → JS injection polls localStorage
→ Tokens sent via messageFromWebview → CapacitorHttp fetches GraphQL on device
→ Receipts POSTed to backend → Stored + processed into pantry
```

- **Auth**: `@capgo/inappbrowser` WebView with `preShowScript` injection
- **Fetch**: `CapacitorHttp` (native networking, device IP)
- **Storage**: `@capacitor/preferences` for token persistence
- **Backend**: `POST /api/providers/costco/store-receipts` (added for spike)

## Files

| File | Purpose |
|------|---------|
| `costcoInjectionScript.js` | Raw JS injected into WebView; polls localStorage for idToken, clientID, refreshToken |
| `costcoWebViewBridge.js` | InAppBrowser orchestrator; `startLogin()` (visible), `startSilentSync()` (hidden) |
| `costcoNativeSync.js` | CapacitorHttp GraphQL fetch, JWT decode, token refresh, `submitToBackend()` |
| `useCostcoSync.js` | React hook; state machine for token check → refresh/login → fetch → handoff |
| `CostcoOneTapSync.jsx` | React UI component with sync button and status display |

## Usage

### 1. Dependencies (already added)

```bash
npm install @capgo/inappbrowser @capacitor/preferences
```

`CapacitorHttp` is enabled in `capacitor.config.ts`.

### 2. Add component to your app

```jsx
import CostcoOneTapSync from '../spike/CostcoOneTapSync';

// In your Providers page or similar:
<CostcoOneTapSync
  userId={userId}
  days={90}
  apiBaseUrl={import.meta.env.VITE_API_BASE_URL}
/>
```

### 3. Run on device

One-Tap Sync runs only on native iOS/Android. Build and run:

```bash
npm run build:mobile
npx cap open android   # or ios
```

### 4. Flow

- **First sync**: Tap "Sync Costco Receipts" → WebView opens → Sign in to Costco → Tokens extracted → Receipts fetched natively → Sent to backend.
- **Later syncs**: "Sync Costco Receipts" uses stored tokens; "Silent Sync" tries hidden WebView first (no visible login).

## Backend endpoint

The spike adds:

```
POST /api/providers/costco/store-receipts
Body: { "receipts": [...], "user_id": "uuid" }
```

This endpoint is implemented in `backend/routes/providers.py` and calls `_store_and_process_fetched_receipts`.

## Risk notes

- **Akamai**: Fetching from device with real browser cookies should avoid bot detection; rapid polling of localStorage could be tuned if needed.
- **Token refresh**: B2C `client_id` and policy are hardcoded; works with Costco's current config.
- **Hidden WebView**: 1x1 off-screen WebView may behave differently on iOS vs Android; validate per platform.
- **Cookie persistence**: WebView cookie jar should persist "Remember Me"; verify across app restarts.

## Next steps

1. Test on real iOS and Android devices.
2. Confirm silent sync (hidden WebView) on both platforms.
3. Consider extracting injection script to a separate file if maintenance becomes harder.
4. Add error telemetry for token extraction and fetch failures.
5. Evaluate refresh token rotation and secure storage (e.g., Keychain/Keystore).
