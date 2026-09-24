#!/usr/bin/env python3
"""Upload a signed AAB to Google Play Internal testing.

Does not print service-account JSON. Exit 3 = versionCode already used.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

SCOPE = "https://www.googleapis.com/auth/androidpublisher"
DUP_EXIT = 3


def die(msg: str, code: int = 1) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    raise SystemExit(code)


def load_json_path(explicit: str | None) -> Path:
    raw = explicit or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or os.environ.get(
        "PLAY_JSON_KEY_PATH"
    )
    if not raw:
        die(
            "set GOOGLE_APPLICATION_CREDENTIALS or PLAY_JSON_KEY_PATH to a service account JSON",
            2,
        )
    path = Path(os.path.expanduser(raw)).resolve()
    if not path.is_file():
        die(f"service account JSON not found: {path}", 2)
    return path


def assert_service_account(path: Path) -> None:
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        die(f"credentials file is not JSON: {e}", 2)
    kind = data.get("type")
    if kind == "service_account":
        print("Auth: service_account JSON OK")
        return
    if isinstance(data.get("installed"), dict) or kind == "installed":
        die(
            "credentials file is a desktop OAuth client, not a service account. "
            "Set GOOGLE_APPLICATION_CREDENTIALS to the Play service account JSON.",
            2,
        )
    die(f"credentials JSON type is {kind!r}, expected 'service_account'", 2)


def publisher(path: Path):
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    creds = service_account.Credentials.from_service_account_file(
        str(path), scopes=[SCOPE]
    )
    return build("androidpublisher", "v3", credentials=creds, cache_discovery=False)


def http_status(err: BaseException) -> int | None:
    code = getattr(err, "status_code", None)
    if code is not None:
        return int(code)
    resp = getattr(err, "resp", None)
    status = getattr(resp, "status", None)
    return int(status) if status is not None else None


def is_duplicate_version(err: BaseException) -> bool:
    text = str(err).lower()
    return "version code" in text and (
        "already been used" in text or "already used" in text
    )


def api_error_text(err: BaseException) -> str:
    content = getattr(err, "content", None)
    if isinstance(content, bytes):
        try:
            content = content.decode("utf-8", "replace")
        except Exception:
            content = repr(content)
    if content:
        try:
            parsed = json.loads(content)
            error = parsed.get("error") or parsed
            if isinstance(error, dict):
                msg = error.get("message") or error.get("status") or content
                return str(msg)
        except json.JSONDecodeError:
            return str(content)[:800]
    return str(err)[:800]


def auth_check(service, package: str) -> None:
    from googleapiclient.errors import HttpError

    try:
        edit = service.edits().insert(packageName=package, body={}).execute()
    except HttpError as e:
        if http_status(e) == 403:
            die(
                "Play API 403. Confirm the service account email is invited on Meald "
                "with View app information + Release apps to testing tracks. "
                f"Google: {api_error_text(e)}",
                2,
            )
        die(f"edits.insert failed: {api_error_text(e)}", 2)
    edit_id = edit["id"]
    service.edits().delete(packageName=package, editId=edit_id).execute()
    print(f"AUTH OK  package={package}  (empty edit {edit_id} deleted)")


def upload(
    service,
    *,
    package: str,
    track: str,
    aab: Path,
    status: str,
    release_name: str | None,
    release_notes: str | None,
) -> None:
    from googleapiclient.errors import HttpError
    from googleapiclient.http import MediaFileUpload

    if not aab.is_file():
        die(f"AAB not found: {aab}")
    print(f"Uploading {aab} ({aab.stat().st_size} bytes) → {package} track={track}")

    try:
        edit = service.edits().insert(packageName=package, body={}).execute()
        edit_id = edit["id"]
        media = MediaFileUpload(
            str(aab), mimetype="application/octet-stream", resumable=True
        )
        bundle = (
            service.edits()
            .bundles()
            .upload(packageName=package, editId=edit_id, media_body=media)
            .execute()
        )
        version_code = str(bundle["versionCode"])
        print(f"Bundle versionCode={version_code}")

        release = {
            "name": release_name or version_code,
            "status": status,
            "versionCodes": [version_code],
        }
        notes = (release_notes or "").strip()
        if notes:
            release["releaseNotes"] = [{"language": "en-US", "text": notes}]

        service.edits().tracks().update(
            packageName=package,
            editId=edit_id,
            track=track,
            body={"track": track, "releases": [release]},
        ).execute()
        commit = service.edits().commit(packageName=package, editId=edit_id).execute()
    except HttpError as e:
        if is_duplicate_version(e):
            die(api_error_text(e), DUP_EXIT)
        if http_status(e) == 403:
            die(
                "Play API 403. Confirm the service account is invited on Meald "
                f"with testing-track release rights. Google: {api_error_text(e)}",
                2,
            )
        die(api_error_text(e))

    print(
        "UPLOAD OK\n"
        f"  package: {package}\n"
        f"  track: {track}\n"
        f"  versionCode: {version_code}\n"
        f"  status: {status}\n"
        f"  edit: {commit.get('id', edit_id)}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", default="com.meald.app")
    parser.add_argument("--track", default="internal")
    parser.add_argument("--aab", type=Path)
    parser.add_argument("--json-key", dest="json_key")
    parser.add_argument("--status", choices=("completed", "draft"), default="completed")
    parser.add_argument("--release-name")
    parser.add_argument("--release-notes")
    parser.add_argument(
        "--auth-check",
        action="store_true",
        help="Insert and delete an empty edit; do not upload",
    )
    args = parser.parse_args()

    path = load_json_path(args.json_key)
    assert_service_account(path)
    service = publisher(path)

    if args.auth_check:
        auth_check(service, args.package)
        return
    if args.aab is None:
        die("--aab is required unless --auth-check")
    upload(
        service,
        package=args.package,
        track=args.track,
        aab=args.aab.expanduser().resolve(),
        status=args.status,
        release_name=args.release_name,
        release_notes=args.release_notes,
    )


if __name__ == "__main__":
    main()
