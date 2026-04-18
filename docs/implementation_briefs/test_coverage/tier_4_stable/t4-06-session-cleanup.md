# T4-06 — `backend/workers/session_cleanup.py`

> **Tier:** 4 — Stable
> **Why worth testing:** Background thread that purges expired login sessions and closes browser contexts. A regression here leaks Playwright contexts (memory + CPU) until the process is restarted. No dedicated test file.

---

## 1. Technical Contract

- **File:** `backend/workers/session_cleanup.py`
- **Class:** `SessionCleanupWorker(session_manager, cleanup_interval=60)`
- **Methods (confirm from source):**
  - `start() -> None`
  - `stop() -> None`
  - `_run()` (internal loop).
- **Threading primitives:** `threading.Thread`, `threading.Event` (used for stop signaling).

---

## 2. Logic Guardrails

- **Double-start is a no-op:** calling `start()` twice does NOT spawn a second thread.
- **Stop is graceful:** `stop()` sets the event and joins the thread with a timeout. Must return within (cleanup_interval + small delta).
- **Exception isolation:** `session_manager.cleanup_expired()` raising must NOT kill the worker — log + continue.
- **Interval accuracy:** loop body uses `self._stop_event.wait(cleanup_interval)`, not `time.sleep`, so `stop()` is responsive.
- **No work before start:** constructing a worker does not spawn a thread.

---

## 3. Test-First Suite

Create `tests/backend/test_workers/test_session_cleanup.py` (new folder allowed).

### Test group A — lifecycle

1. `test_construction_does_not_start_thread`
2. `test_start_spawns_exactly_one_thread`
3. `test_double_start_does_not_spawn_second_thread`
4. `test_stop_joins_within_bounded_time`

### Test group B — loop behavior

5. `test_cleanup_called_on_each_interval_tick` (inject a tiny interval like 0.05 and assert multiple calls)
6. `test_cleanup_exception_does_not_kill_worker`
7. `test_stop_during_cleanup_waits_for_current_call_to_finish`

### Test group C — primitives

8. `test_uses_stop_event_wait_not_time_sleep` (patch `self._stop_event.wait` and assert it was called)

---

## 4. Definition of Done

- ≥ 7 test cases, using a mocked `session_manager`.
- Test 3 proves double-start safety.
- Test 6 proves the worker survives `session_manager` bugs.
- Test 8 guards against regressions to `time.sleep` (unresponsive to `stop`).
- Tests run deterministically without real timing dependencies beyond 0.05–0.2 s sleeps.
