# CLI fallback (if the helper script cannot run)

Repo root = Meald checkout. `FRONTEND=frontend`. `IOS_APP=frontend/ios/App`.

This Mac: `export DEVELOPER_DIR=/Applications/Xcode26.app/Contents/Developer` (no `/Applications/Xcode.app`; `xcode-select` is CLT). Details: [notes.md](notes.md).

## Production env for Vite

```bash
cd frontend
PROD_API=$(awk -F= '/^VITE_API_BASE_URL=/{print $2; exit}' .env.production)
test "$PROD_API" = "https://api.meald.app/api"

export VITE_API_BASE_URL="$PROD_API"
unset DEV_SERVER_URL DEVELOPER_DIR
# Highest priority: already-set env wins over .env.local (LAN API + Dev Tools)
export VITE_ENABLE_DEV_SETTINGS=

npm run build
find dist -name '*.map' -delete
npx cap sync ios
```

After sync, `frontend/ios/App/App/capacitor.config.json` must **not** contain a `server.url` (live reload). `frontend/dist` JS must contain `api.meald.app`. Grep LAN / `localhost:5173` only in `.js` `.css` `.html` `.json` — **not** `.map` (Sentry example IPs).

## Bump build

Must exceed App Store Connect **and** `last-upload.md` (last success: **14**). `agvtool next-version` from pbxproj `1` is not enough.

```bash
export DEVELOPER_DIR=/Applications/Xcode26.app/Contents/Developer
cd frontend/ios/App
xcrun agvtool new-version -all 15   # or max(pbxproj+1, last-upload+1)
```

Restore `Info.plist` `CFBundleVersion` to `$(CURRENT_PROJECT_VERSION)` if agvtool hardcoded a number. Marketing version is `1.0` in the pbxproj, not `agvtool what-marketing-version` (`$(MARKETING_VERSION)`).

## Archive (do not use command-line Automatic)

Command-line `CODE_SIGN_STYLE=Automatic` and `PROVISIONING_PROFILE_SPECIFIER=` fail on this project (signing conflict + SPM profile leak). `CODE_SIGN_IDENTITY[sdk=iphoneos*]=…` is parsed wrong.

1. Copy `App.xcodeproj/project.pbxproj`.
2. In **both** App target configs (Debug and Release) only:
   - `"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "Apple Development";`
   - `CODE_SIGN_STYLE = Automatic;`
   - `"PROVISIONING_PROFILE_SPECIFIER[sdk=iphoneos*]" = "";`
3. Archive **without** those keys on the CLI:

```bash
export DEVELOPER_DIR=/Applications/Xcode26.app/Contents/Developer
cd frontend/ios/App
mkdir -p build
xcodebuild \
  -project App.xcodeproj \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/App.xcarchive \
  DEVELOPMENT_TEAM=BQL348J2DW \
  -allowProvisioningUpdates \
  archive
```

4. Restore the pbxproj copy (keeps the version bump, puts Manual signing back).

Add `-authenticationKeyPath` / `-authenticationKeyID` / `-authenticationKeyIssuerID` when using a `.p8`.

Confirm scheme with `xcodebuild -project App.xcodeproj -list` if `App` is missing (user-local scheme).

## ExportOptions.plist

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>destination</key>
  <string>export</string>
  <key>teamID</key>
  <string>BQL348J2DW</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>uploadSymbols</key>
  <true/>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
</dict>
</plist>
```

If `method=app-store-connect` is rejected, use `app-store`. Keep `signingStyle=automatic`.

Do **not** manual-export `iOS Team Store Provisioning Profile: com.meald.app` (Xcode-managed; export rejects it).

App Store profiles live in `~/Library/Developer/Xcode/UserData/Provisioning Profiles/` (Xcode 16+) or `~/Library/MobileDevice/Provisioning Profiles/`. Decode with `security cms -D -i FILE`. Match `application-identifier` `BQL348J2DW.com.meald.app`, no `ProvisionedDevices`, no `ProvisionsAllDevices`. Profile must include Sign in with Apple (`com.apple.developer.applesignin`).

## Export then upload

```bash
xcodebuild -exportArchive \
  -archivePath build/App.xcarchive \
  -exportPath build/export \
  -exportOptionsPlist build/ExportOptions.plist \
  -allowProvisioningUpdates
```

Then set `destination` to `upload` in the plist and run `exportArchive` again (Xcode Apple ID; this is what worked without a `.p8`).

If a `.p8` is present:

```bash
xcrun altool --upload-app \
  -f build/export/*.ipa \
  -t ios \
  --apiKey "$APP_STORE_CONNECT_KEY_ID" \
  --apiIssuer "$APP_STORE_CONNECT_ISSUER_ID"
```

`altool` expects `AuthKey_<KEY_ID>.p8` in `~/.appstoreconnect/private_keys/` or `~/.private_keys/`.

If Apple says the bundle version must be higher than `N`, set `CURRENT_PROJECT_VERSION` to `N+1`, restore Info.plist variable, re-archive + export + upload. No JS rebuild.

## Auth file layout

```
~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8
~/.appstoreconnect/issuer_id          # optional; 36-char UUID
```

Key ID is the 10-character id from App Store Connect → Users and Access → Integrations → App Store Connect API. **Not installed on this Mac** as of 2026-09-15.
