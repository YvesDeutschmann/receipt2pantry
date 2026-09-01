"""Tests for Supabase Vault and mock secrets services."""

import json
import logging
from unittest.mock import MagicMock

import pytest

from backend.services import secrets_service as secrets_service_module
from backend.services.secrets_service import (
    MockSecretsService,
    SupabaseVaultService,
    create_mock_secrets_service,
)
from backend.utils.exceptions import ConfigurationException, SecretsNotFoundException


def _mock_rpc_client(responses: dict[str, object]):
    """Build a mock Supabase client whose .rpc().execute() returns preset data."""
    client = MagicMock()

    def rpc(name, params=None):
        chain = MagicMock()
        payload = responses.get(name)
        if isinstance(payload, Exception):
            chain.execute.side_effect = payload
        else:
            result = MagicMock()
            result.data = payload
            chain.execute.return_value = result
        return chain

    client.rpc.side_effect = rpc
    return client


def test_vault_store_creates_when_secret_missing():
    client = _mock_rpc_client({"vault_get_secret_by_name": None})
    svc = SupabaseVaultService(client)

    key = svc.store_user_credentials("user-1", "costco", {"token": "abc"})

    assert key == "grocerysync:user-1:costco"
    assert client.rpc.call_args_list[0].args[0] == "vault_get_secret_by_name"
    create_calls = [c for c in client.rpc.call_args_list if c.args[0] == "vault_create_secret"]
    assert len(create_calls) == 1
    assert create_calls[0].args[1]["unique_name"] == "grocerysync:user-1:costco"


def test_vault_store_updates_when_secret_exists():
    client = _mock_rpc_client({"vault_get_secret_by_name": '{"token":"old"}'})
    svc = SupabaseVaultService(client)

    svc.store_user_credentials("user-1", "costco", {"token": "new"})

    update_calls = [
        c for c in client.rpc.call_args_list if c.args[0] == "vault_update_secret_by_name"
    ]
    assert len(update_calls) == 1
    assert update_calls[0].args[1]["new_secret"] == json.dumps({"token": "new"})


def test_vault_retrieve_parses_json():
    payload = {"refreshToken": "rt"}
    client = _mock_rpc_client({"vault_get_secret_by_name": json.dumps(payload)})
    svc = SupabaseVaultService(client)

    out = svc.retrieve_user_credentials("user-1", "costco")

    assert out == payload


def test_vault_retrieve_raises_when_missing():
    client = _mock_rpc_client({"vault_get_secret_by_name": None})
    svc = SupabaseVaultService(client)

    with pytest.raises(SecretsNotFoundException):
        svc.retrieve_user_credentials("user-1", "costco")


def test_vault_delete_calls_rpc():
    client = _mock_rpc_client({})
    svc = SupabaseVaultService(client)

    assert svc.delete_user_credentials("user-1", "costco") is True
    client.rpc.assert_called_with(
        "vault_delete_secret_by_name", {"secret_name": "grocerysync:user-1:costco"}
    )


def test_vault_decrypted_secret_never_logged(caplog):
    sensitive = "DO_NOT_LOG_THIS_PLAINTEXT_SECRET"
    client = _mock_rpc_client(
        {"vault_get_secret_by_name": json.dumps({"password": sensitive})}
    )
    svc = SupabaseVaultService(client)

    caplog.set_level(logging.INFO)
    svc_logger = secrets_service_module.logger
    svc_logger.addHandler(caplog.handler)
    try:
        svc.retrieve_user_credentials("user-9", "costco")
    finally:
        svc_logger.removeHandler(caplog.handler)

    combined = " ".join(r.getMessage() for r in caplog.records) + caplog.text
    assert sensitive not in combined


def test_mock_secrets_round_trip():
    svc = MockSecretsService()
    creds = {"username": "a@b.com", "password": "secret"}

    key = svc.store_user_credentials("u1", "costco", creds)
    assert key.startswith("mock-arn-")
    assert svc.retrieve_user_credentials("u1", "costco") == creds
    assert svc.rotate_credentials("u1", "costco", {"password": "new"}) is True
    assert svc.retrieve_user_credentials("u1", "costco") == {"password": "new"}
    assert svc.delete_user_credentials("u1", "costco") is True

    with pytest.raises(SecretsNotFoundException):
        svc.retrieve_user_credentials("u1", "costco")


def test_create_mock_secrets_service():
    svc = create_mock_secrets_service()
    assert isinstance(svc, MockSecretsService)


def test_mock_secrets_blocked_in_production(monkeypatch, mocker):
    """Production startup must fail when Vault (admin_client) is unavailable."""
    monkeypatch.setenv("FLASK_ENV", "production")
    monkeypatch.setenv("FLASK_SECRET_KEY", "prod-key-not-default")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-jwt-secret")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_KEY", "dummy-anon-key")
    monkeypatch.setenv("CORS_ORIGINS", "capacitor://localhost")

    mock_sb = MagicMock()
    mock_sb.admin_client = None
    mocker.patch(
        "backend.services.supabase_service.create_supabase_service",
        return_value=mock_sb,
    )
    mocker.patch(
        "backend.services.receipt_processor.create_receipt_processor",
        return_value=MagicMock(),
    )

    from backend.config import ProductionConfig
    from backend.app import create_app

    with pytest.raises(ConfigurationException, match="Supabase Vault is required"):
        create_app(ProductionConfig())


def test_production_uses_vault_when_admin_client_available(monkeypatch, mocker):
    """Production with service role selects SupabaseVaultService, not mock."""
    monkeypatch.setenv("FLASK_ENV", "production")
    monkeypatch.setenv("FLASK_SECRET_KEY", "prod-key-not-default")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-jwt-secret")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_KEY", "dummy-anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "dummy-service-key")
    monkeypatch.setenv("CORS_ORIGINS", "capacitor://localhost")

    mocker.patch("backend.services.supabase_service.create_client", return_value=MagicMock())
    mocker.patch(
        "backend.services.receipt_processor.ReceiptProcessor",
        return_value=MagicMock(),
    )

    from backend.config import ProductionConfig
    from backend.app import create_app
    from backend.services.secrets_service import SupabaseVaultService

    app = create_app(ProductionConfig())
    assert isinstance(app.config["SECRETS_SERVICE"], SupabaseVaultService)
