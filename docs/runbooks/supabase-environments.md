# Supabase DEV and PROD

## Projects

| Environment | Project ref | API URL | Linked CLI default |
|---|---|---|---|
| **PROD** | `pvmezsxdqotxaqfymmzd` | `https://pvmezsxdqotxaqfymmzd.supabase.co` | Use `--project-ref pvmezsxdqotxaqfymmzd` for prod pushes |
| **DEV** | `zydabsxcbetbhrgpiaxb` | `https://zydabsxcbetbhrgpiaxb.supabase.co` | `supabase link --project-ref zydabsxcbetbhrgpiaxb` (local default after split) |

Fly `meald-api` secrets always point at **PROD**. Store builds bake **PROD** Supabase keys from [`frontend/.env.production`](../../frontend/.env.production).

## Local `.env` (backend)

Point root [`.env`](../../.env) at **DEV** for day-to-day work:

- `SUPABASE_URL=https://zydabsxcbetbhrgpiaxb.supabase.co`
- `SUPABASE_PUBLIC_KEY` / `SUPABASE_SECRET_KEY` from DEV dashboard or `npx supabase projects api-keys --project-ref zydabsxcbetbhrgpiaxb`
- `SUPABASE_JWT_SECRET` from DEV **Project Settings → API → JWT Secret**

Keep a commented `# PROD` block in `.env` for one-off prod seed/purge scripts (never export prod URL when running destructive scripts without `--prod`).

## Frontend env

| File | Purpose |
|---|---|
| [`frontend/.env`](../../frontend/.env) | Local dev → **DEV** Supabase |
| [`frontend/.env.production`](../../frontend/.env.production) | Release builds → **PROD** Supabase + `api.meald.app` |
| [`frontend/.env.local`](../../frontend/.env.local) | LAN / dev settings only; must not ship in store builds |

## DEV auth providers (operator)

In the **Meald-Dev** Supabase dashboard (**Authentication → Providers**):

1. **Email** — enabled; keep **Confirm email** on (blocks random signups).
2. **Google** — same Web client ID as prod (`VITE_GOOGLE_WEB_CLIENT_ID`); add DEV redirect URLs if using web OAuth.
3. **Apple** — same Services ID / bundle config as prod for native Sign in with Apple.

Copy redirect URL list from PROD and add `http://localhost:5173/**` for local web.

Copy **JWT Secret** from **Project Settings → API → JWT Secret** into root `.env` as `SUPABASE_JWT_SECRET` (required for local API JWT validation when testing with Bearer tokens).

## Migrations

```bash
# DEV (default link)
npx supabase db push --yes

# PROD (explicit ref — backup first)
npx supabase link --project-ref pvmezsxdqotxaqfymmzd --yes
npx supabase db push --yes
npx supabase link --project-ref zydabsxcbetbhrgpiaxb --yes   # restore local link
```

Never run `populate_test_pantry`, `COOK_LOOP_LIVE`, or `HOUSEHOLD_JOIN_LIVE` against PROD without reading [`scripts/_env_guard.py`](../../scripts/_env_guard.py).

## Review account

Seeded on **PROD** via [`scripts/seed_review_account.py`](../../scripts/seed_review_account.py) (`--dev` for local rehearsal). Credentials live in 1Password + App Store Connect + Play Console — not in git.

Signed-build cook loop on PROD (email sign-in, `cooking_log` + `cook_logged`) documented in [`app-store-review.md`](app-store-review.md) (2026-09-29).
