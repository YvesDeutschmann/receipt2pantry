# 06 — Launch Readiness

> **Prerequisite:** Briefs 00–05 are fully merged and green. All M0–M5 exit gates are met. The
> activation-funnel telemetry from brief 03 is instrumented and confirmed flowing in staging.
>
> **Scope:** Security/RLS review; production secrets configuration; minimal crash/error monitoring
> wired; reconnect support runbook; iOS + Android dual-platform release QA gate. This brief is the
> **launch go/no-go document**. Every checkbox below must be ticked before submitting to TestFlight
> external beta and Google Play open testing.
>
> **Do NOT touch in this phase:** application business logic, schema columns, or provider sync
> code. This is audit + configuration + runbook + smoke-test work only. If a verification step
> reveals a logic bug, open a separate brief and fix it before returning to this gate.

---

## Objective

Confirm that the Meald production environment is hardened, observable, and operable before the
first external users onboard. The launch gate certifies: (1) no user can read another user's data
via any surface; (2) all secrets travel through the configured vault, never through environment
plaintext or git; (3) any crash or unhandled error is captured and routed to an operator; (4) the
support team has a concrete runbook for the #1 expected ticket (store reconnect); (5) the full
cold-start arc is verified on real iOS and Android devices.

---

## Technical Contract

### Area 1 — Security & RLS Review

**1a. RLS enabled and policies present on every public table**

- Run the SQL audit query against the production database:
  ```sql
  SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  ORDER BY c.relname;
  ```
  Every table listed in `supabase/migrations/022_explicit_data_api_grants.sql` must appear with
  `rls_enabled = true`. Tables covered: `grocery_accounts`, `receipts`, `receipt_items`,
  `automation_logs`, `login_sessions`, `product_mappings`, `pantry_items`, `cooking_log`,
  `ingredient_substitutions`, `ai_processing_log`, `households`, `household_members`, `meal_plan`,
  `shopping_list`, `meal_plan_wizard_session`, `recipe_bans`, `staples_template`,
  `canonical_ingredients`, `pool_generation`, `suggestion_pool`, `item_classification`,
  `depletion_history`, `purchase_history`, `user_preferences`, `ingredient_signals`.

- Verify no table in the `public` schema has RLS disabled via:
  ```sql
  SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
  ```
  Expected: zero rows.

**1b. Cross-user data isolation (household boundary)**

- The household scoping in `supabase/migrations/005_households.sql` permits household members to
  read each other's `pantry_items`, `receipts`, and `cooking_log`. Verify that a user with no
  household membership cannot read rows owned by another user's household. Use two test UUIDs
  (extend `backend/scripts/test_rls_endpoints.py`).
- Verify `grocery_accounts` and `login_sessions` have user-only (not household-scoped) SELECT
  policies: user A must not be able to read user B's connected-store credentials.
- Confirm `depletion_history`, `purchase_history`, `user_preferences`, and `ingredient_signals` are
  own-row only (no household sharing).

**1c. JWT enforcement in production**

- `backend/utils/auth.py` reads `SUPABASE_JWT_SECRET` from the environment at request time. When
  the variable is absent, the function falls back to the `X-User-Id` request header — a
  development-only bypass that must not be reachable in production.
- **Required action:** Confirm `SUPABASE_JWT_SECRET` is set in the production environment.
  Add a startup assertion to `backend/config.py` `ProductionConfig.validate()`:
  ```python
  if not os.getenv("SUPABASE_JWT_SECRET"):
      errors.append("SUPABASE_JWT_SECRET is required in production")
  ```
- Verify: start the Flask server with `FLASK_ENV=production` and an unset `SUPABASE_JWT_SECRET`;
  the process must exit with a `ConfigurationException` before serving requests.

**1d. CORS locked to production origins**

- `backend/app.py` line 48 reads `config.get_cors_origins()`, which parses `CORS_ORIGINS` from the
  environment. The default in `backend/config.py` line 46 is
  `"http://localhost:5173,http://localhost:3000"`.
- Confirm the production environment variable `CORS_ORIGINS` contains only the production Capacitor
  scheme (e.g. `capacitor://localhost`) and the production API host, with no `localhost` or LAN
  entries.
- Verify with `curl -H "Origin: http://localhost:5173" https://<prod-api>/api/health` and confirm
  the response does **not** include `Access-Control-Allow-Origin: http://localhost:5173`.

**1e. Deprecated Safeway Playwright routes return 410**

- `backend/routes/providers.py` lines 20–32 register a `before_request` hook matching
  `_DEPRECATED_SAFEWAY_PATTERN = r"^/api/providers/safeway/(test|fetch-receipts|login/.*)$"`.
  These routes already return 410 with `"deprecated": true`.
- Smoke-test: `curl -X POST https://<prod-api>/api/providers/safeway/login/start` → HTTP 410.
- Confirm no client code in `frontend/src/` calls these paths:
  ```bash
  rg "providers/safeway/(test|fetch-receipts|login)" frontend/src/
  ```
  Expected: zero matches.

---

### Area 2 — Production Secrets Configuration

**2a. Secrets backend selection**

- `backend/app.py` lines 177–214 implement a waterfall: AWS Secrets Manager (if
  `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` are set) → Supabase Vault (if
  `admin_client` is available) → `MockSecretsService` (fallback).
- **Exactly one** of AWS Secrets Manager or Supabase Vault must be configured for production.
  `MockSecretsService` must never be reached in production. Add a startup assertion in
  `ProductionConfig.validate()`:
  ```python
  # Verify a real secrets backend is reachable at startup
  # (checked by the app factory; ensure MOCK log line never appears in prod)
  ```
  Alternatively: verify the production start-up log contains either `"AWS Secrets Manager
  initialized"` or `"Using Supabase Vault Service"` and never `"Using mock Secrets Service"`.

**2b. No secrets in git or committed .env**

- Run the following grep checks (must all return zero matches):
  ```bash
  rg "SPOONACULAR_API_KEY\s*=\s*\S" --include="*.env" .
  rg "OPENAI_API_KEY\s*=\s*\S" --include="*.env" .
  rg "AWS_SECRET_ACCESS_KEY\s*=\s*[A-Za-z0-9]" .
  rg "SUPABASE_SERVICE_ROLE_KEY\s*=\s*eyJ" .
  rg "supabase_service_role|service_role_key" --include="*.py" -i . | grep -v "os.getenv\|config\.\|test\|migration"
  ```
- Confirm `.env` (if present at repo root) is listed in `.gitignore`:
  ```bash
  git check-ignore -v backend/.env .env
  ```

**2c. Required keys present in production environment**

Confirm the following environment variables are non-empty in the production deploy:
- `SUPABASE_URL`
- `SUPABASE_KEY` (or `SUPABASE_PUBLIC_KEY`)
- `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`)
- `SUPABASE_JWT_SECRET`
- `FLASK_SECRET_KEY` (must not equal `"dev-secret-key-change-in-production"` — enforced by
  `ProductionConfig.validate()` in `backend/config.py` lines 108–111)
- `SPOONACULAR_API_KEY`
- `OPENAI_API_KEY`
- Either `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`, or confirm Supabase Vault RPCs are
  reachable (`vault_create_secret`, `vault_get_secret_by_name`) via `backend/services/secrets_service.py`
  `SupabaseVaultService`.

**2d. Android `network_security_config.xml` set for production**

- `frontend/android/app/src/main/res/xml/network_security_config.xml` is currently **modified in
  git** and contains a hardcoded LAN IP `192.168.50.57`. The file comment explicitly states: _"Do
  not commit a machine-specific IP — use .env.local (gitignored)."_
- **Required action before release build:** Remove the `192.168.50.57` `<domain>` entry. The
  production release build must contain only `localhost` and `10.0.2.2` (Android emulator
  loopback) — or better, an empty `<network-security-config/>` if all production traffic uses
  HTTPS, removing cleartext permission entirely.
- Verify the release APK/AAB does not permit cleartext traffic to any non-loopback host:
  ```bash
  # After building release AAB
  rg "cleartext" frontend/android/app/src/main/res/xml/network_security_config.xml
  # Must return zero matches, or only apply to 10.0.2.2 / localhost
  ```

**2e. iOS Info.plist / ATS settings**

- Confirm `frontend/ios/App/App/Info.plist` does not contain `NSAllowsArbitraryLoads = YES` in
  production. Any LAN exception domain entries must be removed before App Store / TestFlight
  submission. Verify:
  ```bash
  rg "NSAllowsArbitraryLoads|NSExceptionDomains" frontend/ios/App/App/Info.plist
  ```

---

### Area 3 — Crash / Error Monitoring

**3a. Backend: Sentry for Flask**

- Install: `uv add sentry-sdk[flask]`
- Initialize in `backend/app.py` `create_app()`, immediately after `app = Flask(__name__)` and
  before any route registration:
  ```python
  import sentry_sdk
  from sentry_sdk.integrations.flask import FlaskIntegration
  if config.SENTRY_DSN:
      sentry_sdk.init(
          dsn=config.SENTRY_DSN,
          integrations=[FlaskIntegration()],
          environment=config.FLASK_ENV,
          traces_sample_rate=0.05,
          send_default_pii=False,   # PII guard — see Logic Guardrails
      )
  ```
- Add `SENTRY_DSN: Optional[str] = os.getenv("SENTRY_DSN")` to `backend/config.py` `Config`.
- `send_default_pii=False` is non-negotiable (see Logic Guardrails).

**3b. Frontend: Sentry for React / Capacitor**

- Install: `npm install @sentry/capacitor @sentry/react`
- Initialize in `frontend/src/main.jsx` `bootstrap()`, before `ReactDOM.createRoot(...)`:
  ```js
  import * as Sentry from "@sentry/capacitor";
  if (import.meta.env.VITE_SENTRY_DSN) {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.MODE,
      // No user PII — see Logic Guardrails
    });
  }
  ```
- Add `VITE_SENTRY_DSN` to the production environment / CI build secrets. Do not commit the value.
- Monitoring is optional at launch (feature-flagged via DSN presence) but strongly recommended.

**3c. Activation-funnel telemetry (from brief 03)**

- Confirm the funnel events instrumented in brief 03 are flowing to the analytics endpoint in
  staging: connect → sync complete → staples confirmed → first suggestion → first cook.
- Run `backend/scripts/test_rls_endpoints.py` in staging; confirm no funnel events include raw
  tokens or user-identifiable content beyond a hashed/opaque user ID.

---

### Area 4 — Reconnect Support Runbook

**4a. Symptom identification**

A user reports: "my pantry isn't updating" or "the app says I need to reconnect my store."

Backend indicators:
- `grocery_accounts.connection_status` (schema: `001_initial_schema`) contains `needs_reconnect`
  for the user's provider row.
- The `needs_reconnect` signal is set by the idempotency/health logic from brief 01c
  (`backend/routes/providers.py`, `/api/providers/<name>/status`).
- Server logs show `expired_credentials` or HTTP 401/403 from the provider API for that user.

Frontend indicators:
- `frontend/src/contexts/AuthContext.jsx`: user session still valid (Supabase auth is fine).
- The reconnect UX from brief 01a is visible: a banner or modal on the home/sync screen indicating
  the specific provider needs attention.

**4b. Standardized `needs_reconnect` signal**

The signal originates in `backend/routes/providers.py` `/api/providers/<provider>/status` and is
set in `grocery_accounts.connection_status` by the sync health logic (brief 01c). The frontend
reads this on app foreground via the auto-sync scheduler (brief 01b) and surfaces the reconnect
prompt from brief 01a.

**4c. Operator resolution steps**

1. Ask the user: which store? (Safeway or Costco)
2. Confirm the user can reach the store's website from a browser (rules out network/geo block).
3. Direct the user to: **Settings → Connected Stores → [Store Name] → Reconnect**.
4. The reconnect flow re-authenticates via the native WebView bridge and writes new
   credentials/tokens to `grocery_accounts` and the secrets vault
   (`backend/services/secrets_service.py`).
5. After reconnect, trigger a manual "Sync Now" from the same screen.
6. If the error recurs within 24 hours, escalate — the store may have changed its auth flow
   (bot-detection regression). Check backend logs for HTTP 403 from the provider and open a
   provider-maintenance issue.

**4d. Safeway vs. Costco reconnect differences**

- **Safeway**: WebView bridge login — user re-enters Safeway credentials. Session cookie is
  refreshed and stored in the secrets vault.
- **Costco**: One-Tap token refresh — user re-authenticates via the Costco One-Tap WebView.
  Token stored in `grocery_accounts` and the secrets vault via `SupabaseVaultService` or AWS.
  Check `providers/costco_provider.py` token-refresh logic and `backend/routes/providers.py`
  `/api/providers/costco/connect-from-app` if the automatic refresh path failed.

---

### Area 5 — Dual-Platform Release QA Gate

**5a. iOS build (TestFlight)**

- Commands (from `frontend/`):
  ```bash
  npm run build
  npx cap sync ios
  # Open Xcode, set scheme to Release, select "Any iOS Device (arm64)", Product → Archive
  # Upload to App Store Connect → TestFlight internal testing group
  ```
- Signing prerequisites: distribution certificate + provisioning profile in Xcode / CI. Confirm
  `PRODUCT_BUNDLE_IDENTIFIER` matches App Store Connect app ID.
- Confirm `Info.plist` `NSAllowsArbitraryLoads` is absent or `false` in the Release scheme.

**5b. Android build (signed APK/AAB)**

- Commands (from `frontend/`):
  ```bash
  npm run build
  npx cap sync android
  # In Android Studio: Build → Generate Signed Bundle/APK → Android App Bundle
  # Or via Gradle: ./gradlew bundleRelease
  ```
- Confirm `network_security_config.xml` LAN IP removed (Area 2d above) before this build.
- Confirm keystore credentials are in CI secrets, not committed to the repo.

**5c. Cold-start arc — both platforms**

Walk the following arc on a physical device (not simulator/emulator) for **both iOS and Android**:
1. Fresh install (no prior app state).
2. Sign in with Apple (iOS) / Google (Android).
3. Household size → dietary restrictions → Connect Store (Safeway OR Costco).
4. Wait for initial sync to complete; observe the reconnect prompt is **not** shown on success.
5. Confirm staples template loads and completes in < 2 minutes.
6. Tap "What's for Dinner"; confirm ≥ 1 suggestion appears in < 2 seconds (warm pool).
7. Mark a meal as cooked; confirm pantry updates.
8. Background and foreground the app; confirm auto-sync fires (brief 01b) without a crash.
9. Confirm no `console.error` / native crash log in Xcode Organizer / Android Logcat.

**5d. Auto-sync verification (both platforms)**

- Auto-sync is on by default per owner decision (M1/M5 owner decision, confirmed 2026-06-09).
- Verify: after a successful cold-start arc, put the app in background for 5 minutes, foreground
  it, and confirm the throttle-aware scheduler from brief 01b triggers a sync attempt without
  showing an error.
- Verify: with invalid credentials (manually expire the token in the DB), foreground the app and
  confirm a visible reconnect prompt appears within the first foreground sync cycle. Confirm the
  prompt is dismissible and navigates to the reconnect flow.
- Verify: a sync failure never silently swallows the error — check Sentry for the captured
  exception and confirm the frontend banner is visible to the user.

---

## Logic Guardrails

- **RLS deny-by-default:** any table without an explicit `authenticated` SELECT policy must return
  zero rows to an authenticated user (not a 403). Confirm with the audit query in Area 1a.
- **No PII in monitoring:** Sentry `send_default_pii=False` on the backend. No user email, name,
  phone number, or raw grocery credentials may appear in Sentry events. Log scrubbing: confirm
  `backend/utils/logger.py` does not log request bodies on non-debug log levels.
- **No secrets in client bundle:** The compiled iOS/Android JS bundle must not contain any API
  keys. Verify: `rg "sk-|eyJhbGciOiJIUzI1NiI|SUPABASE_SERVICE_ROLE" frontend/dist/assets/`.
  Expected: zero matches. `VITE_` env vars that are public (Supabase anon key, Sentry DSN) are
  acceptable; service-role keys, OpenAI keys, and AWS keys are never `VITE_`-prefixed.
- **JWT validation enforced in production:** `backend/utils/auth.py` `get_user_id_from_request()`
  must never return a user ID from the `X-User-Id` header in production. The `SUPABASE_JWT_SECRET`
  must be set; the `ProductionConfig.validate()` startup check enforces this.
- **Mock secrets service blocked in production:** `MockSecretsService` initialization must never
  occur when `FLASK_ENV=production`. The startup log line `"Using mock Secrets Service"` is a
  hard launch blocker.
- **Auto-sync failures are never silent:** any exception in the foreground sync scheduler (brief
  01b) must either surface a user-facing reconnect prompt or be captured by Sentry. A bare
  `try/except: pass` in the sync path is prohibited.
- **Deprecated routes stay at 410:** the `_DEPRECATED_SAFEWAY_PATTERN` before_request hook in
  `backend/routes/providers.py` must not be removed or narrowed before launch.
- **`anon` role has zero grants:** migration `022_explicit_data_api_grants.sql` issues no grants
  to `anon`. Confirm by running `\dp` in psql and checking no `anon` entry appears for any public
  table row-level permission.

---

## Verification Suite

### `test_rls_endpoints.py` — extended checks

Add the following named test cases to `backend/scripts/test_rls_endpoints.py`:

**`RLS_CROSS_USER_PANTRY_ISOLATION`**
- Create (or reference) two test users: `TEST_USER_ID` (`000...0001` from migration 010) and a
  second UUID with no household overlap.
- Using the Supabase `authenticated` client (not admin) as user B, attempt to SELECT
  `pantry_items` owned by user A's household.
- Assert: result is empty (zero rows), not a 403.

**`RLS_CROSS_USER_GROCERY_ACCOUNTS_ISOLATION`**
- As user B (authenticated client), attempt SELECT on `grocery_accounts` where
  `user_id = TEST_USER_ID`.
- Assert: zero rows returned.

**`RLS_ANON_ROLE_BLOCKED`**
- Using the Supabase client initialized with the anon key (no JWT), attempt SELECT on
  `pantry_items`, `receipts`, `grocery_accounts`.
- Assert: zero rows returned for all three (no data leak to unauthenticated callers).

**`DEPRECATED_SAFEWAY_ROUTES_RETURN_410`**
```python
def test_deprecated_safeway_routes_return_410(client):
    for path in [
        "/api/providers/safeway/test",
        "/api/providers/safeway/fetch-receipts",
        "/api/providers/safeway/login/start",
        "/api/providers/safeway/login/abc123/mfa",
    ]:
        r = client.post(path)
        assert r.status_code == 410, f"Expected 410 for {path}, got {r.status_code}"
```

**`CORS_LOCALHOST_BLOCKED_IN_PRODUCTION`**
```python
def test_cors_localhost_blocked(prod_client):
    r = prod_client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    assert "Access-Control-Allow-Origin" not in r.headers or \
           r.headers.get("Access-Control-Allow-Origin") != "http://localhost:5173"
```
(Requires a `prod_client` fixture with `CORS_ORIGINS` set to the production value.)

**`NO_SECRETS_IN_BUNDLE`** (shell check, run in CI after `npm run build`):
```bash
rg "SUPABASE_SERVICE_ROLE|AWS_SECRET_ACCESS_KEY|sk-proj-|SPOONACULAR_API_KEY" \
    frontend/dist/assets/ && echo "FAIL: secret found in bundle" && exit 1 || echo "OK"
```

**`JWT_SECRET_REQUIRED_IN_PRODUCTION`**:
```python
def test_jwt_secret_required_in_production():
    import os
    os.environ["FLASK_ENV"] = "production"
    os.environ.pop("SUPABASE_JWT_SECRET", None)
    with pytest.raises(ConfigurationException, match="SUPABASE_JWT_SECRET"):
        from backend.config import ProductionConfig
        ProductionConfig.validate()
```

**`MOCK_SECRETS_BLOCKED_IN_PRODUCTION`**:
```python
def test_mock_secrets_service_not_used_in_production(caplog):
    # Start app with FLASK_ENV=production and no AWS keys but valid Supabase config
    # Assert log does NOT contain "Using mock Secrets Service"
    assert "Using mock Secrets Service" not in caplog.text
```

### Manual device smoke checklist (iOS + Android)

Run on a **physical device** (not simulator) for each platform before submitting builds:

- [ ] Fresh install completes cold-start arc in < 3 minutes.
- [ ] No crash or native exception in Xcode Organizer (iOS) / Android Logcat during cold-start.
- [ ] Sentry receives a test event (`sentry_sdk.capture_message("launch-readiness-smoke-test")`
      on backend; `Sentry.captureMessage(...)` on frontend) — confirms DSN is live.
- [ ] App foreground auto-sync fires; no "reconnect" prompt appears on a freshly-connected account.
- [ ] Forced reconnect scenario (manually set `grocery_accounts.connection_status = 'needs_reconnect'`
      in Supabase): foreground app, confirm reconnect banner appears, tap it, complete reconnect,
      confirm banner dismisses and sync succeeds.
- [ ] `network_security_config.xml` LAN IP absent from release build (Android).
- [ ] Recipe suggestions load in < 2 seconds from warm pool.
- [ ] "I cooked this" depletes pantry correctly.
- [ ] No `console.error` lines visible in Safari WebInspector (iOS) / Chrome remote debug (Android)
      during a normal session.
- [ ] App Store / Google Play metadata complete; screenshots captured on target device sizes.

---

## Definition of Done

### Security / RLS

- [ ] SQL audit query returns zero tables with `rls_enabled = false`.
- [ ] `RLS_CROSS_USER_PANTRY_ISOLATION` test passes.
- [ ] `RLS_CROSS_USER_GROCERY_ACCOUNTS_ISOLATION` test passes.
- [ ] `RLS_ANON_ROLE_BLOCKED` test passes.
- [ ] `JWT_SECRET_REQUIRED_IN_PRODUCTION` test passes (startup fails without `SUPABASE_JWT_SECRET`).
- [ ] `DEPRECATED_SAFEWAY_ROUTES_RETURN_410` test passes.
- [ ] `CORS_LOCALHOST_BLOCKED_IN_PRODUCTION` test passes.

### Secrets

- [ ] `NO_SECRETS_IN_BUNDLE` CI grep returns zero matches.
- [ ] No `.env` file with real secrets is tracked by git (`git check-ignore` confirms).
- [ ] Production startup log contains `"AWS Secrets Manager initialized"` OR `"Using Supabase Vault Service"` — never `"Using mock Secrets Service"`.
- [ ] `MOCK_SECRETS_BLOCKED_IN_PRODUCTION` test passes.
- [ ] All required env vars in Area 2c are confirmed non-empty in the production deploy.
- [ ] `network_security_config.xml` LAN IP `192.168.50.57` removed; file committed clean.
- [ ] iOS `Info.plist` contains no `NSAllowsArbitraryLoads = YES` in the release build.

### Monitoring

- [ ] Sentry backend DSN set; test event received in Sentry project.
- [ ] Sentry frontend DSN set; test event received in Sentry project.
- [ ] `send_default_pii=False` confirmed in backend Sentry init.
- [ ] Activation-funnel telemetry (brief 03) confirmed flowing in staging with no PII in payloads.

### Reconnect Runbook

- [ ] This brief's Area 4 runbook is accessible to the support team (linked from internal ops wiki
      or Notion).
- [ ] Forced-reconnect smoke test passes on both iOS and Android (manual checklist item).

### Dual-Platform QA

- [ ] Cold-start arc verified on physical iOS device (TestFlight internal).
- [ ] Cold-start arc verified on physical Android device (internal track).
- [ ] Auto-sync on-by-default verified on both platforms (fires on foreground, no silent failure).
- [ ] Forced-reconnect scenario verified on both platforms.
- [ ] No crashes in Xcode Organizer or Android Logcat during full smoke session.

### Logic Audit

- [ ] **RLS deny-by-default:** confirmed via `pg_class` query — zero tables without RLS in public schema.
- [ ] **No PII in monitoring:** Sentry `send_default_pii=False`; grep of Sentry test events confirms no email/name/token fields.
- [ ] **No secrets in client bundle:** `NO_SECRETS_IN_BUNDLE` grep passes on release build artifacts.
- [ ] **JWT enforced in production:** `JWT_SECRET_REQUIRED_IN_PRODUCTION` test passes; `X-User-Id` header fallback unreachable in production env.
- [ ] **Mock secrets blocked:** `MOCK_SECRETS_BLOCKED_IN_PRODUCTION` test passes; production log confirms.
- [ ] **Auto-sync failures are never silent:** code review of brief 01b sync scheduler confirms all exception paths either surface a user prompt or call `Sentry.captureException`.
- [ ] **Deprecated routes stay at 410:** `DEPRECATED_SAFEWAY_ROUTES_RETURN_410` passes; `rg "providers/safeway/(test|fetch-receipts|login)" frontend/src/` returns zero matches.
- [ ] **`anon` role has zero grants:** `\dp` output for all public tables shows no `anon` permission entries.
