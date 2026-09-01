"""Area 3 monitoring configuration and PII scrubbing checks."""

import os

import pytest

from backend.config import ProductionConfig
from backend.utils.exceptions import ConfigurationException
from backend.utils.monitoring import init_monitoring, scrub_event


def test_monitoring_dsn_required_in_production(monkeypatch):
    """MONITORING_DSN_REQUIRED_IN_PRODUCTION"""
    monkeypatch.setenv("FLASK_ENV", "production")
    monkeypatch.setenv("FLASK_SECRET_KEY", "audit-probe-not-dev-default-key")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-jwt-secret")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_KEY", "audit-dummy-anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "audit-dummy-service-key")
    monkeypatch.setenv("CORS_ORIGINS", "capacitor://localhost")
    monkeypatch.delenv("SENTRY_DSN", raising=False)

    with pytest.raises(ConfigurationException, match="SENTRY_DSN"):
        ProductionConfig.validate()


def test_init_monitoring_uses_safe_defaults(mocker):
    """send_default_pii=False and max_request_body_size=never at init."""
    init_mock = mocker.patch("backend.utils.monitoring.sentry_sdk.init")

    class _Cfg:
        SENTRY_DSN = "https://example.com/1"
        SENTRY_ENVIRONMENT = "testing"
        SENTRY_RELEASE = "abc123"
        SENTRY_TRACES_SAMPLE_RATE = 0.05
        FLASK_ENV = "testing"

    init_monitoring(_Cfg())
    assert init_mock.called
    kwargs = init_mock.call_args.kwargs
    assert kwargs["send_default_pii"] is False
    assert kwargs["max_request_body_size"] == "never"


def test_monitoring_no_pii_in_events():
    """MONITORING_NO_PII_IN_EVENTS"""
    event = {
        "request": {
            "headers": {
                "Authorization": "Bearer secret-token",
                "X-User-Id": "user-123",
                "Cookie": "session=abc",
                "Content-Type": "application/json",
                "User-Agent": "MealdTest/1.0",
            },
            "data": '{"email":"user@example.com","receipt":"secret"}',
            "cookies": {"session": "abc"},
        },
        "user": {"id": "opaque-uuid", "email": "user@example.com"},
        "extra": {"token": "abc", "matchCount": 3},
        "tags": {"jwt": "hidden"},
    }

    cleaned = scrub_event(event)
    assert cleaned is not None
    assert "data" not in cleaned["request"]
    assert "cookies" not in cleaned["request"]
    assert "Authorization" not in cleaned["request"]["headers"]
    assert "Cookie" not in cleaned["request"]["headers"]
    assert cleaned["user"] == {"id": "opaque-uuid"}
    assert cleaned["extra"]["token"] == "[Filtered]"
    assert cleaned["extra"]["matchCount"] == 3
    assert cleaned["tags"]["jwt"] == "[Filtered]"
