# Substitution Read-Only Stub

> **Prerequisite:** Brief `02b` merged (sparse-pantry resilience). The `ingredient_substitutions` table exists and is seeded (`supabase/migrations/003_pantry_data_model.sql`, `scripts/populate_ingredient_substitutions.py`). `supabase_service.py::get_substitutions_for_ingredient` is in production.
>
> **Scope:** Surface the existing substitution data as a read-only "possible swap" hint in two UI surfaces — `RecipeDetailModal.jsx` (ingredient list) and `PantryCheckSheet.jsx` (missed-item list). One new thin GET endpoint; one new service method; additive changes to two components and `apiClient.js`. Split into two sub-phases to stay within the file budget.
>
> **Do NOT touch in this brief:** `ingredient_substitutions` data, `scripts/populate_ingredient_substitutions.py`, any write path, the substitution `confidence`/`ratio` ranking logic (no engine — display only), `MealPlanWizard.jsx`, `MealPlan.jsx`, the `/pantry/check-recipe` route, or any other pantry/recipe service.

---

## Objective

Show "Out of X? You may be able to use Y" hints — read-only, no writes, no preference learning, no ranking beyond the existing `acceptable` flag. Source of truth is the `ingredient_substitutions` table seeded at migration time. The stub must render nothing (gracefully) when no substitution exists; it must never imply confidence the data does not have.

---

## Verified schema

**Table:** `ingredient_substitutions` (migration `003_pantry_data_model.sql`)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `ingredient` | TEXT NOT NULL | Exact canonical name; indexed |
| `substitute` | TEXT NOT NULL | Exact canonical name |
| `substitution_type` | TEXT NOT NULL | CHECK IN (`'variant'`, `'ingredient'`) |
| `ratio` | DECIMAL(3,2) | Default 1.0 — amount multiplier |
| `confidence` | DECIMAL(3,2) | Data quality signal; do not surface as percentage to users |
| `acceptable` | BOOLEAN | Default TRUE; FALSE = non-ideal swap (e.g. salted butter in baking) |
| `notes` | TEXT | Human-readable caveat; display as-is when present |
| `source` | TEXT | Internal provenance; not shown to users |
| `verified` | BOOLEAN | Internal quality flag; not shown to users |
| `created_at` | TIMESTAMP WITH TIME ZONE | |

Unique constraint: `(ingredient, substitute)`. RLS: read-only for all authenticated users; writes managed by service role.

---

## Sub-phase overview and gate order

| Sub-phase | Files changed | Gate before next |
|---|---|---|
| **05.1** — Backend endpoint + `RecipeDetailModal` | `pantry.py`, `pantry_service.py`, `RecipeDetailModal.jsx`, `apiClient.js` + tests | pytest green; vitest green |
| **05.2** — `PantryCheckSheet` hint | `PantryCheckSheet.jsx` + tests | vitest green; visual QA on device |

Implement **05.1 first**. Do not start 05.2 until 05.1's Definition of Done is met.

---

## Phase 05.1 — Backend endpoint + `RecipeDetailModal` substitution hints

### Technical Contract

#### 1. `backend/services/pantry_service.py` — new method `get_acceptable_substitutes`

Add to `PantryService` class (after `check_ingredient_availability`, around line 408):

```python
def get_acceptable_substitutes(
    self, ingredient_name: str
) -> List[Dict]:
    """
    Return acceptable substitutes for a canonical ingredient name.

    Exact match only — no substring or LIKE query.
    Returns only rows where acceptable IS TRUE.

    Args:
        ingredient_name: Canonical ingredient name (exact, case-preserved).

    Returns:
        List of dicts with keys: substitute, substitution_type, ratio, notes, confidence.
        Empty list if no acceptable substitutes exist.
    """
    all_subs = self.supabase.get_substitutions_for_ingredient(ingredient_name)
    return [
        {
            "substitute": s["substitute"],
            "substitution_type": s["substitution_type"],
            "ratio": s.get("ratio"),
            "notes": s.get("notes"),
            "confidence": s.get("confidence"),
        }
        for s in all_subs
        if s.get("acceptable") is True
    ]
```

- Uses the existing `supabase_service.py::get_substitutions_for_ingredient(ingredient_name)` (line 757), which already issues an exact `.eq("ingredient", ingredient_name)` query — no substring matching.
- Post-filters `acceptable is True` (explicit `is True`, not truthy — respects the `is not None` integrity standard from `.cursorrules.md`).
- Returns only the five display-safe fields; does not expose `source`, `verified`, or raw `id`.

#### 2. `backend/routes/pantry.py` — new route `GET /pantry/ingredient-substitutions`

Add immediately after the `/pantry/check-recipe` route (around line 1299). Follow the existing route pattern in this file.

```python
@pantry_bp.route("/pantry/ingredient-substitutions", methods=["GET"])
def get_ingredient_substitutions():
    """
    Get acceptable substitutes for a single ingredient name.

    Query params:
        ingredient (required): Exact canonical ingredient name.

    Returns:
        { "ingredient": str, "substitutes": [...] }
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401

    ingredient = request.args.get("ingredient", "").strip()
    if not ingredient:
        return jsonify({"error": "ingredient query parameter is required"}), 400

    service = get_pantry_service()
    if not service:
        return jsonify({"error": "Pantry service not available"}), 503

    try:
        substitutes = service.get_acceptable_substitutes(ingredient)
        return jsonify({"ingredient": ingredient, "substitutes": substitutes})
    except DatabaseException as e:
        logger.error(f"Database error getting substitutes: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error getting substitutes: {e}")
        return jsonify({"error": str(e)}), 500
```

Response shape:
```json
{
  "ingredient": "butter",
  "substitutes": [
    {
      "substitute": "margarine",
      "substitution_type": "ingredient",
      "ratio": 1.0,
      "notes": "Works well for most baking",
      "confidence": 0.85
    }
  ]
}
```

Empty when no acceptable substitutes: `{ "ingredient": "butter", "substitutes": [] }`.

#### 3. `frontend/src/services/apiClient.js` — add `getIngredientSubstitutions`

Add to the `pantry` (or top-level) section of the exported `api` object. Pre-flight: check the existing `apiClient.js` pantry section for the correct pattern.

```js
getIngredientSubstitutions: async (userId, ingredient) => {
  const response = await apiClient.get('/pantry/ingredient-substitutions', {
    params: { ingredient },
    headers: { 'X-User-Id': userId },
  })
  return response.data  // { ingredient: str, substitutes: [...] }
},
```

#### 4. `frontend/src/components/RecipeDetailModal.jsx` — display substitution hints

`RecipeDetailModal` already receives `recipe`, `pantryData`, `userId`, `isOpen`. Use these to compute and display hints.

**Add internal state:**
```js
const [substitutions, setSubstitutions] = useState({})
// shape: { [ingredient_name_lower]: string | null }
// string = first acceptable substitute name; null = no substitute found; key absent = not yet fetched
```

**Add effect to fetch substitutes for unmatched ingredients:**
```js
useEffect(() => {
  if (!isOpen || !recipe?.extendedIngredients || !userId || !pantryData) return
  setSubstitutions({})

  const unmatchedIngredients = recipe.extendedIngredients.filter(
    (ing) => findPantryVariantForIngredient(pantryData, ing) === null
  )

  unmatchedIngredients.forEach(async (ing) => {
    const name = String(ing.name || '').trim()
    if (!name) return
    try {
      const result = await api.getIngredientSubstitutions(userId, name)
      const first = result.substitutes?.[0]
      setSubstitutions((prev) => ({
        ...prev,
        [name.toLowerCase()]: first ? first.substitute : null,
      }))
    } catch {
      // silent — hints are best-effort
    }
  })
}, [isOpen, recipe, userId, pantryData])
```

**Reset on close:**
```js
useEffect(() => {
  if (!isOpen) setSubstitutions({})
}, [isOpen])
```

**Render hint in ingredient list** — in the `rows.map(...)` block (around line 147), after the ingredient `<span>`, add:

```jsx
{(() => {
  const name = String(ingredient.name || '').trim().toLowerCase()
  const sub = substitutions[name]
  if (!sub || variant) return null  // only show for unmatched ingredients
  return (
    <span className="text-xs text-sage-light ml-1 shrink-0">
      (swap: {sub})
    </span>
  )
})()}
```

- Only shown when `variant` is `null` (ingredient not matched in pantry) AND a substitute exists.
- Shows at most one substitute (first in the list, which is unranked — order is DB insertion order).
- Does not show when pantryData is not available (defensive: `substitutions` map would be empty).
- `confidence`, `ratio`, `notes` are NOT displayed here — too noisy for the stub. Keep it to the substitute name only.

### Logic Guardrails

- **Exact match, no substring**: `get_acceptable_substitutes` delegates to `get_substitutions_for_ingredient` which uses `.eq("ingredient", ingredient_name)` — "rice" will NOT match "rice vinegar". Do not add any fuzzy/LIKE/contains logic.
- **Read-only**: `get_ingredient_substitutions` route uses `GET` only; `get_acceptable_substitutes` issues only a SELECT. No writes anywhere in this brief.
- **Graceful empty**: if `substitutes` is empty, the hint does not render. No "No substitution available" placeholder.
- **acceptable filter is strict**: use `s.get("acceptable") is True` not `s.get("acceptable")` — must be the boolean True, not just truthy.
- **No confidence display**: do not render the `confidence` value to users in any form — the data was not collected with user-facing precision in mind.
- **No preference learning**: this route is read-only; do not accept POST/PATCH or accept/reject signals.
- **Hint only when unmatched**: show substitute hint only when `findPantryVariantForIngredient` returns `null` for that ingredient. Do not show "you could use Y instead of X" when X is already in the pantry.
- **Ingredient name case normalization**: `ingredient_name` is stored in the DB in a canonical form (from `scripts/populate_ingredient_substitutions.py`). Pass the ingredient name as-is from the recipe (`ing.name`); if no match is found, that means the canonical form differs — do not silently lowercase-transform before the DB query (the service receives it as-is).
- **Household scoping not required**: `ingredient_substitutions` is a global reference table (no `user_id` / `household_id`). The route requires auth but does not scope by household.

### Test-First Suite

#### `tests/backend/test_services/test_pantry_substitution.py` (new file)

```python
# pytest; mock supabase_service
```

- `TEST_GET_ACCEPTABLE_SUBSTITUTES_RETURNS_ACCEPTABLE_ONLY` — supabase returns two rows, one with `acceptable=True`, one with `acceptable=False`; method returns only the True one.
- `TEST_GET_ACCEPTABLE_SUBSTITUTES_EXACT_MATCH_ONLY` — verify `get_substitutions_for_ingredient` is called with the exact `ingredient_name` string; assert no transformation applied.
- `TEST_GET_ACCEPTABLE_SUBSTITUTES_EMPTY_WHEN_NONE` — supabase returns empty list; method returns `[]`.
- `TEST_GET_ACCEPTABLE_SUBSTITUTES_EXCLUDES_PRIVATE_FIELDS` — returned dicts contain only `substitute`, `substitution_type`, `ratio`, `notes`, `confidence`; do not contain `source`, `verified`, `id`.
- `TEST_GET_ACCEPTABLE_SUBSTITUTES_ACCEPTABLE_NONE_EXCLUDED` — row with `acceptable=None` (DB null) is excluded (is not True).

#### `tests/backend/test_routes/test_pantry_substitution.py` (new file)

```python
# pytest; Flask test client; mock PantryService
```

- `TEST_ROUTE_REQUIRES_AUTH` — GET `/pantry/ingredient-substitutions?ingredient=butter` without `X-User-Id` header returns 401.
- `TEST_ROUTE_REQUIRES_INGREDIENT_PARAM` — GET `/pantry/ingredient-substitutions` (no param) returns 400 with `error` field.
- `TEST_ROUTE_BLANK_INGREDIENT_RETURNS_400` — GET `/pantry/ingredient-substitutions?ingredient=` (empty string after strip) returns 400.
- `TEST_ROUTE_RETURNS_SUBSTITUTE_LIST` — mock service returns one substitute; response JSON has `ingredient` and `substitutes` keys with correct values.
- `TEST_ROUTE_RETURNS_EMPTY_SUBSTITUTES_GRACEFULLY` — mock service returns `[]`; response is `{"ingredient": "...", "substitutes": []}` with 200.
- `TEST_ROUTE_DATABASE_ERROR_RETURNS_500` — mock service raises `DatabaseException`; route returns 500.

#### `frontend/src/tests/RecipeDetailModal.test.jsx` (new file)

Mock `apiClient` with `getIngredientSubstitutions` and `findPantryVariantForIngredient` indirectly via mock `pantryData`.

- `RECIPE_DETAIL_SUBSTITUTION_HINT_SHOWN_FOR_UNMATCHED` — ingredient not in `pantryData`, API returns one substitute; hint "(swap: margarine)" appears in the ingredient row.
- `RECIPE_DETAIL_NO_HINT_WHEN_MATCHED_IN_PANTRY` — ingredient matched via `pantryData` (variant returned); `getIngredientSubstitutions` is NOT called; no hint rendered.
- `RECIPE_DETAIL_NO_HINT_WHEN_API_RETURNS_EMPTY` — API returns `{ substitutes: [] }`; no hint rendered for that ingredient.
- `RECIPE_DETAIL_NO_HINT_WHEN_NO_PANTRY_DATA` — `pantryData` prop is null/undefined; `getIngredientSubstitutions` not called; no hint rendered.
- `RECIPE_DETAIL_HINT_CLEARED_ON_CLOSE` — open modal, fetch succeeds, hints shown; close modal; re-open with different recipe; old hints are gone before new ones load.
- `RECIPE_DETAIL_API_FAILURE_SILENT` — `getIngredientSubstitutions` rejects; no error displayed; rest of modal renders normally.

### Definition of Done

- [ ] `PantryService.get_acceptable_substitutes(ingredient_name)` exists and filters `acceptable is True`.
- [ ] `GET /pantry/ingredient-substitutions?ingredient=<name>` returns `{"ingredient": ..., "substitutes": [...]}`.
- [ ] Route returns 401 without auth, 400 for missing/blank ingredient param.
- [ ] `api.getIngredientSubstitutions(userId, ingredient)` added to `apiClient.js`.
- [ ] `RecipeDetailModal` shows "(swap: Y)" hint inline for unmatched ingredients where a substitute exists.
- [ ] No hint shown when ingredient is matched in pantry, or when no substitute exists.
- [ ] All new pytest cases pass (`pytest tests/backend/test_services/test_pantry_substitution.py tests/backend/test_routes/test_pantry_substitution.py`).
- [ ] All new vitest cases pass (`npm test` in `frontend/`).
- [ ] No new ESLint errors in touched files.

**Logic Audit items:**
- [ ] `get_acceptable_substitutes` uses `is True` not truthy check.
- [ ] No `.contains()`, `LIKE`, or substring matching anywhere in this brief.
- [ ] `RecipeDetailModal` effect has `[isOpen, recipe, userId, pantryData]` dependency array.
- [ ] `confidence`, `ratio`, `notes` not rendered in the UI hint.
- [ ] Route is GET only; no POST/PATCH handler added.

---

**Gate:** Merge 05.1. Run `pytest` (backend) and `npm test` (frontend) before starting 05.2.

---

## Phase 05.2 — `PantryCheckSheet` substitution hints

### Technical Contract

#### `frontend/src/components/PantryCheckSheet.jsx` — show substitute hint per missed item

`PantryCheckSheet` receives `missedItems` (each has `.name` and `.original`). Currently shows a list of missed ingredients with "I have it" / "Still need it" actions.

**Add internal state:**
```js
const [substitutions, setSubstitutions] = useState({})
// shape: { [ingredient_key]: string | null }
// ingredient_key = String(item.name || item.original || '').trim()
```

**Fetch on open:**
```js
useEffect(() => {
  if (!open || !userId || missed.length === 0) return
  setSubstitutions({})

  missed.forEach(async (item) => {
    const key = String(item.name || item.original || '').trim()
    if (!key) return
    try {
      const result = await api.getIngredientSubstitutions(userId, key)
      const first = result.substitutes?.[0]
      setSubstitutions((prev) => ({
        ...prev,
        [key]: first ? first.substitute : null,
      }))
    } catch {
      // silent
    }
  })
}, [open, userId, missed.length])
```

**Reset on close:**
```js
useEffect(() => {
  if (!open) setSubstitutions({})
}, [open])
```

**Render hint** — in the visible missed-item row (inside the `visible.map(...)` render, around the item name), after the ingredient name text:

```jsx
{(() => {
  const key = String(m.name || m.original || '').trim()
  const sub = substitutions[key]
  if (!sub) return null
  return (
    <span className="text-xs text-sage-light block mt-0.5">
      or: {sub}
    </span>
  )
})()}
```

- Renders on a new line below the ingredient name (not inline) to keep the tap targets clean on mobile.
- `api.getIngredientSubstitutions` is the same method added in 05.1 — no new API method needed.

### Logic Guardrails

- **Max 3 items**: `PantryCheckSheet` is only shown when `missedItems.length <= 3` (controlled by `itemsForPantryCheck` in `frontend/src/utils/pantryCheck.js`) — at most 3 API calls on open, which is acceptable.
- **Effect dependency on `missed.length`**: use `missed.length` (not `missed`) to avoid infinite loops from array referential inequality.
- **Silent failure**: API errors must not surface an error state; hints are best-effort.
- **No "I have the substitute" action**: the hint is read-only display. Do not wire substitute names to the "I have it" / quick-add flow — that is a post-MVP feature.
- **Hint cleared between opens**: the `useEffect` on `!open` resets state so stale substitutions from a previous recipe don't bleed through.
- All guardrails from 05.1 (exact match, no writes, no confidence display) apply equally here.

### Test-First Suite

#### `frontend/src/tests/PantryCheckSheet.test.jsx` (new file)

Mock `apiClient` with `getIngredientSubstitutions`.

- `PANTRY_CHECK_SHEET_SUBSTITUTE_HINT_SHOWN` — item with `name: 'butter'`; mock returns `{ substitutes: [{ substitute: 'margarine', ... }] }`; text "or: margarine" appears in the sheet.
- `PANTRY_CHECK_SHEET_NO_HINT_WHEN_EMPTY_SUBSTITUTES` — mock returns `{ substitutes: [] }`; no "or:" text rendered.
- `PANTRY_CHECK_SHEET_API_FAILURE_SILENT` — `getIngredientSubstitutions` rejects; sheet renders normally; no error message.
- `PANTRY_CHECK_SHEET_HINT_NOT_SHOWN_WHEN_CLOSED` — sheet rendered with `open={false}`; `getIngredientSubstitutions` never called.
- `PANTRY_CHECK_SHEET_HINT_CLEARED_ON_CLOSE_AND_REOPEN` — open sheet, hints appear; close sheet; re-open with different missed items; old hints gone before new ones load.
- `PANTRY_CHECK_SHEET_SUBSTITUTE_HINT_IS_READ_ONLY` — hint text is not clickable/actionable; no button or handler attached to the substitute name.

### Definition of Done

- [ ] `PantryCheckSheet` renders "or: {substitute}" hint below each missed ingredient when a substitute exists.
- [ ] No hint when API returns empty substitutes or fails.
- [ ] `getIngredientSubstitutions` not called when sheet is closed.
- [ ] Substitute hints cleared on close/re-open.
- [ ] All `PantryCheckSheet.test.jsx` cases pass.
- [ ] No new ESLint errors in `PantryCheckSheet.jsx`.
- [ ] Manual smoke test: accept a recipe in the wizard with ≥ 1 missed ingredient; if a substitute exists in the DB, the sheet shows "or: X" below that ingredient.

**Logic Audit items:**
- [ ] Effect dependency is `[open, userId, missed.length]` — not `[open, userId, missed]`.
- [ ] Substitute hint has no `onClick` handler.
- [ ] `setSubstitutions({})` called both on open (reset before fetch) and on close.
- [ ] API call uses the item's `.name` field as the canonical ingredient name (same field used in `check_ingredient_availability`).
