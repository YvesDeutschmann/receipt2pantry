# T2-05 — `backend/providers/costco_provider.py`

> **Tier:** 2 — High
> **Why risky:** ~51 KB, 23 methods, wraps brittle external GraphQL + Contentstack APIs, MFA / device-verification, token refresh. External API changes are the single most common production failure for this kind of app. Current test file is ~5 KB.

---

## 1. Technical Contract

- **File:** `backend/providers/costco_provider.py`
- **Class:** `CostcoProvider` (subclass of `PlaywrightProvider`, registered via `@register_provider('costco')`).
- **Constants:** `COSTCO_GRAPHQL_ENDPOINT`, `COSTCO_WCS_CLIENT_ID`, `COSTCO_CLIENT_IDENTIFIER`, `CONTENTSTACK_URL`.
- **Helpers:** `verify_costco_client_identifier()`, receipt extraction utilities in `backend/utils/costco_receipt_extraction.py`.
- **Exceptions:** `AuthenticationException`, `ProviderException`, `MFARequiredException`.

---

## 2. Logic Guardrails

- **Never hit live Costco in tests.** All `requests.post` / `requests.get` calls MUST be mocked. Real network = flaky CI = skipped.
- **Client-identifier drift:** `verify_costco_client_identifier()` compares the hardcoded `COSTCO_CLIENT_IDENTIFIER` to what Contentstack returns. If drift happens, the app silently breaks — tests should lock the match/mismatch branches.
- **Token refresh:** when an access token is rejected with 401, provider must attempt refresh once before raising `AuthenticationException`. No infinite loops.
- **MFA surfacing:** a "device verification required" response MUST raise `MFARequiredException` with the session id / options payload, not swallow it.
- **Non-grocery receipt filter:** `is_non_grocery_costco_receipt_type()` excludes gas, warehouse memberships, etc. Tests must cover a few concrete examples.
- **Empty list, not exception:** zero receipts in the window returns `[]`, not raises.
- **GraphQL envelope handling:** Costco errors come in `errors[]` inside a 200 body. Presence of any entry in `errors[]` must raise `ProviderException`, not be treated as success.
- **Contentstack down** = `verify_costco_client_identifier()` returns `{valid: False, error: ...}`. Production callers should treat this as "retry later", not "auth failed".

---

## 3. Test-First Suite

Augment `tests/backend/test_providers/test_costco_provider.py`.

### Test group A — client-identifier verification

1. `test_verify_client_identifier_returns_valid_true_on_match`
2. `test_verify_client_identifier_returns_valid_false_on_drift`
3. `test_verify_client_identifier_returns_valid_false_when_contentstack_token_missing`
4. `test_verify_client_identifier_returns_valid_false_on_http_error`

### Test group B — GraphQL envelope handling

5. `test_fetch_orders_raises_provider_exception_when_errors_array_present`
6. `test_fetch_orders_returns_empty_list_for_empty_order_window`

### Test group C — token refresh

7. `test_401_triggers_single_refresh_attempt_before_raising`
8. `test_double_401_raises_authentication_exception_without_looping`

### Test group D — MFA surfacing

9. `test_device_verification_required_raises_mfa_required_exception_with_options`

### Test group E — non-grocery filter

10. `test_non_grocery_receipt_types_filtered_out` (gas, membership renewal, etc.)
11. `test_grocery_warehouse_receipts_pass_through`

### Test group F — receipt extraction wrappers

12. `test_extract_costco_order_id_returns_string`
13. `test_extract_costco_order_date_returns_iso_date`
14. `test_extract_costco_total_handles_missing_total`

---

## 4. Definition of Done

- All network I/O mocked with `responses` or `unittest.mock.patch`.
- Token refresh loop (tests 7–8) is bounded at 1 retry.
- Contentstack drift test (2) locks the exact identifier string at test time — document that updating the hardcoded constant also requires updating this test.
- MFA exception includes the session options payload (test 9).
- No test makes real HTTP calls; suite runs in < 2 s.
