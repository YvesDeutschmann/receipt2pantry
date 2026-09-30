# App Store Connect + Google Play — external review

Use the same demo account and notes on both platforms.

## Demo account (PROD)

| Field | Value |
|---|---|
| Email | `review@meald.app` |
| Password | (1Password — App Review entry) |
| PROD `user_id` | `b2d5c7a5-7dfb-483a-99a3-ee83e3b895ef` |

Inbound mail to `review@meald.app` is Namecheap forwarding to the operator inbox (**verified 2026-09-29**). That is separate from Supabase auth for the demo user — see [`deploy.md` — Domain email](deploy.md#domain-email-mealdapp).

Seed or reset: `REVIEW_ACCOUNT_PASSWORD='…' uv run python scripts/seed_review_account.py --prod [--reset]`

Store the password in 1Password (App Review entry). Do not commit it to git.

## Signed-build cook loop (PROD) — verified 2026-09-29

Operator walkthrough on **signed** Android (Play internal) and iOS (TestFlight) builds against `api.meald.app`: email sign-in as `review@meald.app`, Dinner → recipe → **Cooked it**. Server confirmation on Supabase **PROD** (`pvmezsxdqotxaqfymmzd`):

| Check | Result |
|---|---|
| `cooking_log` | **2 rows** — `Rice and Black Beans` (`staple_rice_beans`) at **2026-09-29 ~4:55 PM PT**; `Pasta with Tomato Sauce` (`staple_tomato_pasta`) ~33s later |
| `ingredients_used` | Non-empty JSON on both rows (pantry depletion persisted) |
| `funnel_repeatable_events` (`cook_logged`) | **2** distinct recipe ids (duplicate flush rows per cook — same as Area 5 QA accounts) |
| `funnel_events` | `funnel_first_suggestion_viewed`, `funnel_store_connected`; **`funnel_first_cook_logged` absent** (known E6 telemetry gap — does not block review) |

Re-check after device retest or `--reset` seed:

```sql
SELECT recipe_id, recipe_name, cooked_at
FROM cooking_log
WHERE user_id = 'b2d5c7a5-7dfb-483a-99a3-ee83e3b895ef'
ORDER BY cooked_at DESC
LIMIT 5;

SELECT event, occurred_at, metadata
FROM funnel_repeatable_events
WHERE user_id = 'b2d5c7a5-7dfb-483a-99a3-ee83e3b895ef'
  AND event = 'cook_logged'
ORDER BY occurred_at DESC
LIMIT 5;
```

**Submit gate:** cook loop OK on both platforms + demo credentials pasted in App Store Connect / Play → proceed to external beta / store review submission.

## Review notes (paste into TestFlight + Play)

```
Sign in with the demo email and password provided (not Apple/Google for review).

The pantry is pre-filled from sample grocery receipts. You do not need a Safeway or Costco account.

If prompted to connect a store during onboarding, choose “I’ll add items manually” or skip store connection.

Open the Dinner tab, tap a recipe card, then tap “Cooked it” to see the pantry update.

Weekly meal planner is not included in this build.
```

## App Store Connect — External TestFlight

1. **Test Information** (build): demo email + password + contact email/phone.
2. **What to Test**: paste review notes above.
3. Create **External** group; submit build for **Beta App Review**.
4. Export compliance: `ITSAppUsesNonExemptEncryption = false` in Info.plist (standard HTTPS only).

## Google Play Console

1. **App content → App access** → “All or some functionality is restricted”.
2. Provide the same demo credentials and review notes.
3. Internal / closed testing track must use a build with email sign-in enabled (`VITE_FEATURE_EMAIL_SIGNIN=1` in production bundle).
4. **Data safety → Delete account URL:** `https://api.meald.app/delete-account` (live after `fly deploy` ships [`backend/legal/delete-account.html`](../../backend/legal/delete-account.html)). Partial delete without closing account: **Yes** (disconnect stores in Settings; email `privacy@meald.app` for access/correction).

Apple App Store Connect can use the same URL if an account-deletion link is requested.

## After review

Re-run `seed_review_account.py --prod --reset` if reviewers depleted the dinner pool or changed pantry state.
