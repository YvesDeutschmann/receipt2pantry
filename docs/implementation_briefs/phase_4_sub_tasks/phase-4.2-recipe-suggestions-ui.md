# Phase 4.2 -- Recipe Suggestion Screen with Tiered Shelves

> **Prerequisite:** Phase 4.1 backend endpoints must be complete. Read `meald-depletion-master.md` for system constraints and `depletion-phase-4-ui.md` Surface 1 for the full spec.
>
> **Scope:** Refactor `frontend/src/pages/Recipes.jsx` from a pool/swipe deck into a tiered suggestion screen. Create new components: `SuggestionRecipeCard`, `SuggestionDetailModal`, `ConfidenceIndicator`, `IngredientCorrection`. Add API client methods. Zero backend changes.

---

## Objective

Replace the current swipe-card pool UI on the `/recipes` route with a vertically-scrolled tiered shelf layout that renders Phase 3's `SuggestionResult`. This is the primary screen of the app.

---

## Technical Contract

### API Client Additions

Add these methods to the `api` object in `frontend/src/services/apiClient.js`:

```javascript
getSuggestions: async (userId, householdId = null) => {
  const params = householdId ? { household_id: householdId } : {}
  const response = await apiClient.get('/suggestions', {
    params,
    headers: { 'X-User-Id': userId },
  })
  return response.data
},

dismissSuggestion: async (userId, recipeId, householdId = null) => {
  const response = await apiClient.post(
    '/suggestions/dismiss',
    { recipe_id: recipeId, household_id: householdId },
    { headers: { 'X-User-Id': userId } }
  )
  return response.data
},

markCooked: async (userId, { recipeId, recipeName, servings, ingredients, householdId }) => {
  const response = await apiClient.post(
    '/pantry/cook',
    {
      recipe_id: recipeId,
      recipe_name: recipeName,
      servings,
      ingredients,
      household_id: householdId,
    },
    { headers: { 'X-User-Id': userId } }
  )
  return response.data
},

correctPantryItem: async (userId, itemId, action) => {
  const response = await apiClient.post(
    `/pantry/items/${itemId}/correction`,
    { action },
    { headers: { 'X-User-Id': userId } }
  )
  return response.data
},
```

### Backend Response Shape (already exists from Phase 3)

`GET /api/suggestions` returns:

```json
{
  "use_soon_shelf": [
    {
      "id": "12345",
      "title": "Spinach Frittata",
      "image": "https://...",
      "tier": "use_soon",
      "score": 2.883,
      "trigger_ingredient": null,
      "ingredient_flags": [
        {
          "ingredient_name": "Chicken breast",
          "confidence": 0.95,
          "is_soft_required": false,
          "is_use_soon": true,
          "status_label": "check_freshness"
        }
      ]
    }
  ],
  "cook_tonight": [...],
  "probably_have": [...],
  "check_first": [...]
}
```

---

### Component: `ConfidenceIndicator.jsx`

**File:** `frontend/src/components/ConfidenceIndicator.jsx`

**Props:**

```javascript
{
  confidence: number,       // 0.0 - 1.0
  isSoftRequired: boolean,  // true for spices/herbs
  isUseSoon: boolean,       // true for put-back items
  size: 'sm' | 'md',       // default 'md'
}
```

**Rendering rules (these come from the master doc and MUST be followed exactly):**

| Condition | Symbol | Color | Label |
|---|---|---|---|
| `isSoftRequired === true` | `~` | sage/muted | "check spice rack" |
| `isUseSoon === true` | clock icon | amber | "check freshness" |
| `confidence >= 0.75` | filled circle `●` | green | "confirmed" |
| `confidence >= 0.50` | half circle `◐` | amber/yellow | "probably have" |
| `confidence >= 0.20` | empty circle `○` | orange | "check your pantry" |
| `confidence < 0.20` | N/A | do not render | null |

Priority order: `isSoftRequired` > `isUseSoon` > confidence bands.

---

### Component: `IngredientCorrection.jsx`

**File:** `frontend/src/components/IngredientCorrection.jsx`

**Props:**

```javascript
{
  itemId: string,          // pantry item UUID (may be null if ingredient not in pantry)
  ingredientName: string,  // display name
  onCorrection: (itemId, action) => Promise<void>,
  onDismiss: () => void,
}
```

**Rendering:** A small inline row (not a modal) showing three tappable options:

```
Olive oil
  [Still have it]    [Used it up]    [Never had it]
```

- One tap fires `onCorrection(itemId, 'still_have_it' | 'used_it_up' | 'never_had_it')`.
- Auto-dismisses after the tap (call `onDismiss`).
- No save button. No confirmation dialog.
- If `itemId` is null (ingredient not in pantry), do not render this component.

---

### Component: `SuggestionRecipeCard.jsx`

**File:** `frontend/src/components/SuggestionRecipeCard.jsx`

**Props:**

```javascript
{
  recipe: {
    id: string,
    title: string,
    image: string | null,
    tier: 'use_soon' | 'cook_tonight' | 'probably_have' | 'check_first',
    score: number,
    trigger_ingredient: string | null,
    ingredient_flags: Array<{
      ingredient_name: string,
      confidence: number,
      is_soft_required: boolean,
      is_use_soon: boolean,
      status_label: string | null,
    }>,
  },
  onCookedIt: (recipe) => void,
  onDismiss: (recipe) => void,
  onExpand: (recipe) => void,
  useSoonItemNames: string[],  // for the shelf header subtitle
}
```

**Tier-specific rendering:**

- **`use_soon`:** Amber/warning border (`border-amber-500/50`). No additional header on the card itself (the shelf header handles the "Recipes using your ..." copy).
  - If any `ingredient_flags` entry has `is_use_soon === true` AND `status_label === 'check_freshness'`, render below the card: "Check before cooking -- this was past its use-by date". This disclaimer applies **only to meat and fish** -- the backend currently does not send `sub_class` on `ingredient_flags`, so check if the `ingredient_name` contains common meat/fish terms (chicken, beef, pork, salmon, fish, shrimp, turkey, lamb) as a heuristic. Alternatively, the Phase 4.1 agent can add `sub_class` to the `ingredient_flags` response -- check the actual response shape at implementation time.
- **`cook_tonight`:** Green left-border or green dot.
- **`probably_have`:** Muted opacity (`opacity-80`), lighter card background.
- **`check_first`:** Warning callout below the title: "Confirm you still have: {recipe.trigger_ingredient}". Only show ONE ingredient name -- the `trigger_ingredient` field.

**"Cooked it" button:** Prominent. Use Tailwind classes: `bg-terra text-cream font-semibold rounded-meald-md py-3 w-full`. Text: "Cooked it".

**Swipe-to-dismiss:** Use `framer-motion` drag on the x-axis. On `onDragEnd`, if `info.offset.x < -100`, call `onDismiss(recipe)`. Reveal a red "Don't have this" panel behind the card during the swipe. Follow the same pattern as the existing `RecipeSwipeCard.jsx`.

**Tap:** Calls `onExpand(recipe)` to open the detail modal.

---

### Component: `SuggestionDetailModal.jsx`

**File:** `frontend/src/components/SuggestionDetailModal.jsx`

**Props:**

```javascript
{
  isOpen: boolean,
  onClose: () => void,
  recipe: object | null,       // same shape as SuggestionRecipeCard.recipe, plus full recipe details
  loading: boolean,
  userId: string,
  onCookedIt: (recipe) => void,
  onIngredientCorrected: () => void,  // callback to refresh suggestions after a correction
}
```

**Layout:**
- Uses `AdaptiveModal` (existing component) as the container.
- Recipe image, title, ready-in-minutes, servings (same as existing `RecipeDetailModal`).
- **Ingredient list** with `ConfidenceIndicator` and `status_label` for each flag:
  ```
  Chicken breast      [ConfidenceIndicator] confirmed
  Spinach             [ConfidenceIndicator] probably have
  Paprika             [ConfidenceIndicator] check spice rack
  ```
- **Tapping an ingredient** expands inline to show `IngredientCorrection`. Only one ingredient correction open at a time.
- **"Cooked it" button** at the bottom, same styling as the card button.
- Instructions section (same as existing `RecipeDetailModal`).

The `recipe` object must be enriched with full details. On expand, call `api.getRecipeDetails(userId, recipe.id)` to get `extendedIngredients`, `instructions`, etc. Merge the Phase 3 `ingredient_flags` with the Spoonacular `extendedIngredients` by matching on `ingredient_name`.

---

### Page Refactor: `Recipes.jsx`

**File:** `frontend/src/pages/Recipes.jsx`

**Remove entirely:**
- `deck` state and all pool-related code (`loadPoolFromApi`, `checkDepthAndRefill`, `maybeTriggerRegeneration`, `flattenPool`, `rowToCardRecipe`, `needsRefill`)
- `RecipeSwipeCard` import (the old swipe component)
- All `#region agent log` debug instrumentation blocks
- Meal slot checkboxes and `mealSlots` state (keep `householdId` for API calls)

**Add:**

```javascript
const [suggestions, setSuggestions] = useState({
  use_soon_shelf: [],
  cook_tonight: [],
  probably_have: [],
  check_first: [],
})
const [loading, setLoading] = useState(true)
const [healthCardData, setHealthCardData] = useState(null)
const [cookedConfirmation, setCookedConfirmation] = useState(null)
```

**Data flow:**
1. On mount (and after `householdId` resolves), call `api.getSuggestions(userId, householdId)`. Set result into `suggestions`.
2. Render shelves top-to-bottom: `use_soon_shelf`, `cook_tonight`, `probably_have`, `check_first`.
3. **Never render an empty shelf.** Conditionally render each section only if its array is non-empty.

**Shelf headers:**

| Shelf | Header text | Subtitle logic |
|---|---|---|
| `use_soon_shelf` | "Use before it's gone" | If <= 2 use_soon item names: "Recipes using your {name1} and {name2}". If 3+: "Recipes using what needs using up". Extract names from `ingredient_flags` where `is_use_soon === true`. |
| `cook_tonight` | "Cook tonight" | None |
| `probably_have` | "Probably have everything" | None |
| `check_first` | "Quick check needed" | None |

**"Cooked it" handler:**

```javascript
const handleCookedIt = async (recipe) => {
  try {
    await api.markCooked(userId, {
      recipeId: recipe.id,
      recipeName: recipe.title,
      servings: recipe.servings || 4,
      ingredients: (recipe.ingredient_flags || []).map(f => ({
        name: f.ingredient_name,
        amount: 1,
        unit: 'serving',
      })),
      householdId,
    })
    setCookedConfirmation('Nice! Pantry updated.')
    setTimeout(() => setCookedConfirmation(null), 2500)
    // Re-fetch suggestions
    const updated = await api.getSuggestions(userId, householdId)
    setSuggestions(updated)
    // Check health card (Phase 4.3 will consume this)
  } catch (err) {
    setError(err.response?.data?.error || 'Failed to record cook event.')
  }
}
```

**Dismiss handler:**

```javascript
const handleDismiss = async (recipe) => {
  // Optimistic removal
  setSuggestions(prev => {
    const next = { ...prev }
    for (const key of Object.keys(next)) {
      next[key] = next[key].filter(r => r.id !== recipe.id)
    }
    return next
  })
  try {
    await api.dismissSuggestion(userId, recipe.id, householdId)
  } catch (err) {
    console.error('dismiss failed', err)
  }
}
```

**Pull-to-refresh:** Keep `PullToRefresh` wrapper. On refresh, re-fetch suggestions.

---

## Constraint Checklist

From `meald-depletion-master.md` and `depletion-phase-4-ui.md`:

- [ ] Shelf order is exactly: use_soon -> cook_tonight -> probably_have -> check_first (top to bottom).
- [ ] Empty shelves are never rendered (no header, no section, nothing).
- [ ] Use soon shelf header uses actual item names for <= 2 items; truncated copy for 3+.
- [ ] Meat/fish put-back disclaimer ("Check before cooking...") only appears on use_soon cards where the flagged ingredient is meat or fish, NOT on all cards.
- [ ] Quick Check Needed cards show only ONE uncertain ingredient (the `trigger_ingredient`), not all.
- [ ] "Cooked it" is the most prominent button -- visually satisfying, full-width.
- [ ] Swipe left to dismiss reveals "Don't have this" -- one action, no confirmation, no question about which ingredient.
- [ ] Ingredient correction is three options, one tap, auto-dismiss, no save button.
- [ ] Spices (`is_soft_required`) always show "check spice rack" regardless of confidence value.
- [ ] Confidence indicator priority: soft_required > use_soon > confidence bands.
- [ ] Perishables display as presence state ("Fresh / Use Soon / Likely Gone"), never as quantities.
- [ ] Recipe card expand shows full ingredient list with inline status indicators.

---

## Validation Suite

Tests go in `frontend/src/tests/SuggestionScreen.test.jsx`. Use React Testing Library + Vitest (project uses Vitest via Vite).

### Test: SHELF_ORDER_RENDERS_CORRECTLY
```
Setup:  Mock api.getSuggestions to return 1 recipe in each tier
Expect: use_soon shelf header appears before cook_tonight header,
        cook_tonight before probably_have, probably_have before check_first
```

### Test: EMPTY_SHELF_NOT_RENDERED
```
Setup:  Mock response with use_soon_shelf=[], cook_tonight=[1 recipe], probably_have=[], check_first=[]
Expect: Only "Cook tonight" header rendered. No "Use before it's gone" or other headers present in DOM.
```

### Test: USE_SOON_HEADER_TWO_ITEMS
```
Setup:  use_soon_shelf has 2 recipes, both with ingredient_flags containing is_use_soon items "spinach" and "chicken"
Expect: Header text includes "spinach and chicken"
```

### Test: USE_SOON_HEADER_THREE_PLUS_ITEMS
```
Setup:  use_soon_shelf recipes reference 3+ use_soon ingredient names
Expect: Header text is "Recipes using what needs using up"
```

### Test: CHECK_FIRST_SHOWS_TRIGGER_INGREDIENT
```
Setup:  check_first recipe with trigger_ingredient="olive oil"
Expect: Card renders text "Confirm you still have: olive oil"
```

### Test: COOKED_IT_CALLS_API_AND_REFRESHES
```
Setup:  Render page, click "Cooked it" on a recipe
Mock:   api.markCooked resolves, api.getSuggestions returns updated data
Expect: markCooked called with correct recipe_id
        Confirmation message "Nice! Pantry updated." briefly appears
        getSuggestions called again after markCooked
```

### Test: DISMISS_REMOVES_CARD_OPTIMISTICALLY
```
Setup:  cook_tonight has 2 recipes
Action: Trigger dismiss on the first recipe
Expect: First recipe removed from DOM immediately
        api.dismissSuggestion called with correct recipe_id
```

### Test: CONFIDENCE_INDICATOR_SPICE
```
Setup:  Render ConfidenceIndicator with isSoftRequired=true, confidence=0.40
Expect: Renders "~" symbol and "check spice rack" text
```

### Test: CONFIDENCE_INDICATOR_CONFIRMED
```
Setup:  Render ConfidenceIndicator with confidence=0.80, isSoftRequired=false, isUseSoon=false
Expect: Renders filled circle and "confirmed" text
```

### Test: CONFIDENCE_INDICATOR_PROBABLY_HAVE
```
Setup:  Render ConfidenceIndicator with confidence=0.55
Expect: Renders half circle and "probably have" text
```

### Test: CONFIDENCE_INDICATOR_CHECK_PANTRY
```
Setup:  Render ConfidenceIndicator with confidence=0.30
Expect: Renders empty circle and "check your pantry" text
```

### Test: INGREDIENT_CORRECTION_THREE_OPTIONS
```
Setup:  Render IngredientCorrection with valid itemId
Expect: Three buttons rendered: "Still have it", "Used it up", "Never had it"
```

### Test: INGREDIENT_CORRECTION_AUTO_DISMISS
```
Setup:  Render IngredientCorrection, click "Still have it"
Expect: onCorrection called with (itemId, 'still_have_it')
        Component dismissed (onDismiss called)
```

### Test: INGREDIENT_CORRECTION_NULL_ITEM_ID
```
Setup:  Render IngredientCorrection with itemId=null
Expect: Component renders nothing (null return)
```

### Test: MEAT_DISCLAIMER_ON_USE_SOON_CARD
```
Setup:  use_soon recipe with ingredient_flag { is_use_soon: true, ingredient_name: "chicken breast" }
Expect: Disclaimer text "Check before cooking" visible on card
```

### Test: NO_DISCLAIMER_ON_VEGGIE_USE_SOON
```
Setup:  use_soon recipe with ingredient_flag { is_use_soon: true, ingredient_name: "spinach" }
Expect: No disclaimer text rendered
```

---

## Files to Create

| File | Description |
|---|---|
| `frontend/src/components/ConfidenceIndicator.jsx` | Status dot/symbol with label |
| `frontend/src/components/IngredientCorrection.jsx` | 3-way inline correction |
| `frontend/src/components/SuggestionRecipeCard.jsx` | Tiered recipe card |
| `frontend/src/components/SuggestionDetailModal.jsx` | Expanded recipe view with ingredient status |
| `frontend/src/tests/SuggestionScreen.test.jsx` | Test file for validation suite |

## Files to Modify

| File | Changes |
|---|---|
| `frontend/src/services/apiClient.js` | Add `getSuggestions`, `dismissSuggestion`, `markCooked`, `correctPantryItem` |
| `frontend/src/pages/Recipes.jsx` | Full rewrite: pool swipe deck -> tiered shelves |

---

## Definition of Done

- [ ] `Recipes.jsx` renders four tiered shelves from `GET /api/suggestions` data
- [ ] Empty shelves produce zero DOM nodes (no header, no container)
- [ ] Use soon shelf shows item names in header and renders amber-bordered cards
- [ ] Meat/fish disclaimer only appears on use_soon cards with meat/fish ingredients
- [ ] Cook Tonight cards have green indicator, no qualifiers
- [ ] Probably Have cards are visually muted
- [ ] Check First cards show exactly one trigger ingredient callout
- [ ] "Cooked it" button calls `POST /api/pantry/cook` and refreshes suggestions
- [ ] Brief confirmation message appears after cooking
- [ ] Swipe-left dismiss calls `POST /api/suggestions/dismiss` and removes card
- [ ] Recipe expand shows ingredient list with `ConfidenceIndicator` and status labels
- [ ] Ingredient tap opens inline 3-way correction; auto-dismisses on selection
- [ ] `ConfidenceIndicator` follows the exact priority and symbol mapping from the spec
- [ ] All 16 tests in validation suite pass
- [ ] No existing tests broken
- [ ] No new linter errors
- [ ] Old pool/swipe code and debug instrumentation removed from `Recipes.jsx`
