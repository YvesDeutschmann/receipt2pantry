# T3-04 — `frontend/src/contexts/AuthContext.jsx`

> **Tier:** 3 — Frontend
> **Why risky:** Gates every page via `ProtectedRoute`. Handles native Google Sign-In (via `@capawesome/capacitor-google-sign-in`), Apple OAuth, password auth, and `onAuthStateChange` subscription. A regression here logs everyone out. No dedicated test file today.

---

## 1. Technical Contract

- **File:** `frontend/src/contexts/AuthContext.jsx`
- **Exports:** `AuthProvider`, `useAuth` (hook).
- **Context value:** `{ user, session, loading, signIn, signUp, signOut, signInWithApple, signInWithGoogle, onboardingComplete }`.
- **External deps:** `@capacitor/core`, `supabase` client.
- **Constant:** `OAUTH_NATIVE_REDIRECT = 'com.meald.app://auth-callback'`.
- **Onboarding flag:** `Boolean(user?.user_metadata?.onboarding_completed_at)`.

---

## 2. Logic Guardrails

- **`loading=true` until initial `getSession` resolves** — `ProtectedRoute` relies on this to avoid flash-of-redirect.
- **Native Google Sign-In path:** on `Capacitor.isNativePlatform()`, uses `GoogleSignIn.signIn()` and then `supabase.auth.signInWithIdToken({ provider: 'google', token: idToken })`. Web falls back to `signInWithOAuth` redirect.
- **Missing ID token** on native → throw with explicit message "Google Sign-In did not return an ID token."
- **Redirect URL:** native → `com.meald.app://auth-callback`. Web → `${window.location.origin}/auth`.
- **`signOut`** MUST clear `localStorage.user_id` before calling `supabase.auth.signOut()` (so race conditions don't leave stale id).
- **`onAuthStateChange` cleanup:** the subscription returned from `.onAuthStateChange` must be unsubscribed on unmount.
- **`useAuth` outside provider** throws a clear error.
- **`onboardingComplete`:** `Boolean(...)` — explicitly coerces so downstream routing never receives `undefined`.

---

## 3. Test-First Suite

Create `frontend/src/tests/AuthContext.test.jsx` (new). Mock `supabase` and `@capacitor/core`.

### Test group A — initial load

1. `test_loading_true_until_getSession_resolves`
2. `test_loading_false_and_session_set_after_getSession`
3. `test_onAuthStateChange_subscription_cleaned_up_on_unmount`

### Test group B — hook enforcement

4. `test_useAuth_throws_when_used_outside_provider`

### Test group C — sign-in paths

5. `test_signIn_calls_supabase_signInWithPassword_and_rethrows_error`
6. `test_signUp_passes_signup_method_email_metadata`
7. `test_signInWithApple_uses_oauth_with_native_redirect_on_native`
8. `test_signInWithApple_uses_oauth_with_web_redirect_on_web`

### Test group D — Google native path

9. `test_signInWithGoogle_native_uses_id_token_flow`
10. `test_signInWithGoogle_native_throws_when_id_token_missing`
11. `test_signInWithGoogle_web_uses_signInWithOAuth_redirect`

### Test group E — sign-out

12. `test_signOut_clears_localStorage_user_id_before_supabase_call`

### Test group F — onboarding

13. `test_onboardingComplete_true_when_metadata_has_onboarding_completed_at`
14. `test_onboardingComplete_false_when_metadata_missing_the_key`
15. `test_onboardingComplete_false_when_user_is_null`

---

## 4. Definition of Done

- ≥ 12 test cases, 6 groups.
- Subscription cleanup test (3) prevents memory / duplicate listener leaks.
- `useAuth`-outside-provider error is covered.
- Native-vs-web Google / Apple branches tested separately.
- `signOut` localStorage ordering is locked in.
- All Supabase / Capacitor / Capawesome interactions mocked.
