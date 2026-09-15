# CLI fallback (if the helper script cannot run)

Repo root = Meald checkout. `FRONTEND=frontend`. `IOS_APP=frontend/ios/App`.

## Production env for Vite

```bash
cd frontend
PROD_API=$(awk -F= '/^VITE_API_BASE_URL=/{print $2; exit}' .env.production)
test "$PROD_API" = "https://api.meald.app/api"

export VITE_API_BASE_URL="$PROD_API"
unset DEV_SERVER_URL
# Highest priority: already-set env wins over .env.local
export VITE_ENABLE_DEV_SETTINGS=

npm run build
npx cap sync ios
```

After sync, `frontend/ios/App/App/capacitor.config.json` must **not** contain a `server.url` (live reload). `frontend/ios/App/App/public` and `frontend/dist` must contain `api.meald.app` and must not contain LAN IPs or `localhost:5173`.

## Bump build

```bash
cd frontend/ios/App
xcrun agvtool next-version -all
xcrun agvtool what-marketing-version
xcrun agvtool what-version
```

## Archive

```bash
cd frontend/ios/App
mkdir -p build
xcodebuild \
  -project App.xcodeproj \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/App.xcarchive \
  CODE_SIGN_STYLE=Automatic \
  DEVELOPMENT_TEAM=BQL348J2DW \
  PROVISIONING_PROFILE_SPECIFIER= \
  -allowProvisioningUpdates \
  archive
```

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

If `method=app-store-connect` is rejected, use `app-store`.

Manual fallback: `signingStyle=manual`, `signingCertificate=Apple Distribution`, and:

```xml
<key>provisioningProfiles</key>
<dict>
  <key>com.meald.app</key>
  <string>PROFILE_NAME</string>
</dict>
```

App Store profiles live in `~/Library/Developer/Xcode/UserData/Provisioning Profiles/` (Xcode 16+) or `~/Library/MobileDevice/Provisioning Profiles/`. Decode with `security cms -D -i FILE`. Match `application-identifier` `BQL348J2DW.com.meald.app`, no `ProvisionedDevices`, no `ProvisionsAllDevices`. Profile must include Sign in with Apple (`com.apple.developer.applesignin`).

## Export then upload

```bash
xcodebuild -exportArchive \
  -archivePath build/App.xcarchive \
  -exportPath build/export \
  -exportOptionsPlist build/ExportOptions.plist \
  -allowProvisioningUpdates
```

Then either:

```bash
# One-shot upload during export: set destination=upload in the plist instead.
```

or:

```bash
xcrun altool --upload-app \
  -f build/export/*.ipa \
  -t ios \
  --apiKey "$APP_STORE_CONNECT_KEY_ID" \
  --apiIssuer "$APP_STORE_CONNECT_ISSUER_ID"
```

`altool` expects `AuthKey_<KEY_ID>.p8` in `~/.appstoreconnect/private_keys/` or `~/.private_keys/`.

## Auth file layout

```
~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8
~/.appstoreconnect/issuer_id          # optional; 36-char UUID
```

Key ID is the 10-character id from App Store Connect → Users and Access → Integrations → App Store Connect API.
