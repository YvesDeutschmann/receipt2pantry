# Mobile Setup (Capacitor)

Guide for running Meald on Android and iOS devices.

## Android: Fix "No valid Android SDK root found"

The `npx cap run android` command uses `native-run`, which requires the Android SDK and `ANDROID_HOME` to be set.

### Option A: Set environment variable (for CLI runs)

1. **Install Android Studio** from [developer.android.com/studio](https://developer.android.com/studio) if you haven't already.
2. **Install SDK components** via Android Studio:
  - Open Android Studio → **Settings** (or **File** → **Settings** on Windows)
  - Go to **Languages & Frameworks** → **Android SDK**
  - Ensure **Android SDK Platform** and **Android SDK Platform-Tools** are installed
  - Note the **Android SDK Location** (e.g. `C:\Users\<You>\AppData\Local\Android\Sdk`)
3. **Set `ANDROID_HOME`** (Windows PowerShell, current user):
  ```powershell
   [System.Environment]::SetEnvironmentVariable('ANDROID_HOME', 'C:\Users\<You>\AppData\Local\Android\Sdk', 'User')
  ```
   Replace the path with your actual SDK location.
4. **Restart your terminal** (or reboot) so the new variable is picked up.
5. **Run again:**
  ```bash
   npm run build:mobile
   npx cap run android
  ```

### Option B: Run from Android Studio (no env var needed)

1. **Install Android Studio** and the SDK (see step 1–2 above).
2. **Open the Android project:**
  ```bash
   cd frontend
   npm run build:mobile
   npx cap open android
  ```
3. In Android Studio, select your device or emulator and click the **Run** (▶) button.

Android Studio uses its own SDK path, so `ANDROID_HOME` is not required.

---

## iOS (macOS only)

1. Install **Xcode** from the App Store.
2. Run:
  ```bash
   cd frontend
   npm run build:mobile
   npx cap run ios
  ```
3. Or open in Xcode: `npx cap open ios`, then run from there.

---

## Live reload on device

To use the Vite dev server with hot reload on your phone (same Wi‑Fi as your PC; no static IP needed):

1. From `frontend`, run `**npm run dev**` in one terminal (Vite uses `host: true` so the dev server is reachable on your LAN).
2. In another terminal, from `frontend`, run `**npm run cap:dev**`. This script:
  - Detects your machine’s current LAN IPv4 (**or** uses `**ANDROID_DEV_LAN_IP`** / `**CAP_DEV_HOST`** from `.env` / `.env.local` if set — avoids committing IPs in tracked files)
  - Updates `android/app/src/main/res/xml/network_security_config.xml` so Android allows HTTP to that IP (cleartext); the tracked XML only lists `localhost` + emulator — your LAN IP is injected by this script or by `**npm run cap:sync**` / `**cap run android**` when `ANDROID_DEV_LAN_IP` is in `.env.local`
  - Writes `**VITE_API_BASE_URL**` to `.env.local` (e.g. `http://<your-ip>:5000/api`) so a later `**npm run build:mobile**` bakes the correct dev-machine API URL into the production bundle (otherwise the WebView uses `localhost` and API calls hit the phone)
  - Runs `cap sync` with `**DEV_SERVER_URL**` set so `capacitor.config.ts` points the WebView at `http://<your-ip>:5173/`
3. Open the Android or iOS project and run on a device (e.g. `npx cap open android` → Run in Android Studio, or use Xcode on macOS).

**One-shot from CLI (Android):** `npm run cap:run:android:dev` — same as `cap:dev` but also runs `cap run android`.

**Custom port:** If Vite uses something other than 5173, set `CAP_DEV_PORT` before `cap:dev` (e.g. PowerShell: `$env:CAP_DEV_PORT=5174; npm run cap:dev`).

**Backend / Flask port:** If the API listens on something other than 5000, set `CAP_BACKEND_PORT` before `cap:dev` (e.g. `$env:CAP_BACKEND_PORT=8080; npm run cap:dev`) so `.env.local` gets the matching `VITE_API_BASE_URL`.

**Wrong IP detected:** Add `ANDROID_DEV_LAN_IP=192.168.x.x` (or legacy `CAP_DEV_HOST`) to `**.env.local`** (gitignored), or export it for one session. If you have many virtual adapters (Hyper-V, Docker), prefer an explicit IP over auto-detect.

**Production:** `npm run build:mobile` does not set `DEV_SERVER_URL`, so the app loads the bundled `dist/` and does not embed a dev `server.url`.

**If you get `net::ERR_CLEARTEXT_NOT_PERMITTED`:** Run `npm run cap:dev` again after connecting to a new network so the script refreshes your IP in `network_security_config.xml`. `10.0.2.2` (Android emulator → host loopback) is left unchanged.

---

## Public tunnel via ngrok (no rebuild per ngrok restart)

Use this when you want devices (e.g. TestFlight) to hit your **local Flask** API over HTTPS without baking a new URL into every build when ngrok rotates.

### Prerequisites

1. **ngrok:** `brew install ngrok` (or [ngrok.com](https://ngrok.com)), then `ngrok config add-authtoken <token>`.
2. **Database:** Apply `[supabase/migrations/021_app_config.sql](../supabase/migrations/021_app_config.sql)` to your Supabase project (SQL editor or `supabase db push`).
3. **Root `.env`:** Must include `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`) so the dev script can upsert the tunnel URL.

### One-time: TestFlight / device build with dev UI

In `frontend/.env.local` (gitignored), set:

```bash
VITE_ENABLE_DEV_SETTINGS=1
```

Then `npm run build:mobile` and distribute. This exposes **Settings → Dev Tools → Dev: API base URL** in a **release** build so you can paste an URL or see sync status. Omit this flag for real App Store production.

**Note:** Supabase auto-fetch for `app_config` only runs when `import.meta.env.DEV` is true **or** `VITE_ENABLE_DEV_SETTINGS=1`, so production users without that flag do not poll `app_config`.

### Per session

1. Start Flask on your Mac (default `:5000`), e.g. `./run_backend.sh` from the repo root.
2. From `frontend`:
  ```bash
   npm run ngrok:backend
  ```
   This starts `ngrok http <port>`, reads the public `https://…ngrok-free.app` URL, upserts `app_config.dev_api_base_url` in Supabase, and copies the `/api` URL to the clipboard (macOS).
3. On each device: **cold start** or **bring app to foreground** — the app refreshes the cached URL from Supabase. Or open **Settings → Dev Tools → Refresh from server** to pull immediately.
4. Optional **manual override** on one device: paste a different base URL in the same dev card (overrides Supabase until cleared).

When ngrok gives you a new URL, run `npm run ngrok:backend` again; no new TestFlight build is required.

---

## Supabase: Google / Apple (native)

### Google

Native Android and iOS use **@capawesome/capacitor-google-sign-in** and `supabase.auth.signInWithIdToken` (no custom URL scheme).

### Sign in with Apple (iOS only)

The iOS app uses a local Capacitor **native** Sign in with Apple bridge and `supabase.auth.signInWithIdToken` — there is no Safari redirect back into the app. The “Sign in with Apple” button is only shown on iOS.

1. **Apple Developer**
  - Identifiers → your App ID `com.meald.app` → enable **Sign In with Apple** (capability is configured in the repo in `ios/App/App/App.entitlements`).
2. **Supabase**
  - Dashboard → your project → **Authentication** → **Sign In / Providers** → **Apple** → enable.  
  - **Client ID(s)** must include the iOS app’s **bundle ID** so native Sign in with Apple is accepted. Apple puts that value in the ID token as `aud` (for example `com.meald.app`). In the provider form, set **Client IDs** to:  
    - `com.meald.app`  
    or, if you also use a **Services ID** for web/OAuth (e.g. `com.meald.app.service`), use a **comma-separated** list, for example:  
    `com.meald.app,com.meald.app.service`
  - If you see `**Unacceptable audience in id_token: [com.meald.app]`**, the bundle ID is missing from **Client IDs** (or is typo’d). Add `com.meald.app` and save. The **client secret** (`.p8` JWT) is only required for the **OAuth redirect** / Services ID flow, not for verifying a native iOS ID token, but the dashboard may still require it when the provider is enabled; generate it per [Supabase Apple docs](https://supabase.com/docs/guides/auth/social-login/auth-apple) if needed.
3. Rebuild the iOS app after auth changes: `npm run build:mobile` then `npx cap sync` (or `npx cap sync ios`).

For **web** sign-in, Google still uses the browser `redirectTo` (`{origin}/auth`); add that URL under **Authentication** → **URL Configuration** → **Redirect URLs** if you use a custom domain.