# Monitoring operations runbook (GlitchTip + Meald instrumentation)

## Access

- **GlitchTip UI:** [https://app.glitchtip.com](https://app.glitchtip.com) (Cloud; beta). Self-host compose is [deferred](../../ops/monitoring/README.md).
- **Org:** `meald_team`
- **Projects:** `meald-backend` (Flask), `meald-frontend` (React/Capacitor)
- **Liveness:** `GET /api/health` (UptimeRobot free — see below; GlitchTip free tier cannot host useful-interval uptime)
- **Readiness:** `GET /api/health/ready` (Supabase + secrets backend)

## Severity triage

| Level | Examples | Action |
|-------|----------|--------|
| P1 | App won't load, auth broken, sync down for all users | Page on-call; check `/api/health/ready` and recent deploy |
| P2 | Single-route 5xx spike, provider reconnect failures | Review GlitchTip issue, correlate via `request_id`; see [reconnect runbook](reconnect.md) |
| P3 | Isolated client errors, non-critical UI | Triage in next business day; mute if noisy |

## Correlating user reports

1. Ask the user for **when** the error occurred and any on-screen reference ID.
2. Frontend/backend error JSON includes `request_id` when available.
3. Search GlitchTip by tag `request_id:<uuid>` or filter by release/environment.
4. Cross-check structured backend logs (JSON `correlation_id` field).

## Alert configuration (GlitchTip UI)

Per project (`meald-backend`, `meald-frontend`):

1. **New issue** → email (+ webhook if configured).
2. **Issue frequency** → e.g. 5 events / 5 minutes → email.
3. **Uptime** → **UptimeRobot** (not GlitchTip free): HTTP(s) monitor on `https://api.meald.app/api/health`, 5‑minute interval, email alerts. GlitchTip Cloud free (1k events/mo) cannot run a useful-interval uptime check (~43k events/mo at 60s). **Configured 2026-07-28** (test notification received).

Alert on **symptoms** (new issues, uptime failure), not log volume.

## Source maps

After `npm run build`:

```bash
cd frontend
export SENTRY_URL=https://app.glitchtip.com
export SENTRY_AUTH_TOKEN=<glitchtip-auth-token>   # scopes: org:read, project:read, project:releases
export SENTRY_ORG=meald_team
export SENTRY_PROJECT=meald-frontend
npm run monitoring:upload-sourcemaps
```

GlitchTip supports JS source maps. Native dSYM/ProGuard symbolication is **not** supported — use Xcode Organizer / Play Console Vitals for native crashes.

## Data retention and deletion

- GlitchTip Cloud: plan retention (free tier event cap 1k/mo). Self-host default: `GLITCHTIP_MAX_EVENT_LIFE_DAYS=90`.
- Funnel telemetry: `funnel_events` table — delete rows by `user_id` on account deletion request (service role).
- Provider sync lifecycle: `sync_events` table — delete rows by `user_id` on account deletion request (service role).
- No email, receipt contents, or tokens are intentionally stored in monitoring payloads (`send_default_pii=False`, scrubbers on both sides).

## DSN rotation

If a DSN is leaked:

1. Regenerate the project key in GlitchTip.
2. Update production secrets: `SENTRY_DSN`, `VITE_SENTRY_DSN` (rebuild mobile clients).
3. Revoke old key in GlitchTip.
4. Send test events: `uv run python backend/scripts/send_test_event.py`.

## Verification checklist

- [x] Backend test event visible in GlitchTip (`send_test_event.py`) — hosted Cloud 2026-07-28
- [x] Frontend test event visible after deliberate throw — hosted Cloud 2026-07-28
- [x] Email alerts configured (new issue + frequency) — operator 2026-07-28
- [x] `/api/health` returns 200; UptimeRobot green + test email — 2026-07-28 (`https://api.meald.app/api/health`)
- [x] `/api/health/ready` returns 200 in production (`secrets_backend: ok`)
- [ ] Funnel events visible: `SELECT * FROM funnel_conversion;`
- [ ] `FLASK_ENV=production` without `SENTRY_DSN` refuses startup

## Provider sync anomalies

Costco/Safeway WebView sync emits **lifecycle phases** to `sync_events` (via `POST /api/telemetry/sync`) and **Sentry breadcrumbs** on every phase. Only anomalies become GlitchTip billable events (deduped per provider+phase per app session).

### Phase glossary (terminal / anomaly phases)

| Phase | Meaning |
|-------|---------|
| `close_unconfirmed` | Close was requested but no `closeEvent` within 3s (stuck WebView) |
| `close_skipped_not_owner` | Session ownership lost before close (shared WebView preempted) |
| `close_failed` | `InAppBrowser.close()` failed after 3 retries |
| `sync_skipped` | Silent sync skipped (`webview_busy` / `preempted`); escalates to GlitchTip after 3 consecutive skips in 24h with no success |
| `ingest_failed` | Receipts fetched but `POST /api/receipts/ingest` (or Costco store) failed |
| `sync_failed` | Hook-level failure after WebView work |
| `needs_reconnect` | Token/session invalid; user must reconnect provider |
| `webview_orphan_closed` | Leftover unowned WebView instance closed before a new session (cleanup telemetry; not an anomaly) |

Full enum: see migrations `20260728170000_sync_events.sql` and `20260831190000_sync_events_webview_orphan_phase.sql`.

### Sync failure rate (daily check)

Run manually or via a scheduled SQL job (Supabase cron / external monitor). Alert when any provider exceeds thresholds in the last 24 hours:

```sql
-- Terminal sync outcomes per provider (last 24h)
SELECT
  provider,
  COUNT(*) FILTER (WHERE phase IN ('needs_reconnect', 'silent_timeout', 'sync_failed')) AS terminal_events,
  COUNT(*) FILTER (WHERE phase = 'session_begin') AS attempts,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE phase IN ('needs_reconnect', 'silent_timeout', 'sync_failed'))
    / GREATEST(COUNT(*) FILTER (WHERE phase = 'session_begin'), 1),
    1
  ) AS terminal_pct
FROM sync_events
WHERE occurred_at > now() - interval '24 hours'
GROUP BY provider
ORDER BY terminal_pct DESC;
```

Suggested alert thresholds (tune after baseline):

| Signal | Threshold | Action |
|--------|-----------|--------|
| `terminal_pct` for `costco` | > 25% with ≥ 5 attempts | Page on-call; see [reconnect runbook](reconnect.md) |
| `token_exchange` with `reason` like `http_404` | ≥ 3 in 1h for one user | Wrong B2C authority or dead RT — check `metadata.authoritySource` |
| `sync_failed` with `reason` `refresh_stalled` | any in prod | Interactive login idle watchdog — user stuck on Orders page |

Token refresh in production appears as `token_exchange` rows (not only `/api/dev/log`):

- **Silent Costco page RT grant:** `reason = 'refreshed'`, metadata uses `status`, `policy`, `source`, `rotated` (no tokens).
- **Interactive login diagnostic probe:** metadata uses `tokenFired`, `tokenStatus`, `tokenPolicy`, `tokenSweepRuns`.
- **Failures (both modes):** `reason` is `invalid_grant`, `cors`, `http_<status>`, etc.

```sql
SELECT phase, reason, metadata, occurred_at, mode
FROM sync_events
WHERE phase = 'token_exchange'
  AND occurred_at > now() - interval '2 hours'
ORDER BY occurred_at DESC
LIMIT 50;
```


1. Get approximate time and provider (`costco` / `safeway`).
2. Query attempt outcomes (service role or user's own rows via RLS):

```sql
SELECT *
FROM sync_attempt_outcomes
WHERE user_id = '<uuid>'
  AND started_at > now() - interval '2 hours'
ORDER BY started_at DESC
LIMIT 20;
```

3. Drill into phases for a `sync_id`:

```sql
SELECT phase, reason, occurred_at, metadata
FROM sync_events
WHERE sync_id = '<sync_id>'
ORDER BY occurred_at;
```

4. In GlitchTip (`meald-frontend`), search tag `sync_id:<uuid>` or issue title `Sync anomaly: costco close_unconfirmed`.
5. If ingest failed, correlate backend `meald-backend` via tag `sync_id` on `/api/receipts/ingest` (client sends `X-Sync-Id` header during flush).

### Dev-only WebView strings

Verbose `bridgeDevLog` lines still go to `POST /api/dev/log` (Flask debug mode only). Production diagnosis uses `sync_events` + GlitchTip, not `/api/dev/log`.
