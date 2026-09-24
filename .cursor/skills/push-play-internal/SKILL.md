---
name: push-play-internal
description: Builds a signed Meald Android App Bundle and uploads it to Google Play Internal testing via the Android Publisher API. Always runs npm run build:play-aab first so the latest web bundle is shipped. Use when this skill is explicitly attached or named, or the user asks to put a build on Play Internal / Play Console / TestFlight-for-Android.
disable-model-invocation: true
---

# Push Play Internal

Puts a signed AAB on the Play **Internal testing** track. Include `npm run build:play-aab` so the latest web bundle is shipped.

Upload the binary only. Do **not** promote to production, closed, or open testing. Do **not** open Play Console in the browser.

Read [notes.md](notes.md) before changing the helper. The 2026-09-15 upload was a browser file-picker fight; the API path replaces that.

## Hard rules

- Every run starts with `cd frontend && npm run build:play-aab` (the helper sets `PLAY_LAST_UPLOADED_VERSION_CODE` from `last-upload.md`). Do not skip, cache, or reuse a previous AAB unless a later step failed after that build **in this same run**.
- Never use `npm run build:mobile`, `npm run cap:dev`, or `apply-android-lan-env`. Those inject LAN URLs.
- Force production API: `build:play-aab` sets `VITE_API_BASE_URL` from `frontend/.env.production` (`https://api.meald.app/api`) and empties `VITE_ENABLE_DEV_SETTINGS` so `.env.local` cannot enable ngrok/Dev Tools. Do not export `VITE_ENABLE_DEV_SETTINGS=1` around that build.
- Never browser-upload. Never CDP `DOM.setFileInputFiles`, fetch-intercept, or a local HTTP server for the AAB. Never search Downloads / home for `client_secret_*.json`.
- Auth is a **service account** JSON only (`GOOGLE_APPLICATION_CREDENTIALS` or `PLAY_JSON_KEY_PATH`, including repo `.env`). Desktop OAuth clients are the wrong type.
- Shell needs `required_permissions: ["all"]` (keystore, JSON key outside the repo, Gradle, network).
- Do not print, commit, or copy the service account JSON.
- Never upload a `versionCode` ≤ `last-upload.md`. Leave the gradle bump uncommitted unless the user asks to commit.
- Do not upload iOS. Do not change Play listing metadata.

## Constants

| Item | Value |
|------|--------|
| Package | `com.meald.app` |
| Track | `internal` (API name) |
| AAB | `frontend/android/app/build/outputs/bundle/release/app-release.aab` |
| Last uploaded | **6** / **1.5** (2026-09-15) — next must be ≥ **7** (`last-upload.md`) |
| Console (report only) | [Internal testing](https://play.google.com/console/u/0/developers/7369026141496363714/app/4974352464459431944/tracks/internal-testing) |

## Do this

Copy and track:

```
Task Progress:
- [ ] Preflight (service account JSON, not OAuth client)
- [ ] npm run build:play-aab (PLAY_LAST_UPLOADED_VERSION_CODE from last-upload.md)
- [ ] Upload AAB to Internal via Android Publisher API
- [ ] Report
```

Run the helper (from repo root). It performs every step above:

```bash
bash .cursor/skills/push-play-internal/scripts/upload-play.sh
```

Build + upload can take several minutes. Wait on that process; do not background and forget it.

If the script is missing or you must run by hand, follow [reference.md](reference.md). Still do not skip `npm run build:play-aab`. Still do not browser-upload.

## Auth

Resolve in this order (do not hunt elsewhere):

1. `GOOGLE_APPLICATION_CREDENTIALS` or `PLAY_JSON_KEY_PATH` already exported
2. Those keys in repo-root `.env`

JSON `"type"` must be `service_account`. If the file is missing or is an `"installed"` OAuth client, stop and ask the user. If upload wants a browser consent screen, stop.

## If it fails

- **403 / caller does not have permission**: Play Console invite or testing-track rights missing, or not propagated. Stop. Do not browser-upload as a workaround.
- **Duplicate / too-low versionCode**: bump above the number in the error (and above `last-upload.md`) and re-`bundleRelease` / upload. JS rebuild is not required for that retry.
- **LAN IP / secrets check**: do not skip those checks. Source maps with example IPs are already excluded by `build-play-aab`.
- Show the real Android Publisher / Gradle error. Do not invent a Console UI workaround.

## Done when

Report:

- `versionCode` / `versionName` uploaded to Internal
- That testers may need up to ~1 hour to see it
- AAB path
- That production / store listing was **not** changed
- That the `build.gradle` bump is uncommitted (unless they asked to commit)

Update `last-upload.md` after a successful upload (the helper does this).
