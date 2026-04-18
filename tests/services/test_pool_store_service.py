"""Tests for PoolStoreService (suggestion pool persistence)."""

from datetime import datetime, timedelta, timezone

import pytest

from backend.services.pool_store_service import (
    STALE_GENERATION_MINUTES,
    PoolStoreService,
)
from backend.utils.exceptions import DatabaseException
from tests.conftest import (
    PostgrestClientStub,
    chain_calls_eq,
    install_supabase_service_with_clients,
)


def _pool_store_with_admin(mocker) -> tuple[PoolStoreService, PostgrestClientStub]:
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    supabase = install_supabase_service_with_clients(mocker, anon, admin)
    return PoolStoreService(supabase), admin


def _lt_started_at_value(chain: list) -> str | None:
    for step in chain:
        if step[0] == "lt" and len(step[1]) >= 2 and step[1][0] == "started_at":
            return step[1][1]
    return None


def _update_payload(chain: list) -> dict | None:
    for step in chain:
        if step[0] == "update" and step[1]:
            return step[1][0]
    return None


# --- Test group A — start_generation semantics ---


def test_start_generation_raises_on_empty_meal_types(mocker):
    pool_store, _admin = _pool_store_with_admin(mocker)
    with pytest.raises(DatabaseException, match="meal_types must include at least one meal type"):
        pool_store.start_generation("hh-1", "user-1", "x", [])


def test_start_generation_returns_already_running_when_active_row_exists(mocker):
    pool_store, admin = _pool_store_with_admin(mocker)
    gen_id = "existing-gen"
    admin.queue_response([])  # stale cleanup update
    admin.queue_response([{"id": gen_id, "started_at": "2026-01-01T00:00:00+00:00"}])  # active row

    out = pool_store.start_generation("hh-1", "user-1", "manual_refresh", ["dinner"])

    assert out == {"generation_id": gen_id, "already_running": True}
    assert any(s[0] == "select" for s in admin.chains[-1])
    assert not any(s[0] == "insert" for c in admin.chains for s in c)


def test_start_generation_inserts_new_row_when_no_active(mocker):
    pool_store, admin = _pool_store_with_admin(mocker)
    new_id = "gen-new-1"
    admin.queue_response([])  # stale cleanup
    admin.queue_response([])  # no active in_progress
    admin.queue_response([{"id": new_id}])  # insert

    out = pool_store.start_generation(
        "hh-1", "user-1", "onboarding", ["breakfast", "dinner"]
    )

    assert out == {"generation_id": new_id, "already_running": False}
    insert_chains = [c for c in admin.chains if any(s[0] == "insert" for s in c)]
    assert insert_chains


def test_fail_stale_in_progress_flips_rows_older_than_ten_minutes(mocker):
    pool_store, admin = _pool_store_with_admin(mocker)
    now = datetime(2026, 6, 1, 15, 0, 0, tzinfo=timezone.utc)
    expected_cutoff = (now - timedelta(minutes=STALE_GENERATION_MINUTES)).isoformat()

    pool_store._fail_stale_in_progress("hh-1", now=now)

    assert len(admin.chains) == 1
    chain = admin.chains[0]
    assert _lt_started_at_value(chain) == expected_cutoff
    payload = _update_payload(chain)
    assert payload is not None
    assert payload.get("status") == "failed"
    assert payload.get("error_message") == "Stale generation abandoned"
    assert chain_calls_eq([chain], "household_id", "hh-1")
    assert chain_calls_eq([chain], "status", "in_progress")


def test_fail_stale_in_progress_leaves_recent_rows_alone(mocker):
    """Stale query uses started_at < (now - 10m); in-progress rows newer than that are not targeted."""
    pool_store, admin = _pool_store_with_admin(mocker)
    now = datetime(2026, 3, 10, 8, 30, 0, tzinfo=timezone.utc)
    expected_cutoff = (now - timedelta(minutes=STALE_GENERATION_MINUTES)).isoformat()

    pool_store._fail_stale_in_progress("hh-9", now=now)

    assert _lt_started_at_value(admin.chains[0]) == expected_cutoff
    cutoff_dt = datetime.fromisoformat(expected_cutoff.replace("Z", "+00:00"))
    five_ago = now - timedelta(minutes=5)
    # Recent in_progress rows have started_at > cutoff, so they are not matched by .lt("started_at", cutoff)
    assert five_ago > cutoff_dt


def test_fail_stale_in_progress_accepts_default_now(mocker):
    """When now is omitted, uses wall clock (smoke: single execute, no crash)."""
    pool_store, admin = _pool_store_with_admin(mocker)
    pool_store._fail_stale_in_progress("hh-1")
    assert len(admin.chains) == 1
    assert _lt_started_at_value(admin.chains[0]) is not None


# --- Test group B — clear / dedupe ---


def test_clear_unused_only_deletes_status_unused_rows(mocker):
    pool_store, admin = _pool_store_with_admin(mocker)
    admin.set_default_response_data([])

    pool_store.clear_unused("hh-1")

    assert chain_calls_eq(admin.chains, "household_id", "hh-1")
    assert chain_calls_eq(admin.chains, "status", "unused")
    assert admin.chains[-1][0] == ("table", ("suggestion_pool",), {})
    assert any(s[0] == "delete" for s in admin.chains[-1])


def test_clear_unused_meal_type_filter_narrows_delete(mocker):
    pool_store, admin = _pool_store_with_admin(mocker)
    admin.set_default_response_data([])

    pool_store.clear_unused("hh-1", meal_type="dinner")

    assert chain_calls_eq(admin.chains, "meal_type", "dinner")


def test_add_suggestions_skips_swiped_recipe_ids(mocker):
    pool_store, admin = _pool_store_with_admin(mocker)
    # get_swiped_recipe_ids
    admin.queue_response([{"recipe_id": "99"}, {"recipe_id": "100"}])
    # existing check for 200
    admin.queue_response([])
    # insert 200
    admin.queue_response([{"id": "row-200"}])

    n = pool_store.add_suggestions(
        "hh-1",
        "user-1",
        "gen-1",
        [
            {
                "meal_type": "dinner",
                "recipe_id": "99",
                "recipe_name": "Skip",
                "recipe_data": {},
            },
            {
                "meal_type": "dinner",
                "recipe_id": "200",
                "recipe_name": "Keep",
                "recipe_data": {"id": 200},
            },
        ],
    )
    assert n == 1
    insert_ops = [s for c in admin.chains for s in c if s[0] == "insert"]
    assert len(insert_ops) == 1


def test_add_suggestions_skips_already_present_recipe_ids(mocker):
    pool_store, admin = _pool_store_with_admin(mocker)
    admin.queue_response([])  # swiped
    admin.queue_response([{"id": "row-1", "status": "swiped"}])  # already in pool

    n = pool_store.add_suggestions(
        "hh-1",
        "user-1",
        "gen-1",
        [
            {
                "meal_type": "dinner",
                "recipe_id": "200",
                "recipe_name": "Dup",
                "recipe_data": {},
            },
        ],
    )
    assert n == 0
    assert not any(s[0] == "insert" for c in admin.chains for s in c)


def test_add_suggestions_returns_count_of_actually_inserted(mocker):
    pool_store, admin = _pool_store_with_admin(mocker)
    admin.queue_response([])  # swiped
    admin.queue_response([])  # existing r1
    admin.queue_response([{"id": "i1"}])  # insert r1
    admin.queue_response([{"id": "dup-r2"}])  # existing r2 — duplicate, no insert
    admin.queue_response([])  # existing r3
    admin.queue_response([{"id": "i3"}])  # insert r3

    n = pool_store.add_suggestions(
        "hh-1",
        "u",
        "gen-1",
        [
            {"meal_type": "lunch", "recipe_id": "r1", "recipe_name": "A", "recipe_data": {}},
            {"meal_type": "lunch", "recipe_id": "r2", "recipe_name": "B", "recipe_data": {}},
            {"meal_type": "dinner", "recipe_id": "r3", "recipe_name": "C", "recipe_data": {}},
        ],
    )
    assert n == 2


# --- Test group C — read shape ---


def test_get_pool_grouped_returns_all_three_meal_keys_even_when_empty(mocker):
    pool_store, admin = _pool_store_with_admin(mocker)
    admin.set_default_response_data([])

    grouped = pool_store.get_pool_grouped_by_meal("hh-1")

    assert set(grouped.keys()) == {"breakfast", "lunch", "dinner"}
    assert grouped["breakfast"] == []
    assert grouped["lunch"] == []
    assert grouped["dinner"] == []


def test_get_pool_depth_returns_zero_for_meals_with_no_unused_rows(mocker):
    pool_store, admin = _pool_store_with_admin(mocker)
    admin.set_default_response_data(
        [
            {"meal_type": "breakfast"},
            {"meal_type": "breakfast"},
            {"meal_type": "lunch"},
        ]
    )

    depth = pool_store.get_pool_depth("hh-1")
    assert depth == {"breakfast": 2, "lunch": 1, "dinner": 0}


def test_get_swiped_recipe_ids_returns_set_of_strings(mocker):
    pool_store, admin = _pool_store_with_admin(mocker)
    admin.set_default_response_data([{"recipe_id": 42}, {"recipe_id": "99"}])

    out = pool_store.get_swiped_recipe_ids("hh-1")

    assert isinstance(out, set)
    assert out == {"42", "99"}
    assert all(isinstance(x, str) for x in out)


# --- Test group D — update & read auth ---


def test_update_status_filters_by_household_id(mocker):
    pool_store, admin = _pool_store_with_admin(mocker)
    admin.queue_response([])  # no row updated

    ok = pool_store.update_status("sug-1", "hh-other", "swiped")

    assert ok is False
    assert chain_calls_eq(admin.chains, "id", "sug-1")
    assert chain_calls_eq(admin.chains, "household_id", "hh-other")


def test_get_suggestion_returns_none_when_suggestion_belongs_to_other_household(mocker):
    pool_store, admin = _pool_store_with_admin(mocker)
    admin.set_default_response_data([])

    assert pool_store.get_suggestion("sug-1", "hh-wrong") is None


# --- Test group E — race-documenting test ---


def test_start_generation_is_not_atomic_against_concurrent_caller(mocker):
    """Separate stale update, active select, then insert — not one atomic DB operation (TOCTOU risk)."""
    # TODO: convert to RPC for true atomicity — follow-up: t1-06 pool-store brief (group E).
    pool_store, admin = _pool_store_with_admin(mocker)
    admin.queue_response([])
    admin.queue_response([])
    admin.queue_response([{"id": "g-new"}])

    pool_store.start_generation("hh-1", "u", "manual", ["lunch"])

    assert len(admin.chains) >= 3
    assert any(s[0] == "update" for s in admin.chains[0])
    assert any(s[0] == "select" for s in admin.chains[1])
    assert any(s[0] == "insert" for s in admin.chains[2])


def test_complete_generation_sets_status_and_counts(mocker):
    pool_store, admin = _pool_store_with_admin(mocker)
    admin.set_default_response_data([{"id": "g1"}])

    pool_store.complete_generation("g1", "partial", 3, error_message="quota")

    assert any(s[0] == "update" for s in admin.chains[-1])
    upd = _update_payload(admin.chains[-1])
    assert upd is not None
    assert upd["status"] == "partial"
    assert upd["suggestions_generated"] == 3
    assert upd.get("error_message") == "quota"
