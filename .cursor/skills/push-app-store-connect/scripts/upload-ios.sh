#!/usr/bin/env bash
# Archive Meald iOS and upload the IPA to App Store Connect (TestFlight).
# Does not submit for App Review.
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
BUILD_DIR="$IOS_APP/build"
ARCHIVE_PATH="$BUILD_DIR/App.xcarchive"
EXPORT_DIR="$BUILD_DIR/export"
EXPORT_PLIST="$BUILD_DIR/ExportOptions.plist"
TEAM_ID="BQL348J2DW"
BUNDLE_ID="com.meald.app"
SCHEME="App"
EXPECTED_API="https://api.meald.app/api"

DEVELOPER_DIR="$(xcode-select -p 2>/dev/null || true)"
if [[ "$DEVELOPER_DIR" != /Applications/Xcode.app/* ]]; then
  echo "FAIL: full Xcode required. xcode-select -p → ${DEVELOPER_DIR:-empty}" >&2
  echo "Run: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer" >&2
  exit 1
fi

mkdir -p "$BUILD_DIR" "$EXPORT_DIR"

log() { printf '\n==> %s\n' "$*"; }
die() { echo "FAIL: $*" >&2; exit 1; }

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
production_env() {
  # Intentionally empty VITE_ENABLE_DEV_SETTINGS so a leftover .env.local cannot enable Dev Tools.
  env -u DEV_SERVER_URL \
    VITE_API_BASE_URL="$PROD_API" \
    VITE_ENABLE_DEV_SETTINGS= \
    "$@"
}

verify_web_bundle() {
  local cap_json="$IOS_APP/App/capacitor.config.json"
  local public_dir="$IOS_APP/App/public"
  local dist="$FRONTEND/dist"

  [[ -d "$dist" ]] || die "frontend/dist missing after npm run build"
  grep -Rqs "api.meald.app" "$dist" || die "dist does not contain api.meald.app"

  if grep -RqsE 'localhost:5173|127\.0\.0\.1:5173' "$dist" "$public_dir" 2>/dev/null; then
    die "bundled web still references the Vite dev server"
  fi
  if grep -RqsE '192\.168\.[0-9]+\.[0-9]+|10\.[0-9]+\.[0-9]+\.[0-9]+' "$dist/assets" 2>/dev/null; then
    die "dist/assets contains a LAN IP — not an App Store build"
  fi

  if [[ -f "$cap_json" ]] && grep -q '"url"' "$cap_json" && grep -q '"server"' "$cap_json"; then
    python3 - "$cap_json" <<'PY' || die "capacitor.config.json still has server.url (live reload)"
import json, sys
p = sys.argv[1]
with open(p) as f:
    data = json.load(f)
server = data.get("server") or {}
if server.get("url"):
    sys.exit(1)
PY
  fi
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
  local signing="$2"
  local profile_name="${3:-}"
  cat > "$EXPORT_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>${method}</string>
  <key>destination</key>
  <string>export</string>
  <key>teamID</key>
  <string>${TEAM_ID}</string>
  <key>signingStyle</key>
  <string>${signing}</string>
  <key>uploadSymbols</key>
  <true/>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
  <key>stripSwiftSymbols</key>
  <true/>
EOF
  if [[ "$signing" == "manual" && -n "$profile_name" ]]; then
    cat >> "$EXPORT_PLIST" <<EOF
  <key>signingCertificate</key>
  <string>Apple Distribution</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>${BUNDLE_ID}</key>
    <string>${profile_name}</string>
  </dict>
EOF
  fi
  cat >> "$EXPORT_PLIST" <<'EOF'
</dict>
</plist>
EOF
}

find_app_store_profile_name() {
  python3 - "$BUNDLE_ID" "$TEAM_ID" <<'PY'
import os, subprocess, sys, plistlib
from pathlib import Path

bundle, team = sys.argv[1], sys.argv[2]
want = f"{team}.{bundle}"
dirs = [
    Path.home() / "Library/Developer/Xcode/UserData/Provisioning Profiles",
    Path.home() / "Library/MobileDevice/Provisioning Profiles",
]
found = []
for d in dirs:
    if not d.is_dir():
        continue
    for p in list(d.glob("*.mobileprovision")) + list(d.glob("*.provisionprofile")):
        try:
            xml = subprocess.check_output(["security", "cms", "-D", "-i", str(p)], stderr=subprocess.DEVNULL)
            data = plistlib.loads(xml)
        except Exception:
            continue
        ents = data.get("Entitlements") or {}
        app_id = ents.get("application-identifier") or ""
        if want not in app_id:
            continue
        if "ProvisionedDevices" in data or data.get("ProvisionsAllDevices"):
            continue
        found.append(data.get("Name") or "")
# Prefer a name that looks like App Store / Distribution
ranked = sorted(found, key=lambda n: (("app store" not in n.lower() and "distribution" not in n.lower()), n.lower()))
if ranked:
    print(ranked[0])
PY
}

bump_build() {
  log "Bumping CURRENT_PROJECT_VERSION"
  (cd "$IOS_APP" && xcrun agvtool next-version -all)
  MARKETING="$(cd "$IOS_APP" && xcrun agvtool what-marketing-version -terse1)"
  BUILD_NUM="$(cd "$IOS_APP" && xcrun agvtool what-version -terse)"
  log "Version $MARKETING ($BUILD_NUM)"
}

archive_app() {
  log "Archiving (Release, generic iOS)"
  rm -rf "$ARCHIVE_PATH"
  xcodebuild \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -configuration Release \
    -destination "generic/platform=iOS" \
    -archivePath "$ARCHIVE_PATH" \
    CODE_SIGN_STYLE=Automatic \
    DEVELOPMENT_TEAM="$TEAM_ID" \
    PROVISIONING_PROFILE_SPECIFIER= \
    -allowProvisioningUpdates \
    ${AUTH_FLAGS[@]+"${AUTH_FLAGS[@]}"} \
    archive
  [[ -d "$ARCHIVE_PATH" ]] || die "archive not produced"
}

export_ipa() {
  local method="$1"
  local signing="$2"
  local profile_name="${3:-}"
  write_export_plist "$method" "$signing" "$profile_name"
  log "Exporting IPA (method=$method signing=$signing ${profile_name:+profile=$profile_name})"
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
  log "Uploading $(basename "$ipa") to App Store Connect"
  if [[ -n "${AUTH_KEY_ID:-}" && -n "${AUTH_ISSUER:-}" ]]; then
    # altool reads AuthKey_<id>.p8 from ~/.appstoreconnect/private_keys or ~/.private_keys
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
    write_export_plist "app-store-connect" "automatic"
    # Re-export with destination upload using Xcode session
    python3 - "$EXPORT_PLIST" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
text = p.read_text().replace("<string>export</string>", "<string>upload</string>", 1)
p.write_text(text)
PY
    xcodebuild -exportArchive \
      -archivePath "$ARCHIVE_PATH" \
      -exportPath "$EXPORT_DIR" \
      -exportOptionsPlist "$EXPORT_PLIST" \
      -allowProvisioningUpdates \
      ${AUTH_FLAGS[@]+"${AUTH_FLAGS[@]}"}
  fi
}

cleanup() {
  if [[ -n "${CLEAN_KEY_LINK:-}" && -L "$CLEAN_KEY_LINK" ]]; then
    rm -f "$CLEAN_KEY_LINK"
  fi
}
trap cleanup EXIT

# --- main ---
PROD_API="$(read_prod_api)"
require_prod_api "$PROD_API"
resolve_auth

if ! security find-identity -v -p codesigning | grep -q "$TEAM_ID"; then
  echo "WARN: no codesigning identity mentions team $TEAM_ID. Archive may fail." >&2
fi

log "npm run build (production API)"
(cd "$FRONTEND" && production_env npm run build)

log "npx cap sync ios"
(cd "$FRONTEND" && production_env npx cap sync ios)

verify_web_bundle
bump_build

if ! xcodebuild -project "$PROJECT" -list | grep -q "$SCHEME"; then
  die "scheme $SCHEME not found. Open the project once in Xcode or run: xcodebuild -project $PROJECT -list"
fi

archive_app

set +e
export_ipa "app-store-connect" "automatic"
export_status=$?
if [[ $export_status -ne 0 ]]; then
  export_ipa "app-store" "automatic"
  export_status=$?
fi
if [[ $export_status -ne 0 ]]; then
  PROFILE_NAME="$(find_app_store_profile_name || true)"
  [[ -n "$PROFILE_NAME" ]] || die "export failed and no App Store provisioning profile found for $BUNDLE_ID"
  export_ipa "app-store-connect" "manual" "$PROFILE_NAME"
  export_status=$?
fi
set -e
[[ $export_status -eq 0 ]] || die "IPA export failed"

IPA="$(find_ipa)"
set +e
upload_ipa "$IPA"
upload_status=$?
set -e

if [[ $upload_status -ne 0 ]]; then
  echo "FAIL: upload failed (exit $upload_status). If Apple said the build number was taken, re-run after another bump." >&2
  exit "$upload_status"
fi

cat <<EOF

UPLOAD OK
  app: $BUNDLE_ID
  version: $MARKETING ($BUILD_NUM)
  ipa: $IPA
  archive: $ARCHIVE_PATH

Processing in App Store Connect can take several minutes. Then the build appears in TestFlight.
This script does not submit the app for App Review.

CURRENT_PROJECT_VERSION was bumped in frontend/ios/App/App.xcodeproj/project.pbxproj (uncommitted).
EOF
