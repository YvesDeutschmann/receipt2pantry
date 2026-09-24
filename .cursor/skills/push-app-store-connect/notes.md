# Lessons from 2026-09-15 (1.0 build 14)

Facts that made the first helper run fail. The script now encodes them; do not “simplify” back to the naive `xcodebuild CODE_SIGN_STYLE=Automatic` line.

## Xcode is not `/Applications/Xcode.app`

This Mac has versioned apps, not the default name:

| Path | Version (2026-09-15) |
|------|----------------------|
| `/Applications/Xcode26.app` | 26.1.1 (17B100) — **use this** |
| `/Applications/Xcode16.app` | 16.4 (16F6) |
| `/Applications/Xcode.app` | **missing** |

`xcode-select -p` is `/Library/Developer/CommandLineTools`. Do **not** stop and ask for `sudo xcode-select`. Export:

```bash
export DEVELOPER_DIR=/Applications/Xcode26.app/Contents/Developer
```

Pick the newest `/Applications/Xcode*.app` if 26 is gone. Unset `DEVELOPER_DIR` around `npm` / `npx` (`Unknown env config "devdir"`).

## No App Store Connect `.p8` on disk

There is no `~/.appstoreconnect/private_keys/AuthKey_*.p8` and no `APP_STORE_CONNECT_*` env. Upload via `xcodebuild -exportArchive` with ExportOptions `destination=upload` and `signingStyle=automatic` using the signed-in Xcode Apple ID. That worked without a 2FA prompt this time.

If a 2FA prompt appears, stop and ask for a `.p8`. Do not type an Apple password into the terminal.

`altool --apiKey` is unused until a key exists.

## `.env.local` is LAN; production env must win

`frontend/.env.local` has a LAN `VITE_API_BASE_URL` and `VITE_ENABLE_DEV_SETTINGS`. Vite prefers already-set env over `.env.local`. Always:

```bash
env -u DEV_SERVER_URL -u DEVELOPER_DIR \
  VITE_API_BASE_URL=https://api.meald.app/api \
  VITE_ENABLE_DEV_SETTINGS= \
  npm run build
```

Same for `npx cap sync ios`. Never `build:mobile` / `cap:dev`.

Production web bundles also ignore Capacitor-stored ngrok/LAN API overrides unless `VITE_ENABLE_DEV_SETTINGS=1`. Testers do not need to delete the app after a production TestFlight once that JS is in the binary.

## Source maps look like LAN IPs (false positive)

`frontend/vite.config.js` uses `build.sourcemap: 'hidden'`. The **JS** bundle contains `api.meald.app` and no LAN/localhost. The **`.map` files** contain Sentry/OTel *example* IPs (`192.168.0.1`, `192.168.1.1`, `10.1.2.80`).

A recursive grep of `dist/assets` fails. Delete `*.map` before `cap sync` (they are not needed at runtime). Grep LAN only in `.js` / `.css` / `.html` / `.json`, never `.map`.

## pbxproj signing vs Automatic archive

Checked-in Release/Debug **App target**:

- `CODE_SIGN_STYLE = Manual`
- `CODE_SIGN_IDENTITY[sdk=iphoneos*] = iPhone Distribution`
- `PROVISIONING_PROFILE_SPECIFIER[sdk=iphoneos*] = Meald Development`

`Meald Development` is a **distribution-style** profile (no devices, `get-task-allow=false`) despite the name.

Passing Automatic on the **xcodebuild command line** fails:

1. `App has conflicting provisioning settings` (Automatic vs `iPhone Distribution`).
2. `KEY[sdk=iphoneos*]=value` is parsed as `KEY = iphoneos*]=value` (zsh *and* xcodebuild). Never pass sdk-specific keys as CLI settings.
3. Global `PROVISIONING_PROFILE_SPECIFIER=` leaks into SPM targets (GoogleSignIn, AppAuth, …).

**Working archive:** copy `project.pbxproj`, rewrite **only the App target** (both Debug and Release) to Automatic + `Apple Development` + empty specifier, archive with **only** `DEVELOPMENT_TEAM=BQL348J2DW` and `-allowProvisioningUpdates`, restore the copy. Do not leave Automatic in git.

Archive signs with `Apple Development` + `iOS Team Provisioning Profile: com.meald.app`. Export (`method=app-store-connect`, `signingStyle=automatic`) re-signs for the store.

Do **not** export `signingStyle=manual` with `iOS Team Store Provisioning Profile: com.meald.app` — it is Xcode-managed and export rejects it.

Keychain has `Apple Distribution: Yves Deutschmann (BQL348J2DW)`.

## Build numbers: repo was stale

Apple already had CFBundleVersion **13**. Repo `CURRENT_PROJECT_VERSION` was **1**. `agvtool next-version` → 2, which App Store Connect rejected:

```
The bundle version must be higher than the previously uploaded version: ‘13’
```

Successful upload: **1.0 (14)**. Next build must be **≥ 15**. See `last-upload.md`.

`agvtool new-version -all N` hardcodes `Info.plist` `CFBundleVersion` to `N`. Put `$(CURRENT_PROJECT_VERSION)` back. `agvtool what-marketing-version -terse1` prints `$(MARKETING_VERSION)` — read `MARKETING_VERSION` from the pbxproj (`1.0`).

JS rebuild is not required when only bumping for a duplicate / too-low build.

## Export / upload that worked

1. Export: `method=app-store-connect`, `destination=export`, `signingStyle=automatic`.
2. Upload: same plist with `destination=upload` (Xcode Apple ID). IPA also at `frontend/ios/App/build/export/App.ipa`.

Noisy but ignorable: `IDERunDestination: Supported platforms for the buildables in the current scheme is empty.`

## Do not

- `sudo xcode-select` as a hard requirement
- Open the Xcode GUI
- Submit for App Review
- Permanently rewrite signing in `project.pbxproj`
- Commit the build bump unless asked
- Trust a grep of `dist/assets` that includes `.map`
