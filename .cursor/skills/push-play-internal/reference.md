# CLI fallback (if the helper script cannot run)

Repo root = Meald checkout. Still run `npm run build:play-aab` first. Still do not browser-upload.

## Auth

JSON must be `"type": "service_account"`. Do not print it.

```bash
# already exported, or in repo .env:
# GOOGLE_APPLICATION_CREDENTIALS=/path/to/play-service-account.json
python3 -c 'import json,os; p=os.environ["GOOGLE_APPLICATION_CREDENTIALS"]; print(json.load(open(p))["type"])'
```

Expect `service_account`.

## Build

```bash
cd frontend
# build-play-aab forces api.meald.app and empty VITE_ENABLE_DEV_SETTINGS
PLAY_LAST_UPLOADED_VERSION_CODE=6 npm run build:play-aab
```

AAB: `frontend/android/app/build/outputs/bundle/release/app-release.aab`

If this run already built after that env was set, skip the JS rebuild and only re-`bundleRelease` for a versionCode retry.

## Upload

```bash
.venv/bin/python .cursor/skills/push-play-internal/scripts/upload-aab.py \
  --aab frontend/android/app/build/outputs/bundle/release/app-release.aab \
  --package com.meald.app \
  --track internal \
  --status completed
```

`--auth-check` inserts and deletes an empty edit (no AAB).

## Duplicate versionCode

Play: version code already used. Set gradle `versionCode` above the number in the error (and above `last-upload.md`), `./gradlew bundleRelease`, upload again. Do not skip signing or the LAN/secrets checks on a full rebuild.

## 403

User must confirm the service account email is invited on Meald with testing-track release rights. Stop. Do not fall back to Play Console in the browser.
