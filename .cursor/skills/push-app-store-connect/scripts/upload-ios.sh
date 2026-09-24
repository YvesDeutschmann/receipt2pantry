#!/usr/bin/env bash
# Archive Meald iOS and upload the IPA to App Store Connect (TestFlight).
# Does not submit for App Review.
# See ../notes.md for why signing/Xcode/maps/build-number work this way.
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "FAIL: iOS upload requires macOS with Xcode." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR" && git rev-parse --show-toplevel)"
FRONTEND="$REPO_ROOT/frontend"
IOS_APP="$FRONTEND/ios/App"
PROJECT="$IOS_APP/App.xcodeproj"
PBXPROJ="$PROJECT/project.pbxproj"
INFO_PLIST="$IOS_APP/App/Info.plist"
BUILD_DIR="$IOS_APP/build"
ARCHIVE_PATH="$BUILD_DIR/App.xcarchive"
EXPORT_DIR="$BUILD_DIR/export"
EXPORT_PLIST="$BUILD_DIR/ExportOptions.plist"
PBXPROJ_BACKUP="$BUILD_DIR/project.pbxproj.pre-archive.bak"
LAST_UPLOAD_FILE="$SCRIPT_DIR/../last-upload.md"
TEAM_ID="BQL348J2DW"
BUNDLE_ID="com.meald.app"
SCHEME="App"
EXPECTED_API="https://api.meald.app/api"
SIGNING_PATCHED=0
CLEAN_KEY_LINK=""
AUTH_FLAGS=()
MARKETING="1.0"
BUILD_NUM=""

mkdir -p "$BUILD_DIR" "$EXPORT_DIR"

log() { printf '\n==> %s\n' "$*"; }
die() { echo "FAIL: $*" >&2; exit 1; }

restore_signing() {
  if [[ "$SIGNING_PATCHED" -eq 1 && -f "$PBXPROJ_BACKUP" ]]; then
    cp "$PBXPROJ_BACKUP" "$PBXPROJ"
    SIGNING_PATCHED=0
    log "Restored pbxproj signing (Manual / Meald Development)"
  fi
}

cleanup() {
  restore_signing
  if [[ -n "${CLEAN_KEY_LINK:-}" && -L "$CLEAN_KEY_LINK" ]]; then
    rm -f "$CLEAN_KEY_LINK"
  fi
}
trap cleanup EXIT

select_xcode() {
  local active newest
  active="$(xcode-select -p 2>/dev/null || true)"
  if [[ "$active" == /Applications/Xcode*.app/Contents/Developer ]]; then
    export DEVELOPER_DIR="$active"
  else
    newest="$(python3 - <<'PY'
from pathlib import Path
import plistlib

def ver(app: Path):
    plist = app / "Contents/Info.plist"
    try:
        data = plistlib.loads(plist.read_bytes())
    except Exception:
        return (0, 0, 0)
    short = str(data.get("CFBundleShortVersionString") or "0")
    nums = []
    for part in short.split("."):
        try:
            nums.append(int("".join(c for c in part if c.isdigit()) or "0"))
        except ValueError:
            nums.append(0)
    while len(nums) < 3:
        nums.append(0)
    return tuple(nums[:3])

cands = [p for p in Path("/Applications").glob("Xcode*.app") if (p / "Contents/Developer").is_dir()]
if not cands:
    raise SystemExit(1)
best = max(cands, key=ver)
print(best / "Contents/Developer")
PY
    )" || die "full Xcode required under /Applications/Xcode*.app (this Mac has no /Applications/Xcode.app)"
    export DEVELOPER_DIR="$newest"
    log "xcode-select is ${active:-empty}; using $DEVELOPER_DIR"
  fi
  [[ -x "$DEVELOPER_DIR/usr/bin/xcodebuild" ]] || die "xcodebuild missing in $DEVELOPER_DIR"
  log "Xcode $($DEVELOPER_DIR/usr/bin/xcodebuild -version | tr '\n' ' ')"
}

read_prod_api() {
  local url
  url="$(awk -F= '/^VITE_API_BASE_URL=/{print $2; exit}' "$FRONTEND/.env.production" | tr -d '[:space:]')"
  [[ -n "$url" ]] || die "VITE_API_BASE_URL missing from frontend/.env.production"
  echo "$url"
}

require_prod_api() {
  local url="$1"
  [[ "$url" == "$EXPECTED_API" ]] || die "expected VITE_API_BASE_URL=$EXPECTED_API, got $url"
}

# Env already set wins over .env.local in Vite.
# Unset DEVELOPER_DIR so npm does not warn about config "devdir".
production_env() {
  env -u DEV_SERVER_URL -u DEVELOPER_DIR \
    VITE_API_BASE_URL="$PROD_API" \
    VITE_ENABLE_DEV_SETTINGS= \
    "$@"
}

strip_js_maps() {
  find "$FRONTEND/dist" -name '*.map' -delete 2>/dev/null || true
}

verify_web_bundle() {
  python3 - "$FRONTEND/dist" "$IOS_APP/App/public" "$IOS_APP/App/capacitor.config.json" <<'PY' || die "web bundle is not a production App Store build"
import json, re, sys
from pathlib import Path

dist, public, cap = map(Path, sys.argv[1:4])
if not dist.is_dir():
    sys.exit("dist missing")
text_ext = {".js", ".css", ".html", ".json"}
lan = re.compile(r"192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|localhost:5173|127\.0\.0\.1:5173")
joined = []
for folder in (dist, public):
    if not folder.exists():
        continue
    for p in folder.rglob("*"):
        if p.suffix.lower() in text_ext and p.is_file():
            t = p.read_text(errors="ignore")
            joined.append(t)
            if lan.search(t):
                sys.exit(f"LAN/dev URL in {p}")
if "api.meald.app" not in "\n".join(joined):
    sys.exit("api.meald.app missing from js/css/html/json")
if cap.is_file():
    data = json.loads(cap.read_text())
    if (data.get("server") or {}).get("url"):
        sys.exit("capacitor.config.json has server.url")
print("verify ok: prod API, no live-reload, no LAN in js/css/html/json")
PY
}

read_last_uploaded_build() {
  local n=0
  if [[ -f "$LAST_UPLOAD_FILE" ]]; then
    n="$(awk -F= '/^BUILD=/{print $2; exit}' "$LAST_UPLOAD_FILE" | tr -d '[:space:]')"
  fi
  [[ "$n" =~ ^[0-9]+$ ]] || n=0
  echo "$n"
}

read_pbx_build() {
  python3 - "$PBXPROJ" <<'PY'
import re, sys
text = open(sys.argv[1]).read()
nums = [int(x) for x in re.findall(r"CURRENT_PROJECT_VERSION = (\d+);", text)]
print(max(nums) if nums else 0)
PY
}

read_pbx_marketing() {
  python3 - "$PBXPROJ" <<'PY'
import re, sys
text = open(sys.argv[1]).read()
m = re.search(r"MARKETING_VERSION = ([^;]+);", text)
print((m.group(1).strip() if m else "1.0").strip('"'))
PY
}

restore_info_plist_version_var() {
  python3 - "$INFO_PLIST" <<'PY'
import re, sys
from pathlib import Path
p = Path(sys.argv[1])
text = p.read_text()
new, n = re.subn(
    r"(<key>CFBundleVersion</key>\s*<string>)[^<]+(</string>)",
    r"\1$(CURRENT_PROJECT_VERSION)\2",
    text,
    count=1,
)
if n:
    p.write_text(new)
PY
}

write_last_upload() {
  cat > "$LAST_UPLOAD_FILE" <<EOF
# Last successful App Store Connect binary upload.
# The helper reads BUILD and will not upload a number ≤ this.
# Update after each successful upload (the script does this).
MARKETING=$MARKETING
BUILD=$BUILD_NUM
DATE=$(date +%F)
EOF
}

set_build_number() {
  local n="$1"
  log "Setting CURRENT_PROJECT_VERSION=$n"
  (cd "$IOS_APP" && xcrun agvtool new-version -all "$n" >/dev/null)
  restore_info_plist_version_var
  BUILD_NUM="$(read_pbx_build)"
  MARKETING="$(read_pbx_marketing)"
  log "Version $MARKETING ($BUILD_NUM)"
}

bump_build() {
  local current last next
  current="$(read_pbx_build)"
  last="$(read_last_uploaded_build)"
  next="$(( (current > last ? current : last) + 1 ))"
  log "Build floor: pbxproj=$current last-upload=$last → $next"
  set_build_number "$next"
}

patch_app_signing_automatic() {
  cp "$PBXPROJ" "$PBXPROJ_BACKUP"
  python3 - "$PBXPROJ" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
text = p.read_text()
old = '''\t\t\t\t"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "iPhone Distribution";
\t\t\t\tCODE_SIGN_STYLE = Manual;'''
new = '''\t\t\t\t"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "Apple Development";
\t\t\t\tCODE_SIGN_STYLE = Automatic;'''
if text.count(old) != 2:
    raise SystemExit(f"unexpected CODE_SIGN_STYLE/identity count {text.count(old)} (want 2)")
text = text.replace(old, new)
oldp = '''\t\t\t\t"PROVISIONING_PROFILE_SPECIFIER[sdk=iphoneos*]" = "Meald Development";'''
newp = '''\t\t\t\t"PROVISIONING_PROFILE_SPECIFIER[sdk=iphoneos*]" = "";'''
if text.count(oldp) != 2:
    raise SystemExit(f"unexpected profile specifier count {text.count(oldp)} (want 2)")
p.write_text(text.replace(oldp, newp))
PY
  SIGNING_PATCHED=1
  log "Temporarily set App target signing to Automatic (pbxproj will be restored)"
}

resolve_auth() {
  AUTH_KEY_PATH="${APP_STORE_CONNECT_KEY_PATH:-${ASC_API_KEY_PATH:-}}"
  AUTH_KEY_ID="${APP_STORE_CONNECT_KEY_ID:-${ASC_KEY_ID:-}}"
  AUTH_ISSUER="${APP_STORE_CONNECT_ISSUER_ID:-${ASC_ISSUER_ID:-}}"

  if [[ -z "$AUTH_ISSUER" && -f "$HOME/.appstoreconnect/issuer_id" ]]; then
    AUTH_ISSUER="$(tr -d '[:space:]' < "$HOME/.appstoreconnect/issuer_id")"
  fi

  if [[ -z "$AUTH_KEY_PATH" ]]; then
    local keys=()
    if [[ -d "$HOME/.appstoreconnect/private_keys" ]]; then
      while IFS= read -r f; do keys+=("$f"); done < <(find "$HOME/.appstoreconnect/private_keys" -maxdepth 1 -name 'AuthKey_*.p8' -type f | sort)
    fi
    if [[ ${#keys[@]} -eq 1 ]]; then
      AUTH_KEY_PATH="${keys[0]}"
    elif [[ ${#keys[@]} -gt 1 ]]; then
      die "multiple AuthKey_*.p8 files; set APP_STORE_CONNECT_KEY_PATH and APP_STORE_CONNECT_KEY_ID"
    fi
  fi

  if [[ -n "$AUTH_KEY_PATH" && -z "$AUTH_KEY_ID" ]]; then
    local base
    base="$(basename "$AUTH_KEY_PATH")"
    AUTH_KEY_ID="${base#AuthKey_}"
    AUTH_KEY_ID="${AUTH_KEY_ID%.p8}"
  fi

  AUTH_FLAGS=()
  if [[ -n "$AUTH_KEY_PATH" ]]; then
    [[ -f "$AUTH_KEY_PATH" ]] || die "API key file not found: $AUTH_KEY_PATH"
    [[ -n "$AUTH_KEY_ID" ]] || die "set APP_STORE_CONNECT_KEY_ID"
    [[ -n "$AUTH_ISSUER" ]] || die "set APP_STORE_CONNECT_ISSUER_ID (or ~/.appstoreconnect/issuer_id)"
    AUTH_FLAGS=(
      -authenticationKeyPath "$AUTH_KEY_PATH"
      -authenticationKeyID "$AUTH_KEY_ID"
      -authenticationKeyIssuerID "$AUTH_ISSUER"
    )
    log "Using App Store Connect API key id $AUTH_KEY_ID"
  else
    log "No .p8 API key found; using Xcode signed-in Apple ID (will fail if 2FA prompts)"
  fi
}

write_export_plist() {
  local method="$1"
  local dest="${2:-export}"
  cat > "$EXPORT_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>${method}</string>
  <key>destination</key>
  <string>${dest}</string>
  <key>teamID</key>
  <string>${TEAM_ID}</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>uploadSymbols</key>
  <true/>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
  <key>stripSwiftSymbols</key>
  <true/>
</dict>
</plist>
EOF
}

archive_app() {
  log "Archiving (Release, generic iOS) — temporary Automatic on App target only"
  rm -rf "$ARCHIVE_PATH"
  patch_app_signing_automatic
  # Do NOT pass CODE_SIGN_STYLE / PROVISIONING_PROFILE_SPECIFIER / sdk-specific
  # identities on the CLI (signing conflict, xcodebuild parse bug, SPM leak).
  xcodebuild \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -configuration Release \
    -destination "generic/platform=iOS" \
    -archivePath "$ARCHIVE_PATH" \
    DEVELOPMENT_TEAM="$TEAM_ID" \
    -allowProvisioningUpdates \
    ${AUTH_FLAGS[@]+"${AUTH_FLAGS[@]}"} \
    archive
  restore_signing
  [[ -d "$ARCHIVE_PATH" ]] || die "archive not produced"
}

export_ipa() {
  local method="$1"
  write_export_plist "$method" "export"
  log "Exporting IPA (method=$method signing=automatic)"
  rm -rf "$EXPORT_DIR"
  mkdir -p "$EXPORT_DIR"
  xcodebuild -exportArchive \
    -archivePath "$ARCHIVE_PATH" \
    -exportPath "$EXPORT_DIR" \
    -exportOptionsPlist "$EXPORT_PLIST" \
    -allowProvisioningUpdates \
    ${AUTH_FLAGS[@]+"${AUTH_FLAGS[@]}"}
}

find_ipa() {
  local ipa
  ipa="$(find "$EXPORT_DIR" -maxdepth 1 -name '*.ipa' -type f | head -n 1)"
  [[ -n "$ipa" ]] || die "no IPA in $EXPORT_DIR"
  echo "$ipa"
}

upload_ipa() {
  local ipa="$1"
  log "Uploading $(basename "$ipa") to App Store Connect (version $MARKETING ($BUILD_NUM))"
  if [[ -n "${AUTH_KEY_ID:-}" && -n "${AUTH_ISSUER:-}" ]]; then
    if [[ -n "${AUTH_KEY_PATH:-}" ]]; then
      mkdir -p "$HOME/.appstoreconnect/private_keys"
      local expected="$HOME/.appstoreconnect/private_keys/AuthKey_${AUTH_KEY_ID}.p8"
      if [[ ! -e "$expected" ]]; then
        ln -s "$AUTH_KEY_PATH" "$expected"
        CLEAN_KEY_LINK="$expected"
      fi
    fi
    xcrun altool --upload-app -f "$ipa" -t ios \
      --apiKey "$AUTH_KEY_ID" \
      --apiIssuer "$AUTH_ISSUER"
  else
    write_export_plist "app-store-connect" "upload"
    xcodebuild -exportArchive \
      -archivePath "$ARCHIVE_PATH" \
      -exportPath "$EXPORT_DIR" \
      -exportOptionsPlist "$EXPORT_PLIST" \
      -allowProvisioningUpdates \
      ${AUTH_FLAGS[@]+"${AUTH_FLAGS[@]}"}
  fi
}

parse_min_build_from_log() {
  python3 - "$1" <<'PY'
import re, sys
from pathlib import Path
text = Path(sys.argv[1]).read_text(errors="ignore")
m = re.search(r"previously uploaded version:\s*[''‘’\"]?(\d+)", text)
if m:
    print(m.group(1))
PY
}

# --- main ---
select_xcode
PROD_API="$(read_prod_api)"
require_prod_api "$PROD_API"
resolve_auth

if ! security find-identity -v -p codesigning | grep -q "$TEAM_ID"; then
  echo "WARN: no codesigning identity mentions team $TEAM_ID. Archive may fail." >&2
fi

log "npm run build (production API)"
(cd "$FRONTEND" && production_env npm run build)
strip_js_maps

log "npx cap sync ios"
(cd "$FRONTEND" && production_env npx cap sync ios)

verify_web_bundle
bump_build

if ! xcodebuild -project "$PROJECT" -list | grep -q "$SCHEME"; then
  die "scheme $SCHEME not found. Open the project once in Xcode or run: xcodebuild -project $PROJECT -list"
fi

attempt=1
max_attempts=3
upload_status=1
while [[ $attempt -le $max_attempts ]]; do
  archive_app

  set +e
  export_ipa "app-store-connect"
  export_status=$?
  if [[ $export_status -ne 0 ]]; then
    export_ipa "app-store"
    export_status=$?
  fi
  set -e
  [[ $export_status -eq 0 ]] || die "IPA export failed (automatic signing only; do not manual-export the Xcode-managed Team Store profile)"

  IPA="$(find_ipa)"
  upload_log="$BUILD_DIR/upload.log"
  set +e
  upload_ipa "$IPA" 2>&1 | tee "$upload_log"
  upload_status=${PIPESTATUS[0]}
  set -e

  if [[ $upload_status -eq 0 ]]; then
    break
  fi

  apple_min="$(parse_min_build_from_log "$upload_log" || true)"
  if [[ "$apple_min" =~ ^[0-9]+$ ]]; then
    next="$((apple_min + 1))"
    log "Apple requires CFBundleVersion > $apple_min; retrying as $next (no JS rebuild)"
    set_build_number "$next"
    attempt=$((attempt + 1))
    continue
  fi
  echo "FAIL: upload failed (exit $upload_status). If Apple said the build number was taken, re-run after another bump." >&2
  exit "$upload_status"
done

[[ $upload_status -eq 0 ]] || die "upload failed after $max_attempts attempts"
write_last_upload

cat <<EOF

UPLOAD OK
  app: $BUNDLE_ID
  version: $MARKETING ($BUILD_NUM)
  ipa: $IPA
  archive: $ARCHIVE_PATH

Processing in App Store Connect can take several minutes. Then the build appears in TestFlight.
This script does not submit the app for App Review.

CURRENT_PROJECT_VERSION was bumped in frontend/ios/App/App.xcodeproj/project.pbxproj (uncommitted).
last-upload.md now records build $BUILD_NUM.
EOF
