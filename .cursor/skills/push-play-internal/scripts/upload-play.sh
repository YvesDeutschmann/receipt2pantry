#!/usr/bin/env bash
# Build a signed Meald AAB and upload it to Play Internal testing.
# Does not promote to production. See ../notes.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR" && git rev-parse --show-toplevel)"
FRONTEND="$REPO_ROOT/frontend"
AAB_PATH="$FRONTEND/android/app/build/outputs/bundle/release/app-release.aab"
GRADLE="$FRONTEND/android/app/build.gradle"
LAST_UPLOAD_FILE="$SCRIPT_DIR/../last-upload.md"
UPLOAD_PY="$SCRIPT_DIR/upload-aab.py"
PACKAGE="com.meald.app"
TRACK="internal"
ENV_FILE="$REPO_ROOT/.env"

log() { printf '\n==> %s\n' "$*"; }
die() { echo "FAIL: $*" >&2; exit 1; }

read_last_uploaded() {
  local n=""
  if [[ -f "$LAST_UPLOAD_FILE" ]]; then
    n="$(awk -F= '/^VERSION_CODE=/{print $2; exit}' "$LAST_UPLOAD_FILE" | tr -d '[:space:]')"
  fi
  [[ "$n" =~ ^[0-9]+$ ]] || n=0
  echo "$n"
}

read_gradle_field() {
  local field="$1"
  python3 - "$GRADLE" "$field" <<'PY'
from pathlib import Path
import re, sys
text = Path(sys.argv[1]).read_text()
field = sys.argv[2]
if field == "versionCode":
    m = re.search(r"versionCode\s+(\d+)", text)
else:
    m = re.search(r'versionName\s+"([^"]+)"', text)
if not m:
    raise SystemExit(f"could not parse {field}")
print(m.group(1))
PY
}

dotenv_get() {
  local key="$1"
  python3 - "$ENV_FILE" "$key" <<'PY'
from pathlib import Path
import sys
path, key = Path(sys.argv[1]), sys.argv[2]
if not path.is_file():
    raise SystemExit(0)
for line in path.read_text().splitlines():
    s = line.strip()
    if s.startswith(key + "="):
        val = s.split("=", 1)[1].strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        print(val)
        break
PY
}

load_credentials() {
  if [[ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]]; then
    local from_env
    from_env="$(dotenv_get GOOGLE_APPLICATION_CREDENTIALS || true)"
    [[ -n "$from_env" ]] && export GOOGLE_APPLICATION_CREDENTIALS="$from_env"
  fi
  if [[ -z "${PLAY_JSON_KEY_PATH:-}" ]]; then
    local from_env
    from_env="$(dotenv_get PLAY_JSON_KEY_PATH || true)"
    [[ -n "$from_env" ]] && export PLAY_JSON_KEY_PATH="$from_env"
  fi
  if [[ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" && -n "${PLAY_JSON_KEY_PATH:-}" ]]; then
    export GOOGLE_APPLICATION_CREDENTIALS="$PLAY_JSON_KEY_PATH"
  fi
  [[ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]] || die \
    "set GOOGLE_APPLICATION_CREDENTIALS or PLAY_JSON_KEY_PATH (env or repo .env) to the Play service account JSON"
  [[ -f "${GOOGLE_APPLICATION_CREDENTIALS}" ]] || die \
    "service account JSON not found (check GOOGLE_APPLICATION_CREDENTIALS)"
}

pick_python() {
  local venv="$REPO_ROOT/.venv/bin/python"
  if [[ -x "$venv" ]] && "$venv" -c "from googleapiclient.discovery import build; from google.oauth2 import service_account" 2>/dev/null; then
    echo "$venv"
    return
  fi
  if python3 -c "from googleapiclient.discovery import build; from google.oauth2 import service_account" 2>/dev/null; then
    echo python3
    return
  fi
  die "need google-api-python-client in .venv or python3 (pip install google-api-python-client google-auth google-auth-httplib2)"
}

write_last_upload() {
  local code="$1"
  local name="$2"
  cat > "$LAST_UPLOAD_FILE" <<EOF
# Last successful Play Internal binary upload.
# The helper will not upload a versionCode ≤ this.
# Update after each successful upload (the script does this).
PACKAGE=$PACKAGE
TRACK=$TRACK
VERSION_CODE=$code
VERSION_NAME=$name
DATE=$(date +%F)
EOF
}

load_credentials
PY="$(pick_python)"
LAST="$(read_last_uploaded)"
log "Play last uploaded versionCode=$LAST (next must be ≥ $((LAST + 1)))"
log "Using service account JSON (path not printed)"

log "Auth check"
"$PY" "$UPLOAD_PY" --auth-check --package "$PACKAGE"

log "npm run build:play-aab"
(
  cd "$FRONTEND"
  PLAY_LAST_UPLOADED_VERSION_CODE="$LAST" npm run build:play-aab
)

[[ -f "$AAB_PATH" ]] || die "AAB not produced at $AAB_PATH"

VERSION_CODE="$(read_gradle_field versionCode)"
VERSION_NAME="$(read_gradle_field versionName)"
[[ "$VERSION_CODE" -gt "$LAST" ]] || die "versionCode $VERSION_CODE is not greater than last uploaded $LAST"

NOTES="${PLAY_RELEASE_NOTES:-Internal testing build ${VERSION_NAME} (${VERSION_CODE}).}"
STATUS="${PLAY_RELEASE_STATUS:-completed}"
[[ "$STATUS" == "completed" || "$STATUS" == "draft" ]] || die "PLAY_RELEASE_STATUS must be completed or draft"

attempt=1
max_attempts=3
upload_status=1
while [[ $attempt -le $max_attempts ]]; do
  log "Uploading versionCode=$VERSION_CODE versionName=$VERSION_NAME (attempt $attempt)"
  set +e
  "$PY" "$UPLOAD_PY" \
    --aab "$AAB_PATH" \
    --package "$PACKAGE" \
    --track "$TRACK" \
    --status "$STATUS" \
    --release-name "${VERSION_NAME} (${VERSION_CODE})" \
    --release-notes "$NOTES"
  upload_status=$?
  set -e

  if [[ $upload_status -eq 0 ]]; then
    break
  fi
  if [[ $upload_status -eq 3 ]]; then
    NEXT="$((VERSION_CODE + 1))"
    log "Play rejected versionCode $VERSION_CODE as already used; bumping to $NEXT and re-bundleRelease (no JS rebuild)"
    python3 - "$GRADLE" "$NEXT" <<'PY'
from pathlib import Path
import re, sys
path = Path(sys.argv[1])
next_code = sys.argv[2]
text = path.read_text()
text, n = re.subn(r"versionCode\s+\d+", f"versionCode {next_code}", text, count=1)
if n != 1:
    raise SystemExit("could not bump versionCode")
path.write_text(text)
PY
    (cd "$FRONTEND/android" && ./gradlew bundleRelease)
    VERSION_CODE="$(read_gradle_field versionCode)"
    VERSION_NAME="$(read_gradle_field versionName)"
    NOTES="${PLAY_RELEASE_NOTES:-Internal testing build ${VERSION_NAME} (${VERSION_CODE}).}"
    attempt=$((attempt + 1))
    continue
  fi
  echo "FAIL: Play upload failed (exit $upload_status)." >&2
  exit "$upload_status"
done

[[ $upload_status -eq 0 ]] || die "upload failed after $max_attempts attempts"
write_last_upload "$VERSION_CODE" "$VERSION_NAME"

cat <<EOF

UPLOAD OK
  app: $PACKAGE
  track: $TRACK
  version: $VERSION_NAME ($VERSION_CODE)
  aab: $AAB_PATH
  status: $STATUS

Internal testers may need up to ~1 hour to see the build.
This script does not promote to production or edit the store listing.

versionCode was bumped in frontend/android/app/build.gradle (uncommitted).
last-upload.md now records versionCode $VERSION_CODE.
EOF
