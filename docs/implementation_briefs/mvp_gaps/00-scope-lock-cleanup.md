# M0 — Scope Lock & Cleanup

> **Prerequisite:** Read `docs/MVP_SCOPE_AND_ROADMAP.md` §2 (deferred features), §5 gap #8, and `docs/implementation_briefs/mvp_gaps/README.md` "Shared conventions".
>
> **Scope:** Remove or guard three dev-only debug-logging paths from production code; add a frontend allowlist that constrains the provider UI to Safeway + Costco; confirm voice-guided cooking has no surfaced entry point. Zero behavior change to any in-scope feature.
>
> **Related:** `00a-playwright-removal.md` handles removal of the legacy server-side Playwright automation (deprecated Safeway provider, Costco browser-login/MFA routes, `LoginSessionManager`, etc.). The two briefs are independent and may be executed in either order.
>
> **Do NOT touch in this phase:** any `logger.info` / `logger.warning` / `logger.error` call; `backend/providers/_deprecated/safeway_provider.py` internals; any voice-input-for-pantry code (`frontend/src/components/voice/*`, `backend/routes/pantry.py` `/voice-transcribe` `/voice-confirm`); test files that already patch `_agent_dbg`.

---

## Objective

Make the production app invisible to deferred features and clean of developer debug artifacts before M1 work begins. An end user running the app after this brief must never see a QFC/Kroger/Walmart provider card, a voice-guided-cooking entry point, or trigger a write to `debug-ef2920.log` / `debug-392e90.log`. No in-scope feature changes behavior.

---

## Technical Contract

### 1. `backend/routes/pool.py` — delete `_agent_dbg` function and all call-site blocks

**What to remove (delete, not comment out):**

- Lines 20–44: the entire `_agent_dbg` function definition, plus the `import json`, `import os`, `import time` statements **only if** they are not used elsewhere in the file after removal (verify — `time` is used in the `# #region agent log` call sites but nowhere else; `json` and `os` are only used by `_agent_dbg`; remove all three if confirmed unused after cleanup).
- All `# #region agent log` / `# #endregion` sentinel comments and their enclosed code blocks:
  - `get_pool`: the `_t0 = time.perf_counter()` block (lines 85–87) and the `_agent_dbg(...)` block (lines 89–98).
  - `get_depth`: the `_t0 = time.perf_counter()` block (lines 117–119) and the `_agent_dbg(...)` block (lines 121–130).
  - `generate_pool`: the `_agent_dbg("...enter...")` block (lines 203–212), the `_t_gen` assignment, and the `_agent_dbg("...exit...")` block (lines 219–228).

**After removal:** `get_pool`, `get_depth`, and `generate_pool` call their service methods and return responses directly, with no timing variables or debug calls. All existing `logger.error` calls remain.

### 2. `backend/services/pool_generator.py` — delete `_agent_dbg` function and all call-site blocks

Same pattern as `pool.py`. The file contains:
- A `_agent_dbg` function definition in a `# #region agent log` block (confirmed: 8 occurrences of the pattern in this file, 4 function + call-site pairs).
- Remove the function definition and every call site enclosed in `# #region agent log` … `# #endregion` sentinels. Remove the sentinels themselves.
- Remove `import json`, `import os`, `import time` **only if** they are no longer referenced after cleanup (audit each import before removing).

**After removal:** `pool_generator.py` contains no reference to `_agent_dbg`, `debug-ef2920.log`, or any file-write operation.

### 3. `backend/routes/debug_ingest.py` + `backend/app.py` — remove the dev debug-ingest HTTP endpoint

The `debug_ingest_bp` blueprint exposes `POST /api/debug-ingest`, which appends arbitrary payloads to `debug-392e90.log` at the repo root. This is a dev-only artifact.

**Changes:**
- `backend/app.py`: remove the import `from backend.routes.debug_ingest import debug_ingest_bp` (line 11) and remove `app.register_blueprint(debug_ingest_bp, url_prefix="/api")` (line 248).
- `backend/routes/debug_ingest.py`: delete the entire file.

**After removal:** `GET/POST /api/debug-ingest` returns 404. The file `debug-392e90.log` is never written by production code.

### 4. `frontend/src/pages/Providers.jsx` — add provider allowlist guard

The page fetches its provider list from `GET /api/providers`, which today returns only `['costco', 'safeway']`. However there is no frontend guard: if the backend registry ever gains a new provider (QFC, Kroger, Walmart), it would render with generic "Test Connection" / "Fetch Receipts" buttons (the `else` branch at line 484).

**Change:** Immediately after `const providerList = data.providers || []` (line 70), filter to the MVP allowlist:

```js
const MVP_PROVIDERS = ['safeway', 'costco']
// ...
const providerList = (data.providers || []).filter(p => MVP_PROVIDERS.includes(p))
```

Declare `MVP_PROVIDERS` as a module-level constant above the component. The else-branch rendering (lines 484–499) remains as a safety net for future in-scope providers but will never render at MVP.

**No other changes to `Providers.jsx`.** The `SafewayConnectCard` and `CostcoOneTapSync` branches already branch correctly on `provider === 'costco'` / `provider === 'safeway'`.

### 5. Voice-guided cooking — confirm-only (no code change expected)

Audit the codebase for any route, page, or button that would surface a "hands-free cooking" or "voice-guided cooking" flow:

- `frontend/src/components/voice/VoiceInputSheet.jsx` and `VoiceWaveform.jsx` — these are pantry-input voice components, not cooking guides. Confirm they are only imported/used in `Pantry.jsx` or similar pantry-add flows, not on any recipe/cook page.
- `frontend/src/App.jsx` routes — confirm no route exists for a voice-cooking page.
- Backend `backend/routes/pantry.py` — confirm `/voice-transcribe` and `/voice-confirm` are pantry-only endpoints (no recipe step or cooking navigation).

**Expected outcome:** no code change needed. Brief requires documenting the audit result in the Logic Audit.

---

## Logic Guardrails

- **No behavior change to in-scope features:** Safeway sync, Costco sync, pantry operations, recipe suggestions, meal plan, and the cold-start arc must behave identically before and after this brief.
- **`logger.*` calls are not debug logging:** Do not remove any `logger.info`, `logger.warning`, `logger.error`, or `logger.debug` calls. Only `_agent_dbg` file-write calls and the `debug_ingest_bp` HTTP endpoint are removed.
- **Import hygiene:** When removing `import json / os / time` from `pool.py` or `pool_generator.py`, verify with `rg` that no remaining code in the same file uses them before removing. Do not remove an import that is still in use for non-debug logic.
- **MVP_PROVIDERS allowlist is additive, not restrictive:** If Safeway or Costco are absent from the backend response (e.g., service error), the filter simply produces an empty list — the existing "No providers available yet" fallback renders correctly.
- **`backend/providers/_deprecated/safeway_provider.py`** is not imported by any production route (confirmed: `providers.py` uses `ProviderRegistry`, which does not register `_deprecated`). The code inside it is therefore dead code; cleanup is deferred to `00a-playwright-removal.md`.
- **Test files** (`tests/services/test_pool_generator.py`) already patch `_agent_dbg`. After this brief, those patches become no-ops on a missing symbol; update the test to remove the patch or adjust the import guard as needed so the test suite still passes.

---

## Test-First Suite

All tests must be scaffolded **before** implementation changes. Run with `pytest` (backend) and `vitest` (frontend).

### Backend: `tests/routes/test_pool_cleanup.py` (new)

- `test_get_pool_returns_200_no_debug_side_effects` — call `GET /suggestions/pool` with a valid household; assert response is 200, assert `debug-ef2920.log` does not exist or was not modified (capture mtime before/after).
- `test_get_depth_returns_200_no_debug_side_effects` — same pattern for `GET /suggestions/pool/depth`.
- `test_generate_pool_returns_200_no_debug_side_effects` — `POST /suggestions/pool/generate` with `trigger_reason=manual_refresh`; assert 200, no file write.
- `test_debug_ingest_endpoint_removed` — `POST /api/debug-ingest` with arbitrary JSON body; assert HTTP 404.
- `test_debug_ingest_log_not_written` — after calling the above, assert `debug-392e90.log` does not exist at the repo root (or was not created/modified during the test run).

### Backend: `tests/routes/test_pool_cleanup.py` — grep-based assertions (run as part of CI)

These can live as a `test_no_debug_artifacts_in_source` parametrized test using `subprocess.run(['rg', ...])`:

- `RG_NO_DEBUG_EF2920_IN_PROD` — `rg 'debug-ef2920' --glob '!tests/**' --glob '!docs/**'` returns no matches.
- `RG_NO_DEBUG_392E90_IN_PROD` — `rg 'debug-392e90' --glob '!tests/**' --glob '!docs/**'` returns no matches.
- `RG_NO_AGENT_DBG_FUNCTION_IN_PROD` — `rg '_agent_dbg' backend/routes/pool.py backend/services/pool_generator.py` returns no matches.
- `RG_NO_DEBUG_INGEST_IMPORT` — `rg 'debug_ingest' backend/app.py` returns no matches.

### Frontend: `frontend/src/tests/providers-allowlist.test.jsx` (new, vitest)

- `PROVIDERS_ALLOWLIST_FILTERS_UNKNOWN_PROVIDER` — render `<Providers />` with a mocked `api.listProviders()` returning `['safeway', 'costco', 'qfc']`; assert the DOM contains provider cards for safeway and costco but **not** qfc.
- `PROVIDERS_ALLOWLIST_RENDERS_SAFEWAY_AND_COSTCO` — mock returns `['safeway', 'costco']`; both cards render.
- `PROVIDERS_ALLOWLIST_EMPTY_WHEN_NO_KNOWN_PROVIDERS` — mock returns `['qfc', 'walmart']`; the "No providers available yet" fallback renders.
- `VOICE_INPUT_SHEET_NOT_IMPORTED_IN_RECIPES` — static import check: assert `Recipes.jsx` does not import `VoiceInputSheet` or any voice component (use `rg` assertion in test setup or as a separate CI lint step).

---

## Definition of Done

- [ ] `backend/routes/pool.py`: `_agent_dbg` function and all `# #region agent log` call-site blocks deleted; file has no reference to `debug-ef2920.log`; no unused `import json/os/time` left; all route handlers pass existing tests.
- [ ] `backend/services/pool_generator.py`: same — no `_agent_dbg`, no `debug-ef2920.log` reference, no orphaned imports.
- [ ] `backend/routes/debug_ingest.py`: file deleted.
- [ ] `backend/app.py`: `debug_ingest_bp` import and `register_blueprint` call removed.
- [ ] `frontend/src/pages/Providers.jsx`: `MVP_PROVIDERS` constant added; provider list filtered before `setProviders`; no other changes.
- [ ] `rg 'debug-ef2920' --glob '!tests/**' --glob '!docs/**'` — zero matches.
- [ ] `rg 'debug-392e90' --glob '!tests/**' --glob '!docs/**'` — zero matches.
- [ ] `rg '_agent_dbg' backend/routes/pool.py backend/services/pool_generator.py` — zero matches.
- [ ] `rg 'debug_ingest' backend/app.py` — zero matches.
- [ ] All existing pytest and vitest suites pass without modification (except patching `_agent_dbg` in `test_pool_generator.py` which must be updated to remove the now-stale patch).
- [ ] New test suite `test_pool_cleanup.py` passes.
- [ ] New vitest suite `providers-allowlist.test.jsx` passes.
- [ ] Manual smoke: run the app, open Providers page — only Safeway and Costco cards render.
- [ ] Manual smoke: open Recipes/cook flow — no voice-guided cooking button or route is reachable.

### Logic Audit

Before marking done, produce a bullet-list confirming each of the following:

- [ ] `import json` in `pool.py` removed (or confirmed still needed) — state which.
- [ ] `import os` in `pool.py` removed (or confirmed still needed) — state which.
- [ ] `import time` in `pool.py` removed (or confirmed still needed) — state which.
- [ ] Same three imports audited in `pool_generator.py`.
- [ ] `VoiceInputSheet` / `VoiceWaveform` import graph audited: only used in pantry-add flow, not in any recipe or cook surface — confirmed.
- [ ] `test_pool_generator.py` patch of `_agent_dbg` updated to prevent import error after symbol removal.
