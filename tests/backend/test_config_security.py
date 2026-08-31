"""Area 1 production config security checks."""

import os

import pytest

from backend.config import ProductionConfig, is_unsafe_production_cors_origin
from backend.utils.exceptions import ConfigurationException


def test_jwt_secret_required_in_production(monkeypatch):
    """ProductionConfig.validate() must fail when SUPABASE_JWT_SECRET is unset."""
    monkeypatch.setenv("FLASK_ENV", "production")
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.setenv("FLASK_SECRET_KEY", "audit-probe-not-dev-default-key")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_KEY", "audit-dummy-anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "audit-dummy-service-key")
    monkeypatch.setenv("CORS_ORIGINS", "capacitor://localhost")

    with pytest.raises(ConfigurationException, match="SUPABASE_JWT_SECRET"):
        ProductionConfig.validate()


@pytest.mark.parametrize(
    "origin,unsafe",
    [
        ("http://localhost:5173", True),
        ("https://localhost:3000", True),
        ("http://127.0.0.1:5000", True),
        ("http://192.168.50.57:5173", True),
        ("capacitor://localhost", False),
        ("ionic://localhost", False),
        ("https://api.example.com", False),
    ],
)
def test_is_unsafe_production_cors_origin(origin, unsafe):
    assert is_unsafe_production_cors_origin(origin) is unsafe


def test_cors_localhost_blocked_in_production(monkeypatch):
    """ProductionConfig rejects browser localhost/LAN CORS origins."""
    monkeypatch.setenv("FLASK_ENV", "production")
    monkeypatch.setenv("FLASK_SECRET_KEY", "audit-probe-not-dev-default-key")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-jwt-secret")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_KEY", "audit-dummy-anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "audit-dummy-service-key")
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:5173")

    with pytest.raises(ConfigurationException, match="CORS_ORIGINS"):
        ProductionConfig.validate()


def test_cors_capacitor_allowed_in_production(monkeypatch):
    """Capacitor WebView origin must pass production CORS validation."""
    monkeypatch.setenv("FLASK_ENV", "production")
    monkeypatch.setenv("FLASK_SECRET_KEY", "audit-probe-not-dev-default-key")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-jwt-secret")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_KEY", "audit-dummy-anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "audit-dummy-service-key")
    monkeypatch.setenv("CORS_ORIGINS", "capacitor://localhost")
    monkeypatch.setenv("SENTRY_DSN", "https://example.com/1")

    ProductionConfig.validate()
