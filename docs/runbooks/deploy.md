# Production backend deploy runbook (Fly.io)

Deploy the Meald Flask backend to Fly.io at **`https://api.meald.app`**.

## Architecture

- **Host:** Fly.io (`meald-api` app, `sjc` region)
- **Runtime:** Docker + gunicorn (2 sync workers, 300s timeout)
- **Health:** liveness `GET /api/health`, readiness `GET /api/health/ready`
- **DNS:** Namecheap BasicDNS → Advanced DNS for host `api`

## Environment variables

### Set in `fly.toml [env]` (non-secret)

| Variable | Value | Notes |
|---|---|---|
| `FLASK_ENV` | `production` | Enables `ProductionConfig` validation |
| `LOG_LEVEL` | `INFO` | |
| `CORS_ORIGINS` | `capacitor://localhost` | Capacitor WebView origin |
| `SENTRY_ENVIRONMENT` | `production` | |
| `FEATURE_MEAL_PLANNER` | `0` | Meal planner deferred from MVP |
| `SPOONACULAR_CALL_BUDGET` | `250` | Per-worker; 2 workers ≈ 500/hour effective |

### Set via `fly secrets set` (secret)

| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_PUBLIC_KEY` | yes | `sb_publishable_…` key |
| `SUPABASE_SECRET_KEY` | yes | `sb_secret_…` key (Vault + admin client) |
| `SUPABASE_JWT_SECRET` | yes | HS256 JWT signing secret from Supabase dashboard |
| `FLASK_SECRET_KEY` | yes | Any strong random string (not the dev default) |
| `SENTRY_DSN` | yes | GlitchTip or Sentry-compatible DSN |
| `OPENAI_API_KEY` | yes | Receipt parsing / voice |
| `SPOONACULAR_API_KEY` | yes | Recipe suggestions |
| `GEMINI_API_KEY` | no | Optional Costco AI fallback |
| `CONTENTSTACK_ACCESS_TOKEN` | no | Costco config monitor only |

**Never** bake secrets into the Docker image. `.dockerignore` excludes `.env`.

## First deploy

Prerequisites: `flyctl` installed, `fly auth login` completed, Fly account with a payment method (required even for small apps).

```bash
# From repo root
fly launch --no-deploy --copy-config --name meald-api

# Set all secrets (paste values from local .env; do not commit)
fly secrets set \
  SUPABASE_URL="..." \
  SUPABASE_PUBLIC_KEY="..." \
  SUPABASE_SECRET_KEY="..." \
  SUPABASE_JWT_SECRET="..." \
  FLASK_SECRET_KEY="..." \
  SENTRY_DSN="..." \
  OPENAI_API_KEY="..." \
  SPOONACULAR_API_KEY="..."

# Optional secrets
fly secrets set GEMINI_API_KEY="..." CONTENTSTACK_ACCESS_TOKEN="..."

# Deploy
fly deploy

# Confirm machine is healthy
fly status
fly logs
curl https://meald-api.fly.dev/api/health
curl https://meald-api.fly.dev/api/health/ready
```

Startup will **fail** if any `ProductionConfig.validate()` check fails (missing JWT secret, localhost CORS, missing SENTRY_DSN, mock secrets backend).

## Custom domain (`api.meald.app`)

```bash
fly certs add api.meald.app
fly certs show api.meald.app
```

Fly prints DNS targets. In **Namecheap → Domain List → meald.app → Advanced DNS**, add:

- **A record** (or AAAA): host `api`, value = Fly IPv4 (or IPv6)
- Or **CNAME**: host `api`, value = `meald-api.fly.dev` (if Fly recommends CNAME)

Wait for certificate issuance (`fly certs check api.meald.app`). Then verify:

```bash
curl https://api.meald.app/api/health
```

## Redeploy

```bash
fly deploy
```

Fly rebuilds the Docker image from `Dockerfile` and rolls out with zero-downtime.

## Rollback

```bash
fly releases list
fly deploy --image <previous-image-ref-from-releases>
```

## Operations

| Task | Command |
|---|---|
| Live logs | `fly logs` |
| SSH into machine | `fly ssh console` |
| Machine status | `fly status` |
| Restart | `fly apps restart meald-api` |
| Update a secret | `fly secrets set KEY=value` (triggers rolling restart) |
| Send test GlitchTip event | `SENTRY_DSN=... uv run python backend/scripts/send_test_event.py` |

## Uptime monitoring

**Configured 2026-07-28:** UptimeRobot free tier HTTP(s) monitor:

- URL: `https://api.meald.app/api/health`
- Interval: 5 minutes
- Alert: email (test notification confirmed)

Do not use GlitchTip Cloud free uptime for this — a 60s check burns ~43k events/mo vs a 1k free cap; keep GlitchTip for error events only.

## Frontend release builds

Production mobile builds bake in the API URL from [`frontend/.env.production`](../../frontend/.env.production):

```
VITE_API_BASE_URL=https://api.meald.app/api
```

Store builds must use `npm run build:play-aab` (forces `VITE_API_BASE_URL` from `.env.production` and strips LAN cleartext). Do **not** use `build:mobile` for Play — that path writes the current LAN API URL into `.env.local` for debug APKs. Do **not** export `VITE_API_BASE_URL` from the repo-root `.env` when building — process env overrides Vite files and would bake `localhost` into the bundle.

Verify after `cd frontend && npm run build`:

```bash
rg -c 'https://api\.meald\.app/api' dist/assets/*.js   # expect >= 1
rg -c 'localhost:5000/api' dist/assets/*.js           # expect 0 (or only /dev/log fallbacks)
```

Supabase `app_config` URL sync is gated to `import.meta.env.DEV || VITE_ENABLE_DEV_SETTINGS=1`, so release builds keep the baked production URL.

## Smoke checklist (post-deploy)

- [ ] `GET /api/health` → 200
- [ ] `GET /api/health/ready` → 200, `secrets_backend: "ok"`
- [ ] `GET /api/dev/log` → 403
- [ ] Authenticated API call with Supabase JWT → 200
- [ ] Unauthenticated call → 401
- [ ] GlitchTip test event received
- [ ] Uptime monitor green

## Local Docker build (optional)

```bash
docker build -t meald-backend .
docker run --rm -p 8080:8080 --env-file .env -e FLASK_ENV=development meald-backend
curl http://localhost:8080/api/health
```

Use `FLASK_ENV=development` for local container smoke; production validation requires all prod secrets.
