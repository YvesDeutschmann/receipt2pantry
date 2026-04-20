"""Tests for `ConnectionCodeManager` — time injection, consumption, threading, logging."""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from queue import Queue

import pytest

from backend.services.connection_code_manager import ConnectionCodeManager


def test_generate_code_returns_urlsafe_string(mocker):
    mgr = ConnectionCodeManager()
    spy = mocker.patch(
        "backend.services.connection_code_manager.secrets.token_urlsafe",
        return_value="fixturetoken",
    )
    code = mgr.generate_code("user-1")
    spy.assert_called_once()
    assert code == "fixturetoken"


def test_validate_code_returns_entry_when_valid_and_unexpired():
    mgr = ConnectionCodeManager()
    anchor = datetime(2024, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
    code = mgr.generate_code("user-1", now=anchor)
    info = mgr.validate_code(code, now=anchor + timedelta(minutes=1))
    assert info is not None
    assert info["user_id"] == "user-1"
    assert info["status"] == "pending"
    assert info["expires_at"] == anchor + timedelta(minutes=mgr.expiry_minutes)


def test_validate_code_returns_none_for_unknown_code():
    mgr = ConnectionCodeManager()
    assert mgr.validate_code("not-a-real-code") is None


def test_validate_code_returns_none_when_expired():
    mgr = ConnectionCodeManager()
    anchor = datetime(2024, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    code = mgr.generate_code("user-1", now=anchor)
    assert (
        mgr.validate_code(code, now=anchor + timedelta(minutes=mgr.expiry_minutes + 1))
        is None
    )


def test_expiry_uses_injected_expiry_minutes():
    expiry_minutes = 3
    mgr = ConnectionCodeManager(expiry_minutes=expiry_minutes)
    anchor = datetime(2024, 3, 1, 10, 0, 0, tzinfo=timezone.utc)
    code = mgr.generate_code("user-1", now=anchor)
    assert mgr.validate_code(code, now=anchor + timedelta(minutes=2)) is not None
    assert mgr.validate_code(code, now=anchor + timedelta(minutes=expiry_minutes + 1)) is None


def test_consume_code_makes_it_invalid_for_next_call():
    mgr = ConnectionCodeManager()
    code = mgr.generate_code("user-1")
    assert mgr.validate_code(code) is not None
    assert mgr.consume_code(code) is True
    assert mgr.validate_code(code) is None


def test_consume_unknown_code_is_noop_or_explicit_error():
    mgr = ConnectionCodeManager()
    assert mgr.consume_code("unknown-code") is False


def test_concurrent_generate_and_consume_does_not_corrupt_store():
    mgr = ConnectionCodeManager()
    q: Queue[str] = Queue()
    per_producer = 10
    producers_n = 4
    consumers_n = 4

    def producer():
        for _ in range(per_producer):
            q.put(mgr.generate_code("user-concurrent"))

    def consumer():
        for _ in range(per_producer):
            c = q.get()
            assert mgr.consume_code(c) is True

    with ThreadPoolExecutor(max_workers=producers_n + consumers_n) as ex:
        futs = [ex.submit(producer) for _ in range(producers_n)] + [
            ex.submit(consumer) for _ in range(consumers_n)
        ]
        for f in as_completed(futs):
            f.result()

    assert mgr._codes == {}


def test_full_code_never_logged(caplog, mocker):
    caplog.set_level(logging.INFO)
    secret = "FULL_SECRET_CODE_SHOULD_NOT_APPEAR_IN_LOGS"
    mocker.patch(
        "backend.services.connection_code_manager.secrets.token_urlsafe",
        return_value=secret,
    )
    mgr = ConnectionCodeManager()
    code = mgr.generate_code("user-logtest")
    mgr.mark_connected(code)
    mgr.consume_code(
        mgr.generate_code("user-logtest-2")
    )  # second code so consume logs

    combined = " ".join(r.getMessage() for r in caplog.records)
    assert secret not in combined
