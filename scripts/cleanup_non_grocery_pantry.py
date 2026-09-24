#!/usr/bin/env python3
"""
Remove non-grocery rows from live pantry (dry-run by default).

Uses the same deny-list as receipt processing. Soft-deletes with reason NEVER_HAD.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter
from datetime import date
from typing import Any, Dict, List, Optional

project_root = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, project_root)

from backend.config import Config  # noqa: E402
from backend.services.confidence_engine import _rpc_soft_delete_pantry_item  # noqa: E402
from backend.services.supabase_service import SupabaseService  # noqa: E402
from backend.utils.non_grocery import (  # noqa: E402
    is_non_grocery_line,
    is_non_grocery_normalized,
)


def _pantry_row_matches(row: Dict[str, Any]) -> bool:
    pseudo_normalized = {
        "category": row.get("category") or "",
        "base_ingredient": row.get("base_ingredient"),
        "normalized_name": row.get("normalized_name"),
    }
    if is_non_grocery_normalized(pseudo_normalized):
        return True
    label = (
        (row.get("normalized_name") or "").strip()
        or (row.get("base_ingredient") or "").strip()
    )
    return is_non_grocery_line(label, row.get("category") or "")


def fetch_live_pantry_rows(
    admin_client: Any,
    household_id: Optional[str],
) -> List[Dict[str, Any]]:
    query = (
        admin_client.table("pantry_items")
        .select(
            "id,user_id,household_id,normalized_name,base_ingredient,category,"
            "depletion_class,purchase_date,put_back_count"
        )
        .is_("deleted_at", "null")
    )
    if household_id:
        query = query.eq("household_id", household_id)
    result = query.execute()
    return result.data or []


def summarize_matches(rows: List[Dict[str, Any]]) -> None:
    by_name: Counter[str] = Counter()
    by_cat: Counter[str] = Counter()
    for row in rows:
        name = (row.get("normalized_name") or row.get("base_ingredient") or "?").strip()
        by_name[name] += 1
        by_cat[(row.get("category") or "(none)").strip()] += 1
    print(f"Would soft-delete {len(rows)} live pantry row(s).\n")
    print("By normalized_name:")
    for name, count in by_name.most_common():
        print(f"  {count:4d}  {name}")
    print("\nBy category:")
    for cat, count in by_cat.most_common():
        print(f"  {count:4d}  {cat}")


def apply_soft_deletes(admin_client: Any, rows: List[Dict[str, Any]], today: date) -> None:
    for row in rows:
        user_id = str(row["user_id"])
        item_id = str(row["id"])
        purchase_raw = row.get("purchase_date")
        purchase = None
        if purchase_raw:
            purchase = date.fromisoformat(str(purchase_raw)[:10])
        _rpc_soft_delete_pantry_item(
            admin_client,
            user_id=user_id,
            pantry_item_id=item_id,
            item_name=row.get("base_ingredient") or row.get("normalized_name") or "",
            depletion_class=row.get("depletion_class") or "STAPLE",
            purchase_date=purchase,
            today=today,
            reason="NEVER_HAD",
            was_cooked=False,
            put_back_count=int(row.get("put_back_count") or 0),
        )
    print(f"Soft-deleted {len(rows)} row(s) with reason NEVER_HAD.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Perform soft deletes (default is dry run only)",
    )
    parser.add_argument(
        "--household-id",
        dest="household_id",
        default=None,
        help="Limit to one household UUID",
    )
    args = parser.parse_args()

    config = Config()
    supabase = SupabaseService(
        url=config.SUPABASE_URL,
        key=config.SUPABASE_KEY,
        service_role_key=config.SUPABASE_SERVICE_ROLE_KEY,
    )
    admin = supabase.admin_client
    if admin is None:
        print("Service role client required.", file=sys.stderr)
        return 1

    all_rows = fetch_live_pantry_rows(admin, args.household_id)
    matches = [r for r in all_rows if _pantry_row_matches(r)]

    if not matches:
        print("No matching non-grocery pantry rows.")
        return 0

    summarize_matches(matches)

    if not args.apply:
        print("\nDry run only. Re-run with --apply to soft-delete.")
        return 0

    apply_soft_deletes(admin, matches, date.today())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
