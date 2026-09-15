---
name: push-app-store-connect
description: Archives Meald iOS and uploads the IPA to App Store Connect / TestFlight. Always runs npm build and cap sync first so the latest web bundle is shipped. Use when this skill is explicitly attached or named, or the user asks to put a build in App Store Connect.
disable-model-invocation: true
---

# Push App Store Connect

Puts a build in App Store Connect. Include npm build and cap sync just to be sure the Latest version gets pushed.

Upload the binary only. Do **not** submit for App Review. Do **not** open the Xcode GUI.

## Hard rules

- Every run starts with `npm run build` then `npx cap sync ios`. Do not skip, cache, or reuse a previous `dist` unless a later step failed after those two already succeeded **in this same run**.
- Never use `npm run build:mobile`, `npm run cap:sync`, `npm run cap:dev`, or `npx cap open ios`. Those inject LAN URLs or live-reload.
- Force production API: `VITE_API_BASE_URL` from `frontend/.env.production` (must be `https://api.meald.app/api`). Unset `DEV_SERVER_URL`. Do not ship `VITE_ENABLE_DEV_SETTINGS=1` unless the user explicitly asked for a TestFlight debug build.
- Shell needs `required_permissions: ["all"]` (Keychain, signing, DerivedData, upload).
- Do not print, commit, or copy `.p8` / API key contents.
- Do not bump `MARKETING_VERSION` unless asked. Do bump `CURRENT_PROJECT_VERSION` so Apple accepts the build.
- Leave the version bump uncommitted unless the user asks to commit.
- macOS + full Xcode only (`xcode-select -p` must be under `/Applications/Xcode.app`).

## Constants

| Item | Value |
|------|--------|
| Bundle ID | `com.meald.app` |
| Team | `BQL348J2DW` |
| Xcode project | `frontend/ios/App/App.xcodeproj` |
| Scheme / target | `App` |
| Marketing version | `1.0` (do not change by default) |

Release in `project.pbxproj` is **Manual** + profile `Meald Development`. That is a development profile name. Archive/export with **Automatic** signing + team `BQL348J2DW` and `-allowProvisioningUpdates` so export can pick an App Store profile. Do not permanently rewrite signing in the pbxproj.

## Do this

Copy and track:

```
Task Progress:
- [ ] Preflight
- [ ] npm run build (production env)
- [ ] npx cap sync ios
- [ ] Verify bundled web is prod (no live-reload / LAN)
- [ ] Bump CURRENT_PROJECT_VERSION
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
3. Xcode’s signed-in Apple ID (`-allowProvisioningUpdates` only)

If upload wants an interactive 2FA prompt, stop. Ask the user for a `.p8` key; do not type an Apple password into the terminal.

## If it fails

- **Signing / profile**: retry export with the App Store profile for `com.meald.app` (see reference). Do not switch to a simulator destination.
- **Duplicate build number**: bump `CURRENT_PROJECT_VERSION` again and re-archive/upload. JS rebuild is not required for that retry.
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

Do not open Xcode. Do not upload Android. Do not change App Store listing metadata.
