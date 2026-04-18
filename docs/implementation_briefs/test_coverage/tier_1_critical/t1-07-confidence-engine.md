# T1-07 — `backend/services/confidence_engine.py`

> **Tier:** 1 — Critical
> **Why risky:** Drives tier assignment (cook_tonight / probably_have / check_first / suppressed), graveyard sweep, put-back rules, and health card. Already has the largest test file in the repo (~55 KB) — the job here is **gap coverage**, not from-scratch.

---

## 1. Technical Contract

- **File:** `backend/services/confidence_engine.py`
- **Public functions (22 total):** `compute_confidence`, `process_cook_event`, `process_put_back`, `run_expiry_cleanup`, `get_calibrated_days_supply`, `get_engagement_multiplier`, `_find_pantry_match` (imported by `suggestion_service` — promote or document).
- **Constants:** `PUT_BACK_CONFIDENCE_OVERRIDE = 0.85`, `USE_SOON_DAYS = 2`, `MAX_PUT_BACK_SUBCLASSES = {"raw_meat", "raw_fish"}`.
- **Time contract:** every function that reads `today` must accept it as a parameter; computed confidence is **never persisted** (except user-initiated `confidence_override`).

---

## 2. Logic Guardrails

- **Persistence rule:** computed `confidence` is read-model only. Tests must assert no writes occur during pure `compute_confidence` calls.
- **Put-back cap:** a user cannot put back more than `MAX_PUT_BACK_SUBCLASSES` items per (household, subclass) within the override window — confirm the exact policy in the file, then pin it.
- **Put-back override lifetime:** `confidence_override` is honored only while `confidence_override_expires >= today`. On `today == expires`, override is still active. On `today == expires + 1`, it is ignored.
- **Timezone:** `_deleted_at_for_day(today)` returns `datetime.combine(today, time.min, tzinfo=timezone.utc)`. No local-tz leakage allowed.
- **Calibration / engagement:** `get_calibrated_days_supply` and `get_engagement_multiplier` must accept deterministic inputs; no internal `date.today()` calls.
- **Tier edges:** `0.75`, `0.50`, `0.20` — test on-the-boundary values explicitly.
- **Underscored imports leak:** `suggestion_service` imports `_find_pantry_match` and `_to_date`. Either promote to public API or add a test that documents the coupling so accidental renames break CI.

---

## 3. Test-First Suite

Augment `tests/services/test_confidence_engine.py`. Focus on gaps only — do not rewrite what's covered.

### Test group A — boundary math (gap fill)

1. `test_tier_exactly_at_0_75_is_cook_tonight`
2. `test_tier_exactly_at_0_50_is_probably_have`
3. `test_tier_exactly_at_0_20_is_check_first`
4. `test_tier_below_0_20_is_suppressed`

### Test group B — override lifetime

5. `test_override_honored_when_today_equals_expires`
6. `test_override_ignored_when_today_equals_expires_plus_one`
7. `test_override_none_when_expires_is_none`

### Test group C — put-back policy

8. `test_put_back_allowed_for_raw_meat_within_subclass_cap`
9. `test_put_back_rejected_when_subclass_cap_exceeded`
10. `test_put_back_sets_override_to_0_85_and_expires_in_use_soon_window`

### Test group D — time-determinism

11. `test_compute_confidence_is_pure_accepts_today_parameter`
12. `test_run_expiry_cleanup_uses_provided_today_for_deleted_at_stamp`

### Test group E — coupling guard

13. `test_public_reexport_of_find_pantry_match` (either assert `find_pantry_match` exists publicly, or xfail-mark it to force a future promotion)

---

## 4. Definition of Done

- Boundary tests (A) are in place for all three tier thresholds.
- Time-boundary tests (B) cover expire-day and expire-day+1.
- Put-back cap is enforced by at least one failing-then-passing regression test.
- `_find_pantry_match` is either publicly re-exported OR test 13 marks the coupling as a known debt.
- Total test file grows by ≤ 15% — no rewriting existing cases.
