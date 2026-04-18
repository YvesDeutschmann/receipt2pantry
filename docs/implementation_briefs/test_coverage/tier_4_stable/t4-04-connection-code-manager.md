# T4-04 — `backend/services/connection_code_manager.py`

> **Tier:** 4 — Stable
> **Why worth testing:** Manages temporary connection codes used in the user-assisted token-extraction flow. Small but concurrency-sensitive (uses `threading.Lock`) and time-dependent (10-minute expiry). No dedicated test file.

---

## 1. Technical Contract

- **File:** `backend/services/connection_code_manager.py`
- **Class:** `ConnectionCodeManager(expiry_minutes=10)`
- **Methods (confirm signatures from source):**
  - `generate_code(user_id) -> str`
  - `validate_code(code) -> Optional[Dict]`
  - `consume_code(code)` / revoke.
- **Storage:** in-memory `self._codes: Dict[str, Dict]` guarded by `self._lock`.

---

## 2. Logic Guardrails

- **Uniqueness:** generated codes are cryptographically random; collision probability tests should assert `secrets.token_urlsafe` usage.
- **Expiry:** `expires_at = now + timedelta(minutes=expiry_minutes)`. Time-Determinism violation if `now` cannot be injected — flag and refactor to accept `now` parameter.
- **One-shot consumption:** `consume_code` must remove / invalidate the entry; validating the same code twice after consumption returns `None`.
- **Thread safety:** concurrent `generate_code` + `consume_code` must not corrupt the dict. Test with a small threadpool.
- **No PII in logs:** log the code fingerprint (first 4 chars), never the full code.

---

## 3. Test-First Suite

Create `tests/backend/test_services/test_connection_code_manager.py`.

### Test group A — happy path

1. `test_generate_code_returns_urlsafe_string`
2. `test_validate_code_returns_entry_when_valid_and_unexpired`
3. `test_validate_code_returns_none_for_unknown_code`

### Test group B — expiry

4. `test_validate_code_returns_none_when_expired` (inject `now`)
5. `test_expiry_uses_injected_expiry_minutes`

### Test group C — consumption

6. `test_consume_code_makes_it_invalid_for_next_call`
7. `test_consume_unknown_code_is_noop_or_explicit_error` (pin)

### Test group D — thread safety

8. `test_concurrent_generate_and_consume_does_not_corrupt_store` (small threadpool, join, assert invariants)

### Test group E — logging

9. `test_full_code_never_logged`

---

## 4. Definition of Done

- Refactor: `generate_code` and `validate_code` accept `now: datetime | None = None`.
- ≥ 7 test cases.
- Thread-safety test (8) runs deterministically (not a flaky sleep-based test).
- No full code in logs (test 9, caplog assertion).
