"""Request-scoped context (correlation ID) for structured logging and error tracking."""

from __future__ import annotations

import logging
import uuid
from contextvars import ContextVar

REQUEST_ID_HEADER = "X-Request-Id"
SYNC_ID_HEADER = "X-Sync-Id"

_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)


def get_request_id() -> str | None:
    """Return the current request correlation ID, if any."""
    return _request_id.get()


def set_request_id(request_id: str | None) -> None:
    """Set the current request correlation ID."""
    _request_id.set(request_id)


def resolve_request_id(inbound: str | None) -> str:
    """Accept inbound header or mint a new UUID4."""
    candidate = (inbound or "").strip()
    if candidate:
        return candidate
    return str(uuid.uuid4())


class RequestIdLogFilter(logging.Filter):
    """Inject correlation_id into log records for JSONFormatter."""

    def filter(self, record: logging.LogRecord) -> bool:
        request_id = get_request_id()
        if request_id:
            record.correlation_id = request_id
        return True
