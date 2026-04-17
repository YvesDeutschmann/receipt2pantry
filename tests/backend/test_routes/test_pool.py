"""Tests for suggestion pool API routes."""

from unittest.mock import MagicMock

import pytest


@pytest.fixture
def pool_store():
    return MagicMock()


@pytest.fixture
def pool_generator():
    return MagicMock()


@pytest.fixture
def household_service():
    hs = MagicMock()
    hs.get_household_id.return_value = "hh-1"
    hs.get_household.return_value = {
        "suggestion_meal_slots": {"breakfast": True, "lunch": False, "dinner": True}
    }
    return hs


@pytest.fixture
def app_with_pool(app, pool_store, pool_generator, household_service):
    app.config["POOL_STORE_SERVICE"] = pool_store
    app.config["POOL_GENERATOR"] = pool_generator
    app.config["HOUSEHOLD_SERVICE"] = household_service
    return app


@pytest.fixture
def client_pool(app_with_pool):
    return app_with_pool.test_client()


def test_get_pool_returns_grouped_by_meal(client_pool, pool_store):
    pool_store.get_pool_grouped_by_meal.return_value = {
        "breakfast": [{"id": "s1", "recipe_id": "1"}],
        "lunch": [],
        "dinner": [],
    }

    res = client_pool.get("/api/suggestions/pool", headers={"X-User-Id": "user-1"})
    assert res.status_code == 200
    data = res.get_json()
    assert data["household_id"] == "hh-1"
    assert "pool" in data
    assert len(data["pool"]["breakfast"]) == 1


def test_get_pool_depth_returns_per_slot_counts(client_pool, pool_store):
    pool_store.get_pool_depth.return_value = {
        "breakfast": 2,
        "lunch": 1,
        "dinner": 0,
    }

    res = client_pool.get(
        "/api/suggestions/pool/depth", headers={"X-User-Id": "user-1"}
    )
    assert res.status_code == 200
    assert res.get_json()["depth"]["breakfast"] == 2


def test_post_swipe_updates_status_to_swiped(client_pool, pool_store):
    pool_store.update_status.return_value = True

    res = client_pool.post(
        "/api/suggestions/pool/sug-uuid/swipe",
        json={"household_id": "hh-1"},
        headers={"X-User-Id": "user-1"},
    )
    assert res.status_code == 200
    assert res.get_json()["ok"] is True
    pool_store.update_status.assert_called_once_with(
        "sug-uuid", "hh-1", "swiped"
    )


def test_post_generate_accepts_all_four_trigger_reasons(
    client_pool, pool_generator, household_service
):
    pool_generator.generate_pool.return_value = {
        "generation_id": "g1",
        "status": "completed",
        "suggestions_generated": 5,
        "error": None,
    }

    for reason in (
        "onboarding",
        "receipt_scan",
        "manual_refresh",
        "low_watermark",
    ):
        res = client_pool.post(
            "/api/suggestions/pool/generate",
            json={"trigger_reason": reason, "household_id": "hh-1"},
            headers={"X-User-Id": "user-1"},
        )
        assert res.status_code == 200, (reason, res.get_json())
        pool_generator.generate_pool.reset_mock()


def test_post_generate_rejects_invalid_trigger_reason(client_pool, pool_generator):
    res = client_pool.post(
        "/api/suggestions/pool/generate",
        json={"trigger_reason": "invalid", "household_id": "hh-1"},
        headers={"X-User-Id": "user-1"},
    )
    assert res.status_code == 400
    pool_generator.generate_pool.assert_not_called()


def test_post_generate_returns_already_running_status(client_pool, pool_generator):
    pool_generator.generate_pool.return_value = {
        "generation_id": "g-existing",
        "status": "already_running",
        "suggestions_generated": 0,
    }

    res = client_pool.post(
        "/api/suggestions/pool/generate",
        json={"trigger_reason": "receipt_scan", "household_id": "hh-1"},
        headers={"X-User-Id": "user-1"},
    )
    assert res.status_code == 200
    assert res.get_json()["status"] == "already_running"
