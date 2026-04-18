# T4-05 — `backend/services/household_service.py`

> **Tier:** 4 — Stable
> **Why worth testing:** 13 methods, already well-covered by `tests/services/test_household_service.py` (~17 KB). Gap fill: join-code generation retries, member admin permissions, and leave-household edge cases.

---

## 1. Technical Contract

- **File:** `backend/services/household_service.py`
- **Class:** `HouseholdService(supabase)`
- **Constants:** `JOIN_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"` (no 0/O/1/I), `JOIN_CODE_LENGTH = 6`.
- **Methods (entry points):** `create_household`, `_generate_join_code`, `join_household`, `leave_household`, `regenerate_join_code`, `remove_member`, `update_household_name`, `update_household_profile`, `get_members`.
- **Exceptions:** `ValidationException`, `AuthorizationException`, `DatabaseException`.

---

## 2. Logic Guardrails

- **Join-code charset:** never emit `0`, `O`, `1`, `I` (visually ambiguous). Test by generating a large batch and asserting no forbidden chars.
- **Collision retry:** `_generate_join_code` retries up to 10 times if `is_join_code_unique` returns False; on total failure raises `DatabaseException("Failed to generate unique join code")`.
- **Admin-only actions:** `remove_member`, `update_household_name`, `regenerate_join_code` must raise `AuthorizationException` when caller is not the household admin.
- **Last-admin guard:** removing the last admin (or last member) must either block or promote another member — pin current behavior.
- **Leave-household:** member leaves → pantry/recipes ownership policy must be explicit (row-level RLS governs, but service should not leak orphan records).
- **Idempotent joins:** calling `join_household` twice with the same code + user is a no-op, not a duplicate membership row.

---

## 3. Test-First Suite

Augment `tests/services/test_household_service.py`.

### Test group A — join code

1. `test_join_code_never_contains_0_O_1_or_I` (generate 1000, assert)
2. `test_join_code_is_six_characters`
3. `test_generate_retries_on_collision_up_to_ten_times`
4. `test_generate_raises_database_exception_after_ten_collisions`

### Test group B — admin permissions

5. `test_remove_member_requires_admin_raises_authorization_exception_otherwise`
6. `test_update_household_name_admin_only`
7. `test_regenerate_join_code_admin_only`

### Test group C — membership lifecycle

8. `test_join_household_is_idempotent_for_same_user_and_code`
9. `test_leave_household_last_admin_policy_pinned` (document current behavior — block or auto-promote)
10. `test_remove_member_cannot_remove_self_via_that_endpoint` (must use leave)

### Test group D — validation

11. `test_create_household_rejects_empty_name`
12. `test_update_profile_rejects_negative_size`

---

## 4. Definition of Done

- Tests 1–4 pin join-code correctness.
- Admin-only guards (5–7) parametrized over the protected methods.
- Last-admin policy is explicitly documented by test 9.
- New tests additive; do not rewrite the existing 17 KB suite.
