# T1-01 — `backend/services/supabase_service.py`

> **Tier:** 1 — Critical
> **Why risky:** Single data-access layer used by every service. 56 methods, ~57 KB, current test file is ~4 KB. Any silent column/schema drift against `supabase/migrations/` crashes deep in services. Every method toggles between `admin_client` (bypasses RLS) and `client` (respects RLS) — a regression here is a security issue.

---

## 1. Technical Contract

- **File:** `backend/services/supabase_service.py`
- **Class:** `SupabaseService`
- **Key attributes:** `self.client` (anon), `self.admin_client` (service role — may be `None`).
- **Call shape:** every method follows `client.table("<table>").<op>(...).execute()` and must tolerate `response.data` being `None`, `[]`, or a list of dicts.
- **Schema source of truth:** `supabase/migrations/` — never hardcode column assumptions in tests beyond what the latest migration defines.

Example methods to characterize (not exhaustive — pick highest-traffic first):

- `get_user_household(user_id)`
- `get_household_pantry(household_id)` / `get_user_pantry(user_id)`
- `get_receipt_items(receipt_id)`
- `get_product_mapping(raw_name)`
- `get_household_members(household_id)`
- `is_join_code_unique(code)`
- `get_active_canonical_ingredient(name)`
- Partial-update pantry row (service role).

---

## 2. Logic Guardrails

- **Admin-vs-anon client selection** is repeated dozens of times: `self.admin_client if self.admin_client else self.client`. Every method that needs to bypass RLS MUST prefer admin when present. A regression that flips this order silently exposes user data.
- **Empty-result handling:** methods that return "one row" must not assume `response.data[0]` exists — they must return `None` / `{}` on empty.
- **Column existence:** never use `.get("column")` in tests without asserting the migration actually defines that column.
- **No substring matching** for ingredient/household lookups — must use exact `eq(...)` filters (per `.cursorrules.md`).

---

## 3. Test-First Suite

Create `tests/backend/test_services/test_supabase_service.py` (expand existing file).

Build a reusable PostgREST builder stub in `tests/conftest.py` (fake that records `.table / .select / .eq / .execute` chains).

### Test group A — client selection

1. `test_get_household_pantry_uses_admin_client_when_available`
2. `test_get_household_pantry_falls_back_to_anon_client_when_admin_none`
3. `test_partial_update_pantry_row_always_uses_admin_client` (service role required)

### Test group B — query shape

4. `test_get_user_household_filters_by_user_id_eq` (asserts `.eq("user_id", ...)` was called, not `.ilike`)
5. `test_get_receipt_items_filters_by_receipt_id_eq`
6. `test_get_active_canonical_ingredient_normalizes_name_lowercase` (confirm normalization happens before query, not after)

### Test group C — empty / malformed responses

7. `test_get_user_household_returns_none_when_response_data_empty`
8. `test_get_household_members_returns_empty_list_when_response_data_none`
9. `test_get_product_mapping_returns_none_on_empty` (callers rely on `None` to trigger AI fallback)

### Test group D — uniqueness / join codes

10. `test_is_join_code_unique_returns_true_on_empty_data`
11. `test_is_join_code_unique_returns_false_when_any_row_present`

---

## 4. Definition of Done

- Reusable PostgREST builder stub available in `tests/conftest.py`; other service tests can import it.
- ≥ 20 test cases covering the 8 most-called methods (rank by `rg` count in `backend/`).
- Every method that can bypass RLS has an explicit admin-vs-anon selection test.
- CI runs the new suite in < 2 s (no real Supabase connection).
- No test imports the real `create_client` — all PostgREST is mocked.
