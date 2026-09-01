# Build Play AAB

Build a signed Android App Bundle for Google Play Internal testing.

## Do this

1. From the repo root, run:

```bash
cd frontend && npm run build:play-aab
```

2. Wait for the command to finish. It will:
   - Bump `versionCode` and `versionName` in `frontend/android/app/build.gradle`
   - Strip any LAN IP from `network_security_config.xml`
   - Build the web bundle, sync Capacitor, and run `./gradlew bundleRelease`
   - Fail if `rg "sk-|eyJhbGciOiJIUzI1NiI|SUPABASE_SERVICE_ROLE|SERVICE_ROLE" dist/assets/` finds hits (excluding `*.map`)
   - Fail if the AAB or source XML still contains a non-emulator LAN IP

3. On success, report:
   - AAB path: `frontend/android/app/build/outputs/bundle/release/app-release.aab`
   - New `versionCode` / `versionName`
   - That pre-upload checks passed

4. Do **not** commit, push, or upload to Play Console unless the user explicitly asks.

## If it fails

Show the failing check or Gradle error and stop. Do not invent a workaround that skips version bump or the secrets/LAN checks.
