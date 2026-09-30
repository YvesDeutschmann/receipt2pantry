#!/usr/bin/env python3
"""
Seed review@meald.app for App Store / Play review (onboarding + mock receipts + dinner pool).

Usage:
  REVIEW_ACCOUNT_PASSWORD='…' uv run python scripts/seed_review_account.py --dev
  REVIEW_ACCOUNT_PASSWORD='…' uv run python scripts/seed_review_account.py --prod [--reset]

Requires SUPABASE_URL + SUPABASE_SECRET_KEY (+ SUPABASE_JWT_SECRET for --prod API calls).
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

project_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv

load_dotenv(project_root / ".env")

from scripts._env_guard import assert_not_prod, assert_prod
from backend.routes.dev import freshen_mock_receipt_dates

REVIEW_EMAIL = os.getenv("REVIEW_ACCOUNT_EMAIL", "review@meald.app").strip()
PROD_API = "https://api.meald.app/api"
DEV_API = os.getenv("SEED_API_BASE_URL", "http://127.0.0.1:5000/api").rstrip("/")


def _secret_key() -> str:
    return (
        os.getenv("SUPABASE_SECRET_KEY")
        or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or ""
    ).strip()


def _public_key() -> str:
    return (os.getenv("SUPABASE_PUBLIC_KEY") or os.getenv("SUPABASE_KEY") or "").strip()


def _supabase_url() -> str:
    url = (os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
    if not url:
        print("FAIL: SUPABASE_URL not set", file=sys.stderr)
        sys.exit(1)
    return url


def _admin_client():
    from supabase import create_client

    key = _secret_key()
    if not key:
        print("FAIL: SUPABASE_SECRET_KEY required", file=sys.stderr)
        sys.exit(1)
    return create_client(_supabase_url(), key)


def _password_from_env() -> str:
    pw = os.getenv("REVIEW_ACCOUNT_PASSWORD", "").strip()
    if pw:
        return pw
    pw = getpass.getpass("Review account password: ")
    if len(pw) < 8:
        print("FAIL: password must be at least 8 characters", file=sys.stderr)
        sys.exit(1)
    return pw


def _sign_in(email: str, password: str) -> str:
    pub = _public_key()
    if not pub:
        print("FAIL: SUPABASE_PUBLIC_KEY required for sign-in", file=sys.stderr)
        sys.exit(1)
    url = f"{_supabase_url()}/auth/v1/token?grant_type=password"
    r = requests.post(
        url,
        headers={"apikey": pub, "Content-Type": "application/json"},
        json={"email": email, "password": password},
        timeout=60,
    )
    if r.status_code != 200:
        print(f"FAIL: sign-in HTTP {r.status_code}", file=sys.stderr)
        sys.exit(1)
    token = r.json().get("access_token")
    if not token:
        print("FAIL: no access_token", file=sys.stderr)
        sys.exit(1)
    return token


def _api(method: str, path: str, token: str, api_base: str, **kwargs):
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    url = f"{api_base}{path}"
    return requests.request(method, url, headers=headers, timeout=120, **kwargs)


def _delete_via_api(token: str, api_base: str) -> None:
    r = _api("DELETE", "/account", token, api_base)
    if r.status_code not in (200, 404):
        print(f"WARN: delete account HTTP {r.status_code}", file=sys.stderr)


def _create_or_reset_user(admin, email: str, password: str, reset: bool, api_base: str):
    existing_id = None
    page = 1
    while True:
        batch = admin.auth.admin.list_users(page=page, per_page=200)
        users = getattr(batch, "users", None) or batch
        if not users:
            break
        for u in users:
            if getattr(u, "email", None) == email:
                existing_id = u.id
                break
        if existing_id or len(users) < 200:
            break
        page += 1

    if existing_id and reset:
        try:
            token = _sign_in(email, password)
            _delete_via_api(token, api_base)
        except SystemExit:
            admin.auth.admin.delete_user(existing_id)
        existing_id = None

    if existing_id:
        admin.auth.admin.update_user_by_id(
            existing_id, {"password": password, "email_confirm": True}
        )
        return existing_id

    created = admin.auth.admin.create_user(
        {
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"signup_method": "email"},
        }
    )
    return created.user.id


def _ensure_household(token: str, user_id: str, api_base: str) -> str:
    r = _api("GET", "/households", token, api_base)
    if r.status_code != 200:
        print(f"FAIL: GET households {r.status_code}", file=sys.stderr)
        sys.exit(1)
    hh = r.json().get("household")
    if hh and hh.get("id"):
        return hh["id"]

    r = _api(
        "POST",
        "/households",
        token,
        api_base,
        json={"name": "Review Household", "size": 2, "dietary_restrictions": []},
    )
    if r.status_code not in (200, 201):
        print(f"FAIL: create household {r.status_code} {r.text[:200]}", file=sys.stderr)
        sys.exit(1)
    return r.json()["household"]["id"]


def _complete_onboarding(admin, user_id: str, token: str, api_base: str) -> None:
    r = _api(
        "PUT",
        "/households/profile",
        token,
        api_base,
        json={"size": 2, "dietary_restrictions": []},
    )
    if r.status_code != 200:
        print(f"FAIL: profile {r.status_code}", file=sys.stderr)
        sys.exit(1)

    now = datetime.now(timezone.utc).isoformat()
    admin.auth.admin.update_user_by_id(
        user_id,
        {
            "user_metadata": {
                "onboarding_completed_at": now,
                "cold_start_pantry_template_completed_at": now,
                "cold_start_step": 2,
                "cold_start_skip_grocery": True,
                "bridge_chose_manual": True,
                "cold_start_grocery_connected": True,
                "signup_method": "email",
                "whats_for_dinner_unlocked": True,
            }
        },
    )


def _load_mock_receipts(token: str, user_id: str, api_base: str) -> int:
    fixture = project_root / "data" / "fixtures" / "safeway_receipts.json"
    with open(fixture, encoding="utf-8") as f:
        receipts = json.load(f)
    receipts = freshen_mock_receipt_dates(receipts)
    r = _api(
        "POST",
        "/receipts/ingest",
        token,
        api_base,
        json={"provider": "safeway", "receipts": receipts, "user_id": user_id},
    )
    if r.status_code != 200:
        print(f"FAIL: ingest {r.status_code} {r.text[:300]}", file=sys.stderr)
        sys.exit(1)
    return int(r.json().get("items_added_to_pantry") or 0)


def _confirm_staples(token: str, api_base: str) -> None:
    r = _api("GET", "/pantry/staples-template", token, api_base)
    if r.status_code != 200:
        print(f"FAIL: staples template {r.status_code}", file=sys.stderr)
        sys.exit(1)
    selected = []
    for cat in r.json().get("categories") or []:
        for item in cat.get("items") or []:
            base = (item.get("base_ingredient") or "").strip()
            if base:
                selected.append(base)
    if not selected:
        selected = ["eggs", "milk", "pasta", "rice", "chicken breast"]

    r = _api(
        "POST",
        "/pantry/confirm-staples",
        token,
        api_base,
        json={"selected_items": selected[:30]},
    )
    if r.status_code != 200:
        print(f"FAIL: confirm staples {r.status_code}", file=sys.stderr)
        sys.exit(1)


def _warm_dinner_pool(token: str, household_id: str, api_base: str) -> int:
    r = _api(
        "POST",
        "/suggestions/pool/generate",
        token,
        api_base,
        json={
            "trigger_reason": "onboarding",
            "household_id": household_id,
            "meal_types": ["dinner"],
        },
    )
    if r.status_code not in (200, 429):
        print(f"FAIL: pool generate {r.status_code} {r.text[:200]}", file=sys.stderr)
        sys.exit(1)

    r = _api("GET", "/suggestions", token, api_base)
    if r.status_code != 200:
        print(f"FAIL: suggestions {r.status_code}", file=sys.stderr)
        sys.exit(1)
    data = r.json()
    cook = data.get("cook_tonight") or []
    pool = data.get("pool") or {}
    if isinstance(pool, dict):
        unused = pool.get("unused") or []
    else:
        unused = []
    return len(cook) + len(unused)


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed App Review account")
    parser.add_argument("--prod", action="store_true")
    parser.add_argument("--dev", action="store_true")
    parser.add_argument("--reset", action="store_true")
    args = parser.parse_args()
    if args.prod == args.dev:
        print("Specify exactly one of --prod or --dev", file=sys.stderr)
        sys.exit(1)

    if args.prod:
        assert_prod(allow_prod=True, context="seed_review_account.py")
        api_base = PROD_API
    else:
        assert_not_prod(allow_prod=False, context="seed_review_account.py")
        api_base = DEV_API

    password = _password_from_env()
    admin = _admin_client()
    user_id = _create_or_reset_user(
        admin, REVIEW_EMAIL, password, reset=args.reset, api_base=api_base
    )
    token = _sign_in(REVIEW_EMAIL, password)
    household_id = _ensure_household(token, user_id, api_base)
    _complete_onboarding(admin, user_id, token, api_base)
    items = _load_mock_receipts(token, user_id, api_base)
    _confirm_staples(token, api_base)
    cards = _warm_dinner_pool(token, household_id, api_base)

    ok = cards >= 1
    print(
        json.dumps(
            {
                "ok": ok,
                "pantry_items_from_receipts": items,
                "suggestion_cards": cards,
                "household_id_set": bool(household_id),
            }
        )
    )
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
