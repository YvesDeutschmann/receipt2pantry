# M0a — Remove Legacy Server-Side Playwright Automation

> **Prerequisite:** Read `docs/MVP_SCOPE_AND_ROADMAP.md` §2 (deferred features) and `docs/implementation_briefs/mvp_gaps/README.md` "Shared conventions".
>
> **Scope:** Delete every server-side Playwright/browser-automation path — both the deprecated Safeway provider and the Costco browser-login/MFA/scraping flow — leaving only the native WebView bridges and the Costco token/GraphQL API path that production already uses. Remove `playwright` and `playwright-stealth` from the dependency tree. Remove the dead credentials/MFA UI from the frontend. Zero behavior change to any in-scope sync flow.
>
> **Relationship to 00:** `00-scope-lock-cleanup.md` handles debug-artifact removal and the provider allowlist. The two briefs are independent and may be executed in either order.
>
> **Do NOT touch / must keep working:**
> - Costco token/API path: `CostcoProvider.fetch_receipts_via_api`, `_refresh_id_token`, `_get_b2c_token_endpoint`, `_get_api_headers`, `_decode_jwt_payload`, `_is_token_expired`, `_parse_api_receipt`, and `verify_costco_client_identifier`.
> - Token/connection routes in `backend/routes/providers.py`: `list_providers`, `get_provider_status`, `store_costco_receipts`, `connect-from-app`.
> - Native WebView bridges and hooks: `safewayWebViewBridge.js`, `safewayApiFetcher.js`, `safewayExtractScript.js`, `costcoWebViewBridge.js`, `costcoExtractScript.js`, `costcoNativeSync.js`, `useSafewaySync.js`, `useCostcoSync.js`, `useCostcoAutoSync.js`, `SafewayConnectCard.jsx`, `CostcoOneTapSync.jsx`.
> - Email/receipt parsers under `backend/parsers/` (`safeway_parser.py`, `costco_parser.py`).
> - Any `logger.info` / `logger.warning` / `logger.error` / `logger.debug` call.

---

## Background

The app uses Playwright in two places, both now superseded:

| Path | Why superseded |
|---|---|
| `SafewayProvider` in `_deprecated/` — browser login + scrape | Native iOS/Android WebView bridge (M1). Already blocked by a 410 guard; never called by the frontend. |
| `CostcoProvider.login()` / browser `fetch_receipts()` / MFA routes | Native WebView bridge + in-device receipt fetch + `CostcoProvider.fetch_receipts_via_api` (GraphQL, no browser). These replace the browser path end-to-end. |

`CostcoProvider` still extends `PlaywrightProvider` and still contains 600+ lines of Chromium automation, but **no production call path reaches those methods**. The `playwright` and `playwright-stealth` packages ship with the app and force a full Chromium install for no benefit.

This brief removes that dead surface entirely.

---

## Objective

After this brief:

- No server-side code imports or starts a browser. `playwright` / `playwright-stealth` are not dependencies.
- `CostcoProvider` is a plain `BaseProvider` subclass with only token/API methods.
- The MFA login-session manager, session-cleanup worker, `/test`, `/login/*`, and username/password `fetch-receipts` routes no longer exist.
- Removed routes return 404 (not 410 — they are gone, not deprecated).
- The frontend ships no credentials-modal or MFA-dialog UI.
- `my_safeway_login.py` (standalone dev script at the repo root) is deleted.

---

## Technical Contract

### 1. Delete Playwright-only backend files

Delete these files and remove their directories if they become empty:

| File | Directory cleanup |
|---|---|
| `backend/providers/playwright_provider.py` | — |
| `backend/providers/_deprecated/safeway_provider.py` | Remove `backend/providers/_deprecated/` |
| `backend/providers/_deprecated/__init__.py` | (same) |
| `backend/services/_deprecated/login_session_manager.py` | Remove `backend/services/_deprecated/` |
| `backend/services/_deprecated/__init__.py` | (same) |
| `backend/workers/session_cleanup.py` | — |
| `my_safeway_login.py` (repo root) | — |

### 2. `backend/providers/base_provider.py` — trim to the token-era interface

`ProviderRegistry.register()` validates `issubclass(provider_class, BaseProvider)`, so this class must stay. Its browser-centric abstract methods are now obsolete.

**Remove:**
- The `login`, `fetch_receipts`, and `handle_mfa` abstract methods (they only modelled the interactive browser flow).
- The `from datetime import datetime` and `List` imports if nothing else in the file references them after removal.

**Change:**
- `cleanup` from an abstract method to a concrete no-op default: `def cleanup(self) -> None: pass`. Providers with no resources need not override it.

**Keep:**
- The `provider_name` abstract property.

### 3. `backend/providers/costco_provider.py` — make it API-only

**Class declaration:**
Change `class CostcoProvider(PlaywrightProvider):` to `class CostcoProvider(BaseProvider):` and import `BaseProvider` from `backend.providers.base_provider`. Drop the `PlaywrightProvider` import.

**`__init__`:**
Replace the browser-setup `super().__init__()` call. Keep accepting `headless`/`timeout` keyword args (call sites pass `CostcoProvider(headless=True)`) but treat them as no-ops. Keep `self._id_token = None`. Do not assign `browser` / `context` / `page` / `_playwright` attributes.

**Delete these methods** (browser / scraping only):

| Method | Reason safe to delete |
|---|---|
| `_get_session_file` | Browser persistent profile path, unused by API path |
| `extract_tokens_from_browser` | `page.evaluate()` on localStorage |
| `login` | Starts Chromium, navigates costco.com |
| `_is_logged_in` | DOM check in browser |
| `_detect_mfa_prompt` | DOM check in browser |
| `handle_mfa` / `_perform_mfa_verification` | MFA entry via browser |
| `_scrape_receipt_modal` | DOM scraping |
| `fetch_receipts` (the `since: datetime` overload) | Browser scraping fallback; `fetch_receipts_via_api` is the sole production path |
| `_close_receipt_modal` | DOM interaction |
| `_extract_order_id`, `_extract_order_date`, `_extract_total` | Text-parsing helpers used only by the scraping path — verify with `rg` before removing |

**Keep** all token/API methods: `provider_name`, `_decode_jwt_payload`, `_is_token_expired`, `_get_api_headers`, `_get_b2c_token_endpoint`, `_refresh_id_token`, `fetch_receipts_via_api`, `_parse_api_receipt`. Keep the module-level functions `verify_costco_client_identifier` and `_mfa_payload_from_graphql_errors` (used by `fetch_receipts_via_api`), and all API/GraphQL constants.

**Imports to remove:** `random`, `time` (used only by browser flow). Audit and keep: `base64`, `hashlib`, `json`, `re`, `requests`, `datetime`, `timedelta`, `typing`, `Config`.

**`cleanup`:** inherits the concrete no-op from `BaseProvider`; no override needed.

### 4. `backend/routes/providers.py` — remove the browser login / MFA / scraping routes

**Remove the deprecation guard:**
- Delete `_DEPRECATED_SAFEWAY_PATTERN` and the entire `@providers_bp.before_request def _deprecate_safeway_playwright_routes()` function (lines 20–32). The guarded routes no longer exist; callers get a plain 404 from Flask.

**Remove the executor plumbing:**
- Delete the module-level `_playwright_executor` (line 15).
- Delete `_cleanup_session_in_executor` and `_terminate_session_with_executor_cleanup`.
- Remove `import concurrent.futures` if nothing else in the file references it after deletion (audit).

**Delete these route handlers and helpers entirely:**

| Handler | Route |
|---|---|
| `test_provider_connection` | `POST /providers/<provider>/test` |
| `get_login_status` | `GET /providers/<provider>/login/<session_id>/status` |
| `get_device_verification_options` | `GET /providers/<provider>/login/<session_id>/device-verification` |
| `select_device_verification_method` | `POST /providers/<provider>/login/<session_id>/device-verification` |
| `submit_mfa_code` | `POST /providers/<provider>/login/<session_id>/mfa` |
| `cancel_login` | `DELETE /providers/<provider>/login/<session_id>` |
| `_run_provider_login_and_fetch` (helper) | — |
| `fetch_receipts` (username/password overload) | Second `POST /providers/<provider>/fetch-receipts` (unreachable; Flask matched `fetch_receipts_with_stored_credentials` first) |
| `fetch_receipts_after_mfa` | `POST /providers/<provider>/login/<session_id>/fetch-receipts` |
| `fetch_receipts_with_stored_credentials` | `POST /providers/<provider>/fetch-receipts` (stored-credential token fetch) |
| `fetch_costco_receipts_with_token` | `POST /providers/costco/fetch-receipts-with-token` |
| `get_costco_connection_code` | `GET /providers/costco/connection-code` |
| `connect_costco_with_tokens` | `POST /providers/costco/connect` |
| `get_costco_connection_status` | `GET /providers/costco/connection/<code>/status` |

**Keep** `store_costco_receipts`, `connect-from-app`, `list_providers`, and `get_provider_status`.

**Imports to audit after deletion:** remove `MFARequiredException` (used only by the login flow); check `timezone` and `timedelta` — keep if still used by any remaining handler, remove otherwise.

### 5. `backend/app.py` — remove session-manager / cleanup-worker wiring

**Remove from `create_app`:**
- `LoginSessionManager` import, `session_manager` init, and `app.config["LOGIN_SESSION_MANAGER"] = ...` (lines 216–220).
- `SessionCleanupWorker` import, `cleanup_worker` init + `.start()` + `app.config["SESSION_CLEANUP_WORKER"] = ...` (lines 222–230).
- `app.config["PLAYWRIGHT_HEADLESS"]`, `app.config["PLAYWRIGHT_TIMEOUT"]`, `app.config["MFA_SESSION_TIMEOUT"]`, `app.config["MFA_MAX_RETRY_ATTEMPTS"]` stores (lines 233–236).

**Remove from `main()`:**
- The `finally:` block that stops `SESSION_CLEANUP_WORKER` and calls `LOGIN_SESSION_MANAGER.cleanup_expired_sessions()` (lines 306–317). Collapse `app.run(...)` back to a plain call if the surrounding `try` is no longer needed.

### 6. `backend/config.py` — drop Playwright / MFA-session settings

Remove:
- `PLAYWRIGHT_HEADLESS`, `PLAYWRIGHT_TIMEOUT` (lines 36–38).
- `MFA_SESSION_TIMEOUT`, `SESSION_CLEANUP_INTERVAL`, `MFA_MAX_RETRY_ATTEMPTS` (lines 41–43) — consumed only by the deleted session machinery.

### 7. `pyproject.toml` / `uv.lock` — drop Playwright dependencies

- `pyproject.toml`: remove `"playwright>=1.40.0"` and `"playwright-stealth>=2.0.1"` from `[project].dependencies`; remove the `[tool.playwright]` table.
- Run `uv lock` so `uv.lock` no longer pins playwright or playwright-stealth.

### 8. Frontend — remove the credentials/MFA login UI

The credentials + MFA UI only ever drove the deleted username/password server routes. Both Safeway and Costco use native WebView bridges.

**Delete files:**
- `frontend/src/components/CredentialsModal.jsx`
- `frontend/src/components/MfaDialog.jsx`

**`frontend/src/services/apiClient.js` — delete these methods:**
`testProviderConnection`, `getDeviceVerificationOptions`, `selectDeviceVerificationMethod`, `submitMfaCode`, `getLoginStatus`, `cancelLoginSession`, `fetchReceipts` (username/password), `fetchReceiptsAfterMfa`.

Keep: `listProviders`, `getProviderStatus`, `connectCostcoFromApp`, `storeCostcoReceipts`, and `ingestReceipts`. (Legacy methods `fetchReceiptsWithStoredCredentials`, `getConnectionCode`, `connectProvider`, and `getConnectionStatus` were removed in the legacy Costco cleanup.)

**`frontend/src/pages/Providers.jsx` — remove the credentials/MFA flow:**
- Remove imports of `CredentialsModal` and `MfaDialog`.
- Remove state: `credentialsModalOpen`, `selectedProvider`, `testingConnection`, `fetchMode`, `fetchingReceipts`, `fetchedReceipts`, `receiptError`, `mfaDialogOpen`, `mfaSession`, `mfaLoading`, `mfaError`, `pollingActive`, `pollingIntervalRef`, `mfaDialogOpenRef`.
- Remove handlers: `handleTestConnection`, `handleFetchReceipts`, `handleCredentialsSubmit`, `handleCredentialsCancel`, `handleMfaSubmit`, `handleMfaCancel`, `startStatusPolling`, `stopStatusPolling`.
- Remove the generic-provider `else` branch (the "Test Connection" / "Fetch Receipts" buttons block at lines 484–499).
- Remove the `<CredentialsModal>` and `<MfaDialog>` JSX renders.
- Remove the "Waiting for device verification…" polling indicator.
- Remove the "Fetched Receipts Display" section (lines 513–535) — it displayed results from the now-deleted `fetchReceipts` call.

**Keep:** the `provider === 'costco'` and `provider === 'safeway'` branches with `SafewayConnectCard` and `CostcoOneTapSync` only (legacy `CostcoConnectPage`, "Fetch Receipts", and "Reconnect" buttons removed).

### 9. Human-facing docs — remove Playwright setup steps

No behavior impact, but keeps the repo honest:
- `README.md`: remove the "Playwright for browser automation" bullet, the `uv run playwright install` step, and the `PLAYWRIGHT_HEADLESS` env-var doc.
- `SETUP_GUIDE.md`: remove the `uv run playwright install` step and the `PLAYWRIGHT_HEADLESS` / troubleshooting references.
- `quickstart.sh`: remove the `uv run playwright install chromium` step.

---

## Logic Guardrails

- **Costco token/API path is the only backend path that must survive.** `fetch_receipts_via_api`, `_refresh_id_token`, `_get_b2c_token_endpoint`, `_get_api_headers`, `_decode_jwt_payload`, `_is_token_expired`, and `_parse_api_receipt` must remain byte-for-byte equivalent.
- **Native WebView bridges are untouched.** No change to any `*WebViewBridge.js`, `*ApiFetcher.js`, `*ExtractScript.js`, or the Connect/OneTap UI components.
- **Provider registry still works after the base-class trim.** `CostcoProvider` must remain a `BaseProvider` subclass so `@register_provider("costco")` and `ProviderRegistry.get_provider("costco")` succeed. Verify `ProviderRegistry.is_registered("costco")` is true and that instantiation does not start a browser.
- **Removed routes return 404, not 410.** They are gone, not deprecated. The former 410 guard is deleted. Update any test that asserted 410.
- **Import hygiene.** Before removing any import, verify with `rg` that no remaining code in the same file uses it.
- **`MFARequiredException`** is imported in `providers.py` only for the deleted login flow; remove it unless `rg` reveals another reference.

---

## Test-First Suite

All tests must be scaffolded **before** implementation changes.

### Backend — update `tests/backend/test_routes/test_providers.py`

- **Replace** `test_test_provider_connection_missing_body` (previously asserted 410): assert `POST /api/providers/safeway/test` returns **404**.
- **Replace** `test_test_provider_connection_invalid_provider`: `POST /api/providers/invalid-provider/test` returns **404** (route deleted).
- **Add** `DELETED_LOGIN_ROUTES_RETURN_404` — parametrized test asserting 404 for:
  - `POST /api/providers/costco/login/abc/mfa`
  - `GET /api/providers/costco/login/abc/status`
  - `GET /api/providers/costco/login/abc/device-verification`
  - `POST /api/providers/costco/login/abc/device-verification`
  - `DELETE /api/providers/costco/login/abc`
  - `POST /api/providers/costco/login/abc/fetch-receipts`
- **Remove** fetch-receipts stored-credential tests; **add** `DELETED_LEGACY_COSTCO_ROUTES_RETURN_404` — parametrized test asserting 404 for:
  - `POST /api/providers/costco/fetch-receipts`
  - `POST /api/providers/costco/fetch-receipts-with-token`
  - `GET /api/providers/costco/connection-code`
  - `POST /api/providers/costco/connect`
  - `GET /api/providers/costco/connection/abc123/status`
- **Keep** all `store-receipts` and `connect-from-app` tests unchanged.

### Backend — update `tests/backend/test_providers/test_costco_provider.py`

- **Update** `test_costco_provider_initialization`: drop assertions on `browser` / `context` / `page` / `_playwright`; assert only `provider.provider_name == "costco"` and that instantiation does not raise.
- **Update** `test_costco_provider_cleanup`: assert `cleanup()` does not raise (no-op); remove browser-attribute assertions.
- **Remove** `test_costco_provider_login_missing_credentials` and `test_costco_provider_fetch_receipts_not_logged_in` (the `login` / browser `fetch_receipts` methods are deleted).
- **Keep** all `_parse_api_receipt`, `fetch_receipts_via_api`, token-refresh, and `verify_costco_client_identifier` tests.

### Backend — update `tests/backend/conftest.py`

Remove `from backend.providers._deprecated import safeway_provider  # noqa: F401`.

### Backend — delete `tests/backend/test_workers/test_session_cleanup.py`

The worker is removed; this file no longer has a subject.

### Backend — audit `tests/conftest.py` and other test files

Search for `LOGIN_SESSION_MANAGER`, `SESSION_CLEANUP_WORKER`, `MFA_SESSION_TIMEOUT`, `_playwright_executor`, `_deprecate_safeway_playwright_routes`; update or remove any references so the suite imports cleanly.

### Backend — add `test_no_playwright_artifacts_in_source` (grep-based, CI)

Parametrized test using `subprocess.run(['rg', ...])`:

- `RG_NO_PLAYWRIGHT_IMPORT_IN_PROD` — `rg 'from playwright|import playwright|playwright_stealth' backend/` returns no matches.
- `RG_NO_PLAYWRIGHT_PROVIDER_FILE` — `backend/providers/playwright_provider.py` does not exist.
- `RG_NO_DEPRECATED_DIRS` — `backend/providers/_deprecated/` and `backend/services/_deprecated/` do not exist.
- `RG_NO_SESSION_MACHINERY` — `rg 'SessionCleanupWorker|LoginSessionManager' backend/` returns no matches.
- `RG_NO_PLAYWRIGHT_DEP` — `rg 'playwright' pyproject.toml uv.lock` returns no matches.

### Frontend — delete tests for removed components

- Delete or empty any vitest spec that imports `CredentialsModal` or `MfaDialog`.
- Assert in the Providers smoke test that neither `CredentialsModal` nor `MfaDialog` appears in the rendered tree.

---

## Definition of Done

### Files deleted
- [ ] `backend/providers/playwright_provider.py`
- [ ] `backend/providers/_deprecated/` (directory + contents)
- [ ] `backend/services/_deprecated/` (directory + contents)
- [ ] `backend/workers/session_cleanup.py`
- [ ] `my_safeway_login.py`
- [ ] `frontend/src/components/CredentialsModal.jsx`
- [ ] `frontend/src/components/MfaDialog.jsx`

### Backend modified
- [ ] `base_provider.py`: `login` / `fetch_receipts` / `handle_mfa` abstract methods removed; `cleanup` is a concrete no-op; `provider_name` abstract property kept.
- [ ] `costco_provider.py`: extends `BaseProvider`; no browser methods or `browser`/`context`/`page`/`_playwright` attributes; no `random`/`time` imports; token/API methods intact.
- [ ] `providers.py`: deprecation guard, executor plumbing, and all `/test` + `/login/*` + username/password `/fetch-receipts` + `fetch_receipts_after_mfa` handlers removed; legacy token/connection routes (`fetch-receipts`, `fetch-receipts-with-token`, `connection-code`, `connect`, `connection/<code>/status`) also removed; `store-receipts` and `connect-from-app` untouched.
- [ ] `app.py`: `LoginSessionManager`, `SessionCleanupWorker`, `debug_ingest_bp`, and `PLAYWRIGHT_*` / `MFA_*` config stores removed; `main()` shutdown block removed.
- [ ] `config.py`: `PLAYWRIGHT_HEADLESS`, `PLAYWRIGHT_TIMEOUT`, `MFA_SESSION_TIMEOUT`, `SESSION_CLEANUP_INTERVAL`, `MFA_MAX_RETRY_ATTEMPTS` removed.

### Dependencies
- [ ] `pyproject.toml`: `playwright`, `playwright-stealth`, and `[tool.playwright]` removed.
- [ ] `uv lock` re-run; `uv.lock` has zero playwright / playwright-stealth entries.

### Frontend modified
- [ ] `apiClient.js`: dead login/MFA methods removed.
- [ ] `Providers.jsx`: credentials/MFA state, handlers, JSX, and the generic `else` branch removed.

### Verification
- [ ] `uv run python -c "from backend.app import create_app; create_app()"` succeeds and logs no `LoginSessionManager` / `SessionCleanupWorker` init.
- [ ] `rg 'playwright|playwright_stealth' backend/ frontend/src/ pyproject.toml uv.lock` — zero matches.
- [ ] `rg 'PlaywrightProvider|LoginSessionManager|SessionCleanupWorker|_perform_mfa_verification' backend/ frontend/src/` — zero matches.
- [ ] `rg 'LOGIN_SESSION_MANAGER|SESSION_CLEANUP_WORKER|MFA_SESSION_TIMEOUT' backend/` — zero matches.
- [ ] All pytest and vitest suites pass with the test updates above.
- [ ] Manual smoke: connect Costco via One-Tap Sync still works end-to-end.
- [ ] Manual smoke: Safeway native WebView sync still works end-to-end.
- [ ] Manual smoke: `POST /api/providers/costco/test` returns 404.

### Logic Audit

Before marking done, produce a bullet-list confirming each of the following:

- [ ] `CostcoProvider` is still registered and instantiable without launching a browser — confirmed via `ProviderRegistry.is_registered("costco")` and a no-arg instantiation in a test.
- [ ] `CostcoProvider.fetch_receipts_via_api` / token-refresh methods unchanged — confirmed by diff.
- [ ] `costco_provider.py` imports audited: `random`, `time`, `base64`, `hashlib`, `json`, `re`, `requests`, `datetime`, `timedelta` — state which were removed.
- [ ] `providers.py` imports audited: `concurrent.futures`, `MFARequiredException`, `timezone`, `timedelta` — state which were removed.
- [ ] No remaining reference to `LOGIN_SESSION_MANAGER` / `SESSION_CLEANUP_WORKER` / `MFA_*` config in `backend/`.
- [ ] No remaining frontend caller of the removed `apiClient` methods (`testProviderConnection`, `submitMfaCode`, `getLoginStatus`, `cancelLoginSession`, `getDeviceVerificationOptions`, `selectDeviceVerificationMethod`, `fetchReceipts`, `fetchReceiptsAfterMfa`).
- [ ] `tests/backend/conftest.py` no longer imports `_deprecated.safeway_provider`; `test_session_cleanup.py` deleted; affected provider/route tests updated.
