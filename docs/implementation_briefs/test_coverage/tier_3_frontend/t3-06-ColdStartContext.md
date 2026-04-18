# T3-06 — `frontend/src/contexts/ColdStartContext.jsx`

> **Tier:** 3 — Frontend
> **Why risky:** Coordinates the "first-time user" progress bar and the handoff between `OnboardingContext` and the receipt-sync hooks. Small surface, but a regression here flips the UI between two confusing states. No dedicated test file today.

---

## 1. Technical Contract

- **File:** `frontend/src/contexts/ColdStartContext.jsx`
- **Exports:** `ColdStartProvider`, `useColdStart`.
- **Context value:** progress state (current step, total steps, label) and setters used by the progress bar and hooks.

---

## 2. Logic Guardrails

- **Idempotent updates:** setting the same progress value twice must not trigger a rerender beyond the first.
- **Clamp range:** `current <= total`; negative current is treated as 0; setting `current > total` clamps to `total` (or throws — pin current behavior).
- **Completion signal:** when `current === total`, subscribers read the "complete" flag as true.
- **Stable reference:** the context value should be memoized.
- **Provider placement:** `useColdStart` outside provider throws.

---

## 3. Test-First Suite

Create `frontend/src/tests/ColdStartContext.test.jsx` (new).

### Test group A — hook enforcement

1. `test_useColdStart_throws_outside_provider`

### Test group B — progress updates

2. `test_setProgress_updates_current_and_total`
3. `test_setProgress_is_idempotent_for_same_values`
4. `test_progress_clamped_when_current_exceeds_total`
5. `test_progress_clamped_to_zero_when_current_negative`

### Test group C — completion

6. `test_complete_flag_true_when_current_equals_total`
7. `test_complete_flag_false_when_current_less_than_total`

### Test group D — stability

8. `test_context_value_is_memoized_when_setters_unchanged`

---

## 4. Definition of Done

- Tests 4–5 pin the clamping policy explicitly (either clamp or throw — no accidental drift).
- Idempotency (test 3) prevents UI flicker.
- Memoization test (8) prevents `ColdStartProgressBar` from re-rendering unnecessarily.
- No external network mocks needed — this is pure React state.
