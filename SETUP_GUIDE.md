# Meald Setup Guide

This guide will walk you through setting up Meald from scratch.

## Prerequisites

Before you begin, make sure you have:

- **Python 3.11+** installed
- **Node.js 18+** and npm installed
- **uv** package manager installed (`pip install uv`)
- A **Supabase** account (required for database and credential vault)

## Step 1: Clone and Install Dependencies

```bash
# Clone the repository
git clone https://github.com/yourusername/receipt2pantry.git
cd receipt2pantry

# Install Python dependencies
uv sync

# Install frontend dependencies
cd frontend
npm install
cd ..
```

## Step 2: Configure Environment

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your configuration
# Set SUPABASE_SERVICE_ROLE_KEY to use Supabase Vault; without it, dev uses an in-memory mock
```

**Minimum configuration for local development:**
```env
FLASK_ENV=development
FLASK_SECRET_KEY=your-development-secret-key
FLASK_PORT=5000

# Set all three Supabase keys to enable Vault; omit service role for mock-only dev
SUPABASE_URL=
SUPABASE_KEY=
SUPABASE_SERVICE_ROLE_KEY=

LOG_LEVEL=DEBUG
```

## Step 3: Database Setup (Optional)

If you want to use Supabase:

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to Project Settings > API to get your URL and keys
3. Go to SQL Editor and run `migrations/001_initial_schema.sql`
4. Update your `.env` with the Supabase credentials

## Step 4: Run the Application

**Terminal 1 - Backend:**
```bash
# From project root
uv run python backend/app.py

# Or use the script
chmod +x run_backend.sh
./run_backend.sh
```

**Terminal 2 - Frontend:**
```bash
# From project root
cd frontend
npm run dev

# Or use the script
chmod +x run_frontend.sh
./run_frontend.sh
```

Visit `http://localhost:5173` to see the application!

## Step 5: Test the Installation

**Run backend tests:**
```bash
uv run pytest
```

**Run frontend tests:**
```bash
cd frontend
npm test
```

**Test the health endpoint:**
```bash
curl http://localhost:5000/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "service": "grocerysync-backend",
  "version": "0.1.0"
}
```

## Step 6: Configure Your First Provider

1. Go to `http://localhost:5173/providers`
2. Click "Configure" on Safeway
3. Enter your Safeway credentials
4. Test the connection

## Troubleshooting

### Backend won't start
- Check that port 5000 is not in use: `lsof -i :5000`
- Verify Python version: `python --version` (should be 3.11+)
- Check logs for specific errors

### Frontend won't start
- Check that port 5173 is not in use: `lsof -i :5173`
- Clear node_modules and reinstall: `rm -rf node_modules && npm install`
- Check Node version: `node --version` (should be 18+)

### Database connection errors
- Verify Supabase credentials in `.env`
- Check that the migration was applied successfully
- Ensure your IP is allowed in Supabase project settings

### Provider automation fails
- Check that credentials are correct
- Some stores may have captcha or additional security measures

## Next Steps

- Configure additional providers
- Set up automated receipt syncing
- Explore the database schema
- Customize the frontend UI

## Production Deployment

Production runs on **Fly.io** at `https://api.meald.app` (live since 2026-07-28).

See the full runbook: **[docs/runbooks/deploy.md](docs/runbooks/deploy.md)** — Dockerfile, gunicorn, `fly secrets`, custom domain (Namecheap DNS), redeploy, rollback, and smoke checklist.

Related ops docs:

- Monitoring (GlitchTip + UptimeRobot): [docs/runbooks/monitoring.md](docs/runbooks/monitoring.md)
- Reconnect support: [docs/runbooks/reconnect.md](docs/runbooks/reconnect.md)
- Launch status: [docs/implementation_briefs/mvp_gaps/06-launch-readiness-findings.md](docs/implementation_briefs/mvp_gaps/06-launch-readiness-findings.md)

Quick summary:

1. `FLASK_ENV=production` with all required secrets (`SUPABASE_JWT_SECRET`, `SENTRY_DSN`, Supabase keys, `FLASK_SECRET_KEY`)
2. `CORS_ORIGINS=capacitor://localhost` (no localhost/LAN origins)
3. `fly deploy` from repo root
4. Release mobile builds with `VITE_API_BASE_URL=https://api.meald.app/api` (baked via `frontend/.env.production`)
5. Feature flags default off for MVP: meal planner (`FEATURE_MEAL_PLANNER` / `VITE_FEATURE_MEAL_PLANNER`), email auth (`VITE_FEATURE_EMAIL_AUTH`)

## Getting Help

- Check the [README.md](README.md) for more information
- Review the code documentation
- Open an issue on GitHub
- Check existing issues for solutions

Happy grocery syncing! 🛒
