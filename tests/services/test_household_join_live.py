"""Live household join test against remote/dev Supabase. Opt-in via HOUSEHOLD_JOIN_LIVE=1."""

from __future__ import annotations

import os

import pytest

from backend.config import Config
from backend.services.household_service import HouseholdService
from backend.services.supabase_service import SupabaseService
from backend.utils.exceptions import ValidationException

# Hardcoded QA UUIDs — no env override (destructive CASCADE targets HH2 only).
QA_OWNER_USER_ID = "00000000-0000-0000-0000-000000000003"
QA_OWNER_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000004"
QA_JOINER_USER_ID = "00000000-0000-0000-0000-000000000005"
QA_JOINER_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000006"
QA_NAME_GATE = "to-be-merged"
QA_OWNER_JOIN_CODE = "TBMERA"
QA_JOINER_JOIN_CODE = "TBMERB"


def _live_flag_on() -> bool:
    return os.getenv("HOUSEHOLD_JOIN_LIVE", "").strip().lower() in ("1", "true", "yes")


def _public_key() -> str:
    return (os.getenv("SUPABASE_PUBLIC_KEY") or os.getenv("SUPABASE_KEY") or "").strip()


def _secret_key() -> str:
    return (os.getenv("SUPABASE_SECRET_KEY") or "").strip()


def _live_skip_reason() -> str | None:
    if not _live_flag_on():
        return "HOUSEHOLD_JOIN_LIVE=1 required for live household join test"
    if not os.getenv("SUPABASE_URL"):
        return "SUPABASE_URL required"
    if not _public_key():
        return "SUPABASE_PUBLIC_KEY required"
    if not _secret_key():
        return "SUPABASE_SECRET_KEY required"
    cook_loop_hh = os.getenv("COOK_LOOP_LIVE_HOUSEHOLD_ID", "").strip()
    if cook_loop_hh and cook_loop_hh in (QA_OWNER_HOUSEHOLD_ID, QA_JOINER_HOUSEHOLD_ID):
        return "QA household IDs must not match COOK_LOOP_LIVE_HOUSEHOLD_ID"
    return None


pytestmark = pytest.mark.live_supabase


@pytest.fixture
def live_supabase():
    reason = _live_skip_reason()
    if reason:
        pytest.skip(reason)
    config = Config()
    supabase = SupabaseService(
        url=config.SUPABASE_URL,
        key=_public_key(),
        service_role_key=_secret_key(),
    )
    if supabase.admin_client is None:
        pytest.fail("SUPABASE_SECRET_KEY is required for live household join test")
    return supabase


@pytest.fixture
def live_household_service(live_supabase):
    return HouseholdService(live_supabase)


def _assert_qa_household_gates(supabase: SupabaseService, hh_id: str, name: str) -> None:
    if QA_NAME_GATE not in name.lower():
        pytest.fail(f"Household name {name!r} must contain '{QA_NAME_GATE}'")


def _restore_joiner_baseline(supabase: SupabaseService) -> None:
    """Detach B from any household, recreate HH2 with fixed UUID."""
    client = supabase.admin_client
    client.table("household_members").delete().eq("user_id", QA_JOINER_USER_ID).execute()
    client.table("households").delete().eq("id", QA_JOINER_HOUSEHOLD_ID).execute()
    client.table("households").insert(
        {
            "id": QA_JOINER_HOUSEHOLD_ID,
            "name": "to-be-merged-user-2",
            "created_by": QA_JOINER_USER_ID,
            "join_code": QA_JOINER_JOIN_CODE,
            "size": 2,
            "dietary_restrictions": [],
        }
    ).execute()
    client.table("household_members").insert(
        {
            "household_id": QA_JOINER_HOUSEHOLD_ID,
            "user_id": QA_JOINER_USER_ID,
            "role": "owner",
        }
    ).execute()


def _assert_owner_a_intact(supabase: SupabaseService) -> None:
    owner_hh = supabase.get_user_household(QA_OWNER_USER_ID)
    assert owner_hh is not None
    assert owner_hh["id"] == QA_OWNER_HOUSEHOLD_ID
    _assert_qa_household_gates(supabase, owner_hh["id"], owner_hh["name"])
    members = supabase.get_household_members(QA_OWNER_HOUSEHOLD_ID)
    assert len(members) == 1
    assert members[0]["user_id"] == QA_OWNER_USER_ID


def _precondition_joiner_on_hh2(supabase: SupabaseService) -> None:
    joiner_hh = supabase.get_user_household(QA_JOINER_USER_ID)
    assert joiner_hh is not None, "joiner B must belong to HH2 before destructive steps"
    assert joiner_hh["id"] == QA_JOINER_HOUSEHOLD_ID
    _assert_qa_household_gates(supabase, joiner_hh["id"], joiner_hh["name"])
    members = supabase.get_household_members(QA_JOINER_HOUSEHOLD_ID)
    assert len(members) == 1


@pytest.fixture
def qa_baseline(live_supabase):
    _restore_joiner_baseline(live_supabase)
    _assert_owner_a_intact(live_supabase)
    _precondition_joiner_on_hh2(live_supabase)
    yield live_supabase
    _restore_joiner_baseline(live_supabase)
    owner_members = live_supabase.get_household_members(QA_OWNER_HOUSEHOLD_ID)
    for m in owner_members:
        if m["user_id"] != QA_OWNER_USER_ID:
            live_supabase.remove_household_member(m["user_id"])
    _assert_owner_a_intact(live_supabase)


def test_live_household_join_flow(qa_baseline, live_household_service):
    supabase = qa_baseline
    service = live_household_service

    with pytest.raises(ValidationException) as exc_info:
        service.join_household(QA_JOINER_USER_ID, QA_OWNER_JOIN_CODE)
    assert "already a member" in str(exc_info.value).lower()

    with pytest.raises(ValidationException):
        service.join_household(QA_JOINER_USER_ID, "BADBAD")
    assert supabase.get_user_household(QA_JOINER_USER_ID)["id"] == QA_JOINER_HOUSEHOLD_ID

    client = supabase.admin_client
    client.table("pantry_items").insert(
        {
            "user_id": QA_JOINER_USER_ID,
            "household_id": QA_JOINER_HOUSEHOLD_ID,
            "base_ingredient": "qa_join_marker",
            "normalized_name": "qa join marker",
            "quantity": 1,
            "unit": "count",
        }
    ).execute()

    service.leave_household(QA_JOINER_USER_ID)

    rows = (
        client.table("pantry_items")
        .select("id")
        .eq("household_id", QA_JOINER_HOUSEHOLD_ID)
        .execute()
        .data
        or []
    )
    assert len(rows) == 0

    owner_before = supabase.get_household_by_id(QA_OWNER_HOUSEHOLD_ID)
    assert owner_before is not None
    owner_size_before = owner_before.get("size", 2)

    joined = service.join_household(QA_JOINER_USER_ID, QA_OWNER_JOIN_CODE)
    assert joined["id"] == QA_OWNER_HOUSEHOLD_ID
    assert joined["role"] == "member"
    assert joined["size"] == owner_size_before

    members = supabase.get_household_members(QA_OWNER_HOUSEHOLD_ID)
    assert len(members) == 2

    pantry = supabase.get_household_pantry(QA_OWNER_HOUSEHOLD_ID)
    assert isinstance(pantry, list)

    merged = service.merge_dietary_restrictions(QA_JOINER_USER_ID, ["shellfish"])
    assert "peanuts" in merged["dietary_restrictions"]
    assert "shellfish" in merged["dietary_restrictions"]

    again = service.merge_dietary_restrictions(QA_JOINER_USER_ID, ["shellfish"])
    assert again["dietary_restrictions"].count("shellfish") == 1
