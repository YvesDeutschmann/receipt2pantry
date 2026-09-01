# Meald

Automated grocery receipt syncing and pantry management system.

## Overview

Meald automatically fetches grocery receipts from your favorite stores and organizes them into a searchable database. Currently supports Safeway, with more providers coming soon.

## Features

- 🏪 **Provider Integration**: Connect to grocery store accounts and automatically sync receipts
- 📊 **Receipt Management**: View, search, and organize all your grocery receipts in one place
- 🔒 **Secure Credentials**: Encrypted credential storage via Supabase Vault
- 🎨 **Modern UI**: Beautiful, responsive interface built with React and Tailwind CSS
- 🔌 **Extensible**: Modular provider system makes adding new stores easy

## Architecture

### Backend (Python + Flask)
- **Flask** for REST API
- **Supabase** for database
- **Supabase Vault** for encrypted grocery credential storage
- **Provider abstraction layer** for easy store integration

### Frontend (React + Vite)
- **React 18** with modern hooks
- **Tailwind CSS** for styling
- **Vite** for fast development
- **React Router** for navigation

### Database (Supabase/PostgreSQL)
- Users and authentication
- Grocery account management
- Receipt storage with full-text search
- Automation logs

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+
- uv package manager
- Supabase account (optional for development)
- Supabase project (required for credential vault and database)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/receipt2pantry.git
   cd receipt2pantry
   ```

2. **Install Python dependencies**
   ```bash
   uv sync
   ```

3. **Install frontend dependencies**
   ```bash
   cd frontend
   npm install
   ```

4. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

5. **Run database migrations** (if using Supabase)
   ```bash
   # Apply migrations/001_initial_schema.sql to your Supabase project
   ```

### Development

**Start the backend:**
```bash
uv run python backend/app.py
```

**Start the frontend:**
```bash
cd frontend
npm run dev
```

Visit `http://localhost:5173` to see the application.

### Production & ops

- **API:** `https://api.meald.app` (Fly.io) — [deploy runbook](docs/runbooks/deploy.md)
- **Monitoring:** GlitchTip Cloud + UptimeRobot — [monitoring runbook](docs/runbooks/monitoring.md)
- **Reconnect support:** [reconnect runbook](docs/runbooks/reconnect.md)
- **Launch gate:** [MVP roadmap](docs/MVP_SCOPE_AND_ROADMAP.md) · [M6 findings](docs/implementation_briefs/mvp_gaps/06-launch-readiness-findings.md) (**NO-GO** until Area 5 device QA)

Release mobile builds use `frontend/.env.production` (`VITE_API_BASE_URL=https://api.meald.app/api`).

### Testing

**Backend tests:**
```bash
uv run pytest
```

**Frontend tests:**
```bash
cd frontend
npm test
```

## Project Structure

```
receipt2pantry/
├── backend/
│   ├── app.py                 # Flask application factory
│   ├── config.py              # Configuration management
│   ├── routes/                # API endpoints
│   ├── services/              # Business logic
│   ├── providers/             # Store-specific automation
│   ├── parsers/               # Receipt parsing
│   └── utils/                 # Utilities
├── frontend/
│   ├── src/
│   │   ├── components/        # React components
│   │   ├── pages/             # Page components
│   │   ├── services/          # API client
│   │   └── App.jsx            # Root component
│   └── package.json
├── migrations/                # Database migrations
├── tests/                     # Test suite
└── pyproject.toml            # Python dependencies
```

## Adding a New Provider

1. Create a new provider class in `backend/providers/`:
   ```python
   from backend.providers.base_provider import BaseProvider
   from backend.providers.provider_registry import register_provider

   @register_provider('mystore')
   class MyStoreProvider(BaseProvider):
       # Implement required methods
       pass
   ```

2. Create a parser in `backend/parsers/`:
   ```python
   from backend.parsers.base_parser import BaseParser

   class MyStoreParser(BaseParser):
       # Implement parsing logic
       pass
   ```

3. The provider will automatically be available in the API and UI!

## Configuration

See `.env.example` for all available configuration options.

**Key settings:**
- `SUPABASE_URL` and `SUPABASE_KEY`: Database connection
- `CONTENTSTACK_ACCESS_TOKEN`: Costco Contentstack CMS read-only token (for client-identifier verification)
- `SUPABASE_SERVICE_ROLE_KEY`: Required for Supabase Vault (grocery credentials); without it, development falls back to an in-memory mock
- `LOG_LEVEL`: Logging verbosity

## Security

- Grocery provider credentials are encrypted in Supabase Vault (never stored in Postgres tables)
- Row-level security (RLS) ensures users only access their own data
- CORS configured for frontend domain only
- No credentials stored in code or git

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Submit a pull request

## License

MIT License - see LICENSE file for details

## Roadmap

See [`docs/MVP_SCOPE_AND_ROADMAP.md`](docs/MVP_SCOPE_AND_ROADMAP.md). MVP focuses on Safeway + Costco → pantry → What's for Dinner; meal planner and email auth are deferred behind feature flags. Launch readiness (M6) is **NO-GO** until physical-device QA against prod — track in [`06-launch-readiness-findings.md`](docs/implementation_briefs/mvp_gaps/06-launch-readiness-findings.md).

## Support

For issues and questions, please open a GitHub issue.
