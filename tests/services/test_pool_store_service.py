"""Tests for PoolStoreService (suggestion pool persistence)."""

from unittest.mock import MagicMock

import pytest

from backend.services.pool_store_service import PoolStoreService
from backend.utils.exceptions import DatabaseException


def _make_chain(**execute_return):
    """Build a mock that supports .table().select/update/delete/insert().eq()...execute()."""
    end = MagicMock()
    end.execute.return_value = MagicMock(**execute_return)

    def chain(*_a, **_k):
        return end

    q = MagicMock()
    q.select = chain
    q.update = chain
    q.delete = chain
    q.insert = chain
    q.eq = chain
    q.lt = chain
    q.order = chain
    q.limit = chain
    return q


@pytest.fixture
def mock_client():
    client = MagicMock()
    client.table.return_value = _make_chain(data=[])
    return client


@pytest.fixture
def pool_store(mock_client):
    supabase = MagicMock()
    supabase.admin_client = mock_client
    supabase.client = mock_client
    return PoolStoreService(supabase)


def test_start_generation_inserts_in_progress_row(pool_store, mock_client):
    gen_id = "gen-uuid-1"
    ins_end = MagicMock()
    ins_end.execute.return_value = MagicMock(data=[{"id": gen_id}])
    ins_q = MagicMock()
    ins_q.insert.return_value = ins_end

    active_end = MagicMock()
    active_end.execute.return_value = MagicMock(data=[])
    active_q = MagicMock()
    active_q.select.return_value = active_q
    active_q.eq.return_value = active_q
    active_q.execute.return_value = active_end

    stale_end = MagicMock()
    stale_end.execute.return_value = MagicMock(data=[])
    stale_q = MagicMock()
    stale_q.update.return_value = stale_q
    stale_q.eq.return_value = stale_q
    stale_q.lt.return_value = stale_q
    stale_q.execute.return_value = stale_end

    def table_side(name):
        if name == "pool_generation":
            return ins_q if ins_q.insert.called else active_q
        return _make_chain(data=[]).table  # noqa

    # Simpler: two-step mock
    mock_client.table.side_effect = None
    mock_client.reset_mock()

    pool_tbl = MagicMock()
    pool_tbl.select.return_value = pool_tbl
    pool_tbl.eq.return_value = pool_tbl
    pool_tbl.lt.return_value = pool_tbl
    pool_tbl.update.return_value = pool_tbl
    pool_tbl.insert.return_value = pool_tbl
    pool_tbl.delete.return_value = pool_tbl
    pool_tbl.order.return_value = pool_tbl

    active_res = MagicMock(data=[])
    pool_tbl.execute.return_value = active_res

    def do_insert(*_a, **_k):
        pool_tbl.insert.return_value.execute.return_value = MagicMock(
            data=[{"id": gen_id}]
        )
        return pool_tbl.insert.return_value

    pool_tbl.insert.side_effect = lambda *_a, **_k: MagicMock(
        execute=MagicMock(return_value=MagicMock(data=[{"id": gen_id}]))
    )

    mock_client.table.return_value = pool_tbl

    out = pool_store.start_generation(
        "hh-1", "user-1", "onboarding", ["breakfast", "dinner"]
    )
    assert out["generation_id"] == gen_id
    assert out["already_running"] is False
    pool_tbl.insert.assert_called()


def test_start_generation_returns_already_running_when_active(pool_store, mock_client):
    gen_id = "existing-gen"
    pool_tbl = MagicMock()
    pool_tbl.select.return_value = pool_tbl
    pool_tbl.eq.return_value = pool_tbl
    pool_tbl.lt.return_value = pool_tbl
    pool_tbl.update.return_value = pool_tbl
    pool_tbl.insert.return_value = pool_tbl
    pool_tbl.delete.return_value = pool_tbl
    pool_tbl.order.return_value = pool_tbl

    # First execute: stale cleanup (update) -> empty; second: active in_progress -> row
    exec_calls = [
        MagicMock(data=[]),
        MagicMock(data=[{"id": gen_id, "started_at": "2026-01-01T00:00:00+00:00"}]),
    ]

    def exec_side_effect():
        return exec_calls.pop(0) if exec_calls else MagicMock(data=[])

    pool_tbl.execute.side_effect = exec_side_effect
    mock_client.table.return_value = pool_tbl

    out = pool_store.start_generation("hh-1", "user-1", "manual_refresh", ["dinner"])
    assert out["generation_id"] == gen_id
    assert out["already_running"] is True
    pool_tbl.insert.assert_not_called()


def test_fail_stale_in_progress_marks_old_runs_failed(pool_store, mock_client):
    """_fail_stale_in_progress runs update on pool_generation for stale in_progress rows."""
    pool_tbl = MagicMock()
    pool_tbl.select.return_value = pool_tbl
    pool_tbl.eq.return_value = pool_tbl
    pool_tbl.lt.return_value = pool_tbl
    pool_tbl.update.return_value = pool_tbl
    pool_tbl.insert.return_value = pool_tbl
    pool_tbl.delete.return_value = pool_tbl
    pool_tbl.order.return_value = pool_tbl

    exec_results = [
        MagicMock(data=[]),  # stale update
        MagicMock(data=[]),  # active check empty
        MagicMock(data=[{"id": "new-gen"}]),  # insert
    ]
    pool_tbl.execute.side_effect = lambda: exec_results.pop(0)

    insert_exec = MagicMock()
    insert_exec.execute.return_value = MagicMock(data=[{"id": "new-gen"}])
    pool_tbl.insert.return_value = insert_exec

    mock_client.table.return_value = pool_tbl

    pool_store.start_generation("hh-1", "user-1", "onboarding", ["lunch"])
    # Stale cleanup: update was invoked
    assert pool_tbl.update.called


def test_add_suggestions_filters_swiped_recipe_ids(pool_store, mock_client):
    sugg_tbl = MagicMock()
    sugg_tbl.select.return_value = sugg_tbl
    sugg_tbl.eq.return_value = sugg_tbl
    sugg_tbl.insert.return_value = sugg_tbl

    # get_swiped_recipe_ids: select ... status swiped
    # existing check per recipe: select ... recipe_id
    exec_results = [
        MagicMock(data=[{"recipe_id": "99"}, {"recipe_id": "100"}]),
        MagicMock(data=[]),
        MagicMock(data=[]),
    ]
    sugg_tbl.execute.side_effect = lambda: exec_results.pop(0)

    mock_client.table.return_value = sugg_tbl

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
    assert sugg_tbl.insert.call_count == 1


def test_add_suggestions_skips_duplicates(pool_store, mock_client):
    sugg_tbl = MagicMock()
    sugg_tbl.select.return_value = sugg_tbl
    sugg_tbl.eq.return_value = sugg_tbl
    sugg_tbl.insert.return_value = sugg_tbl

    # get_swiped: empty; then existing select for recipe 200 finds row
    exec_results = [
        MagicMock(data=[]),
        MagicMock(data=[{"id": "row-1", "status": "unused"}]),
    ]
    sugg_tbl.execute.side_effect = lambda: exec_results.pop(0)

    mock_client.table.return_value = sugg_tbl

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
    sugg_tbl.insert.assert_not_called()


def test_clear_unused_preserves_swiped_rows(pool_store, mock_client):
    del_tbl = MagicMock()
    del_tbl.delete.return_value = del_tbl
    del_tbl.eq.return_value = del_tbl
    del_tbl.execute.return_value = MagicMock(data=[])

    mock_client.table.return_value = del_tbl

    pool_store.clear_unused("hh-1")
    del_tbl.delete.assert_called_once()
    # Only status=unused
    calls = [c for c in del_tbl.eq.call_args_list if len(c[0]) >= 2]
    assert any("unused" in str(c) for c in calls)


def test_get_pool_depth_counts_only_unused(pool_store, mock_client):
    depth_tbl = MagicMock()
    depth_tbl.select.return_value = depth_tbl
    depth_tbl.eq.return_value = depth_tbl
    depth_tbl.execute.return_value = MagicMock(
        data=[
            {"meal_type": "breakfast"},
            {"meal_type": "breakfast"},
            {"meal_type": "lunch"},
        ]
    )
    mock_client.table.return_value = depth_tbl

    d = pool_store.get_pool_depth("hh-1")
    assert d["breakfast"] == 2
    assert d["lunch"] == 1
    assert d["dinner"] == 0


def test_complete_generation_sets_status_and_counts(pool_store, mock_client):
    upd_tbl = MagicMock()
    upd_tbl.update.return_value = upd_tbl
    upd_tbl.eq.return_value = upd_tbl
    upd_tbl.execute.return_value = MagicMock(data=[{"id": "g1"}])
    mock_client.table.return_value = upd_tbl

    pool_store.complete_generation("g1", "partial", 3, error_message="quota")
    upd_tbl.update.assert_called_once()
    kwargs = upd_tbl.update.call_args[0][0]
    assert kwargs["status"] == "partial"
    assert kwargs["suggestions_generated"] == 3
    assert "quota" in (kwargs.get("error_message") or "")


def test_start_generation_raises_when_meal_types_empty(pool_store):
    with pytest.raises(DatabaseException, match="meal_types"):
        pool_store.start_generation("hh", "u", "x", [])
