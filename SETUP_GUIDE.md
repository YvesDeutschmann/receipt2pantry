# Meald Setup Guide

This guide will walk you through setting up Meald from scratch.

## Prerequisites

Before you begin, make sure you have:

- **Python 3.11+** installed
- **Node.js 18+** and npm installed
- **uv** package manager installed (`pip install uv`)
- A **Supabase** account (optional for development, required for production)
- An **AWS** account (optional for development, required for production)

## Step 1: Clone and Install Dependencies

```bash
# Clone the repository
git clone https://github.com/yourusername/receipt2pantry.git
cd receipt2pantry

# Install Python dependencies
uv sync

# Install Playwright browsers
uv run playwright install

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
# For development, you can leave AWS credentials empty (will use mock service)
```

**Minimum configuration for local development:**
```env
FLASK_ENV=development
FLASK_SECRET_KEY=your-development-secret-key
FLASK_PORT=5000

# Leave Supabase empty for testing without database
SUPABASE_URL=
SUPABASE_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Leave AWS empty for mock credentials service
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

LOG_LEVEL=DEBUG
PLAYWRIGHT_HEADLESS=false
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
- Try running with `PLAYWRIGHT_HEADLESS=false` to see what's happening
- Check that credentials are correct
- Some stores may have captcha or additional security measures

## Next Steps

- Configure additional providers
- Set up automated receipt syncing
- Explore the database schema
- Customize the frontend UI

## Production Deployment

For production deployment:

1. Set `FLASK_ENV=production`
2. Generate a strong `FLASK_SECRET_KEY`
3. Configure proper Supabase production database
4. Set up AWS Secrets Manager for credential storage
5. Enable HTTPS
6. Set `PLAYWRIGHT_HEADLESS=true`
7. Configure proper CORS origins
8. Set up monitoring and logging

See the main README for more details on production deployment.

## Getting Help

- Check the [README.md](README.md) for more information
- Review the code documentation
- Open an issue on GitHub
- Check existing issues for solutions

Happy grocery syncing! 🛒
