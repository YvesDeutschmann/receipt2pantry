---
name: push-app-store-connect
description: Archives Meald iOS and uploads the IPA to App Store Connect / TestFlight. Always runs npm build and cap sync first so the latest web bundle is shipped. Use when this skill is explicitly attached or named, or the user asks to put a build in App Store Connect.
disable-model-invocation: true
---

# Push App Store Connect

Puts a build in App Store Connect. Include npm build and cap sync just to be sure the Latest version gets pushed.

Upload the binary only. Do **not** submit for App Review. Do **not** open the Xcode GUI.

Read [notes.md](notes.md) before changing the helper. The 2026-09-15 upload failed until those steps were used.

## Hard rules

- Every run starts with `npm run build` then `npx cap sync ios`. Do not skip, cache, or reuse a previous `dist` unless a later step failed after those two already succeeded **in this same run**.
- Never use `npm run build:mobile`, `npm run cap:sync`, `npm run cap:dev`, or `npx cap open ios`. Those inject LAN URLs or live-reload.
- Force production API: `VITE_API_BASE_URL` from `frontend/.env.production` (must be `https://api.meald.app/api`). Unset `DEV_SERVER_URL` and `DEVELOPER_DIR` around npm. Empty `VITE_ENABLE_DEV_SETTINGS` so `.env.local` cannot enable Dev Tools. Production JS ignores stored ngrok/LAN API prefs unless that flag is on.
- Shell needs `required_permissions: ["all"]` (Keychain, signing, DerivedData, upload).
- Do not print, commit, or copy `.p8` / API key contents.
- Do not bump `MARKETING_VERSION` unless asked. Do bump `CURRENT_PROJECT_VERSION` so Apple accepts the build. Local pbxproj can lag App Store Connect — never upload a number ≤ `last-upload.md`.
- Leave the version bump uncommitted unless the user asks to commit.
- Full Xcode under `/Applications/Xcode*.app`. This Mac has **no** `/Applications/Xcode.app`. `xcode-select` is Command Line Tools. Set `DEVELOPER_DIR` to the newest Xcode app (prefer `Xcode26.app`). Do not require `sudo xcode-select`.

## Constants

| Item | Value |
|------|--------|
| Bundle ID | `com.meald.app` |
| Team | `BQL348J2DW` |
| Xcode project | `frontend/ios/App/App.xcodeproj` |
| Scheme / target | `App` |
| Marketing version | `1.0` (do not change by default) |
| Last uploaded build | **14** (2026-09-15) — next must be ≥ **15** (`last-upload.md`) |
| Xcode to use | `/Applications/Xcode26.app` (26.1.1) |

Release in `project.pbxproj` is **Manual** + `iPhone Distribution` + profile `Meald Development`. Do **not** pass `CODE_SIGN_STYLE=Automatic` or `PROVISIONING_PROFILE_SPECIFIER=` on the xcodebuild command line (conflicts + SPM leak). The helper temporarily rewrites **only the App target** to Automatic, archives, then restores the pbxproj. Do not permanently rewrite signing.

## Do this

Copy and track:

```
Task Progress:
- [ ] Preflight
- [ ] npm run build (production env)
- [ ] npx cap sync ios
- [ ] Verify bundled web is prod (no live-reload / LAN in js/css/html/json)
- [ ] Bump CURRENT_PROJECT_VERSION (> last-upload.md)
- [ ] Archive + upload
- [ ] Report
```

Run the helper (from repo root). It performs every step above:

```bash
bash .cursor/skills/push-app-store-connect/scripts/upload-ios.sh
```

Archive/upload can take 5–15 minutes. Wait on that process; do not background and forget it.

If the script is missing or you must run by hand, follow [reference.md](reference.md). Still do not skip `npm run build` or `npx cap sync ios`.

## Auth

Prefer an App Store Connect API key (Admin/Developer, App Manager). Resolve in this order:

1. `APP_STORE_CONNECT_KEY_PATH` + `APP_STORE_CONNECT_KEY_ID` + `APP_STORE_CONNECT_ISSUER_ID`
2. `~/.appstoreconnect/private_keys/AuthKey_*.p8` (exactly one) + issuer env / `~/.appstoreconnect/issuer_id`
3. Xcode’s signed-in Apple ID (`destination=upload` + `-allowProvisioningUpdates`). There is **no `.p8` on this Mac** as of 2026-09-15; this path worked.

If upload wants an interactive 2FA prompt, stop. Ask the user for a `.p8` key; do not type an Apple password into the terminal.

## If it fails

- **Signing / profile**: see [notes.md](notes.md). Temporary App-target Automatic patch, then restore. Do not switch to a simulator destination. Do not manual-export the Xcode-managed Team Store profile.
- **Duplicate / too-low build**: Apple’s last version was **13** before 14 landed. Bump `CURRENT_PROJECT_VERSION` above the number in the error (and above `last-upload.md`) and re-archive/upload. JS rebuild is not required for that retry.
- **LAN IP in dist**: almost certainly hidden source maps (Sentry example IPs). Strip `*.map`; do not treat that as a live-reload bake-in unless `.js` itself has a LAN URL.
- **`CONTRACT_NOT_VALID` / 403**: user must accept Apple agreements in App Store Connect. Stop.
- **No distribution identity**: user must install an Apple Distribution cert in Keychain. Stop.
- Show the real `xcodebuild` / `altool` error. Do not invent a workaround that skips build, sync, or signing.

## Done when

Report:

- Marketing version + build number uploaded
- That App Store Connect processing can take several minutes (TestFlight)
- Paths: archive / IPA if exported
- That review was **not** submitted
- That the pbxproj build bump is uncommitted (unless they asked to commit)

Update `last-upload.md` after a successful upload (the helper does this).

Do not open Xcode. Do not upload Android. Do not change App Store listing metadata.
