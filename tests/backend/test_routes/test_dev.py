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
