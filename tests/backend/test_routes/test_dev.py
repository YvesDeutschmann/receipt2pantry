"""Tests for dev-only routes and DEV_LOG_ENABLED gate."""

import json

import pytest

from backend.app import create_app
from backend.config import Config
from backend.routes.dev import reset_dev_log_rate_limit_for_tests


class ProdLikeConfig(Config):
    TESTING = True
    DEBUG = False
    FLASK_ENV = "testing"
    SUPABASE_URL = None
    SUPABASE_KEY = None
    SUPABASE_SERVICE_ROLE_KEY = None
    OPENAI_API_KEY = None


@pytest.fixture
def prod_client():
    app = create_app(ProdLikeConfig())
    app.config.update({"TESTING": True, "DEBUG": False, "DEV_LOG_ENABLED": False})
    with app.test_client() as client:
        yield client


@pytest.fixture(autouse=True)
def clear_dev_log_rate_limit():
    reset_dev_log_rate_limit_for_tests()
    yield
    reset_dev_log_rate_limit_for_tests()


def test_dev_log_returns_403_when_debug_off_and_flag_off(prod_client):
    response = prod_client.post(
        "/api/dev/log",
        data="costcoLogin|hello",
        content_type="text/plain;charset=UTF-8",
    )
    assert response.status_code == 403


def test_dev_log_returns_200_when_flag_enabled(prod_client):
    prod_client.application.config["DEV_LOG_ENABLED"] = True
    response = prod_client.post(
        "/api/dev/log",
        data="costcoLogin|hello",
        content_type="text/plain;charset=UTF-8",
    )
    assert response.status_code == 200
    data = json.loads(response.data)
    assert data["ok"] is True


def test_reset_onboarding_still_403_when_dev_log_flag_on(prod_client):
    prod_client.application.config["DEV_LOG_ENABLED"] = True
    response = prod_client.delete("/api/dev/reset-onboarding")
    assert response.status_code == 403


def test_load_mock_receipts_still_403_when_dev_log_flag_on(prod_client):
    prod_client.application.config["DEV_LOG_ENABLED"] = True
    response = prod_client.post(
        "/api/dev/load-mock-receipts",
        json={"provider": "costco"},
    )
    assert response.status_code == 403


def test_freshen_mock_receipt_dates_rewrites_order_date_without_mutating_source():
    from datetime import date

    from backend.routes.dev import freshen_mock_receipt_dates

    original = [
        {
            "order_id": "dev-mock-SW-001",
            "order_date": "2026-01-10",
            "date": "2026-01-10T11:00:00.000Z",
            "items": [{"name": "Organic Bananas"}],
        },
        {
            "order_id": "dev-mock-CC-001",
            "order_date": "2026-04-18",
            "date": "2026-04-18",
            "items": [{"name": "Quinoa"}],
        },
    ]
    today = date(2026, 9, 8)
    out = freshen_mock_receipt_dates(original, today=today)

    assert original[0]["order_date"] == "2026-01-10"
    assert original[1]["date"] == "2026-04-18"
    assert out[0]["order_date"] == "2026-09-08"
    assert out[0]["date"].startswith("2026-09-08T")
    assert out[1]["order_date"] == "2026-09-08"
    assert out[1]["date"] == "2026-09-08"


def test_load_mock_receipts_freshens_dates_before_store(debug_client, mocker):
    from datetime import date

    captured = []

    def fake_store(_user_id, provider, receipts):
        captured.append((provider, receipts))
        return {
            "receipts_stored": len(receipts),
            "receipt_ids": [f"{provider}-1"],
            "errors": [],
            "items_added_to_pantry": 1,
        }

    mocker.patch(
        "backend.routes.providers._store_and_process_fetched_receipts",
        side_effect=fake_store,
    )
    debug_client.application.config["SUPABASE_SERVICE"] = mocker.MagicMock()

    response = debug_client.post(
        "/api/dev/load-mock-receipts",
        json={"provider": "all", "reset": False},
        headers={"X-User-Id": "user-1"},
    )
    assert response.status_code == 200
    assert {p for p, _ in captured} == {"safeway", "costco"}
    today = date.today().isoformat()
    for _provider, recs in captured:
        assert recs
        for rec in recs:
            assert rec["order_date"] == today


def test_dev_log_rejects_oversized_body(prod_client):
    prod_client.application.config["DEV_LOG_ENABLED"] = True
    response = prod_client.post(
        "/api/dev/log",
        data="x" * 5000,
        content_type="text/plain;charset=UTF-8",
    )
    assert response.status_code == 413


def test_dev_log_rate_limit_returns_429(prod_client):
    prod_client.application.config["DEV_LOG_ENABLED"] = True
    for _ in range(60):
        response = prod_client.post(
            "/api/dev/log",
            data="costcoLogin|ping",
            content_type="text/plain;charset=UTF-8",
        )
        assert response.status_code == 200
    response = prod_client.post(
        "/api/dev/log",
        data="costcoLogin|ping",
        content_type="text/plain;charset=UTF-8",
    )
    assert response.status_code == 429


def test_dev_log_strips_control_characters(prod_client, mocker):
    prod_client.application.config["DEV_LOG_ENABLED"] = True
    log_mock = mocker.patch("backend.routes.dev.logger.info")
    response = prod_client.post(
        "/api/dev/log",
        data="costcoLogin|hello\x07world",
        content_type="text/plain;charset=UTF-8",
    )
    assert response.status_code == 200
    log_mock.assert_called_once()
    assert "helloworld" in log_mock.call_args[0][0]


def test_dev_log_rate_limit_not_bypassed_by_spoofed_x_forwarded_for(prod_client):
    """Rate limit keys on Fly-Client-IP / remote_addr, not client X-Forwarded-For."""
    prod_client.application.config["DEV_LOG_ENABLED"] = True
    for i in range(60):
        response = prod_client.post(
            "/api/dev/log",
            data="costcoLogin|ping",
            content_type="text/plain;charset=UTF-8",
            headers={"X-Forwarded-For": f"10.0.0.{i}"},
        )
        assert response.status_code == 200
    response = prod_client.post(
        "/api/dev/log",
        data="costcoLogin|ping",
        content_type="text/plain;charset=UTF-8",
        headers={"X-Forwarded-For": "10.0.0.99"},
    )
    assert response.status_code == 429


def test_dev_log_uses_fly_client_ip_when_present(prod_client):
    prod_client.application.config["DEV_LOG_ENABLED"] = True
    for i in range(60):
        response = prod_client.post(
            "/api/dev/log",
            data="costcoLogin|ping",
            content_type="text/plain;charset=UTF-8",
            headers={"Fly-Client-IP": "203.0.113.50"},
        )
        assert response.status_code == 200
    response = prod_client.post(
        "/api/dev/log",
        data="costcoLogin|ping",
        content_type="text/plain;charset=UTF-8",
        headers={"Fly-Client-IP": "203.0.113.50"},
    )
    assert response.status_code == 429


@pytest.fixture
def debug_client():
    app = create_app(ProdLikeConfig())
    app.config.update({"TESTING": True, "DEBUG": True, "DEV_LOG_ENABLED": False})
    with app.test_client() as client:
        yield client


def test_cook_loop_reset_403_when_debug_off(prod_client):
    for path in ("/api/dev/cook-loop/reset", "/api/dev/cook-loop/run"):
        response = prod_client.post(path)
        assert response.status_code == 403
    response = prod_client.get("/api/dev/cook-loop/report")
    assert response.status_code == 403


def test_cook_loop_reset_401_without_user(debug_client):
    response = debug_client.post("/api/dev/cook-loop/reset")
    assert response.status_code == 401


def test_cook_loop_reset_400_without_household(debug_client, mocker):
    mock_supabase = mocker.MagicMock()
    mock_supabase.get_user_household.return_value = None
    debug_client.application.config["SUPABASE_SERVICE"] = mock_supabase
    response = debug_client.post(
        "/api/dev/cook-loop/reset",
        headers={"X-User-Id": "user-1"},
    )
    assert response.status_code == 400
    assert "Household" in json.loads(response.data)["error"]


def test_cook_loop_run_returns_graded_report(debug_client, mocker):
    mock_supabase = mocker.MagicMock()
    mock_supabase.get_user_household.return_value = {"id": "hh-1"}
    mock_pantry = mocker.MagicMock()
    mock_pool = mocker.MagicMock()
    debug_client.application.config["SUPABASE_SERVICE"] = mock_supabase
    debug_client.application.config["PANTRY_SERVICE"] = mock_pantry
    debug_client.application.config["POOL_STORE_SERVICE"] = mock_pool

    report = {
        "ok": True,
        "recipe_id": "dev_cook_loop",
        "mode": "run",
        "checks": [{"id": "touched_bases", "ok": True}],
        "pool_suggestion_id": "pool-1",
        "logged_at": "2026-01-01T00:00:00+00:00",
    }
    mock_svc = mocker.MagicMock()
    mock_svc.run_async = mocker.AsyncMock(return_value=report)
    mocker.patch(
        "backend.routes.dev._get_cook_loop_sandbox_service",
        return_value=mock_svc,
    )

    response = debug_client.post(
        "/api/dev/cook-loop/run",
        headers={"X-User-Id": "user-1"},
    )
    assert response.status_code == 200
    data = json.loads(response.data)
    assert data["ok"] is True
    assert data["recipe_id"] == "dev_cook_loop"


def test_cook_loop_report_observe(debug_client, mocker):
    mock_supabase = mocker.MagicMock()
    mock_supabase.get_user_household.return_value = {"id": "hh-1"}
    debug_client.application.config["SUPABASE_SERVICE"] = mock_supabase
    debug_client.application.config["PANTRY_SERVICE"] = mocker.MagicMock()
    debug_client.application.config["POOL_STORE_SERVICE"] = mocker.MagicMock()

    mock_svc = mocker.MagicMock()
    mock_svc.grade.return_value = {
        "ok": False,
        "recipe_id": "dev_cook_loop",
        "mode": "observe",
        "checks": [{"id": "pool_status", "ok": False}],
        "logged_at": "2026-01-01T00:00:00+00:00",
    }
    mocker.patch(
        "backend.routes.dev._get_cook_loop_sandbox_service",
        return_value=mock_svc,
    )

    response = debug_client.get(
        "/api/dev/cook-loop/report",
        headers={"X-User-Id": "user-1"},
    )
    assert response.status_code == 200
    data = json.loads(response.data)
    assert data["ok"] is False
    assert data["mode"] == "observe"
