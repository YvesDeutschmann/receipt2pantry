"""Area 1 launch-readiness security tests (JWT, CORS, IDOR, dev routes)."""

import json
import os
from unittest import mock

import pytest

from backend.config import ProductionConfig, is_unsafe_production_cors_origin
from backend.utils.exceptions import ConfigurationException

TEST_USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
TEST_USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"


class TestProductionCorsOriginGuard:
  def test_capacitor_localhost_is_safe(self):
    assert is_unsafe_production_cors_origin("capacitor://localhost") is False
    assert is_unsafe_production_cors_origin("ionic://localhost") is False

  def test_browser_localhost_is_unsafe(self):
    assert is_unsafe_production_cors_origin("http://localhost:5173") is True
    assert is_unsafe_production_cors_origin("https://localhost:3000") is True
    assert is_unsafe_production_cors_origin("http://127.0.0.1:5000") is True

  def test_lan_origin_is_unsafe(self):
    assert is_unsafe_production_cors_origin("http://192.168.50.57:5173") is True


class TestJwtSecretRequiredInProduction:
  def test_jwt_secret_required_in_production(self, monkeypatch):
    monkeypatch.setenv("FLASK_ENV", "production")
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.setenv("FLASK_SECRET_KEY", "prod-secret-not-default")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_KEY", "dummy-anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "dummy-service-key")
    monkeypatch.setenv("CORS_ORIGINS", "capacitor://localhost")

    with pytest.raises(ConfigurationException, match="SUPABASE_JWT_SECRET"):
      ProductionConfig.validate()


class TestCorsLocalhostBlockedInProduction:
  def test_localhost_cors_rejected_in_production(self, monkeypatch):
    monkeypatch.setenv("FLASK_ENV", "production")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "jwt-secret")
    monkeypatch.setenv("FLASK_SECRET_KEY", "prod-secret-not-default")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_KEY", "dummy-anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "dummy-service-key")
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:5173")

    with pytest.raises(ConfigurationException, match="CORS_ORIGINS"):
      ProductionConfig.validate()

  def test_capacitor_cors_allowed_in_production(self, monkeypatch):
    monkeypatch.setenv("FLASK_ENV", "production")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "jwt-secret")
    monkeypatch.setenv("FLASK_SECRET_KEY", "prod-secret-not-default")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_KEY", "dummy-anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "dummy-service-key")
    monkeypatch.setenv("CORS_ORIGINS", "capacitor://localhost")
    monkeypatch.setenv("SENTRY_DSN", "https://example.com/1")

    ProductionConfig.validate()

  def test_cors_localhost_blocked_on_prod_app(self, monkeypatch):
    """Prod-like app must not echo browser localhost in ACAO."""
    from backend.app import create_app
    from backend.config import Config

    class ProdLikeConfig(Config):
      DEBUG = False
      FLASK_ENV = "production"
      TESTING = True
      CORS_ORIGINS = "capacitor://localhost"

    monkeypatch.setenv("CORS_ORIGINS", "capacitor://localhost")
    app = create_app(ProdLikeConfig())
    client = app.test_client()
    resp = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    assert resp.headers.get("Access-Control-Allow-Origin") != "http://localhost:5173"


class TestAdminRouteIdor:
  def test_get_receipts_ignores_forged_query_user_id(self, client, mock_supabase_service, mocker):
    mocker.patch(
      "backend.routes.receipts.get_user_id_from_request",
      return_value=TEST_USER_A,
    )
    with client.application.app_context():
      client.application.config["SUPABASE_SERVICE"] = mock_supabase_service

    response = client.get(
      f"/api/receipts?user_id={TEST_USER_B}",
      headers={"X-User-Id": TEST_USER_A},
    )
    assert response.status_code == 200
    mock_supabase_service.get_user_receipts.assert_called_once_with(TEST_USER_A, 50)

  def test_get_receipts_requires_auth(self, client, mocker):
    mocker.patch("backend.routes.receipts.get_user_id_from_request", return_value=None)
    response = client.get(f"/api/receipts?user_id={TEST_USER_B}")
    assert response.status_code == 401

  def test_provider_status_ignores_forged_query_user_id(
    self, client, mock_supabase_service, mocker
  ):
    mocker.patch(
      "backend.routes.providers.get_user_id_from_request",
      return_value=TEST_USER_A,
    )
    mock_supabase_service.get_grocery_account.return_value = {
      "is_active": True,
      "last_successful_login": None,
      "mfa_required": False,
    }
    with client.application.app_context():
      client.application.config["SUPABASE_SERVICE"] = mock_supabase_service

    response = client.get(
      f"/api/providers/costco/status?user_id={TEST_USER_B}",
      headers={"X-User-Id": TEST_USER_A},
    )
    assert response.status_code == 200
    mock_supabase_service.get_grocery_account.assert_called_once_with(
      TEST_USER_A, "costco"
    )

  def test_store_costco_ignores_forged_body_user_id(
    self, client, mocker
  ):
    mocker.patch(
      "backend.routes.providers.get_user_id_from_request",
      return_value=TEST_USER_A,
    )
    store_mock = mocker.patch(
      "backend.routes.providers._store_and_process_fetched_receipts",
      return_value={
        "receipt_ids": [],
        "receipts_stored": 0,
        "errors": [],
        "items_added_to_pantry": 0,
      },
    )
    payload = {"receipts": [], "user_id": TEST_USER_B}
    response = client.post(
      "/api/providers/costco/store-receipts",
      data=json.dumps(payload),
      content_type="application/json",
      headers={"X-User-Id": TEST_USER_A},
    )
    assert response.status_code == 200
    store_mock.assert_called_once()
    assert store_mock.call_args[0][0] == TEST_USER_A


class TestDevLogGated:
  def test_dev_log_forbidden_when_not_debug(self, client):
    client.application.debug = False
    response = client.post(
      "/api/dev/log",
      data=json.dumps({"tag": "test", "msg": "hello"}),
      content_type="application/json",
    )
    assert response.status_code == 403

  def test_dev_log_allowed_when_debug(self, client):
    client.application.debug = True
    response = client.post(
      "/api/dev/log",
      data=json.dumps({"tag": "test", "msg": "hello"}),
      content_type="application/json",
    )
    assert response.status_code == 200
