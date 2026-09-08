# Household sharing — open items

> **Purpose:** Registry of known gaps and follow-up work for household sharing. Use this when triaging “what’s still open on sharing?” — not the launch-readiness scoreboard (Area 1) and not the cook-loop / receipt-fetch tracks.
>
> **Related:** Safe new-user join slice (create vs join before household exists, `POST /households/dietary/merge`, join-with-code onboarding). Scoped in the household sharing implementation plan and Aug 27 mechanics chats.

---

## Security — member can overwrite household allergies (OPEN)

**Severity:** Medium (safety / trust, not auth bypass). Any household **member** can call `PUT /api/households/profile` with a **full replacement** `dietary_restrictions` array and wipe or shrink the owner’s allergy list.

**Why it matters:** Join onboarding was scoped to **union-merge** new codes via `POST /api/households/dietary/merge` so a joiner cannot silently drop a partner’s allergy. The general profile endpoint was left unchanged and still overwrites the whole array in one request.

**Where:**

| Layer | Location |
|-------|----------|
| Route | `PUT /api/households/profile` — [`backend/routes/households.py`](../../backend/routes/households.py) (`update_profile`) |
| Service | [`HouseholdService.update_household_profile`](../../backend/services/household_service.py) — assigns `updates["dietary_restrictions"] = dietary_restrictions` (full replace) |
| Create path (intended replace) | Onboarding `completeBridge` → `api.updateHouseholdProfile` with the creator’s full list |
| Join path (safe) | Onboarding joiner → `api.mergeDietaryRestrictions` only |

**Current behavior (to pin in tests):** Add `test_member_put_profile_replaces_dietary_array` in `tests/services/test_household_service.py` — a member calling `update_household_profile` with a shorter `dietary_restrictions` list must still replace the array (documents today’s hole until a fix ships).

**Not fixed in the safe-join slice because:** Join flow avoids `PUT` for diet; fixing profile semantics affects Settings, meal-planning filters, and any future “edit household diet” UI.

**Suggested next slice (when prioritized):**

1. **Restrict shrink/remove:** Members may only **add** via merge; only **owner** may replace or remove codes (or require owner approval to remove).
2. **Or** split endpoints: `PUT` profile stops accepting `dietary_restrictions`; diet changes go through merge (add) and a separate owner-only replace/remove API.
3. Add regression tests for owner vs member permissions and for “joiner cannot remove owner allergy via any API.”

**Search terms:** `dietary_restrictions`, `update_household_profile`, `household sharing security`, `allergy overwrite`, `PUT /households/profile`.

---

## Product / data — still out of scope for safe-join slice

These were explicitly deferred when scoping **new-user join only** (Aug 29 hours estimate). Still open for couples who already finished onboarding with auto-created `"My Household"`.

| Item | Risk if ignored |
|------|-----------------|
| **Leave / merge for existing users** | Two onboarded users must still leave (sole owner → CASCADE delete) before joining the same household. |
| **Household-scoped receipt dedup** | Same store account on two members can double-count (`UNIQUE (user_id, provider, order_id)`). |
| **Concurrent pantry qty / cook** | Last-write-wins; no version or atomic increment on shared rows. |
| **Transfer ownership** | Owner cannot leave while other members remain; no handoff path. |

---

## QA / test accounts

Dedicated live-test users (migration `028_qa_share_test_users.sql`): `to-be-merged-user-1` / `to-be-merged-user-2` (`…0003`–`…0006`). **Not** for daily use. See [`data/fixtures/README.md`](../../data/fixtures/README.md) for `HOUSEHOLD_JOIN_LIVE` pytest.

---

## Changelog

| Date | Note |
|------|------|
| 2026-09-08 | Documented open `PUT /profile` dietary replace hole after architect review of safe household sharing plan. |
