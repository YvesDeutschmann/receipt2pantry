# T3-08 — `frontend/src/services/webViewBridge.js` (+ `costcoExtractScript.js`, `safewayExtractScript.js`)

> **Tier:** 3 — Frontend
> **Why risky:** ~20 KB bridge + injected JS that scrapes Costco/Safeway pages inside a Capacitor InAppBrowser/WebView. Hard to test in isolation, but the **message contract** between the WebView and the hooks (`useCostcoSync`, `useSafewaySync`) can and must be unit-tested.

---

## 1. Technical Contract

- **Files:**
  - `frontend/src/services/webViewBridge.js` — shared bridge abstraction.
  - `frontend/src/services/costcoWebViewBridge.js` — Costco-specific wrapper.
  - `frontend/src/services/safewayWebViewBridge.js` — Safeway-specific wrapper.
  - `frontend/src/services/costcoExtractScript.js` — injected page script.
  - `frontend/src/services/safewayExtractScript.js` — injected page script.
- **Message shapes consumed by hooks:**
  - Costco: `{ idToken, accessToken, refreshToken, clientID, wcsClientId, refreshTokenClientId, receipts?, _fromWebView, _closeWebViewAfterFetch }`.
  - Safeway: `{ accessToken, clubCard, cookieHeader }` + `webview-progress` window events `{ step, current, total }`.

---

## 2. Logic Guardrails

- **Schema contract tests only.** Do not attempt to test the injected page scripts against a real retailer page; test the shape of what the bridge emits.
- **`_fromWebView` flag:** Costco bridge sets this when receipts are fetched in-WebView. Hooks rely on it to branch.
- **`_closeWebViewAfterFetch`:** signals an error condition where hook must surface a "try again" message. Must not be swallowed.
- **Progress events:** Safeway emits `window.dispatchEvent(new CustomEvent('webview-progress', { detail: { step, current, total } }))`. Detail must always have those three keys.
- **Cleanup on cancel:** bridge methods must resolve or reject; never leave a pending promise if the WebView is closed by the user.
- **Token redaction on logs:** any `console.log` in the bridge must not print the raw `accessToken` / `idToken`. Regression here leaks credentials to logs.

---

## 3. Test-First Suite

Create `frontend/src/tests/webViewBridge.test.js` (and sibling specs per bridge file as needed).

### Test group A — Costco bridge message shape

1. `test_costco_startLogin_returns_object_with_required_token_keys`
2. `test_costco_in_webview_fetch_result_has_fromWebView_flag_set`
3. `test_costco_close_after_fetch_flag_set_when_user_never_navigated_to_orders`

### Test group B — Safeway bridge message shape

4. `test_safeway_startLogin_returns_accessToken_clubCard_cookieHeader`
5. `test_safeway_missing_clubCard_still_resolves_tokens_with_undefined_clubCard_field` (hook decides how to react)

### Test group C — progress events

6. `test_safeway_progress_event_detail_has_step_current_total`
7. `test_safeway_progress_events_fire_only_between_start_and_end`

### Test group D — cancel / cleanup

8. `test_startLogin_rejects_when_webview_is_cancelled_by_user`
9. `test_no_pending_promise_leak_after_cancel`

### Test group E — security / logging

10. `test_bridge_never_logs_raw_access_token`
11. `test_bridge_never_logs_raw_id_token`

### Test group F — smoke

12. `test_extract_scripts_export_string_functions_that_can_be_stringified` (sanity: they must be serializable into the WebView)

---

## 4. Definition of Done

- Contract tests lock the exact key names hooks rely on (tests 1, 4).
- Cancel leak test (9) prevents hung UIs.
- Log redaction tests (10–11) prevent credential leaks to device logs.
- Injected scripts are tested only at the serializability level — no DOM simulation needed.
- All Capacitor InAppBrowser APIs mocked.
