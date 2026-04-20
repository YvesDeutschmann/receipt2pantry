"""Tests for SessionCleanupWorker (session_cleanup worker)."""

import threading
import time
from unittest.mock import MagicMock, patch

import pytest

from backend.workers.session_cleanup import SessionCleanupWorker


@pytest.fixture
def session_manager():
    mock = MagicMock()
    mock.cleanup_expired_sessions.return_value = 0
    return mock


def test_construction_does_not_start_thread(session_manager):
    worker = SessionCleanupWorker(session_manager, cleanup_interval=60)
    assert worker._thread is None
    assert not worker.is_running()
    assert not worker._stop_event.is_set()


def test_start_spawns_exactly_one_thread(session_manager):
    worker = SessionCleanupWorker(session_manager, cleanup_interval=0.05)
    worker.start()
    try:
        assert worker._thread is not None
        assert worker._thread.is_alive()
        assert worker.is_running()
    finally:
        worker.stop(timeout=5)


def test_double_start_does_not_spawn_second_thread(session_manager):
    worker = SessionCleanupWorker(session_manager, cleanup_interval=0.05)
    worker.start()
    try:
        first = worker._thread
        worker.start()
        second = worker._thread
        assert first is second
        assert first.is_alive()
    finally:
        worker.stop(timeout=5)


def test_stop_joins_within_bounded_time(session_manager):
    """stop() must return quickly once the worker is idle (event set + join)."""
    interval = 0.05
    worker = SessionCleanupWorker(session_manager, cleanup_interval=interval)
    worker.start()
    t0 = time.monotonic()
    worker.stop(timeout=5)
    elapsed = time.monotonic() - t0
    # Bounded: default join timeout caps worst case; typical exit is immediate after wait unblocks.
    assert elapsed < interval + 2.0
    assert not worker.is_running()


def test_cleanup_called_on_each_interval_tick(session_manager):
    interval = 0.05
    worker = SessionCleanupWorker(session_manager, cleanup_interval=interval)
    worker.start()
    try:
        time.sleep(0.28)
        assert session_manager.cleanup_expired_sessions.call_count >= 4
    finally:
        worker.stop(timeout=5)


def test_cleanup_exception_does_not_kill_worker(session_manager):
    interval = 0.05
    call_lock = threading.Lock()
    calls = []

    def side_effect():
        with call_lock:
            n = len(calls)
            calls.append(n)
        if n < 2:
            raise RuntimeError("cleanup boom")
        return 0

    session_manager.cleanup_expired_sessions.side_effect = side_effect
    worker = SessionCleanupWorker(session_manager, cleanup_interval=interval)
    worker.start()
    try:
        deadline = time.monotonic() + 1.5
        while time.monotonic() < deadline:
            with call_lock:
                if len(calls) >= 3:
                    break
            time.sleep(0.02)
        with call_lock:
            assert len(calls) >= 3
    finally:
        worker.stop(timeout=5)


def test_stop_during_cleanup_waits_for_current_call_to_finish(session_manager):
    in_cleanup = threading.Event()
    release_cleanup = threading.Event()

    def slow_cleanup():
        in_cleanup.set()
        release_cleanup.wait(timeout=10)
        return 0

    session_manager.cleanup_expired_sessions.side_effect = slow_cleanup
    worker = SessionCleanupWorker(session_manager, cleanup_interval=60)
    worker.start()
    assert in_cleanup.wait(timeout=2)

    stop_completed = threading.Event()

    def run_stop():
        worker.stop(timeout=10)
        stop_completed.set()

    t = threading.Thread(target=run_stop)
    t.start()
    time.sleep(0.05)
    assert not stop_completed.is_set()
    release_cleanup.set()
    assert stop_completed.wait(timeout=5)
    t.join(timeout=1)
    assert not t.is_alive()


def test_uses_stop_event_wait_not_time_sleep(session_manager):
    interval = 0.05
    worker = SessionCleanupWorker(session_manager, cleanup_interval=interval)
    # Patch session_cleanup.time.sleep without using time.sleep() in this test — patching
    # targets the stdlib `time` module singleton and would otherwise capture our delay too.
    with patch("backend.workers.session_cleanup.time.sleep") as sleep_mock:
        with patch.object(worker._stop_event, "wait", wraps=worker._stop_event.wait) as wait_mock:
            worker.start()
            try:
                threading.Event().wait(0.12)
            finally:
                worker.stop(timeout=5)
    sleep_mock.assert_not_called()
    assert wait_mock.called
    wait_mock.assert_any_call(timeout=interval)
