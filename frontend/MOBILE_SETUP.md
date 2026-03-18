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

To use the Vite dev server with hot reload on your phone:

1. Get your PC's local IP (e.g. `192.168.50.30`).
2. In `capacitor.config.ts`, set:
   ```ts
   server: {
     url: 'http://YOUR_IP:5173',
     cleartext: true,
     androidScheme: 'https',
   },
   ```
3. Run `npm run dev` in one terminal (Vite is configured with `host: true` so it's reachable on your network).
4. Run `npx cap sync` then `npx cap run android` (or open in Android Studio and run).

Remember to revert the `server.url` when building for production.

**If you get `net::ERR_CLEARTEXT_NOT_PERMITTED`:** Android blocks HTTP by default. Add your dev machine's IP to `android/app/src/main/res/xml/network_security_config.xml` in the `domain-config` section (e.g. `<domain includeSubdomains="true">192.168.50.30</domain>`). If your IP changes, update both `capacitor.config.ts` and this file.
