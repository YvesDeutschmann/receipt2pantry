#!/usr/bin/env python3
"""
Delete migration fixture auth users (test@example.com + 028 QA users).

PROD only when --prod is passed. Does not touch Area 5 OAuth QA accounts.

If admin get_user_by_id returns "Database error loading user" for migration UUIDs,
delete those rows via Supabase SQL (see docs/runbooks/supabase-environments.md).
"""

from __future__ import annotations

import argparse
import os
import sys

project_root = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, project_root)

from dotenv import load_dotenv

load_dotenv(os.path.join(project_root, ".env"))

from scripts._env_guard import assert_not_prod, assert_prod
from backend.config import Config
from backend.services.account_deletion_service import AccountDeletionService
from backend.services.secrets_service import SupabaseVaultService
from backend.services.supabase_service import SupabaseService

FIXTURE_USER_IDS = (
    "00000000-0000-0000-0000-000000000001",
    "00000000-0000-0000-0000-000000000003",
    "00000000-0000-0000-0000-000000000005",
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Remove fixture auth users")
    parser.add_argument(
        "--prod",
        action="store_true",
        help="Run against production Supabase (requires SUPABASE_URL=prod)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List users only; do not delete",
    )
    args = parser.parse_args()

    if args.prod:
        assert_prod(allow_prod=True, context="purge_fixture_auth_users.py")
    else:
        assert_not_prod(allow_prod=False, context="purge_fixture_auth_users.py")

    config = Config()
    supabase = SupabaseService(
        url=config.SUPABASE_URL,
        key=config.SUPABASE_KEY,
        service_role_key=config.SUPABASE_SERVICE_ROLE_KEY,
    )
    if not supabase.admin_client:
        print("FAIL: admin client unavailable (SUPABASE_SECRET_KEY)", file=sys.stderr)
        sys.exit(1)

    admin = supabase.admin_client
    existing = []
    for uid in FIXTURE_USER_IDS:
        try:
            row = admin.auth.admin.get_user_by_id(uid)
            user = getattr(row, "user", row)
            if user:
                existing.append(uid)
        except Exception:
            continue

    print(f"Fixture users present: {len(existing)}")
    if args.dry_run:
        for uid in existing:
            print(f"  would delete {uid}")
        return

    vault = SupabaseVaultService(supabase.admin_client)
    deletion = AccountDeletionService(supabase, vault)
    for uid in existing:
        try:
            deletion.delete_account(uid)
            print(f"deleted {uid}")
        except Exception as e:
            print(f"FAIL {uid}: {e}", file=sys.stderr)
            sys.exit(1)

    print("OK: fixture users removed")


if __name__ == "__main__":
    main()
