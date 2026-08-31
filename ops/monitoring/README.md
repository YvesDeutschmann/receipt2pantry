# GlitchTip monitoring

[GlitchTip](https://glitchtip.com/) (MIT) for Meald crash/error tracking. GlitchTip accepts the official Sentry SDK wire protocol — point `SENTRY_DSN` / `VITE_SENTRY_DSN` at your GlitchTip project DSN, not sentry.io.

## Quick start (beta): GlitchTip Cloud

**Status (2026-07-28):** Cloud org `meald_team` is live — projects `meald-backend` (`26280`) and `meald-frontend` (`26281`); smoke events + alerts confirmed; UptimeRobot on `https://api.meald.app/api/health`. Operator runbook: [`docs/runbooks/monitoring.md`](../../docs/runbooks/monitoring.md).

**Beta decision:** use [GlitchTip Cloud](https://app.glitchtip.com) (free tier, 1k events/mo). Do **not** self-host the compose stack for friends beta.

1. Sign up at [app.glitchtip.com](https://app.glitchtip.com) and create org `meald_team`.
2. Create two projects and copy DSNs into secrets (never commit):

| Project | Platform | Env var |
|---------|----------|---------|
| `meald-backend` | Python / Flask | `SENTRY_DSN` |
| `meald-frontend` | JavaScript / React | `VITE_SENTRY_DSN` |

DSN shape: `https://<key>@app.glitchtip.com/<project-id>`.

3. Local smoke:

```bash
# root .env
SENTRY_DSN=https://<key>@app.glitchtip.com/<backend-project-id>
SENTRY_ENVIRONMENT=development

# frontend/.env (Vite injects at build/dev time)
VITE_SENTRY_DSN=https://<key>@app.glitchtip.com/<frontend-project-id>
```

```bash
uv run python backend/scripts/send_test_event.py
# if ModuleNotFoundError: backend — use:
# PYTHONPATH=. uv run python backend/scripts/send_test_event.py
```

Confirm message + exception under `meald-backend`. Trigger a deliberate frontend throw (or error-boundary path) with `VITE_SENTRY_DSN` set and confirm under `meald-frontend`.

4. Production / release builds:
   - Backend PaaS: set `SENTRY_DSN`, `SENTRY_ENVIRONMENT=production` (+ optional `SENTRY_RELEASE`). Required by `ProductionConfig.validate()`.
   - Frontend: inject `VITE_SENTRY_DSN` at build time (CI/secrets). Rebuild mobile clients when the DSN changes.

5. Alerts (GlitchTip UI, both projects):
   - **New issue** → email
   - **Issue frequency** → e.g. 5 events / 5 minutes → email
   - **Uptime** on `GET /api/health` — defer until a public API URL exists

See [docs/runbooks/monitoring.md](../../docs/runbooks/monitoring.md) for triage and DSN rotation.

## Source maps

```bash
cd frontend
export SENTRY_URL=https://app.glitchtip.com
export SENTRY_AUTH_TOKEN=<glitchtip-auth-token>   # org:read + project:read + project:releases
export SENTRY_ORG=meald_team
export SENTRY_PROJECT=meald-frontend
npm run monitoring:upload-sourcemaps
```

GlitchTip supports JS source maps. Native dSYM/ProGuard symbolication is not supported — native crashes are tracked via Xcode Organizer / Play Console Vitals.

## Self-host (deferred until after beta)

Keep [`docker-compose.glitchtip.yml`](docker-compose.glitchtip.yml) in-repo for a later option. Prefer Cloud until event volume or privacy needs justify ops cost.

```bash
cd ops/monitoring
cp .env.example .env
# Edit .env: set SECRET_KEY, POSTGRES_PASSWORD, DATABASE_URL, GLITCHTIP_DOMAIN
docker compose -f docker-compose.glitchtip.yml up -d
```

Open `GLITCHTIP_DOMAIN` (default `http://localhost:8000`), create an admin user (registration is disabled by default — use Django admin or `docker compose exec web ./manage.py createsuperuser`).

App Store / Play builds need HTTPS: terminate TLS at nginx, Caddy, or a load balancer and set `GLITCHTIP_DOMAIN=https://errors.yourdomain.com`.

### Backup and restore

Postgres data lives in the `glitchtip-pg-data` volume.

```bash
# Backup
docker compose -f docker-compose.glitchtip.yml exec -T postgres \
  pg_dump -U glitchtip glitchtip > glitchtip-backup.sql

# Restore (stack stopped)
docker compose -f docker-compose.glitchtip.yml exec -T postgres \
  psql -U glitchtip glitchtip < glitchtip-backup.sql
```
