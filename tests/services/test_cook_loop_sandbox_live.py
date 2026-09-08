"""Live cook-loop test against remote/dev Supabase. Opt-in via COOK_LOOP_LIVE=1."""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest

from backend.config import Config
from backend.services.cook_loop_sandbox_service import (
    DEV_RECIPE_ID,
    CookLoopSandboxService,
    load_cook_loop_fixture,
)
from backend.services.pantry_service import PantryService
from backend.services.pool_store_service import PoolStoreService
from backend.services.supabase_service import SupabaseService


def _live_flag_on() -> bool:
    return os.getenv("COOK_LOOP_LIVE", "").strip().lower() in ("1", "true", "yes")


def _public_key() -> str:
    return (os.getenv("SUPABASE_PUBLIC_KEY") or os.getenv("SUPABASE_KEY") or "").strip()


def _secret_key() -> str:
    return (os.getenv("SUPABASE_SECRET_KEY") or "").strip()


def _live_skip_reason() -> str | None:
    """Return skip reason, or None when all live gates are satisfied."""
    if not _live_flag_on():
        return "COOK_LOOP_LIVE=1 required for live cook-loop test"
    if not os.getenv("SUPABASE_URL"):
        return "SUPABASE_URL required"
    if not _public_key():
        return "SUPABASE_PUBLIC_KEY required"
    if not _secret_key():
        return "SUPABASE_SECRET_KEY required"
    if not os.getenv("COOK_LOOP_LIVE_USER_ID", "").strip():
        return "COOK_LOOP_LIVE_USER_ID required"
    if not os.getenv("COOK_LOOP_LIVE_HOUSEHOLD_ID", "").strip():
        return "COOK_LOOP_LIVE_HOUSEHOLD_ID required"
    return None


def _pantry_by_base(rows):
    out = {}
    for row in rows:
        base = (row.get("base_ingredient") or "").strip().lower()
        if base and base not in out:
            out[base] = row
    return out


def _as_float(value):
    if value is None:
        return None
    return float(value)


def _parse_uuid_env(name: str) -> str:
    raw = os.getenv(name, "").strip().strip("\"'").rstrip("\\").strip()
    try:
        return str(UUID(raw))
    except ValueError:
        pytest.fail(f"{name} must be a UUID (got {raw!r})")


pytestmark = pytest.mark.live_supabase


@pytest.fixture
def live_ids():
    reason = _live_skip_reason()
    if reason:
        pytest.skip(reason)
    user_id = _parse_uuid_env("COOK_LOOP_LIVE_USER_ID")
    household_id = _parse_uuid_env("COOK_LOOP_LIVE_HOUSEHOLD_ID")
    return user_id, household_id


@pytest.fixture
def live_sandbox(live_ids):
    config = Config()
    supabase = SupabaseService(
        url=config.SUPABASE_URL,
        key=_public_key(),
        service_role_key=_secret_key(),
    )
    if supabase.admin_client is None:
        pytest.fail("SUPABASE_SECRET_KEY is required for live cook-loop test")
    pantry = PantryService(supabase)
    pool = PoolStoreService(supabase)
    return CookLoopSandboxService(supabase, pantry, pool), live_ids


@pytest.mark.asyncio
async def test_live_cook_loop_c1_match_and_rpc(live_sandbox):
    svc, (user_id, household_id) = live_sandbox
    fixture = load_cook_loop_fixture()

    hh = svc.supabase.get_user_household(user_id)
    if not hh or str(hh.get("id")) != str(household_id):
        pytest.fail(
            "COOK_LOOP_LIVE_USER_ID must belong to COOK_LOOP_LIVE_HOUSEHOLD_ID "
            "(dedicated cook-loop household, not a guessed UUID)"
        )
    name = str(hh.get("name") or "")
    if "cook-loop" not in name.lower():
        pytest.fail(
            f"Household name {name!r} must contain 'cook-loop' so this test "
            "cannot wipe a daily-use household"
        )

    names = [
        (row.get("base_ingredient") or "").strip()
        for row in (fixture.get("pantry") or [])
    ]
    classes = svc.supabase.get_item_classifications_by_names(names)
    for row in fixture.get("pantry") or []:
        base = (row.get("base_ingredient") or "").strip()
        expected = str(row.get("expected_depletion_class") or "").upper()
        actual = str((classes.get(base) or {}).get("depletion_class") or "").upper()
        assert actual == expected, (
            f"item_classification drift: {base} is {actual or 'MISSING'} not {expected}"
        )

    recipe_id = str(fixture.get("recipe_id") or DEV_RECIPE_ID)
    try:
        reset_report = await svc.reset(user_id, household_id)
        by_base = _pantry_by_base(svc.supabase.get_household_pantry(household_id))
        for row in fixture.get("pantry") or []:
            base = (row.get("base_ingredient") or "").strip().lower()
            expected_class = str(row.get("expected_depletion_class") or "").upper()
            expected_qty = float(row.get("quantity") or 1)
            actual = by_base.get(base)
            assert actual is not None, f"missing pantry row {base}"
            assert str(actual.get("depletion_class") or "").upper() == expected_class
            assert _as_float(actual.get("quantity")) == expected_qty
            if expected_class == "UNIT_ITEM":
                assert _as_float(actual.get("quantity_purchased")) == expected_qty
                assert actual.get("quantity_remaining") is None

        pasta = by_base["pasta"]
        assert pasta.get("quantity_remaining") is None

        t0 = datetime.now(timezone.utc) - timedelta(seconds=5)
        report = svc.cook(
            user_id,
            household_id,
            reset_report.get("pool_suggestion_id"),
        )

        by_base = _pantry_by_base(svc.supabase.get_household_pantry(household_id))
        pasta = by_base.get("pasta")
        assert pasta is not None
        assert pasta.get("deleted_at") is None
        assert _as_float(pasta.get("quantity_remaining")) == 1.0

        rice = by_base.get("white rice")
        assert rice is not None
        assert rice.get("deleted_at") is None
        rem = rice.get("quantity_remaining")
        purchased = rice.get("quantity_purchased")
        assert rem is None or _as_float(rem) == _as_float(purchased)

        touched = (report.get("cook") or {}).get("touched") or []
        touched_bases = sorted(
            {
                (t.get("base_ingredient") or "").strip().lower()
                for t in touched
                if (t.get("base_ingredient") or "").strip()
            }
        )
        expected_touched = sorted(
            b.strip().lower() for b in (fixture["expect"]["touched_bases"])
        )
        assert touched_bases == expected_touched
        assert "white rice" not in touched_bases

        pool_row = svc.pool_store.get_pool_row_by_recipe_id(household_id, recipe_id)
        assert pool_row is not None
        assert pool_row.get("status") == "swiped"

        log_client = svc.supabase.admin_client
        log_res = (
            log_client.table("cooking_log")
            .select("*")
            .eq("recipe_id", recipe_id)
            .eq("household_id", household_id)
            .order("cooked_at", desc=True)
            .limit(1)
            .execute()
        )
        logs = log_res.data or []
        assert logs, "cooking_log row missing"
        cooked_at = logs[0].get("cooked_at")
        assert cooked_at is not None
        cooked_dt = datetime.fromisoformat(str(cooked_at).replace("Z", "+00:00"))
        if cooked_dt.tzinfo is None:
            cooked_dt = cooked_dt.replace(tzinfo=timezone.utc)
        assert cooked_dt >= t0

        assert report["ok"] is True
    finally:
        svc.supabase.reset_household_pantry(household_id)
        svc.pool_store.delete_by_recipe_id(household_id, recipe_id)
        svc.supabase.delete_recipe_cooking_log(household_id, recipe_id)
