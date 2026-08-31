# 06 — Launch Readiness Assessment Findings

> **Assessed against:** [`06-launch-readiness.md`](06-launch-readiness.md)  
> **Assessment date:** 2026-07-22 (Area 1 remediation + live audit refreshed 2026-07-24; **Area 2 secrets closed 2026-07-25**; **third pass — solo-dev friends-beta review — 2026-07-28**, see bottom section)  
> **Status refresh:** 2026-07-28 evening — prod API live, GlitchTip + UptimeRobot live, OAuth-only flag shipped, sync-event visibility shipped; **Apple agreements accepted; signed iOS + Android release builds against `api.meald.app`**.  
> **Scope of this review:** Codebase + migration review, local secret greps, and DoD checklist scoring.  
> **Area 1 live audit:** Run 2026-07-24 post-remediation against project `pvmezsxdqotxaqfymmzd`. Household RLS recursion later landed on master as `024_postgres_best_practices_hardening.sql` (#67). Anon table revoke ships in this tree as `026_revoke_anon_table_grants.sql`. DB verification via Supabase MCP `execute_sql`; local checks via `uv run python backend/scripts/area1_security_audit.py`. Packaged `npx supabase` v2.67.0 lacks `db query` subcommand — SQL role-simulation checks use MCP or ephemeral-user fallback.  
> **Still not performed:** formal Area 5 cold-start / forced-reconnect checklist sign-off on those prod builds. **GlitchTip Cloud + UptimeRobot live 2026-07-28** (see Area 3 + runbooks).

---

## Verdict

**NO-GO for TestFlight external beta / Google Play open testing.**

Hard blockers are now **Area 5 device QA checklist** (cold-start / auto-sync / forced-reconnect sign-off) plus remaining third-pass ops (privacy/terms, delete-account, spend caps/backups, commit/merge of the launch-readiness tree). ~~Apple agreements + signed release builds against prod~~ **DONE**. **Areas 1–4 are effectively closed for code + live verify:**

| Area | Status (2026-07-28) |
|---|---|
| 1 Security / RLS | **PASS** (code + live DB audit) |
| 2 Secrets | **CLOSED** (2026-07-25) |
| 3 Monitoring | **PASS** — GlitchTip Cloud + UptimeRobot + sync_events |
| 4 Reconnect runbook | **PASS** (packaging); device smoke → Area 5 |
| 5 Dual-platform QA | **PARTIAL** — signed prod builds done; checklist sign-off open |

**Production backend:** Fly.io `meald-api` at `https://api.meald.app` (2026-07-28, finding 3.1). Prod env: `SUPABASE_JWT_SECRET`, `CORS_ORIGINS=capacitor://localhost`, `SENTRY_DSN` via `fly secrets` / `fly.toml`. Frontend release builds bake `VITE_API_BASE_URL=https://api.meald.app/api` from `frontend/.env.production`.

**Prerequisite note:** Brief 05 substitution stub landed in `78b0aa2`. Signed iOS + Android release builds against `https://api.meald.app` are available (2026-07-28). Remaining gate before flipping GO: commit/merge the uncommitted launch-readiness working tree, then complete Area 5 checklist on those builds.

---

## Scoreboard (Definition of Done)

Legend: **PASS** | **FAIL** | **PARTIAL** | **BLOCKED** (needs prod/device access) | **N/A** (superseded by later brief)

### Security / RLS

| DoD item | Status | Evidence |
|---|---|---|
| SQL audit: zero tables with `rls_enabled = false` | **PASS** | Live `pg_class` on `pvmezsxdqotxaqfymmzd`: zero public tables with `relrowsecurity=false` (post-024) |
| `RLS_CROSS_USER_PANTRY_ISOLATION` | **PASS** | Post-024: attacker `pantry_leak=0` (SQL simulation + ephemeral user) |
| `RLS_CROSS_USER_GROCERY_ACCOUNTS_ISOLATION` | **PASS** | `grocery_leak=0` |
| `RLS_OWN_ROW_TABLES_ISOLATION` | **PASS** | Post-024: `depletion_history`, `purchase_history`, `user_preferences`, `ingredient_signals`, `login_sessions` all `leak=0` for attacker |
| `RLS_ANON_ROLE_BLOCKED` | **PASS** | anon role: sensitive table counts all 0 |
| `JWT_SECRET_REQUIRED_IN_PRODUCTION` | **PASS** | `ProductionConfig.validate()` requires `SUPABASE_JWT_SECRET`; set on Fly via `fly secrets` (2026-07-28). Local `.env` may omit for dev. |
| `DEPRECATED_SAFEWAY_ROUTES_RETURN_410` | **N/A** | Brief 00a removed routes (expect 404). Live audit: all four paths return **404** |
| `CORS_LOCALHOST_BLOCKED_IN_PRODUCTION` | **PASS** | `ProductionConfig` rejects browser localhost/LAN, allows `capacitor://localhost`; Fly `CORS_ORIGINS=capacitor://localhost` (2026-07-28). Local `.env` may still list localhost (dev-only). |
| Admin-route IDOR (receipts/providers) | **PASS** | Routes derive identity from `get_user_id_from_request()` only; forged `user_id` ignored |
| `/api/dev/log` debug-gated | **PASS** | Returns 403 unless `current_app.debug`; `origins=*` override removed |

### Secrets

| DoD item | Status | Evidence |
|---|---|---|
| `NO_SECRETS_IN_BUNDLE` CI grep | **BLOCKED** / **FAIL (CI)** | No CI check found; `frontend/dist/assets` not available for local scan |
| `.env` with real secrets not tracked | **PASS** | `.gitignore` lists `.env` / `.env.local`; `git check-ignore -v .env` → ignored; `git ls-files .env` empty; no `.env` in git history |
| Prod startup uses Vault, never mock | **PASS** | `backend/app.py`: Vault when `admin_client` present; live `GET /api/health/ready` → `secrets_backend: ok` (2026-07-28) |
| `MOCK_SECRETS_BLOCKED_IN_PRODUCTION` | **PASS** | `tests/backend/test_services/test_secrets_service.py::test_mock_secrets_blocked_in_production` |
| Area 2c required env vars non-empty in prod | **PASS** (shared DEV=PROD) | See Area 2 close-out (2026-07-25): Vault + `sb_*` keys verified; rotations complete |
| `network_security_config.xml` LAN IP removed | **PASS** | Only `localhost` + `10.0.2.2`; no `192.168.50.57` |
| iOS `NSAllowsArbitraryLoads = YES` absent | **PASS** | `Info.plist` has `NSAllowsLocalNetworking` only; no arbitrary loads / exception domains |

### Monitoring

| DoD item | Status | Evidence |
|---|---|---|
| Backend GlitchTip DSN + test event | **PASS** | GlitchTip Cloud `meald-backend` (project id `26280`); smoke 2026-07-28 event ids `5fdf785c24cf4f36925952d23a85b089` (message) / `1fcb57b053f8461d9ac68c4f65b2330f` (exception); operator confirmed. Alerts: new issue + frequency. |
| Frontend GlitchTip DSN + test event | **PASS** | GlitchTip Cloud `meald-frontend` (project id `26281`); smoke 2026-07-28 event ids `8916c08c8dc44eeb8112037e6158d82a` (message) / `14a399a607b446cc81afcb67981d4e36` (exception); operator confirmed. Alerts: new issue + frequency. |
| `send_default_pii=False` | **PASS** | Backend `init_monitoring()` + frontend `monitoring.js` both set `send_default_pii=False` / `sendDefaultPii: false`; scrubbers tested in `tests/backend/test_monitoring.py` and `frontend/src/services/__tests__/monitoring.test.js`. |
| Activation-funnel telemetry flowing in staging (no PII) | **PASS** (code) / **BLOCKED** (staging) | `POST /api/telemetry/funnel` + `funnel_events` migration; offline-first flush in `funnelTelemetry.js`. Operator must apply migration and verify `SELECT * FROM funnel_conversion`. |

### Reconnect Runbook

| DoD item | Status | Evidence |
|---|---|---|
| Area 4 runbook accessible to support | **PASS** | [`docs/runbooks/reconnect.md`](../../runbooks/reconnect.md) published; repo home of record (Notion optional) |
| Forced-reconnect smoke (iOS + Android) | **BLOCKED** | Manual device checklist not executed |

### Dual-Platform QA

| DoD item | Status | Evidence |
|---|---|---|
| Cold-start on physical iOS | **PARTIAL** | Signed TestFlight build against prod exists; formal checklist not signed off |
| Cold-start on physical Android | **PARTIAL** | Signed Play/internal build against prod exists; formal checklist not signed off |
| Auto-sync on-by-default both platforms | **BLOCKED** | Code present (`useAppSyncScheduler.js`); device verification not signed off |
| Forced-reconnect both platforms | **BLOCKED** | Not signed off |
| No crashes in Organizer / Logcat | **BLOCKED** | Not signed off |

### Logic Audit

| Guardrail | Status | Notes |
|---|---|---|
| RLS deny-by-default (migrations) | **PASS** (static) | All 022-listed tables enable RLS in migrations |
| No PII in monitoring | **PASS** (code) | Default-deny scrubbers on backend + frontend; only opaque `user.id` attached; funnel metadata primitives-only |
| No secrets in client bundle | **BLOCKED** | Release artifact scan not run |
| JWT enforced in production | **PASS** | Startup assert + Fly `SUPABASE_JWT_SECRET`; unauthenticated `GET /api/receipts` → 401 (2026-07-28) |
| Mock secrets blocked | **PASS** | Production startup raises if Vault unavailable; mock dev-only |
| Auto-sync failures never silent | **PARTIAL** | Outer catch dispatches `error` / `needs-reconnect`; API 5xx/network errors reported via `captureHandledError` in `apiClient.js`. Non-critical `.catch(() => {})` only on suggestion trigger |
| Deprecated routes stay at 410 | **N/A** | Superseded by 00a deletion (404) |
| `anon` role has zero grants | **PARTIAL** | Post-025: anon has **only** `app_config` SELECT (intentional per `021_app_config.sql`). Accepted launch exception. |

---

## Area-by-area findings

### Area 1 — Security & RLS Review

#### Area 1 live audit (2026-07-24, post-remediation)

| Check | Status | Detail |
|---|---|---|
| 1a RLS enabled | **PASS** | Zero public tables with RLS off |
| RLS_CROSS_USER_PANTRY_ISOLATION | **PASS** | `pantry_leak=0` (migration 024 fixed `42P17` recursion) |
| RLS_CROSS_USER_GROCERY_ACCOUNTS_ISOLATION | **PASS** | `grocery_leak=0` |
| RLS_OWN_ROW_TABLES_ISOLATION | **PASS** | All five own-row tables `leak=0` for attacker |
| RLS_ANON_ROLE_BLOCKED | **PASS** | anon counts on sensitive tables = 0 |
| anon grants inventory | **PARTIAL** | Only `app_config` SELECT (accepted exception) |
| JWT_SECRET_REQUIRED_IN_PRODUCTION | **PASS** | `ProductionConfig.validate()` asserts secret |
| SUPABASE_JWT_SECRET present in env | **yes (prod)** | Set on Fly `meald-api` via `fly secrets` (2026-07-28) |
| CORS_LOCALHOST_BLOCKED (code) | **PASS** | `ProductionConfig` blocks browser localhost/LAN; allows `capacitor://localhost` |
| CORS_ORIGINS in prod | **PASS** | Fly `CORS_ORIGINS=capacitor://localhost`; local `.env` may still list localhost (dev-only) |
| Admin-route IDOR | **PASS** | `get_user_id_from_request()` only on receipts/providers |
| `/api/dev/log` gated | **PASS** | 403 unless `app.debug` |
| DEPRECATED_SAFEWAY (expect 404) | **PASS** | all four paths → 404 |

Commands: `npx supabase db push --linked` (024/025); Supabase MCP `execute_sql`; `uv run python backend/scripts/area1_security_audit.py`; `uv run pytest tests/backend/test_config_security.py tests/backend/test_routes/test_area1_security.py`. Overall launch verdict remains **NO-GO** (Area 5 device QA + remaining third-pass ops).

#### 1a. RLS enabled on every public table

**Live PASS (2026-07-24).**

Every table listed in brief 06 / migration `022_explicit_data_api_grants.sql` appears with `rls_enabled = true`, plus `app_config`. Note: views `ai_cost_monthly` / `ai_usage_daily` are `relkind=v` with `relrowsecurity=false` (out of table-scoped 1a query; follow up if Data API exposes them).

#### 1b. Cross-user data isolation

**PASS (post-024).**

- Household RLS recursion is fixed on master by `024_postgres_best_practices_hardening.sql` (`is_household_member()` SECURITY DEFINER helpers). This PR does not re-land a parallel 024.
- Attacker SELECT on victim `pantry_items` returns **0 rows** (no more `42P17`).
- Own-row tables (`depletion_history`, `purchase_history`, `user_preferences`, `ingredient_signals`, `login_sessions`) confirmed `leak=0`.
- `grocery_accounts` isolation unchanged (`leak=0`).

#### 1c. JWT enforcement in production — **PASS** (code + prod)

`ProductionConfig.validate()` requires `SUPABASE_JWT_SECRET`. Set on Fly `meald-api` (2026-07-28). Unauthenticated `GET https://api.meald.app/api/receipts` → 401. Dev `X-User-Id` fallback remains only when the secret is unset locally.

Admin-route IDOR closed: `GET /api/receipts`, `POST /api/receipts/ingest`, `GET /api/providers/<name>/status`, `POST /api/providers/costco/store-receipts`, and `POST /api/providers/costco/connect-from-app` use `get_user_id_from_request()` only.

#### 1d. CORS locked to production origins — **PASS** (code + prod)

`ProductionConfig.validate()` rejects browser `http(s)://localhost`, `127.0.0.1`, and private LAN origins while **allowing** `capacitor://localhost`. Fly sets `CORS_ORIGINS=capacitor://localhost` (2026-07-28). Live preflight: Capacitor origin allowed; `https://evil.example.com` not reflected.

#### 1e. Deprecated Safeway Playwright routes — **PASS**

#### 1f. `/api/dev/log` — **PASS**

Returns 403 unless `current_app.debug`. Removed `@cross_origin(origins="*")` override.

---

### Area 2 — Production Secrets Configuration — **CLOSED** (2026-07-25)

> **Chapter closed.** Vault-only secrets ladder shipped; AWS removed; operator rotations and
> Supabase legacy-key disable verified with automated smokes + live web UI (pantry loads).

#### 2a. Secrets backend selection — **PASS**

- `backend/app.py`: Supabase Vault when `admin_client` is set; mock only in non-production.
- Production without Vault raises `ConfigurationException` (no silent mock).
- Migration `20260725140329_vault_secrets_rpc_wrappers.sql` applied; live smoke passed.
- AWS Secrets Manager removed from code, config, and deps.

#### 2b. No secrets in git / rotation — **PASS** (closed)

- `.gitignore` includes `.env`, `.env.local`, `.env.*.local`.
- Verified: `git check-ignore -v .env` → ignored; `git ls-files .env` empty; no `.env` in git history.
- Greps for committed live secrets in tracked sources: placeholders/docs only.
- **Operator close-out (2026-07-25):**
  - Migrated to Supabase **publishable** (`SUPABASE_PUBLIC_KEY` / `VITE_SUPABASE_ANON_KEY`) + **secret** (`SUPABASE_SECRET_KEY`); legacy `anon` / `service_role` JWTs commented out in `.env` and **disabled in Supabase dashboard**.
  - Post-disable smokes: backend Vault round-trip, frontend Auth API accepts publishable key, legacy JWT rejected by Supabase (`ALL_POST_DISABLE_SMOKES_PASSED`); web UI pantry confirmed.
  - Rotated (or re-issued) live app keys in shared DEV=PROD `.env` as applicable (`OPENAI_API_KEY`, `SPOONACULAR_API_KEY`, Contentstack token, etc.).
  - `FLASK_SECRET_KEY` **marked unused** (not mapped to Flask `SECRET_KEY`; auth is Supabase JWT) — notes in `backend/config.py`, `.env`, and brief 06 Area 2c.

#### 2c. Required keys in production — **PASS** (shared DEV=PROD; closed)

Active path uses `SUPABASE_URL` + `SUPABASE_PUBLIC_KEY` + `SUPABASE_SECRET_KEY` (Vault via service role / secret key). Vault RPCs verified. Prod deploy (2026-07-28): `SUPABASE_JWT_SECRET` + `CORS_ORIGINS=capacitor://localhost` set on Fly; `/api/health/ready` reports `secrets_backend: ok`.

#### 2d. Android `network_security_config.xml` — **PASS**

Current file permits cleartext only for `10.0.2.2` and `localhost`. The previously cited LAN IP `192.168.50.57` is absent. Prefer empty config / HTTPS-only for final store builds if possible.

#### 2e. iOS Info.plist / ATS — **PASS** (with note)

No `NSAllowsArbitraryLoads`. `NSAllowsLocalNetworking = true` remains (dev-friendly). Confirm Release archive does not reintroduce exception domains via build settings.

Android signing reads `keystores.properties` (not hardcoded passwords in Gradle) — good pattern; confirm properties/keystore files stay out of git.

---

### Area 3 — Crash / Error Monitoring

#### 3a / 3b. GlitchTip (Sentry-wire-compatible) — **PASS** (hosted Cloud live verify 2026-07-28)

- **Backend:** `sentry-sdk[flask]` via `backend/utils/monitoring.py`; init in `create_app()`; `SENTRY_DSN` required in production; correlation IDs via `X-Request-Id`; error handlers call `capture_exception`.
- **Frontend:** `@sentry/react` (WebView-only — no `@sentry/capacitor`; GlitchTip lacks native dSYM/ProGuard symbolication); `AppErrorBoundary`; global `window.onerror` / `unhandledrejection` handlers.
- **Infra (beta):** GlitchTip Cloud org `meald_team` — projects `meald-backend` (`26280`), `meald-frontend` (`26281`). Self-host compose in `ops/monitoring/` deferred post-beta. Operator runbook: `docs/runbooks/monitoring.md`.
- **Live verify:** DSNs wired (local + Fly `SENTRY_DSN`); backend event ids `5fdf785c…` / `1fcb57b0…`; frontend event ids `8916c08c…` / `14a399a6…` (2026-07-28); operator confirmed events + email alerts (new issue + frequency).
- **Uptime:** UptimeRobot HTTP monitor on `https://api.meald.app/api/health` (5‑min); test email received 2026-07-28. (GlitchTip free uptime skipped — event quota.)
- **Provider sync visibility (2026-07-28):** `POST /api/telemetry/sync` → `sync_events` (migration `20260728170000_sync_events.sql`); client `syncEventLog.js` emits lifecycle phases + anomaly breadcrumbs to GlitchTip.

#### 3c. Activation-funnel telemetry — **CODE PASS; STAGING VERIFY PENDING**

Events emitted from Auth / ColdStart / Staples / Recipes flush to `POST /api/telemetry/funnel` → Supabase `funnel_events` (migration `20260725150000_funnel_events.sql`). Local queue retained for offline-first. Aggregate view: `funnel_conversion`. Identity from JWT only (no client `user_id` trust). Metadata sanitization on client + server.

---

### Area 4 — Reconnect Support Runbook — **PACKAGING PASS** (2026-07-27)

#### Signal model — **corrected in runbook**

Brief 06 originally referenced `grocery_accounts.connection_status`; that column **does not exist**
(`001_initial_schema.sql`). Brief 01c standardized **transient** reconnect: client CustomEvents +
Preferences, and Costco `_reconnect_response()` 401 JSON (`needs_reconnect`, `provider`, `reason`).
`/api/providers/<name>/status` returns `configured` / `active` only — not a reconnect flag.

#### Product UX — **PASS (code)**

- `ReconnectBanner`, `NeedsAttentionSection`, `SyncToastHost`, provider cards wired.
- Scheduler maps auth failures → `needs-reconnect` events; generic failures → `error` events (not swallowed).

#### Operator runbook packaging — **PASS**

Standalone runbook: [`docs/runbooks/reconnect.md`](../../runbooks/reconnect.md). Nav validated:
Dashboard Needs attention → `/providers`; Settings → Connected Stores → Manage → `/providers`.
Forced-reconnect device smoke remains **Area 5 / BLOCKED**.

---

### Area 5 — Dual-Platform Release QA Gate

**Builds: PASS** — Apple agreements accepted; signed iOS + Android release artifacts rebuilt against **`https://api.meald.app`** (2026-07-28).

**Checklist: BLOCKED** — formal cold-start / auto-sync / forced-reconnect sign-off on those builds not yet recorded.

Partial device work (not a substitute for the checklist): Play-installed Android client + onboarding forensics; Google OAuth SHA troubleshooting; Costco WebView hang / Safeway post failure observed — now instrumented via `sync_events` + GlitchTip anomalies.

Code readiness notes:

- Foreground auto-sync scheduler exists and is intended on-by-default.
- Capacitor iOS/Android projects present; release signing scaffolding for Android uses external `keystores.properties`.
- Release builds bake `VITE_API_BASE_URL=https://api.meald.app/api` from `frontend/.env.production`.

---

## Verification suite status

| Named check | Present? |
|---|---|
| `RLS_CROSS_USER_PANTRY_ISOLATION` | No |
| `RLS_CROSS_USER_GROCERY_ACCOUNTS_ISOLATION` | No |
| `RLS_ANON_ROLE_BLOCKED` | No |
| `DEPRECATED_SAFEWAY_ROUTES_RETURN_410` | No (and expectation outdated vs 00a) |
| `CORS_LOCALHOST_BLOCKED_IN_PRODUCTION` | No |
| `NO_SECRETS_IN_BUNDLE` (CI) | No |
| `JWT_SECRET_REQUIRED_IN_PRODUCTION` | No |
| `MOCK_SECRETS_BLOCKED_IN_PRODUCTION` | Yes (`test_mock_secrets_blocked_in_production`) |

`test_rls_endpoints.py` needs extension (or replacement by pytest) before the Security DoD can pass.

---

## Hard blockers (must fix before go)

1. ~~Add `SUPABASE_JWT_SECRET` to `ProductionConfig.validate()`~~ **DONE**
2. ~~**Block `MockSecretsService` in production**~~ **DONE**
3. ~~**Wire Sentry / GlitchTip**~~ **DONE** — Cloud live smoke + UptimeRobot 2026-07-28
4. ~~**RLS isolation + anon-blocked live audit**~~ **DONE** (Area 1, 2026-07-24)
5. ~~**Confirm production env:** JWT + CORS + DSN on dedicated prod deploy~~ **DONE** — Fly `api.meald.app` 2026-07-28
6. **Add `NO_SECRETS_IN_BUNDLE` CI check** on release build artifacts (plan drafted; no pytest/vitest workflow yet — only `.github/workflows/fly-deploy.yml`).
7. **Complete dual-platform physical-device cold-start + forced-reconnect checklist against `https://api.meald.app`.**
8. ~~Finish brief 05~~ **DONE** (`78b0aa2`).
9. **Commit + merge** the launch-readiness working tree (still largely uncommitted as of 2026-07-28 EOD).
10. ~~**Apple agreements + signed iOS/Android against `api.meald.app`**~~ **DONE** (2026-07-28).
11. **Third-pass remaining:** privacy/terms pages; delete-account wire-or-hide; OpenAI/Spoonacular spend caps; Supabase tier/backup check.

## Soft / doc / follow-up items

- Reconcile brief 06 vs 00a on deprecated Safeway route status codes (410 → 404).
- ~~Rewrite Area 4 runbook around transient `needs_reconnect` JSON + frontend banner; remove `connection_status` column references.~~ **DONE** — [`docs/runbooks/reconnect.md`](../../runbooks/reconnect.md); brief 06 Area 4 updated.
- Decide fate of `app_config` anon SELECT for production (dev URL sync vs strict “anon zero grants”).
- Audit routes that still take `user_id` from query/body instead of JWT (`providers` status, some `receipts` paths).
- Funnel telemetry: ~~ship analytics sink~~ **DONE** — `POST /api/telemetry/funnel` + `funnel_events` table; operator must verify `SELECT * FROM funnel_conversion` in prod.
- ~~Publish corrected reconnect runbook to the support wiki/Notion.~~ **DONE** — repo runbook at `docs/runbooks/reconnect.md` (Notion paste optional).
- Prefer removing cleartext domain-config entirely for store release builds if all traffic is HTTPS.
- Confirm `NSAllowsLocalNetworking` is acceptable for App Store review / Release scheme.
- DEV=PROD hygiene during beta (finding 3.2): freeze schema pushes; backup before `db push`; keep Fly `debug` off.
- Minimal CI beyond Fly deploy (finding 3.6 plan).
- Optional `flask-limiter` on expensive routes after dashboard spend caps (finding 3.7).

---

## Manual device smoke checklist (unchanged — all unchecked except monitoring)

Copied from brief 06 for operator tracking:

- [ ] Fresh install completes cold-start arc in < 3 minutes **against prod API**.
- [ ] No crash or native exception in Xcode Organizer (iOS) / Android Logcat during cold-start.
- [x] GlitchTip receives a test event (backend + frontend) — Cloud smoke 2026-07-28; operator confirmed
- [x] UptimeRobot green on `https://api.meald.app/api/health` — 2026-07-28
- [ ] App foreground auto-sync fires; no reconnect prompt on a freshly-connected account.
- [ ] Forced reconnect scenario: banner appears → reconnect → banner dismisses → sync succeeds.
- [ ] `network_security_config.xml` LAN IP absent from release build (Android) — **code PASS; verify in AAB**.
- [ ] Recipe suggestions load in < 2 seconds from warm pool.
- [ ] "I cooked this" depletes pantry correctly.
- [ ] No `console.error` lines during a normal session (WebInspector / Chrome remote debug).
- [ ] App Store / Google Play metadata complete; screenshots captured.

---

## Recommended next sequence

Use the **third-pass go sequence** at the bottom of this document (section 4). Short form:

1. Commit + merge launch-readiness tree; apply pending migrations (`funnel_events`, `sync_events`) if not already on prod.
2. ~~Accept Apple agreements; signed iOS/Android against `https://api.meald.app`.~~ **DONE**
3. Spend caps (OpenAI + Spoonacular) + Supabase backup/tier check.
4. Privacy/terms page + delete-account wire-or-hide.
5. Run Area 5 checklist on the signed prod builds (cold-start, auto-sync, forced-reconnect).
6. Invite friends cohort; watch GlitchTip + `funnel_conversion` + `sync_events` + `ai_cost_monthly`.

**Re-score rule:** flip NO-GO → GO only when every **FAIL** above is **PASS**, and every **BLOCKED** item has been executed with evidence attached (query output, screenshot, GlitchTip event ID, or checklist sign-off).

---

## Second-pass review (independent)

> **Historical snapshot (2026-07-22).** Later remediations supersede several findings below (Area 1 live PASS, Area 2 closed, GlitchTip + Fly prod + OAuth-only as of 2026-07-28). Keep for audit trail; use the **Verdict** and **third pass** sections above for current status.
>
> **Reviewer:** second assessment pass (2026-07-22), after the primary findings above.  
> **Method:** Independent code/config audit against brief 06, then compare to this document.  
> **Same limits (at time of write):** no live production DB/env, no physical-device QA.

### Agreement with primary verdict

**Concur (as of 2026-07-22): NO-GO.** Many of the then-open items are now closed — see current Verdict. At write time, JWT production enforcement, mock-secrets fallback, missing verification suite, and unfinished prod/device gates were enough to block external beta.

Strong agreement on:

| Finding | Notes |
|---|---|
| `SUPABASE_JWT_SECRET` not in `ProductionConfig.validate()` | Confirmed. `X-User-Id` / query / body fallback in `backend/utils/auth.py` remains reachable if secret unset. |
| `MockSecretsService` blocked in production | Fixed: `backend/app.py` raises when `ProductionConfig` and no `admin_client`; AWS path removed. |
| Sentry absent (BE + FE) | Confirmed: no `sentry-sdk` / `@sentry/*`, no DSN config, no init. |
| Launch verification suite almost entirely missing | Confirmed against `test_rls_endpoints.py` and pytest. |
| Android LAN IP cleaned; iOS no `NSAllowsArbitraryLoads` | Confirmed. |
| Area 4 `connection_status` column does not exist | Confirmed — runbook drift vs brief 01c transient 401 JSON. |
| Funnel telemetry is local-only | Confirmed (`funnelTelemetry.js`: no network sink). |
| `021_app_config.sql` grants `SELECT` to `anon` | Confirmed — conflicts with “anon zero grants” guardrail as written. |
| Deprecated Safeway 410 → treat as **N/A** vs 00a | Agree with primary framing (404 after deletion). Do not treat missing 410 hook as a restore-blocker; update brief 06 instead. |

### Elevations / additions the primary pass underweighted or missed

#### 1. Client-supplied `user_id` + admin client = IDOR — **elevate to LAUNCH BLOCKER**

Primary pass correctly flagged this as “auth smell / follow-up,” but severity is higher than that framing.

Evidence:

- `GET /api/receipts` takes `request.args.get("user_id")` and calls `supabase_service.get_user_receipts()` (`backend/routes/receipts.py`).
- `get_user_receipts` prefers `admin_client` and **bypasses RLS** (`backend/services/supabase_service.py`).
- Same pattern on `GET /api/providers/<name>/status` (`request.args.get("user_id")` → `get_grocery_account` via admin client) and `POST /api/providers/costco/store-receipts` (body `user_id` → store/process into that user’s pantry).

**Implication:** even if `SUPABASE_JWT_SECRET` is set and the JWT path is correct on other routes, these endpoints remain spoofable: any caller who can hit the API can read another user’s receipts / grocery-account metadata or write Costco receipts into another user’s account. JWT startup assertion alone does **not** close this.

**Required before go:** every mutating/reading route that uses `admin_client` must derive user identity from `get_user_id_from_request()` (validated JWT) and ignore client-supplied `user_id` (or require exact match with JWT `sub`).

#### 2. `/api/dev/log` is **not** debug-gated — **add as LAUNCH BLOCKER / high**

Primary pass did not call this out. Module docstring claims “guarded by Flask debug mode,” and sibling routes (`reset-onboarding`, `load-mock-receipts`) correctly check `current_app.debug` → 403. **`dev_log` does not.**

- Registered unconditionally via `app.register_blueprint(dev_bp)` in `backend/app.py`.
- `@cross_origin(origins="*")` deliberately bypasses the global CORS allowlist.
- Accepts arbitrary GET/POST payloads and writes them to server logs (`logger.info(f"[{tag}] {msg}")`).

**Risks:** open log-injection surface in production; CORS `*` on a live API path; possible credential/PII leakage if WebViews post sensitive strings. Gate with `current_app.debug` (or remove from prod builds) before launch.

#### 3. Sentry severity nuance (agree on outcome, clarify brief tension)

Brief Area 3b says monitoring is “optional at launch … but strongly recommended,” while the DoD checkboxes require Sentry test events. Primary pass treating absence as a **practical blocker** for first external cohort is reasonable. Recommend an explicit owner decision: either wire Sentry before go, or amend DoD to “waived for MVP with dated sign-off” so the gate is not ambiguous.

#### 4. `.env` hygiene — confirm track status (operator)

Primary PARTIAL is correct. Independent pass also saw a repo-root `.env` with real `OPENAI_API_KEY` / `SPOONACULAR_API_KEY` values, and `.gitignore` lists `.env`. Git track confirmation failed in both assessment sandboxes (`.git` inaccessible). Operator must still run:

```bash
git check-ignore -v .env
git ls-files .env
```

If ever tracked historically, rotate those keys.

#### 5. Prerequisite brief 05 claim — soft caveat

Primary notes uncommitted brief-05 work. Independent pass found `PantryCheckSheet.jsx` (+ tests) present in the tree; could not re-verify git dirty state under the same sandbox limits. Treat the “05 not landed” prerequisite as **operator-confirm**, not automatically false — but do not clear M6 until CI is green either way.

### Small disagreements / reframes (not verdict-changing)

| Primary item | Second-pass note |
|---|---|
| Deprecated Safeway as **N/A** | Agree. Prefer updating brief 06 DoD to “routes absent (404)” over restoring a 410 shim unless product wants permanent 410 tombstones. |
| Auto-sync “never silent” as **PARTIAL** | Agree. Outer scheduler catch dispatches `error` / `needs-reconnect` (good). Bare `.catch(() => {})` on non-critical side paths exists but is not the main sync outcome path. Still fails the Sentry half of the guardrail until monitoring exists. |
| `app_config` anon SELECT as **FAIL** | Agree on literal guardrail fail. Severity depends on row contents (dev URL sync vs secrets). If only non-sensitive config, downgrade to documented exception; if anything sensitive, revoke `anon` grant. |
| Android cleartext for localhost/10.0.2.2 as soft follow-up | Agree — not a blocker if release traffic is HTTPS-only to prod API; still prefer empty cleartext config for store builds. |

### Revised hard-blocker list (merge of both passes)

Keep primary items 1–8, and add/elevate:

1. **IDOR on admin-backed routes that trust client `user_id`** (receipts GET, provider status, Costco store-receipts) — *elevated from soft follow-up*.
2. **Gate or remove `/api/dev/log` in production** (debug check + drop `origins="*"` outside debug) — *new*.

### What second pass would not change

- Overall **NO-GO**.
- Physical-device / prod SQL / prod env items remain correctly **BLOCKED**.
- Reconnect UX code readiness vs runbook packaging: runbook **PASS** (`docs/runbooks/reconnect.md`); forced-reconnect device QA still Area 5 **BLOCKED**.
- Recommended next sequence remains sound; insert the IDOR + `/api/dev/log` fixes into step 2 (production assertions / security fixes) before device QA.

---

## Third pass — solo-dev friends-beta review (2026-07-28)

> **Framing:** This pass answers a different question than passes 1–2. Not "is the code launch-safe?"
> (largely yes, per above) but **"can a solo side-project dev hand this to friends without spending the
> next month firefighting?"** It cross-references the recent working sessions (Jul 24–28) against the
> roadmap and lists gaps that **no prior chat or document has raised at all**.

### 1. What actually happened since the second pass (session recap)

| Date | Session outcome | Status |
|---|---|---|
| Jul 24–25 | Area 1 security fixes + live audit (migrations 024/025); Area 2 secrets chapter closed; Area 3 monitoring code (GlitchTip-compatible SDKs, funnel telemetry, `ops/monitoring/` stack) | Done (code) |
| Jul 27 | Area 4 reconnect runbook published (`docs/runbooks/reconnect.md`) | Done |
| Jul 27 | Brief 05 substitution stub **committed** (`78b0aa2` on `feat/substitution-hints-and-suggestion-fixes`) | Done |
| Jul 27 | **Meal planner deferred from MVP** — hidden behind `FEATURE_MEAL_PLANNER` / `VITE_FEATURE_MEAL_PLANNER` (default off) | Done (in working tree) |
| Jul 27 | Google Play internal-testing plan drafted | Plan — `/build-aab` + Play upload path improved Jul 28 |
| Jul 28 AM | TestFlight upload → Xcode `403 FORBIDDEN_ERROR.CONTRACT_NOT_VALID` | **Closed** — Apple agreements accepted; signed iOS + Android rebuilt against `api.meald.app` |
| Jul 28 | Solo-dev friends-beta review (this third pass); plans for 3.1–3.8 drafted | Done (docs/plans) |
| Jul 28 | **Production backend on Fly.io** (`api.meald.app`); deploy runbook; UptimeRobot | **Done** |
| Jul 28 | **GlitchTip Cloud** live smoke (org `meald_team`, projects 26280/26281); monitoring runbook hosted-first | **Done** |
| Jul 28 | **Provider sync event visibility** — `syncEventLog` + `POST /api/telemetry/sync` + `sync_events` migration | Done (in working tree) |
| Jul 28 | **OAuth-only MVP** — email auth behind `VITE_FEATURE_EMAIL_AUTH` (default off) | Done (in working tree) |

**Working-tree warning:** essentially all Area 1–4 code, the monitoring stack, several Supabase migrations, meal-planner gating, OAuth-only gating, and sync-event visibility remain **uncommitted** on the current feature branch (large modified/untracked set). Nothing built from a clean checkout of `main` today would contain the launch-readiness work. Landing this branch is still **step 0**.

### 2. Roadmap cross-check (MVP_SCOPE_AND_ROADMAP M0–M6)

- **M0 scope lock / M1 reliability + auto-sync / M2 cost + sparse pantry / M4 cook loop / M5 stubs:** code-complete and (mostly) merged. Meal-planner deferral + OAuth-only email auth (owner decisions #5–#6) are implemented in the working tree.
- **M3 cold-start on-device:** telemetry + sync-event code exists; signed prod builds exist; formal Area 5 checklist sign-off still open.
- **M6 launch readiness:** Areas 1–4 code + live verify done (prod API, GlitchTip, UptimeRobot, reconnect runbook). Apple agreements + signed release builds **done**. Remaining: commit/merge, Area 5 checklist, third-pass legal/ops items (3.4–3.5, 3.7–3.8, 3.10 partial).

The roadmap's remaining work is therefore **mostly operational** — device QA, store submission hygiene, and beta ops — not greenfield product.

### 3. Gaps never raised in any chat or doc (the blind spots)

Ordered by "probability this causes a fire during the friends beta."

#### 3.1 There is no production backend — **RESOLVED** (2026-07-28)

**Was:** No prod deploy, no WSGI server, no reachable API for testers' phones.

**Now shipped:**

- **Host:** Fly.io app `meald-api` (`sjc`), `https://meald-api.fly.dev` + **`https://api.meald.app`**
- **Custom domain:** `api.meald.app` cert **Issued** (Let's Encrypt); Namecheap BasicDNS A/AAAA set
- **Container:** `Dockerfile` + gunicorn (`backend/wsgi.py`, `gunicorn.conf.py`)
- **Runbook:** [`docs/runbooks/deploy.md`](../../runbooks/deploy.md)
- **Frontend:** `frontend/.env.production` → `VITE_API_BASE_URL=https://api.meald.app/api` (verified inlined by `vite build`); Supabase URL sync gated to dev builds only; root `.env` LAN URL commented so it cannot override release builds

**Live smoke evidence (2026-07-28):**

| Check | Result |
|---|---|
| `GET /api/health` | 200 `{"status":"healthy"}` |
| `GET /api/health/ready` | 200 `secrets_backend: ok`, `supabase: ok` |
| `GET /api/dev/log` | 403 |
| `GET /api/receipts` (no JWT) | 401 `User ID required` |
| CORS preflight `Origin: capacitor://localhost` | `access-control-allow-origin: capacitor://localhost` |
| CORS preflight `Origin: https://evil.example.com` | no allow-origin header |
| GlitchTip test events | message `d9ea1a1c…`, exception `82af1f10…` |

**Operator close-out (2026-07-28):**

- Namecheap BasicDNS: A/AAAA for `api.meald.app` → Fly IPs; cert **Issued** (Let's Encrypt).
- `https://api.meald.app/api/health` → 200; `/api/health/ready` → 200.
- **UptimeRobot** HTTP monitor on `/api/health` (5‑min); test email received. (GlitchTip free uptime skipped — event quota.)

Remaining: run Area 5 device QA checklist on the signed builds against `https://api.meald.app`.

#### 3.2 DEV = PROD is a beta hazard, not just a secrets note

Area 2 recorded "shared DEV=PROD" as a secrets fact. The operational consequence was never discussed:
once friends are live, **every local migration, pool-generator experiment, and dev-tools reset runs
against their data**. Minimum mitigation for a solo dev (a second Supabase project may be overkill):
freeze schema changes during the beta window, take a backup before any `db push`, and never point local
dev at the live project with `FLASK_ENV` ≠ production dev-tools enabled (`/api/dev/*` is debug-gated —
verify the deployed app runs with debug off).

#### 3.3 Sign-up emails will not reach testers — **MITIGATED** (OAuth-only, 2026-07-28)

Email+password signup remains in code but is **hidden** behind `VITE_FEATURE_EMAIL_AUTH` (default off) — same pattern as the meal-planner kill switch (`frontend/src/config/features.js`, `Auth.jsx`). Beta is Apple/Google OAuth only.

**Still open if email is re-enabled:** configure custom SMTP (Resend/Postmark) in Supabase before turning the flag on; built-in SMTP will fail for friend testers.

#### 3.4 "Delete Account" is a dead button; no deletion path exists

`Settings.jsx` renders a Danger-Zone **Delete** button with **no onClick and no backend endpoint**
(only dev-reset and per-provider credential deletion exist). Consequences: (a) Apple **requires**
in-app account deletion for apps with account creation (guideline 5.1.1(v)) — a future App Store
rejection; (b) during the beta you cannot cleanly remove a friend's data (real grocery purchase
history) on request. Either wire it (Supabase `auth.admin.delete_user` + cascade check) or remove the
button for the beta build so it doesn't look broken.

#### 3.5 `/terms` and `/privacy` are dead links; no privacy policy exists

`Auth.jsx` links "Terms of Service" and "Privacy Policy" to routes that don't exist in the SPA. No
policy document exists anywhere in the repo. TestFlight **external** testing (Beta App Review) and any
Play listing require a privacy-policy URL — and the app ingests real purchase history + stores grocery
credentials, so this is not boilerplate. A one-page hosted policy (GitHub Pages is fine) unblocks both
stores; fix or remove the dead links.

#### 3.6 There is no CI — **PARTIAL**

`.github/workflows/fly-deploy.yml` deploys to Fly on push to `main`. There is still **no** pytest / vitest / `NO_SECRETS_IN_BUNDLE` workflow. Plan drafted (`minimal_ci_workflow`); implement before relying on “CI green” as a gate.

#### 3.7 No API rate limiting, no spend caps

Once the backend is public, `/api/receipts/ingest` (OpenAI-backed parsing) and voice transcription are
reachable by anyone with a token; only Spoonacular has cost guardrails (pool/cache). Never discussed:
**hard spend caps in the OpenAI and Spoonacular dashboards** (5-minute task, do it first), and
optionally `flask-limiter` on the expensive routes. The `ai_cost_monthly` view exists — check it weekly
during the beta.

#### 3.8 No backup / data-durability story

Zero mentions of backups anywhere. If the Supabase project is on the **free tier**: no automated
backups, and free projects **pause after ~1 week of inactivity** (instant "app is down" fire). Verify
tier; either upgrade (daily backups) or schedule a `pg_dump` before real user data lands.

#### 3.9 Release hygiene: versioning + update path — **PARTIAL**

`/build-aab` Cursor command + `frontend/scripts/build-play-aab.js` bump Android `versionCode`/`versionName` on Play uploads (2026-07-28). ~~Apple agreements (`CONTRACT_NOT_VALID`)~~ **DONE**; ~~signed iOS + Android against `api.meald.app`~~ **DONE** (2026-07-28). Keep bumping build numbers on every subsequent upload.

#### 3.10 Tester operations: nobody defined how the beta actually runs

The runbooks assume a "support" function — that's you. Missing, and cheap to prepare:

- **Cohort criteria:** testers need a Safeway or Costco account **with recent purchase history**, or their cold-start collapses to manual pantry entry. Pick 5–10 friends who actually shop there; the sparse-pantry fallback (M2) is the safety net, not the pitch.
- **One feedback channel** (a group chat is enough) + a pinned "when it breaks, send me: what you did, a screenshot, and the time" note. Backend already emits `X-Request-Id` correlation IDs — GlitchTip events will match.
- **Expectation-setting message** before install: what works, what's stubbed (substitutions), what's hidden (meal planner), and that receipts sync from exactly two chains.
- **Uptime monitor** on `/api/health` — ~~open~~ **DONE** (UptimeRobot 2026-07-28).

### 4. How to elevate this to a *clean* MVP (solo-dev, minimal-fire path)

The theme of every gap above: **the remaining risk is operational load, not features.** Three
deliberate simplifications will cut the firefighting surface the most:

1. **~~Don't self-host GlitchTip for the beta.~~ DONE 2026-07-28** — GlitchTip Cloud org `meald_team`; compose stack kept deferred in `ops/monitoring/`.
2. **~~One PaaS deploy closes five blockers at once.~~ DONE 2026-07-28** — Fly.io + `api.meald.app` + prod JWT/CORS/DSN + UptimeRobot.
3. **~~Shrink the day-one auth surface.~~ DONE 2026-07-28** — OAuth-only via `VITE_FEATURE_EMAIL_AUTH` (default off).

**Revised go sequence (friends beta) — status 2026-07-28 evening:**

1. Commit + merge the launch-readiness branch; tag it. *(step 0 — still uncommitted)*
2. ~~Accept Apple agreements; signed iOS + Android against `https://api.meald.app`.~~ **DONE**
3. Spend caps at OpenAI + Spoonacular; verify Supabase tier + backups. *(15 minutes)*
4. ~~Deploy backend to a PaaS with gunicorn; set prod env; confirm `/api/dev/*` 403.~~ **DONE**
5. ~~Monitoring test events + uptime monitor.~~ **DONE**
6. ~~OAuth-only / email flag.~~ **DONE** — still open: fix/remove dead Delete-Account button and `/terms` / `/privacy`; publish a one-page privacy policy.
7. Minimal CI: pytest + vitest + `NO_SECRETS_IN_BUNDLE` (Fly deploy workflow alone is not enough).
8. Run Area 5 device checklist on the signed prod builds.
9. TestFlight internal + Play internal with 5–10 person cohort; expectations note; watch GlitchTip + `funnel_conversion` + `sync_events` + `ai_cost_monthly`.

**Re-score rule unchanged** — third-pass items still on the blocker checklist before NO-GO → GO: Area 5 checklist, legal pages/account deletion, spend caps, backups, CI, commit/merge.
