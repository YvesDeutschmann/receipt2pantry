# T3-02 — `frontend/src/hooks/useSafewaySync.js`

> **Tier:** 3 — Frontend
> **Why risky:** Twin of `useCostcoSync` but with an extra path: pre-fetch of `knownOrderIds` from backend, club-card validation, progress events from `window.addEventListener('webview-progress', ...)`, and a delta-sync window (3 days when stored tokens exist, 90 days on first run).

---

## 1. Technical Contract

- **File:** `frontend/src/hooks/useSafewaySync.js`
- **Returns:** `{ status, error, result, progress, startSync, startSilent, hasStoredTokens, checkStoredTokens, isNative }`.
- **External deps:** `@capacitor/core`, `safewayWebViewBridge`, `safewayReceiptParser`, `apiClient`.
- **Progress shape:** `{ step, current, total }` pushed via the `webview-progress` window event.
- **States:** `IDLE | AUTHENTICATING | FETCHING | SUBMITTING | SUCCESS | ERROR`.

---

## 2. Logic Guardrails

- **Native-only** — same as T3-01.
- **Club-card required:** missing `clubCard` → ERROR with a user-facing message. Do NOT fall back silently.
- **Token/club-card failure clears tokens:** both `startSync` and `startSilent` must `clearStoredTokens()` when authentication inputs are invalid.
- **Delta window:** `daysOverride = hasStoredTokensState ? 3 : 90`. Pin this boundary.
- **`knownOrderIds` pre-fetch is best-effort:** if `api.getReceipts` throws, continue with empty list (suppressed `_` catch).
- **🔴 Regex fragility:** auth-error classifier `/token.*invalid|token.*expired|401|403|session.*expired/i` — same pinning concern as T3-01 (note: different regex from Costco; confirm intent).
- **Progress event cleanup:** `useEffect` subscribes on mount, unsubscribes on unmount. Memory leak if this regresses.
- **Background generation trigger:** same `> 3` gate, best-effort.
- **Silent path auth failure:** `startSilentSync` returning null → clear tokens, ERROR with user-facing "session expired" message.

---

## 3. Test-First Suite

Augment `frontend/src/tests/useSafewaySync.test.js`.

### Test group A — platform & auth preconditions

1. `test_startSync_sets_ERROR_on_web`
2. `test_startSilent_requires_userId_on_native`
3. `test_missing_accessToken_surfaces_error_and_does_not_clear_tokens`
4. `test_missing_clubCard_surfaces_error`

### Test group B — delta window

5. `test_fetch_uses_3_day_window_when_hasStoredTokens_true`
6. `test_fetch_uses_90_day_window_when_hasStoredTokens_false`

### Test group C — knownOrderIds pre-fetch

7. `test_known_order_ids_forwarded_to_fetcher_when_api_getReceipts_succeeds`
8. `test_known_order_ids_empty_when_api_getReceipts_throws_silently`

### Test group D — progress events

9. `test_webview_progress_event_updates_progress_state`
10. `test_progress_listener_removed_on_unmount`

### Test group E — auth error branches

11. `test_401_clears_tokens`
12. `test_403_clears_tokens`
13. `test_session_expired_message_clears_tokens`

### Test group F — silent path

14. `test_startSilent_null_result_sets_session_expired_error`
15. `test_startSilent_empty_receipts_sets_success_with_zero_counts`

### Test group G — background trigger

16. `test_triggerGeneration_fires_only_when_itemsAdded_gt_3`

---

## 4. Definition of Done

- Delta-window boundary (tests 5–6) locked.
- Progress listener lifecycle tested (9–10); no memory leaks on unmount.
- Three concrete auth-error strings pin the regex.
- Best-effort pre-fetch (tests 7–8) does not block the main flow.
- All external modules mocked; no real `webview-progress` events come from a real WebView.
