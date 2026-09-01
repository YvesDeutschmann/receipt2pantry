"""GlitchTip / Sentry-compatible error monitoring with PII-safe defaults."""

from __future__ import annotations

import copy
import logging
import re
from typing import Any

import sentry_sdk
from sentry_sdk.integrations.flask import FlaskIntegration
from sentry_sdk.integrations.logging import LoggingIntegration

from backend.utils.logger import get_logger

logger = get_logger(__name__)

_SENSITIVE_KEY_RE = re.compile(
    r"(authorization|token|secret|password|cookie|email|jwt|api[_-]?key|credential|session)",
    re.IGNORECASE,
)
_ALLOWED_REQUEST_HEADERS = frozenset(
    {"content-type", "user-agent", "x-request-id", "accept", "accept-language"}
)
_MAX_STRING_LEN = 500


def _is_sensitive_key(key: str) -> bool:
    return bool(_SENSITIVE_KEY_RE.search(str(key)))


def _truncate(value: Any) -> Any:
    if isinstance(value, str) and len(value) > _MAX_STRING_LEN:
        return value[:_MAX_STRING_LEN] + "…"
    return value


def _scrub_mapping(data: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(data, dict):
        return {}
    out: dict[str, Any] = {}
    for key, value in data.items():
        if _is_sensitive_key(key):
            out[key] = "[Filtered]"
        elif isinstance(value, dict):
            out[key] = _scrub_mapping(value)
        elif isinstance(value, list):
            out[key] = "[Filtered]"
        else:
            out[key] = _truncate(value)
    return out


def _scrub_request(event: dict[str, Any]) -> None:
    request = event.get("request")
    if not isinstance(request, dict):
        return

    request.pop("cookies", None)
    request.pop("data", None)
    request.pop("env", None)

    headers = request.get("headers")
    if isinstance(headers, dict):
        request["headers"] = {
            k: v
            for k, v in headers.items()
            if k.lower() in _ALLOWED_REQUEST_HEADERS and not _is_sensitive_key(k)
        }


def _scrub_user(event: dict[str, Any]) -> None:
    user = event.get("user")
    if not isinstance(user, dict):
        event.pop("user", None)
        return
    user_id = user.get("id")
    event["user"] = {"id": user_id} if user_id else {}


def scrub_event(event: dict[str, Any], hint: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """Default-deny PII scrubber for outbound error events."""
    if not isinstance(event, dict):
        return event

    cleaned = copy.deepcopy(event)
    _scrub_request(cleaned)
    _scrub_user(cleaned)

    if "extra" in cleaned:
        cleaned["extra"] = _scrub_mapping(cleaned.get("extra"))
    if "tags" in cleaned:
        cleaned["tags"] = _scrub_mapping(cleaned.get("tags"))
    if "contexts" in cleaned:
        cleaned["contexts"] = _scrub_mapping(cleaned.get("contexts"))

    return cleaned


def scrub_breadcrumb(crumb: dict[str, Any], hint: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """Strip sensitive data from breadcrumbs."""
    if not isinstance(crumb, dict):
        return crumb

    cleaned = copy.deepcopy(crumb)
    category = str(cleaned.get("category") or "").lower()
    if category in {"console", "xhr", "fetch", "http"}:
        cleaned.pop("data", None)
        cleaned.pop("message", None)
    elif "data" in cleaned and isinstance(cleaned["data"], dict):
        cleaned["data"] = _scrub_mapping(cleaned["data"])

    if "message" in cleaned:
        cleaned["message"] = _truncate(cleaned["message"])

    return cleaned


def init_monitoring(config: Any) -> None:
    """Initialize Sentry SDK (GlitchTip-compatible) when DSN is configured."""
    dsn = getattr(config, "SENTRY_DSN", None)
    if not dsn:
        logger.info("Monitoring DSN not configured; error tracking disabled")
        return

    environment = getattr(config, "SENTRY_ENVIRONMENT", None) or getattr(config, "FLASK_ENV", "development")
    release = getattr(config, "SENTRY_RELEASE", None)
    traces_sample_rate = float(getattr(config, "SENTRY_TRACES_SAMPLE_RATE", 0.05) or 0)

    sentry_sdk.init(
        dsn=dsn,
        integrations=[
            FlaskIntegration(),
            LoggingIntegration(level=logging.INFO, event_level=logging.ERROR),
        ],
        environment=environment,
        release=release,
        traces_sample_rate=traces_sample_rate,
        send_default_pii=False,
        max_request_body_size="never",
        before_send=scrub_event,
        before_breadcrumb=scrub_breadcrumb,
    )
    logger.info("Monitoring initialized (environment=%s)", environment)


def set_monitoring_user(user_id: str | None) -> None:
    """Attach opaque user id to monitoring scope (never email)."""
    if user_id:
        sentry_sdk.set_user({"id": user_id})
    else:
        sentry_sdk.set_user(None)


def capture_exception(exc: BaseException) -> str | None:
    """Capture exception and return event id when available."""
    return sentry_sdk.capture_exception(exc)


def capture_message(message: str, level: str = "info") -> str | None:
    """Capture a message event."""
    return sentry_sdk.capture_message(message, level=level)
