# GrocerySync Architecture

This document describes the high-level architecture and design decisions for GrocerySync.

## System Overview

GrocerySync is a full-stack web application that automates grocery receipt syncing from various providers. The system follows a clean architecture pattern with clear separation of concerns.

```
┌─────────────┐
│   Browser   │
│  (React)    │
└──────┬──────┘
       │ HTTP/REST
       ▼
┌─────────────┐      ┌──────────────┐
│   Flask     │◄────►│  Supabase    │
│   Backend   │      │  PostgreSQL  │
└──────┬──────┘      └──────────────┘
       │
       ├──────► Playwright (Browser Automation)
       │
       └──────► AWS Secrets Manager
```

## Backend Architecture

### Layers

1. **Routes Layer** (`backend/routes/`)
   - HTTP endpoints
   - Request validation
   - Response formatting
   - Error handling

2. **Services Layer** (`backend/services/`)
   - Business logic
   - Database operations
   - External service integration
   - Pure functions with explicit dependencies

3. **Providers Layer** (`backend/providers/`)
   - Store-specific automation
   - Browser control via Playwright
   - Receipt fetching logic
   - Plugin architecture with registry pattern

4. **Parsers Layer** (`backend/parsers/`)
   - Receipt data extraction
   - Email parsing
   - Data normalization
   - Validation

5. **Utils Layer** (`backend/utils/`)
   - Logging
   - Exception hierarchy
   - Common utilities

### Key Patterns

#### Provider Registry Pattern

Providers self-register using a decorator pattern:

```python
@register_provider('safeway')
class SafewayProvider(BaseProvider):
    pass
```

This allows:
- Dynamic provider discovery
- No hardcoded provider lists
- Easy addition of new providers
- Consistent interface across all providers

#### Dependency Injection

Services accept dependencies as parameters rather than importing them:

```python
def fetch_receipts(user_id, provider_instance, supabase_service):
    # Uses injected dependencies
    pass
```

Benefits:
- Easier testing (mock injection)
- Clearer dependencies
- Better testability
- No hidden globals

#### Factory Pattern

Application and services use factory functions:

```python
def create_app(config=None):
    app = Flask(__name__)
    # Configure and return app
    return app
```

Benefits:
- Testable (can create test instances)
- Configurable
- Clean initialization

## Frontend Architecture

### Component Structure

```
src/
├── components/         # Reusable UI components
│   ├── Header.jsx
│   └── ProviderCard.jsx
├── pages/             # Page-level components
│   ├── Dashboard.jsx
│   ├── Providers.jsx
│   └── Settings.jsx
├── services/          # API integration
│   └── apiClient.js
└── App.jsx            # Root component with routing
```

### State Management

Currently uses React's built-in state management:
- `useState` for component state
- `useEffect` for side effects
- Props for data passing

For future scaling, consider:
- Context API for global state
- React Query for server state
- Zustand for client state

### API Communication

Centralized API client with:
- Axios instance
- Request/response interceptors
- Error handling
- Authentication token management

## Database Schema

### Core Tables

1. **grocery_accounts**: Links users to store accounts
2. **receipts**: Receipt metadata and raw data
3. **receipt_items**: Individual items for querying
4. **automation_logs**: Automation run tracking

### Security

- Row Level Security (RLS) enabled on all tables
- Users can only access their own data
- Service role for backend operations
- Encrypted credentials in AWS Secrets Manager

## Data Flow

### Receipt Syncing Flow

```
1. User configures provider credentials in UI
   ↓
2. Frontend sends credentials to backend
   ↓
3. Backend stores encrypted credentials in AWS Secrets Manager
   ↓
4. Backend triggers provider automation
   ↓
5. Provider logs in and fetches receipts
   ↓
6. Parser extracts structured data
   ↓
7. Backend stores data in Supabase
   ↓
8. Frontend displays updated receipts
```

### Authentication Flow

```
1. User signs in (Supabase Auth)
   ↓
2. Frontend receives JWT token
   ↓
3. Token included in all API requests
   ↓
4. Backend verifies token
   ↓
5. Database RLS enforces user isolation
```

## Security Architecture

### Credential Storage

- **Never stored in database**: Only reference IDs
- **AWS Secrets Manager**: Production credential storage
- **Mock service**: Development without AWS
- **Encryption at rest**: AWS handles encryption
- **Encryption in transit**: HTTPS only

### API Security

- **CORS**: Restricted to known origins
- **Rate limiting**: TBD (recommend implementing)
- **Input validation**: All endpoints validate input
- **SQL injection**: Prevented by ORM/parameterized queries
- **XSS**: React escapes by default

### Browser Automation

- **Headless mode**: Production runs headless
- **No credential logging**: Credentials never logged
- **Session management**: Isolated sessions per user
- **Cleanup**: Always cleanup browser resources

## Scalability Considerations

### Current Limitations

- Synchronous receipt fetching
- Single-instance Flask server
- Browser automation per request

### Scaling Strategies

1. **Queue-based processing**
   - Use Celery or RQ for async tasks
   - Queue receipt sync jobs
   - Background workers process queue

2. **Horizontal scaling**
   - Stateless Flask instances
   - Load balancer distribution
   - Shared session storage (Redis)

3. **Database optimization**
   - Connection pooling
   - Read replicas for queries
   - Caching layer (Redis)

4. **Browser automation**
   - Browser pool management
   - Dedicated automation service
   - Rate limiting per provider

## Testing Strategy

### Backend Testing

- **Unit tests**: Service functions with mocked dependencies
- **Integration tests**: Routes with test database
- **E2E tests**: Full flow with mocked providers

### Frontend Testing

- **Component tests**: Isolated component testing
- **Integration tests**: Page-level testing
- **E2E tests**: Full user flows (Playwright)

## Development Workflow

1. **Local Development**
   - Mock services (no AWS/Supabase required)
   - Hot reload (Vite + Flask debug mode)
   - Debug-friendly (non-headless browsers)

2. **Testing**
   - Run all tests before commit
   - CI/CD runs tests on PR
   - Code coverage tracking

3. **Deployment**
   - Backend: Container or serverless
   - Frontend: Static hosting (Vercel, Netlify)
   - Database: Supabase managed

## Future Architecture Improvements

1. **Event-driven architecture**: Pub/sub for receipt syncing
2. **Microservices**: Split provider automation into separate service
3. **GraphQL**: Consider GraphQL instead of REST
4. **Real-time updates**: WebSocket for live receipt sync status
5. **Caching layer**: Redis for frequently accessed data
6. **Message queue**: RabbitMQ or AWS SQS for async tasks

## Key Design Principles

1. **Separation of Concerns**: Each layer has a single responsibility
2. **Dependency Injection**: Explicit dependencies, easy testing
3. **Plugin Architecture**: Easy to add new providers
4. **Security First**: Credentials never in code or logs
5. **Fail Gracefully**: Comprehensive error handling
6. **Observable**: Structured logging throughout
7. **Testable**: All components easily testable

## Technology Choices

### Why Flask?
- Lightweight and flexible
- Easy to test
- Great for APIs
- Python ecosystem for automation

### Why React?
- Component-based
- Large ecosystem
- Great developer experience
- Performant

### Why Playwright?
- Modern browser automation
- Cross-browser support
- Better than Selenium for SPAs
- Good documentation

### Why Supabase?
- PostgreSQL with modern API
- Built-in auth
- Row-level security
- Real-time capabilities

### Why AWS Secrets Manager?
- Secure credential storage
- Encryption at rest
- Access logging
- Integration with AWS ecosystem

## Contributing Guidelines

When adding new features:

1. Follow existing patterns
2. Add tests
3. Update documentation
4. Consider security implications
5. Maintain separation of concerns

