# Manual Testing Guide: MFA Login Flow

**Feature:** Multi-Factor Authentication (MFA) Support for Provider Login  
**Date:** October 16, 2025

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Starting the Application](#starting-the-application)
3. [Testing via UI (Recommended)](#testing-via-ui-recommended)
4. [Testing via API (Advanced)](#testing-via-api-advanced)
5. [Test Scenarios](#test-scenarios)
6. [Debugging Tips](#debugging-tips)
7. [Common Issues](#common-issues)

---

## Prerequisites

### Required
- Python 3.11+
- Node.js 18+
- Valid Safeway account credentials
- Access to email/phone for receiving MFA codes

### Optional (for full testing)
- Supabase account (for database persistence)
- AWS account (for secrets management)

### Important Notes
⚠️ **Browser Visibility**: Set `PLAYWRIGHT_HEADLESS=false` in your environment to watch the automation in action!

⚠️ **Real Credentials**: You'll need actual Safeway credentials to test the full flow. The automation will interact with the real Safeway website.

---

## Starting the Application

### Step 1: Configure Environment Variables

Create a `.env` file in the project root (if not already present):

```bash
# Backend Configuration
FLASK_ENV=development
FLASK_PORT=5000

# Show browser during automation (IMPORTANT for testing!)
PLAYWRIGHT_HEADLESS=false
PLAYWRIGHT_TIMEOUT=30000

# MFA Settings
MFA_SESSION_TIMEOUT=300
SESSION_CLEANUP_INTERVAL=60
MFA_MAX_RETRY_ATTEMPTS=3

# Optional: Database (can skip for basic testing)
# SUPABASE_URL=your_supabase_url
# SUPABASE_KEY=your_supabase_key

# Optional: AWS Secrets Manager (can skip for basic testing)
# AWS_REGION=us-west-2
# AWS_ACCESS_KEY_ID=your_key
# AWS_SECRET_ACCESS_KEY=your_secret
```

### Step 2: Install Dependencies

**Backend:**
```bash
# Using uv (recommended)
uv sync

# Or using pip
pip install -r requirements.txt
```

**Frontend:**
```bash
cd frontend
npm install
```

### Step 3: Start Backend Server

**Option A: Using the run script (Linux/Mac)**
```bash
chmod +x run_backend.sh
./run_backend.sh
```

**Option B: Using PowerShell (Windows)**
```powershell
uv run python backend/app.py
```

**Option C: Direct Python**
```bash
python -m backend.app
```

**Expected Output:**
```
INFO:grocerysync:Starting GrocerySync backend
INFO:grocerysync:Supabase not configured (development mode)
INFO:grocerysync:Using mock Secrets Service (development mode)
INFO:grocerysync:LoginSessionManager initialized with 300s timeout
INFO:grocerysync:Session cleanup worker started
INFO:grocerysync:Routes registered
INFO:grocerysync:GrocerySync backend initialized successfully
INFO:grocerysync:Starting Flask server on port 5000
 * Running on http://0.0.0.0:5000
```

### Step 4: Start Frontend Server

**In a new terminal:**

```bash
cd frontend
npm run dev
```

**Expected Output:**
```
  VITE v5.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

---

## Testing via UI (Recommended)

### Basic Flow - No MFA

**Steps:**
1. Open browser to `http://localhost:5173`
2. Navigate to "Providers" page
3. Click "Test Connection" on Safeway card
4. Enter your Safeway credentials in the modal
5. Click "Test Connection"

**Expected Result:**
- If no MFA: Browser automation logs in, success alert appears
- If MFA required: Credentials modal closes, MFA dialog opens

### MFA Flow - Happy Path

**Steps:**
1. Start the basic flow above with credentials that require MFA
2. **Watch the browser** (should be visible if `PLAYWRIGHT_HEADLESS=false`)
3. Safeway will show "We noticed you're signing in from a new device"
4. Backend detects MFA prompt
5. Frontend shows MFA dialog with:
   - 6-digit code input
   - Countdown timer (5 minutes)
   - Provider name (Safeway)
6. Check your email/phone for Safeway verification code
7. Enter the 6-digit code in the dialog
8. Click "Verify"

**Expected Result:**
- Loading spinner shows while verifying
- Browser automation enters code and submits
- On success: "Successfully connected to safeway!" alert
- MFA dialog closes
- Browser closes automatically

**What to Watch:**
- Backend terminal: Watch logs for MFA detection
- Browser: Watch automation fill in the MFA code
- Frontend: Timer counting down
- Network tab: API calls to `/mfa` endpoint

### MFA Flow - Error Scenarios

#### Test 1: Invalid MFA Code
1. Start MFA flow
2. Enter an incorrect code (e.g., "000000")
3. Click "Verify"

**Expected:**
- Error message appears in dialog
- "Invalid verification code" or similar error
- Can retry with correct code
- After 3 failed attempts: Dialog closes automatically

#### Test 2: Session Expiration
1. Start MFA flow
2. **Wait 5+ minutes** without entering code
3. Observe countdown timer reach 00:00

**Expected:**
- Timer reaches zero
- Dialog closes automatically
- "Session expired" message appears
- Browser closes and cleans up

#### Test 3: User Cancellation
1. Start MFA flow
2. Click "Cancel" button in MFA dialog

**Expected:**
- Dialog closes immediately
- Backend terminates session
- Browser closes and cleans up
- Can restart the flow

---

## Testing via API (Advanced)

### Prerequisites
- API client (curl, Postman, HTTPie, etc.)
- Backend running on `http://localhost:5000`

### Test 1: Initiate Login (No MFA)

```bash
curl -X POST http://localhost:5000/api/providers/safeway/test \
  -H "Content-Type: application/json" \
  -d '{
    "username": "your_email@example.com",
    "password": "your_password",
    "user_id": "test-user-123"
  }'
```

**Expected Response (Success):**
```json
{
  "status": "success",
  "provider": "safeway",
  "message": "Connection successful"
}
```

**Expected Response (MFA Required):**
```json
{
  "status": "mfa_required",
  "session_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "message": "Multi-factor authentication required",
  "provider": "safeway",
  "expires_at": "2025-10-16T12:35:00.000Z"
}
```

### Test 2: Check Session Status

```bash
# Use session_id from previous response
SESSION_ID="a1b2c3d4-e5f6-7890-abcd-ef1234567890"

curl http://localhost:5000/api/providers/safeway/login/$SESSION_ID/status
```

**Expected Response:**
```json
{
  "session_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "awaiting_code",
  "provider": "safeway",
  "created_at": "2025-10-16T12:30:00.000Z",
  "expires_at": "2025-10-16T12:35:00.000Z",
  "time_remaining_seconds": 240,
  "error_message": null
}
```

### Test 3: Submit MFA Code

```bash
# Get code from your email/phone
SESSION_ID="a1b2c3d4-e5f6-7890-abcd-ef1234567890"
MFA_CODE="123456"

curl -X POST http://localhost:5000/api/providers/safeway/login/$SESSION_ID/mfa \
  -H "Content-Type: application/json" \
  -d "{\"code\": \"$MFA_CODE\"}"
```

**Expected Response (Success):**
```json
{
  "status": "success",
  "message": "Login completed successfully"
}
```

**Expected Response (Invalid Code):**
```json
{
  "status": "error",
  "error": "MFA verification failed: Invalid code",
  "can_retry": true,
  "attempts_remaining": 2
}
```

### Test 4: Cancel Session

```bash
SESSION_ID="a1b2c3d4-e5f6-7890-abcd-ef1234567890"

curl -X DELETE http://localhost:5000/api/providers/safeway/login/$SESSION_ID
```

**Expected Response:**
```
HTTP 204 No Content
```

---

## Test Scenarios

### Scenario 1: Complete MFA Flow ✅

**Purpose:** Test the happy path from start to finish

**Steps:**
1. Start with clean state (no active sessions)
2. Initiate login with MFA-enabled account
3. Receive MFA code
4. Submit valid code within timeout
5. Verify successful completion

**Success Criteria:**
- ✅ Session created with valid ID
- ✅ Browser stays open during MFA wait
- ✅ Code accepted and verified
- ✅ Session marked as completed
- ✅ Browser cleaned up
- ✅ session.json file created with cookies

### Scenario 2: Multiple Failed Attempts ⚠️

**Purpose:** Test retry limits and error handling

**Steps:**
1. Initiate login
2. Submit invalid code 3 times
3. Observe behavior after max retries

**Success Criteria:**
- ✅ First 2 failures allow retry
- ✅ Third failure terminates session
- ✅ Browser cleaned up
- ✅ Clear error message shown
- ✅ Must restart flow to retry

### Scenario 3: Session Timeout ⏱️

**Purpose:** Test automatic cleanup after expiration

**Steps:**
1. Initiate login
2. Wait 5+ minutes without submitting code
3. Observe cleanup behavior

**Success Criteria:**
- ✅ Session expires after 5 minutes
- ✅ Background worker cleans up session
- ✅ Browser closed automatically
- ✅ Status endpoint returns 404 or "expired"

### Scenario 4: Concurrent Sessions 🔄

**Purpose:** Test handling multiple simultaneous MFA sessions

**Steps:**
1. Start MFA flow for user A
2. Start MFA flow for user B (different browser/account)
3. Complete both flows

**Success Criteria:**
- ✅ Both sessions tracked independently
- ✅ No cross-contamination
- ✅ Both browsers isolated
- ✅ Both complete successfully

### Scenario 5: User Cancellation ❌

**Purpose:** Test cleanup on user cancellation

**Steps:**
1. Initiate login
2. Cancel via UI or DELETE endpoint
3. Verify cleanup

**Success Criteria:**
- ✅ Session terminated immediately
- ✅ Browser closed
- ✅ Resources released
- ✅ Can restart flow

---

## Debugging Tips

### 1. Check Backend Logs

**Important log messages to watch:**

```bash
# MFA Detection
INFO:backend.providers.safeway_provider:MFA input detected with selector: input[formcontrolname='otpCode']
INFO:backend.providers.safeway_provider:MFA verification required

# Session Management
INFO:backend.services.login_session_manager:Created login session {session_id} for user {user_id}
INFO:backend.services.login_session_manager:Session {session_id} state updated: awaiting_code -> completed

# Cleanup
INFO:backend.workers.session_cleanup:Cleaned up 1 expired session(s)
```

### 2. Watch Browser Automation

**With `PLAYWRIGHT_HEADLESS=false`, watch for:**
- Browser opens automatically
- Credentials filled in
- MFA prompt appears
- Code entered and submitted
- Success/error state

### 3. Monitor Browser Processes

**Windows:**
```powershell
# Check for chrome/chromium processes
tasklist | findstr chrome
```

**Linux/Mac:**
```bash
ps aux | grep chrome
```

**Issue:** If processes accumulate, there's a resource leak

### 4. Check Session Storage

**In browser DevTools (Frontend):**
```javascript
// Check localStorage
localStorage.getItem('auth_token')

// Check sessionStorage
sessionStorage
```

**On Backend:**
```bash
# Check if session.json created after successful login
ls -la session.json
cat session.json
```

### 5. Network Inspector

**Open DevTools → Network tab:**
- Watch for 202 response (MFA required)
- Watch polling to `/status` endpoint (every 2 seconds)
- Watch POST to `/mfa` endpoint
- Check response payloads match expected format

### 6. Database Queries (If Supabase configured)

```sql
-- Check login sessions
SELECT * FROM login_sessions 
ORDER BY created_at DESC 
LIMIT 10;

-- Check active sessions
SELECT * FROM login_sessions 
WHERE state = 'awaiting_code' 
AND expires_at > NOW();

-- Check expired sessions
SELECT * FROM login_sessions 
WHERE expires_at < NOW();
```

---

## Common Issues

### Issue: "Login session manager not available"

**Symptom:** HTTP 503 when MFA required

**Cause:** Session manager not initialized in app.py

**Solution:**
```bash
# Check backend logs for:
INFO:grocerysync:Login session manager initialized

# If missing, check config.py has:
MFA_SESSION_TIMEOUT=300
```

### Issue: Browser doesn't open

**Symptom:** Login attempts but no visible browser

**Cause:** `PLAYWRIGHT_HEADLESS=true` (default)

**Solution:**
```bash
# Set in .env or export:
export PLAYWRIGHT_HEADLESS=false

# Restart backend
```

### Issue: MFA not detected

**Symptom:** Login fails instead of showing MFA dialog

**Possible causes:**
1. Safeway changed their UI selectors
2. Account doesn't have MFA enabled
3. Detection timing issue

**Debug:**
```python
# Check logs for:
INFO:backend.providers.safeway_provider:Waiting for login response
INFO:backend.providers.safeway_provider:MFA input detected...

# If missing, check page HTML:
# Add temporary logging in _detect_mfa_prompt():
logger.info(f"Page content: {self.page.content()[:500]}")
```

### Issue: "Session not found or expired"

**Symptom:** HTTP 404 when checking status

**Causes:**
1. Session already expired (>5 minutes)
2. Session was terminated
3. Wrong session_id in URL

**Solution:**
- Restart the flow from beginning
- Check session_id matches response
- Reduce timeout for testing (in .env)

### Issue: Polling doesn't stop

**Symptom:** Status API calls continue after dialog closes

**Cause:** Frontend cleanup issue

**Debug:**
```javascript
// In Providers.jsx, add logging:
const stopStatusPolling = () => {
  console.log('Stopping polling, interval:', pollingIntervalRef.current)
  if (pollingIntervalRef.current) {
    clearInterval(pollingIntervalRef.current)
    pollingIntervalRef.current = null
  }
}
```

### Issue: Countdown timer not updating

**Symptom:** Timer shows same value

**Causes:**
1. `expiresAt` not passed correctly
2. Date parsing issue
3. Effect dependencies missing

**Debug:**
```javascript
// In MfaDialog.jsx, add logging:
useEffect(() => {
  console.log('Timer effect, expiresAt:', expiresAt)
  console.log('Parsed date:', new Date(expiresAt))
  // ...
}, [isOpen, expiresAt, onCancel])
```

---

## Performance Testing

### Test Session Cleanup Worker

```bash
# Terminal 1: Watch backend logs
tail -f backend.log | grep cleanup

# Terminal 2: Create multiple sessions
for i in {1..5}; do
  curl -X POST http://localhost:5000/api/providers/safeway/test \
    -H "Content-Type: application/json" \
    -d '{"username":"test'$i'@example.com","password":"test"}'
done

# Wait 5+ minutes, verify cleanup runs
```

### Test Concurrent Logins

```bash
# Start multiple MFA flows simultaneously
# Use different accounts/browsers
# Monitor memory usage and browser processes
```

---

## Quick Test Checklist

### Before Release:
- [ ] Normal login (no MFA) works
- [ ] MFA detection triggers correctly
- [ ] MFA dialog appears with timer
- [ ] Valid code submission succeeds
- [ ] Invalid code shows error and allows retry
- [ ] Max retries (3) terminates session
- [ ] Session expiration cleans up resources
- [ ] User cancellation works
- [ ] Browser processes cleaned up
- [ ] Concurrent sessions don't interfere
- [ ] Backend logs show correct flow
- [ ] No resource leaks after errors
- [ ] Frontend polling stops on completion

---

## Getting Help

If you encounter issues:

1. **Check logs first:**
   - Backend terminal output
   - Browser console (F12)
   - Network tab in DevTools

2. **Enable verbose logging:**
   ```bash
   export LOG_LEVEL=DEBUG
   ```

3. **Review documentation:**
   - `docs/features/0002_PLAN.md` - Original plan
   - `docs/features/0002_REVIEW.md` - Code review
   - `docs/features/0002_FIXES.md` - Bug fixes

4. **Common patterns:**
   - 202 = MFA required
   - 200 = Success
   - 401 = Auth failed
   - 404 = Session not found
   - 410 = Session expired
   - 500 = Server error

---

**Last Updated:** October 16, 2025  
**Feature Version:** 1.0  
**Status:** Ready for Testing

