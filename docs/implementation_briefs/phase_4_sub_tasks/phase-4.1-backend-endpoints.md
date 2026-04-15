# Phase 4.1 -- Backend Endpoints for Depletion UI

> **Prerequisite:** Phases 1, 2, and 3 are complete. Read `meald-depletion-master.md` for system constraints.
>
> **Scope:** Six new Flask route handlers in `backend/routes/pantry.py` + one enhancement to the existing `GET /api/pantry` response. Zero frontend changes.

---

## Objective

Wire Phase 2's `confidence_engine` functions (`process_cook_event`, `process_put_back`, `run_expiry_cleanup`) and Phase 3's `suggestion_service` to HTTP endpoints that the Phase 4 UI will consume. Add a confidence-enriched pantry response so the frontend can group items by freshness state.

---

## Technical Contract

All routes belong to the existing `pantry_bp` blueprint in `backend/routes/pantry.py`. Follow the established pattern: `get_user_id_from_request()` for auth, `current_app.config.get("...")` for service lookup, and `jsonify` responses.

Access the Supabase client via `get_supabase_service()` (returns `SupabaseService` instance). Its `.admin_client` is what `confidence_engine` functions expect as the `client` argument.

### Endpoint 1: POST `/api/pantry/cook`

Marks a recipe as cooked. This is the highest-value user action in the app.

**Request body:**

```json
{
  "recipe_id": "12345",
  "recipe_name": "Spinach Frittata",
  "servings": 4,
  "ingredients": [
    { "name": "chicken breast", "amount": 1, "unit": "lb" },
    { "name": "spinach", "amount": 2, "unit": "cups" }
  ],
  "household_id": "uuid or null"
}
```

**Validation:**
- `recipe_id` required (string)
- `servings` required (int, >= 1)
- `ingredients` required (non-empty list; each item must have `name`)

**Implementation:**

```python
from backend.services.confidence_engine import process_cook_event
from datetime import date

# Inside the route handler:
supabase = get_supabase_service()
process_cook_event(
    supabase,
    user_id,
    str(body["recipe_id"]),
    int(body["servings"]),
    body["ingredients"],  # list of dicts with name, amount, unit
    today=date.today(),
    recipe_name=body.get("recipe_name", ""),
    household_id=body.get("household_id"),
)
```

**Response:** `{ "ok": true }` (200)

**Error responses:**
- 401: missing user ID
- 400: missing required fields
- 503: supabase service unavailable
- 500: unexpected error

---

### Endpoint 2: GET `/api/pantry/graveyard`

Returns recently soft-deleted pantry items (7-day window) for the graveyard section.

**Query params:** `household_id` (optional)

**Implementation:** Query `depletion_history` joined with `item_classification` to get `sub_class`. Filter: `deleted_at` within last 7 days. Use the Supabase admin client directly.

```python
from datetime import date, timedelta

cutoff = (date.today() - timedelta(days=7)).isoformat()
rows = (
    supabase.admin_client
    .table("depletion_history")
    .select("id, pantry_item_id, item_name, deleted_at, reason, put_back_count")
    .eq("user_id", user_id)
    .gte("deleted_at", cutoff)
    .order("deleted_at", desc=True)
    .execute()
)
```

For each row, look up `sub_class` from `item_classification` by `item_name`. (Batch-fetch classifications for all returned `item_name` values using `supabase.get_item_classifications_by_names(names)`.)

**Response shape:**

```json
{
  "items": [
    {
      "depletion_history_id": "uuid",
      "pantry_item_id": "uuid",
      "base_ingredient": "spinach",
      "deleted_at": "2026-04-14T00:00:00+00:00",
      "reason": "AUTO_EXPIRED",
      "put_back_count": 0,
      "sub_class": "leafy_green"
    }
  ]
}
```

---

### Endpoint 3: POST `/api/pantry/put-back`

Resurrects a graveyard item. Calls `process_put_back` from `confidence_engine.py`.

**Request body:** `{ "depletion_history_id": "uuid" }`

**Implementation:**

```python
from backend.services.confidence_engine import process_put_back

item, error_code = process_put_back(
    supabase,
    user_id,
    body["depletion_history_id"],
    today=date.today(),
)
if error_code == "MAX_PUT_BACK_REACHED":
    return jsonify({"error": "MAX_PUT_BACK_REACHED"}), 409
if error_code:
    return jsonify({"error": error_code}), 400
```

**Success response:** `{ "ok": true, "item": { ...pantry row dict } }` (200)

**Error responses:**
- 409: `MAX_PUT_BACK_REACHED` (raw meat/fish already put back once)
- 400: `NOT_FOUND`, `PANTRY_ITEM_MISSING`

---

### Endpoint 4: GET `/api/pantry/health-card`

Returns low-confidence pantry items for the weekly health card nudge.

**Query params:** `household_id` (optional)

**Implementation:**

1. Load `user_preferences` for the user via `supabase.get_user_preferences(user_id)`. Check `last_health_card_shown`. If it is a date within the last 7 days, return `{ "show": false, "items": [] }`.
2. Load all active (non-deleted) pantry items.
3. Compute confidence for each item using `compute_confidence` from `confidence_engine`.
4. Filter to items where `0.20 <= confidence <= 0.60`.
5. Sort ascending by confidence.
6. Limit to 5.

```python
from backend.services.confidence_engine import (
    compute_confidence,
    get_calibrated_days_supply,
    get_engagement_multiplier,
)
```

**Response:**

```json
{
  "show": true,
  "items": [
    {
      "item_id": "uuid",
      "base_ingredient": "olive oil",
      "normalized_name": "Extra Virgin Olive Oil",
      "confidence": 0.35,
      "depletion_class": "CONSUMABLE"
    }
  ]
}
```

---

### Endpoint 5: POST `/api/pantry/items/<item_id>/correction`

The 3-way inline correction: "Still have it", "Used it up", "Never had it".

**Request body:** `{ "action": "still_have_it" | "used_it_up" | "never_had_it" }`

**Validation:** `action` must be one of the three literal strings.

**Implementation by action:**

**`still_have_it`:**
```python
from datetime import date, timedelta

supabase.admin_client.table("pantry_items").update({
    "confidence_override": 0.80,
    "confidence_override_expires": (date.today() + timedelta(days=14)).isoformat(),
}).eq("id", item_id).eq("user_id", user_id).execute()
```

Note: Must also verify the item belongs to the user (or the user's household). Use the same ownership check as `deplete_pantry_item` in `pantry_service.py` -- load the item first and call `_user_can_access_pantry_item`.

**`used_it_up`:**
Use the atomic soft-delete RPC. The function `soft_delete_pantry_item` already exists in migration 018. Call it via `confidence_engine._rpc_soft_delete_pantry_item` or replicate the same pattern:

```python
# Load item first for metadata
item = supabase.admin_client.table("pantry_items").select("*").eq("id", item_id).limit(1).execute()
# Soft delete with reason USER_REMOVED
```

**`never_had_it`:**
Same as `used_it_up` but with `reason='NEVER_HAD'`. Soft-delete the pantry item and write to `depletion_history` with `reason='NEVER_HAD'`.

**Response:** `{ "ok": true }` (200)

**Error responses:**
- 400: invalid action value or missing action
- 404: item not found or not accessible by user

---

### Endpoint 6: POST `/api/pantry/health-card/dismiss`

Records that the health card was shown, enforcing the 7-day cooldown.

**Implementation:**

```python
supabase.admin_client.table("user_preferences").upsert({
    "user_id": user_id,
    "last_health_card_shown": date.today().isoformat(),
}, on_conflict="user_id").execute()
```

**Response:** `{ "ok": true }` (200)

---

### Enhancement 7: Enrich `GET /api/pantry` with confidence

Modify the existing `GET /api/pantry` route handler in `pantry.py` (or `get_pantry_summary` in `pantry_service.py`) to compute and attach `confidence` and `depletion_class` to each pantry item in the response.

**After** calling `run_async(service.get_pantry_summary(user_id, household_id))`, iterate over `summary["items"]` and compute confidence for each:

```python
from backend.services.confidence_engine import (
    compute_confidence,
    get_calibrated_days_supply,
    get_engagement_multiplier,
)

client = supabase.admin_client or supabase.client
engagement = get_engagement_multiplier(client, user_id)
prefs_row = supabase.get_user_preferences(user_id)
user_prefs = {"depletion_multiplier": float((prefs_row or {}).get("depletion_multiplier") or 1.0)}

bases = list({(it.get("base_ingredient") or "").strip().lower() for it in summary["items"]})
classifications = supabase.get_item_classifications_by_names(bases)

for item in summary["items"]:
    base = (item.get("base_ingredient") or "").strip().lower()
    cls = classifications.get(base, {})
    default_days = cls.get("default_days_supply") or 45
    cal = get_calibrated_days_supply(client, user_id, base, int(default_days))
    item["confidence"] = compute_confidence(
        item, user_prefs, cls,
        today=date.today(),
        calibrated_days=cal,
        engagement_multiplier=engagement,
    )
    item["depletion_class"] = item.get("depletion_class") or cls.get("depletion_class") or "STAPLE"
```

Also propagate confidence into the `grouped[base]["variants"]` array since items are references.

---

## Constraint Checklist

These constraints come from `meald-depletion-master.md` and must be enforced in the backend:

- [ ] `process_cook_event`: UNIT_ITEM quantities clamp to 0 (never negative). PERISHABLE/CONSUMABLE only get a cook association, no quantity decrement.
- [ ] `process_cook_event`: Clears `use_soon` flag on primary ingredients that match.
- [ ] `process_put_back`: Raw meat (`raw_meat`) and raw fish (`raw_fish`) may only be put back once. If `put_back_count >= 1`, return `MAX_PUT_BACK_REACHED`.
- [ ] `process_put_back`: Sets `confidence_override = 0.85`, `use_soon = true`, `use_soon_expires = today + 2`, `hard_expire_date = today + 2`. No grace buffer on resurrection.
- [ ] Graveyard: Only returns items with `deleted_at` within the last 7 days.
- [ ] Health card: Only surfaces items with `0.20 <= confidence <= 0.60`. Maximum 5 items. 7-day cooldown enforced.
- [ ] `still_have_it` correction: Sets `confidence_override = 0.80`, expires in 14 days.
- [ ] `used_it_up` correction: Soft-deletes and creates a `depletion_history` entry with `reason = 'USER_REMOVED'`.
- [ ] Consumables are never auto-deleted (only through user correction).
- [ ] Confidence is computed at query time, never persisted (except user-initiated `confidence_override`).
- [ ] The `GET /api/pantry` response includes `confidence` (float) and `depletion_class` (string) on every item.

---

## Validation Suite

All tests go in `tests/backend/test_routes/test_pantry_phase4.py`. Use the existing `conftest.py` patterns for Flask test client. Use `TEST_DATE = date(2026, 4, 10)` for deterministic time-based tests. Mock Supabase calls.

### Test: COOK_ENDPOINT_HAPPY_PATH
```
Setup:  POST /api/pantry/cook with valid recipe_id, servings=4, ingredients list
Mock:   process_cook_event called with correct args
Expect: 200, { "ok": true }
```

### Test: COOK_ENDPOINT_MISSING_RECIPE_ID
```
Setup:  POST /api/pantry/cook with no recipe_id
Expect: 400 with error message
```

### Test: COOK_ENDPOINT_MISSING_SERVINGS
```
Setup:  POST /api/pantry/cook with no servings
Expect: 400 with error message
```

### Test: COOK_ENDPOINT_EMPTY_INGREDIENTS
```
Setup:  POST /api/pantry/cook with ingredients=[]
Expect: 400 with error message
```

### Test: GRAVEYARD_RETURNS_RECENT_ITEMS
```
Setup:  depletion_history has items deleted today, 3 days ago, 8 days ago
Expect: Response includes first two, excludes the 8-day-old item
```

### Test: GRAVEYARD_INCLUDES_SUB_CLASS
```
Setup:  depletion_history item with item_name matching item_classification with sub_class='raw_meat'
Expect: Response item has sub_class='raw_meat'
```

### Test: GRAVEYARD_EMPTY_RETURNS_EMPTY_LIST
```
Setup:  No depletion_history rows for user
Expect: { "items": [] }
```

### Test: PUT_BACK_HAPPY_PATH
```
Setup:  depletion_history row for spinach with put_back_count=0
Mock:   process_put_back returns (pantry_row, None)
Expect: 200, { "ok": true, "item": { ... } }
```

### Test: PUT_BACK_RAW_MEAT_BLOCKED
```
Setup:  depletion_history for chicken breast, put_back_count=1, sub_class=raw_meat
Mock:   process_put_back returns (None, "MAX_PUT_BACK_REACHED")
Expect: 409, { "error": "MAX_PUT_BACK_REACHED" }
```

### Test: PUT_BACK_NOT_FOUND
```
Setup:  Invalid depletion_history_id
Mock:   process_put_back returns (None, "NOT_FOUND")
Expect: 400, { "error": "NOT_FOUND" }
```

### Test: HEALTH_CARD_SHOWS_LOW_CONFIDENCE_ITEMS
```
Setup:  Pantry with items at confidence 0.25, 0.40, 0.55, 0.80
        last_health_card_shown = 8 days ago
Expect: show=true, items contains the three items between 0.20-0.60, sorted ascending
```

### Test: HEALTH_CARD_RESPECTS_COOLDOWN
```
Setup:  last_health_card_shown = 3 days ago
Expect: { "show": false, "items": [] }
```

### Test: HEALTH_CARD_MAX_FIVE_ITEMS
```
Setup:  10 pantry items all in 0.20-0.60 range
Expect: items list length <= 5
```

### Test: CORRECTION_STILL_HAVE_IT
```
Setup:  POST /api/pantry/items/{id}/correction with action=still_have_it
Expect: pantry_items row updated with confidence_override=0.80, confidence_override_expires=today+14
```

### Test: CORRECTION_USED_IT_UP
```
Setup:  POST /api/pantry/items/{id}/correction with action=used_it_up
Expect: pantry_items row soft-deleted, depletion_history entry with reason=USER_REMOVED
```

### Test: CORRECTION_NEVER_HAD_IT
```
Setup:  POST /api/pantry/items/{id}/correction with action=never_had_it
Expect: pantry_items row soft-deleted, depletion_history entry with reason=NEVER_HAD
```

### Test: CORRECTION_INVALID_ACTION
```
Setup:  POST with action="foo"
Expect: 400
```

### Test: HEALTH_CARD_DISMISS
```
Setup:  POST /api/pantry/health-card/dismiss
Expect: user_preferences.last_health_card_shown = today
```

### Test: PANTRY_RESPONSE_INCLUDES_CONFIDENCE
```
Setup:  GET /api/pantry, pantry has items with various depletion classes
Expect: Each item in response has "confidence" (float) and "depletion_class" (string)
```

---

## Definition of Done

- [ ] All 6 new endpoints return correct status codes and response shapes
- [ ] `POST /api/pantry/cook` calls `process_cook_event` with the exact signature from `confidence_engine.py`
- [ ] `POST /api/pantry/put-back` correctly returns 409 for raw meat/fish at `put_back_count >= 1`
- [ ] `GET /api/pantry/graveyard` only returns items within 7-day window and includes `sub_class`
- [ ] `GET /api/pantry/health-card` enforces 7-day cooldown and 5-item cap
- [ ] `POST /api/pantry/items/<id>/correction` handles all three actions correctly
- [ ] `GET /api/pantry` response includes `confidence` and `depletion_class` on every item
- [ ] All 19 tests in validation suite pass
- [ ] No existing tests broken
- [ ] No new linter errors introduced
