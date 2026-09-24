# Lessons from 2026-09-15 (versionCode 6 / 1.5)

Facts that made the first Play Internal upload slow. The helper encodes them. Do not “simplify” back to a Console browser session.

## Service account JSON, not a desktop OAuth client

Upload uses the Android Publisher API with a **service account** JSON (`"type": "service_account"`). Resolve from:

1. `GOOGLE_APPLICATION_CREDENTIALS` or `PLAY_JSON_KEY_PATH` already in the environment
2. Those keys in repo-root `.env` (gitignored)

Do **not** search `~/Downloads`, home, or agent transcripts for `client_secret_*.apps.googleusercontent.com.json`. That is a desktop OAuth client (`"installed"`). It cannot unattended-upload.

Do not print or commit the JSON.

## Do not browser-upload

Cursor browser CDP cannot attach a local AAB (`DOM.setFileInputFiles` is denied). Fetch-intercept, a local HTTP server, and `DataTransfer` produced a 0-byte / OBB overlay and a disabled **Next**.

What eventually worked that day: the AAB landed in the artifact library, then **Add from library** → **Save and publish**. The API path replaces all of that.

Direct Console URL (reporting only, not an upload method):

`https://play.google.com/console/u/0/developers/7369026141496363714/app/4974352464459431944/tracks/internal-testing`

API track name is `internal`, not the numeric Console track id.

## Build script already signs and checks

`cd frontend && npm run build:play-aab` bumps `versionCode` / `versionName`, strips LAN from `network_security_config.xml`, production Vite + `cap sync`, `bundleRelease`, secrets/LAN checks.

`.env.local` has `VITE_ENABLE_DEV_SETTINGS=1` for laptop/ngrok TestFlight. Vite prefers already-set env. `build-play-aab` must empty that flag and force `VITE_API_BASE_URL=https://api.meald.app/api` so Internal testers hit Fly, not `app_config.dev_api_base_url`.

The Play helper passes `PLAY_LAST_UPLOADED_VERSION_CODE` from `last-upload.md` so gradle is never uploaded at ≤ last Play success. `/build-aab` without that env still does a simple +1.

## versionCode floor

Play already had **6**. Repo gradle can lag or sit one bump ahead (uncommitted). Never upload ≤ `last-upload.md`. JS rebuild is not required when only bumping for a duplicate versionCode; `bundleRelease` is.

## Permissions 403

GCP IAM on the service account is not enough. Play Console → Users and permissions must invite the `…iam.gserviceaccount.com` email on Meald with **View app information** + **Release apps to testing tracks**. Propagation can take minutes after invite.
