# 01c — Re-sync Idempotency & Connection-Health Signal

> **Prerequisite:** Read `docs/implementation_briefs/mvp_gaps/README.md` (Shared conventions), `docs/safeway_dedup_fix.md` (prior dedup work), and `.cursorrules.md`.
>
> **Scope:** Two tightly-related backend concerns. **01c.1** hardens the dedup key and idempotent storage path so repeated manual syncs and the new on-by-default auto-sync never create duplicate receipts or double-count pantry items. **01c.2** standardizes the connection-health response shape that the frontend briefs 01a/01b react to across both Safeway and Costco.  Touches exactly 3 production files + 1 new migration + 2 test files.
>
> **Do NOT touch in this phase:** `backend/services/receipt_processor.py`, `backend/services/normalization_service.py`, any frontend file, `backend/routes/receipts.py` (beyond what is called from `store_fetched_receipts`), Costco gas/car-wash filtering in `store_costco_receipts`, `receipt_items` column definitions, Safeway WebView bridge code, or any migration ≤ 022.

---

## Objective

A returning user whose store auto-syncs on every app foreground must never end up with duplicate receipts or double-counted pantry items, even if the same receipt list is submitted multiple times in rapid succession (manual + auto interleave). Concurrently, any auth failure from any provider endpoint must return a single, predictable JSON shape so 01a/01b can render a reconnect prompt without provider-specific parsing logic.

---

## Sub-phase 01c.1 — Dedup Hardening

### Technical Contract

#### 1. New migration: `supabase/migrations/023_receipt_dedup_hardening.sql`

**Schema change — dedup key:** The current `receipts` table carries `UNIQUE(order_id)` (constraint name `receipts_order_id_key`, created in `001_initial_schema.sql`). This is a **global** uniqueness constraint with two problems:

- Cross-user collision: two different users whose provider issues the same `order_id` value would see the second user's receipt silently rejected with a misleading "already imported" log.
- No provider scoping: a Safeway and Costco receipt could theoretically share an `order_id` string and collide.

**Replace** the global constraint with a user-scoped dedup key:

```sql
-- Drop old global unique constraint (verify exact name in DB before running)
ALTER TABLE receipts DROP CONSTRAINT IF EXISTS receipts_order_id_key;

-- New semantically-correct dedup key
ALTER TABLE receipts
  ADD CONSTRAINT receipts_user_provider_order_id_key
  UNIQUE (user_id, provider, order_id);
```

> **Agent must verify:** Run `\d receipts` or query `pg_constraint` to confirm the old constraint name is `receipts_order_id_key` before writing the DROP statement. If the name differs, use the actual name.

**RPC update — idempotent upsert:** Replace `store_receipt_with_items` (currently in migration 007) with an updated version that handles duplicates in-database via `ON CONFLICT DO NOTHING`, returning `NULL` for a duplicate row instead of raising an exception:

```sql
CREATE OR REPLACE FUNCTION store_receipt_with_items(
  p_receipt jsonb,
  p_items   jsonb
)
RETURNS uuid        -- returns NULL if receipt already exists (idempotent)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt_id uuid;
  v_item       jsonb;
BEGIN
  INSERT INTO receipts (
    user_id, household_id, grocery_account_id, provider,
    order_id, order_date, total_amount, num_items,
    raw_data, fetched_at, created_at
  )
  VALUES (
    (p_receipt->>'user_id')::uuid,
    NULLIF(trim(p_receipt->>'household_id'), '')::uuid,
    NULLIF(trim(p_receipt->>'grocery_account_id'), '')::uuid,
    p_receipt->>'provider',
    p_receipt->>'order_id',
    (p_receipt->>'order_date')::date,
    (p_receipt->>'total_amount')::numeric,
    COALESCE((p_receipt->>'num_items')::int, 0),
    COALESCE(p_receipt->'raw_data', '{}'::jsonb),
    (p_receipt->>'fetched_at')::timestamptz,
    COALESCE((p_receipt->>'created_at')::timestamptz, now())
  )
  ON CONFLICT (user_id, provider, order_id) DO NOTHING
  RETURNING id INTO v_receipt_id;
  -- v_receipt_id is NULL here if the row already existed → caller skips items

  IF v_receipt_id IS NOT NULL THEN
    FOR v_item IN SELECT elem FROM jsonb_array_elements(p_items) AS elem
    LOOP
      INSERT INTO receipt_items (
        receipt_id, user_id, name, category, price, quantity,
        quantity_info, regular_price, savings, created_at
      )
      VALUES (
        v_receipt_id,
        (v_item->>'user_id')::uuid,
        v_item->>'name',
        COALESCE(v_item->>'category', 'UNKNOWN'),
        (v_item->>'price')::numeric,
        COALESCE((v_item->>'quantity')::numeric, 1),
        v_item->'quantity_info',
        (v_item->>'regular_price')::numeric,
        (v_item->>'savings')::numeric,
        COALESCE((v_item->>'created_at')::timestamptz, now())
      );
    END LOOP;
  END IF;

  RETURN v_receipt_id;  -- NULL = already existed; UUID = newly inserted
END;
$$;
```

Grant the same `service_role` and `authenticated` permissions as migrations 006/007.

#### 2. `backend/services/receipt_service.py` — `store_fetched_receipts`

Current implementation catches `Exception` and does brittle string-matching (`'duplicate key' in error_str and 'order_id' in error_str`) to detect duplicates. **Replace** with an explicit NULL-check on the return value from the RPC:

**Updated `store_fetched_receipts` signature** (no change):
```python
def store_fetched_receipts(
    user_id: str,
    provider_name: str,
    receipts: List[Dict],
    supabase_service,
) -> Dict:
    # returns: {"receipt_ids": List[str], "receipts_stored": int,
    #           "skipped_duplicates": int, "errors": List[str]}
```

> **New return key:** add `"skipped_duplicates": int` to the return dict so callers can log it cleanly. Do not add duplicates to the `errors` list.

**Algorithm change:**
```
for each raw_receipt:
    validate required fields (order_id, order_date, items)
    call store_parsed_receipt(...)  →  receipt_id
    if receipt_id is not None:
        result["receipt_ids"].append(receipt_id)
        result["receipts_stored"] += 1
    else:
        result["skipped_duplicates"] += 1
        # no log noise, no error entry
```

**Updated `store_parsed_receipt` signature** (no change to call sites; change only return type annotation):
```python
def store_parsed_receipt(
    user_id: str,
    provider: str,
    receipt_data: Dict,
    supabase_service,
    grocery_account_id: str = None,
    household_id: str = None,
) -> Optional[str]:   # returns None if already exists (idempotent)
```

The function calls `supabase_service.store_receipt_with_items(receipt_record, items)` which delegates to the updated RPC. The RPC returns `None` for a duplicate; propagate that `None` up to `store_fetched_receipts` without raising.

#### 3. `backend/services/supabase_service.py` — `store_receipt_with_items`

Confirm that `supabase_service.store_receipt_with_items` already passes arguments to the Postgres RPC and returns the raw value (UUID or `None`). If the Python wrapper currently raises on a `None` result or converts `None` to a string, fix it to return `None` as-is. **No new method needed** — this is a one-line defensive check in the existing wrapper.

---

### Logic Guardrails (01c.1)

- `store_fetched_receipts` must use explicit `is not None` to check the receipt_id returned from `store_parsed_receipt`. Never rely on falsy (`if not receipt_id`) because a valid UUID is always truthy, but the intent is clearer and future-safe.
- Do not add skipped duplicates to the `errors` list. Duplicates are expected and normal during auto-sync; surfacing them as errors degrades the UX report shown in 01a/01b.
- The `receipt_items` rows must only be inserted when the receipt row is newly created (i.e. `v_receipt_id IS NOT NULL`). Inserting items for a pre-existing receipt would double-count pantry items.
- Receipt validation order in `store_fetched_receipts`: check required fields first, check items is a list second, then call `store_parsed_receipt`. Skip the receipt (add to `errors`) if required fields are missing; this is a genuine error, not a duplicate.
- The migration must be safe to run on a DB that may have duplicate `order_id` values across users (from the old global constraint era). Add a `CONCURRENTLY`-friendly approach: the new unique index should be created `IF NOT EXISTS` and the old constraint dropped only after the new one is verified.
- The Costco gas/car-wash filter in `store_costco_receipts` (providers.py) runs **before** `store_fetched_receipts`. Do not move, reorder, or modify it.
- `store_parsed_receipt` must not swallow non-duplicate exceptions. Only a `None` return from the RPC is the duplicate signal. Any other exception propagates up as before.
- Do not modify `ReceiptProcessor.process_receipt`. The caller (`_store_and_process_fetched_receipts` and `ingest_receipts`) already guards on `if store_result["receipt_ids"]` before invoking it — the new `skipped_duplicates` key does not affect this gate.

---

### Test-First Suite (01c.1)

New file: `tests/services/test_receipt_service.py`

> Scaffold all test function stubs before writing any implementation. Use `pytest` with `unittest.mock.MagicMock` for `supabase_service`. Match existing naming style in `tests/services/`.

- `STORE_FETCHED_SINGLE_NEW_RECEIPT` — one receipt, RPC returns a UUID; `receipts_stored == 1`, `skipped_duplicates == 0`, `receipt_ids` has one entry, `errors` is empty.
- `STORE_FETCHED_DUPLICATE_RETURNS_NONE` — one receipt, RPC (via `store_parsed_receipt`) returns `None`; `receipts_stored == 0`, `skipped_duplicates == 1`, `receipt_ids` is empty, `errors` is empty.
- `STORE_FETCHED_SYNC_TWICE_NO_DUPES` — submit the same list of 3 receipts twice; second call returns `receipts_stored == 0`, `skipped_duplicates == 3`, `errors` empty. Pantry processing mock asserts it is called exactly 3 times total (once per unique receipt, not 6).
- `STORE_FETCHED_AUTO_MANUAL_INTERLEAVE` — submit receipt list [A, B] then [B, C] (B overlaps); combined result across both calls: `receipts_stored == 3` total (A, B, C), no duplicates, no errors.
- `STORE_FETCHED_MISSING_ORDER_ID_GOES_TO_ERRORS` — receipt missing `order_id` key; `errors` has one entry, `receipts_stored == 0`, `skipped_duplicates == 0`.
- `STORE_FETCHED_MISSING_ITEMS_LIST_GOES_TO_ERRORS` — receipt has `items` as a non-list; same error path.
- `STORE_PARSED_RETURNS_NONE_ON_DUPLICATE` — `store_parsed_receipt` called when RPC returns `None`; function returns `None` without raising.
- `STORE_PARSED_PROPAGATES_NON_DUPLICATE_EXCEPTION` — `store_parsed_receipt` when RPC raises a generic `Exception`; exception is re-raised (not swallowed).

---

### Definition of Done (01c.1)

- [ ] `supabase/migrations/023_receipt_dedup_hardening.sql` exists and is runnable; drops global `UNIQUE(order_id)` and adds `UNIQUE(user_id, provider, order_id)`; updates `store_receipt_with_items` RPC to use `ON CONFLICT DO NOTHING`.
- [ ] `backend/services/receipt_service.py` `store_fetched_receipts` returns `skipped_duplicates` count; no duplicate receipts added to `errors`; no brittle string-matching on exception messages.
- [ ] `store_parsed_receipt` returns `Optional[str]`; returns `None` on duplicate (RPC returns `None`); propagates all other exceptions.
- [ ] All 8 pytest cases in `tests/services/test_receipt_service.py` pass.
- [ ] Manual smoke test: submit the same 3 Safeway receipts twice via `/receipts/ingest`; second call returns `receipts_stored: 0`, no errors, no duplicate `receipt_items` rows in DB.
- [ ] Logic Audit: bullet-list each guardrail above and mark each ✓ verified.

---

## Sub-phase 01c.2 — Connection-Health Signal

### Technical Contract

#### Standardized reconnect response shape

All routes in `backend/routes/providers.py` that indicate a provider needs reconnection must return a **single, stable JSON shape**:

```json
{
  "error": "<human-readable message for logging>",
  "needs_reconnect": true,
  "provider": "<provider_name>",
  "reason": "<reason_enum>"
}
```

`reason` enum values (exhaustive — do not add others without updating 01a/01b briefs):
- `"expired_credentials"` — token/cookie has expired; refresh was unavailable or failed.
- `"token_refresh_failed"` — token refresh was attempted but the refresh endpoint rejected it.
- `"bot_detection"` — Costco API returned a 401/403 but the token is still valid (bot-detection or rate-limit).

HTTP status code: always **401** for all three reason values. Do not return 400 or 500 for auth failures.

> **Note:** `expired_credentials: True` (the old field name) is **replaced** by `needs_reconnect: true` + `reason: "expired_credentials"`. Do not emit both. Brief 01a must react to `needs_reconnect === true` (not to `expired_credentials`).

#### New helper function in `backend/routes/providers.py`

```python
def _reconnect_response(provider: str, reason: str, detail: str = "") -> tuple:
    """
    Build the standardized 401 reconnect response.
    reason must be one of: 'expired_credentials', 'token_refresh_failed', 'bot_detection'
    Returns (flask Response, 401).
    """
```

Usage — replace every current 401 response in `providers.py` that signals an auth/credential failure with a call to `_reconnect_response(...)`. Affected call sites (all in `backend/routes/providers.py`):

| Current location | Current shape | New reason |
|---|---|---|
| `connect_costco_from_app` — expired token | `{"error": "Token has expired..."}` (400 today) | `"expired_credentials"` (401) |
| `connect_costco_from_app` — `AuthenticationException` | `{"error": str(e)}` (401) | `"expired_credentials"` |

> **Safeway and Costco sync note:** Both MVP providers use native WebView bridges for receipt sync. Auth failures during sync are detected client-side in the WebView bridge hooks. Backend `/receipts/ingest` and `/store-receipts` do not need reconnect signals. The legacy `fetch_receipts_with_stored_credentials` route was removed; server-side reconnect signals are limited to `connect-from-app` if 01c.2 is implemented.

#### No new `grocery_accounts` column

Do not add a `needs_reconnect` column to `grocery_accounts`. The connection-health signal is a transient response property, not a persisted state. Brief 01a owns the frontend state machine for reconnect prompts.

---

### Logic Guardrails (01c.2)

- `_reconnect_response` must accept only the three enumerated `reason` strings. Raise `ValueError` for an unrecognized reason so the implementing agent catches bad call sites at test time. Do not accept arbitrary strings.
- `needs_reconnect` must always be the boolean `true`, never a string.
- `provider` in the response must be the exact provider name string passed to the function (e.g. `"costco"`, `"safeway"`), not a derived or lowercased version.
- Do not modify the MFA or session management routes. They return 202/400 shapes that are not reconnect signals.
- Do not change the HTTP status of non-auth errors (400 for bad input, 404 for missing account, 500/503 for infrastructure failures). Only auth failures become 401 + `needs_reconnect`.
- `error` field content must never include raw token values, cookie strings, or credential data. The `detail` parameter to `_reconnect_response` is for internal log use only and should **not** be included in the JSON response body.

---

### Test-First Suite (01c.2)

Extend existing file: `tests/backend/test_routes/test_providers.py`

> Add a clearly-marked block with `# --- 01c.2: connection-health signal ---` comment at the top of the new tests.

- `CONNECT_FROM_APP_EXPIRED_TOKEN_RETURNS_NEEDS_RECONNECT` — post expired JWT to `/connect-from-app`; response has `needs_reconnect == True`, `reason == "expired_credentials"`, `provider == "costco"`, HTTP 401.
- `CONNECT_FROM_APP_AUTH_EXCEPTION_RETURNS_NEEDS_RECONNECT` — mock `_decode_jwt_payload` to raise `AuthenticationException`; response has `needs_reconnect == True`, `reason == "expired_credentials"`, HTTP 401.
- `RECONNECT_RESPONSE_HELPER_UNKNOWN_REASON_RAISES` — call `_reconnect_response("safeway", "unknown_reason")` directly; assert `ValueError` is raised.
- `RECONNECT_RESPONSE_HELPER_VALID_SHAPE` — call `_reconnect_response("safeway", "expired_credentials")`; assert returned JSON contains `needs_reconnect == True`, `provider == "safeway"`, `reason == "expired_credentials"`, no `expired_credentials` key (old field absent).
- `EXPIRED_CREDENTIALS_KEY_ABSENT_FROM_ALL_401_PATHS` — parametrize the two connect-from-app 401 scenarios above; assert `response.json["expired_credentials"]` does not exist in any of them.

---

### Definition of Done (01c.2)

- [ ] `_reconnect_response(provider, reason, detail)` helper exists in `backend/routes/providers.py`; raises `ValueError` for unknown reasons.
- [ ] All former `expired_credentials: True` response bodies in `connect-from-app` are replaced by `needs_reconnect: true` + `reason`.
- [ ] `expired_credentials` key is absent from all 401 responses in `providers.py`.
- [ ] All 5 pytest cases in the `test_providers.py` extension pass.
- [ ] `rg '"expired_credentials"' backend/routes/` returns zero matches (old field fully removed).
- [ ] Logic Audit: bullet-list each guardrail above and mark each ✓ verified.

---

## Combined Definition of Done

- [ ] All 01c.1 and 01c.2 checklist items above are satisfied.
- [ ] `pytest tests/services/test_receipt_service.py tests/backend/test_routes/test_providers.py` exits 0.
- [ ] No new linter errors in `receipt_service.py` or `providers.py`.
- [ ] Schema ambiguity resolved: implementing agent has run `\d receipts` in the target DB and confirmed the old constraint name before writing the DROP statement in migration 023.

### Logic Audit template

Upon completion, generate a bullet list comparing each named guardrail above against the actual implementation:

- `store_fetched_receipts uses is not None for receipt_id check` → ✓/✗
- `Duplicates excluded from errors list` → ✓/✗
- `receipt_items only inserted for new receipts` → ✓/✗
- `Migration uses ON CONFLICT DO NOTHING` → ✓/✗
- `Costco gas/carwash filter position unchanged` → ✓/✗
- `Non-duplicate exceptions propagate in store_parsed_receipt` → ✓/✗
- `_reconnect_response raises ValueError for unknown reason` → ✓/✗
- `needs_reconnect is boolean true not string` → ✓/✗
- `Bot-detection path returns 401 not re-raise` → N/A (legacy stored-credential fetch route removed)
- `error field contains no tokens/credentials` → ✓/✗
- `expired_credentials key absent from all 401 responses` → ✓/✗
