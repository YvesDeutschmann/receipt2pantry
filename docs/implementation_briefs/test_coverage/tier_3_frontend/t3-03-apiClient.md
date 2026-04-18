# T3-03 — `frontend/src/services/apiClient.js`

> **Tier:** 3 — Frontend
> **Why risky:** Single point of failure for every backend call. No dedicated test file today. Derives base URL from `window.location.hostname` for mobile — regression breaks the app on device silently. Request interceptor injects Supabase session headers on every request; a session-refresh hiccup here means unauthenticated requests.

---

## 1. Technical Contract

- **File:** `frontend/src/services/apiClient.js`
- **Exports:** `default apiClient` (axios instance), named `api` (method namespace: receipts, providers, households, pantry, recipes, suggestions, mealPlan, shoppingList).
- **Base URL:** `import.meta.env.VITE_API_BASE_URL` OR `http://${hostname}:5000/api`.
- **Timeout:** default 120 s; `voiceTranscribe` 90 s; `suggestions.triggerGeneration` 10 min.
- **Interceptors:** request (inject `Authorization` + `X-User-Id` from Supabase session), response (error logging passthrough).

---

## 2. Logic Guardrails

- **Base URL derivation:** with `VITE_API_BASE_URL` set → use it verbatim. Unset → `http://<hostname>:5000/api`. On Capacitor native with hostname === `localhost`, the URL MUST resolve to something reachable (documented behavior — test pins current logic so accidental change is caught).
- **Auth header injection:** when `supabase.auth.getSession()` returns a session, `Authorization: Bearer <token>` MUST be set. When no session, header is absent (not `Bearer undefined`).
- **X-User-Id:** set from `session.user.id`. If missing, header absent.
- **Error passthrough:** response interceptor must log and re-reject; callers rely on `axios`-style error shapes.
- **FormData handling:** `voiceTranscribe` deletes `Content-Type` header so axios sets the multipart boundary. Regression here breaks voice input.
- **Timeout overrides:** `suggestions.triggerGeneration` uses `timeout: 600000`. Never inherit the default.
- **No absolute URLs in method calls:** every method uses a relative path so `baseURL` switching works.

---

## 3. Test-First Suite

Create `frontend/src/tests/apiClient.test.js` (new). Use `vi.mock` for `axios` and `supabaseClient`.

### Test group A — base URL

1. `test_uses_VITE_API_BASE_URL_when_set`
2. `test_falls_back_to_hostname_port_5000_api_when_env_unset`
3. `test_localhost_hostname_yields_http_localhost_5000_api`

### Test group B — request interceptor

4. `test_authorization_header_set_when_session_has_access_token`
5. `test_authorization_header_absent_when_no_session`
6. `test_x_user_id_set_from_session_user_id`
7. `test_interceptor_does_not_set_bearer_undefined_on_empty_session`

### Test group C — method contracts

8. `test_getReceipts_sends_user_id_and_limit_as_params`
9. `test_ingestReceipts_posts_provider_and_receipts_body`
10. `test_triggerGeneration_uses_600000ms_timeout_override`
11. `test_voiceTranscribe_deletes_content_type_for_FormData`
12. `test_markCooked_sends_expected_body_shape_recipe_id_servings_ingredients_household_id`

### Test group D — error handling

13. `test_server_error_response_is_logged_and_rethrown`
14. `test_network_error_no_response_is_logged_and_rethrown`

### Test group E — smoke on namespaces

15. `test_suggestions_namespace_exposes_getPool_getDepth_swipe_triggerGeneration`
16. `test_mealPlan_namespace_exposes_wizard_lifecycle_methods`

---

## 4. Definition of Done

- ≥ 14 test cases; every method category (pantry / suggestions / mealPlan / shoppingList / providers) has at least one shape-check test.
- Timeout override (test 10) prevents accidental inheritance of default.
- FormData content-type test (11) guards voice input regressions.
- `bearer undefined` regression (test 7) is locked in.
- No real network calls; `axios` and Supabase mocked.
