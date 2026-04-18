# T3-01 — `frontend/src/hooks/useCostcoSync.js`

> **Tier:** 3 — Frontend
> **Why risky:** 6-state machine (IDLE / AUTHENTICATING / FETCHING / SUBMITTING / SUCCESS / ERROR) with two entry points (`startSync`, `startSilent`), token clearing, a regex-based auth-error classifier, and a side-effect background trigger (`api.suggestions.triggerGeneration`) gated by `itemsAdded > 3`. Existing test (`useCostcoSync.test.js`) is ~5 KB — not enough branches covered.

---

## 1. Technical Contract

- **File:** `frontend/src/hooks/useCostcoSync.js`
- **Returns:** `{ status, error, result, startSync, startSilent, hasStoredTokens, checkStoredTokens, isNative }`.
- **External deps:** `@capacitor/core` (`Capacitor.isNativePlatform`), `../services/costcoWebViewBridge`, `../services/costcoNativeSync`, `../services/apiClient`.
- **States:** `IDLE | AUTHENTICATING | FETCHING | SUBMITTING | SUCCESS | ERROR`.

---

## 2. Logic Guardrails

- **Native-only:** both `startSync` and `startSilent` must set `ERROR` immediately on web.
- **Sign-in gate:** `startSilent` requires a `userId`; without it, fail fast.
- **🔴 Regex fragility:** the auth-error classifier is `/token.*invalid|token.*expired|401|403|65535|in-webview fetch/i`. A backend message-wording change can silently break token clearing. Tests MUST pin exact strings that today trigger the clear, and flag any change as needing a test update.
- **Token-clear policy:** on detected auth error → `clearStoredTokens()` + `setHasStoredTokensState(false)`. On any non-auth error → tokens are preserved.
- **Background generation trigger:** `api.suggestions.triggerGeneration` is called ONLY when `itemsAdded > 3`. Must use `void ... .catch(() => {})` — never awaited, never re-surfaced as an error.
- **`connect-from-app` is best-effort:** failure must only `console.warn`, never flip state to ERROR.
- **In-WebView fetch contract:** `tokens.receipts != null && tokens._fromWebView` → use those. `tokens._closeWebViewAfterFetch` → user-facing retry error.

---

## 3. Test-First Suite

Augment `frontend/src/tests/useCostcoSync.test.js`. Use `@testing-library/react-hooks` or `renderHook` from `@testing-library/react`.

### Test group A — platform gating

1. `test_startSync_sets_ERROR_on_web_immediately`
2. `test_startSilent_sets_ERROR_on_web_immediately`
3. `test_startSilent_sets_ERROR_when_userId_missing_on_native`

### Test group B — happy path (native)

4. `test_startSync_transitions_IDLE_AUTH_FETCH_SUBMIT_SUCCESS_on_happy_path`
5. `test_result_contains_receipts_count_receipts_stored_items_added`
6. `test_triggerGeneration_fires_when_items_added_gt_3`
7. `test_triggerGeneration_does_not_fire_when_items_added_eq_3`

### Test group C — auth-error branches

8. `test_401_error_message_clears_tokens`
9. `test_403_error_message_clears_tokens`
10. `test_token_expired_error_message_clears_tokens`
11. `test_65535_error_message_clears_tokens` (WebView edge)
12. `test_network_timeout_error_preserves_tokens` (non-auth error)

### Test group D — best-effort calls

13. `test_connect_from_app_failure_only_warns_not_errors`
14. `test_triggerGeneration_failure_does_not_flip_state_to_error`

### Test group E — silent path

15. `test_startSilent_sets_empty_result_when_no_receipts_returned`
16. `test_startSilent_clears_tokens_on_any_thrown_error`

---

## 4. Definition of Done

- ≥ 14 test cases across 5 groups.
- Error regex is covered by at least 4 concrete message strings (tests 8–11) so a backend wording change breaks tests, not production.
- `> 3 items` threshold is pinned by tests 6–7 as a boundary.
- `connect-from-app` and `triggerGeneration` best-effort semantics are locked in.
- Tests mock all three service modules — no real fetch, no real Capacitor.
