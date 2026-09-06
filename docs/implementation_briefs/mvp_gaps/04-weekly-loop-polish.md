# Weekly Loop Polish

> **Prerequisite:** Briefs `02a` and `02b` merged (suggestion cost + sparse-pantry resilience). The meal-plan wizard, shopping-list service, and leftover-marking endpoints are all in production and tested.
>
> **Scope:** Three focused UX improvements to the existing weekly loop — split across two sub-phases to stay within the 1-Brief-1-Build file budget. No new backend services; no new database tables.
>
> **Do NOT touch in this brief:** `backend/services/meal_plan_service.py` wizard logic, `backend/services/shopping_list_service.py` generation algorithm, the `/meal-plan/wizard/<session_id>/mark-leftover` endpoint (that creates a new leftover-date entry — separate concern from the calendar toggle below), any provider, sync, or suggestion files.

---

## Objective

Tighten the weekly loop so a user can plan a week, generate a shopping list, mark items purchased, and manually flag leftovers — with the minimum number of taps. This is polish on existing code, not new systems. Every API endpoint shape is preserved as-is; the two smallest targeted additions are called out explicitly below.

---

## Sub-phase overview and gate order

| Sub-phase | Files changed | Gate before next |
|---|---|---|
| **04.1** — Wizard trim + leftover toggle | `MealPlanWizard.jsx`, `MealPlan.jsx` + tests | vitest suite green; no wizard regressions |
| **04.2** — Shopping list display polish | `ShoppingList.jsx` + tests | vitest suite green; visual QA on device/emulator |

Implement **04.1 first**. Do not start 04.2 until 04.1's Definition of Done is met.

---

## Phase 04.1 — Wizard trim + leftover toggle in calendar

### Technical Contract

#### 1. `frontend/src/components/MealPlanWizard.jsx` — eliminate the review step in the normal happy path

Current behavior: accepting the last meal slot calls `setStep('review')`, landing the user on a summary screen requiring one more "Complete & Generate Shopping List" tap.

**Change:** In `handleAcceptRecipe`, replace the terminal branch:

```js
// BEFORE (line ~182)
} else {
  // All slots filled, go to review
  setStep('review')
}

// AFTER
} else {
  // All slots filled — auto-complete immediately; no review screen needed
  await handleComplete()
}
```

- `handleComplete` is already defined and calls `api.mealPlan.completeWizard(sessionId)`, then `onComplete(result)` and `onClose()`.
- The `review` step JSX block (the `{step === 'review' && ...}` branch, lines ~597–628) becomes unreachable in the normal flow. **Remove it** to avoid dead code — the "Complete & Generate Shopping List" label disappears with it; the "Back" button in review had no unique value.
- The `handleCompletePartial` path (triggered from the no-recipes empty state) already calls `completeWizard` directly and is **not affected**.
- No new state variables; no new API calls.

#### 2. `frontend/src/pages/MealPlan.jsx` — leftover toggle in calendar hover menu

Currently the hover menu over a meal cell contains only a "Delete" button (`handleDeleteMeal`). Add a second button: **"Leftover"** (shows "✓ Leftover" when `meal.is_leftover` is truthy).

New handler to add:

```js
const handleToggleLeftover = async (meal) => {
  try {
    await api.mealPlan.updateMeal(meal.id, { is_leftover: !meal.is_leftover })
    loadMealPlan()
  } catch (err) {
    alert(err.response?.data?.error || 'Failed to update meal')
  }
}
```

In the hover actions `<div>` (currently wraps the single "Delete" button), add **before** the Delete button:

```jsx
<button
  className="px-3 py-1 bg-forest-mid text-cream text-sm rounded-meald-sm hover:bg-forest-light"
  onClick={(e) => {
    e.stopPropagation()
    handleToggleLeftover(meal)
  }}
>
  {meal.is_leftover ? '✓ Leftover' : 'Leftover'}
</button>
```

- `api.mealPlan.updateMeal(mealId, updates)` already exists in `frontend/src/services/apiClient.js` (line 813) — wraps `PATCH /meal-plan/<meal_id>`.
- The `PATCH /meal-plan/<meal_id>` route in `backend/routes/meal_plan.py` (line 387) accepts `{ is_leftover: bool }` — no backend change needed.
- Treat `meal.is_leftover === undefined` as `false` (the `!` operator handles this correctly).
- The toggle does NOT call `POST /meal-plan/wizard/<session_id>/mark-leftover` — that endpoint creates a new future-dated leftover entry and is wizard-only.

### Logic Guardrails

- The wizard must not re-enter `step === 'review'` via `handleAcceptRecipe`; the only permitted entry into review (if any code still references it) is `handleCompletePartial`. Since `handleCompletePartial` also calls `completeWizard` directly, the `review` step is safe to remove entirely.
- `handleComplete` is called with `await` inside `handleAcceptRecipe` — preserve the `setLoading(true)` / `finally { setLoading(false) }` lifecycle. Do not let the accept handler return before the complete call resolves.
- Leftover toggle: `loadMealPlan()` must be called on success (not on failure) to refresh the calendar state.
- Household scoping: `loadMealPlan` uses `householdId` from component state — no change required; the PATCH route resolves the meal directly by `meal_id` (no household filter at route level).
- Dates are deterministic: `startDate` in the wizard defaults to next Monday via `startOfWeek(addDays(today, 7), { weekStartsOn: 1 })` — do not alter this logic.
- Do not regress any existing `MealPlanWizard.test.jsx` test cases.

### Test-First Suite

All tests live in `frontend/src/tests/`. Scaffold these cases before implementation.

#### `MealPlanWizard.test.jsx` (extend existing file)

- `WIZARD_AUTO_COMPLETES_ON_LAST_SLOT_ACCEPT` — given exactly 1 dinner slot in `mealSlotsList`, when `acceptRecipe` mock resolves successfully, assert `completeWizard` mock is called exactly once and `onComplete`/`onClose` callbacks are fired; `screen.queryByText('Meal Plan Summary')` returns null.
- `WIZARD_REVIEW_STEP_NOT_VISIBLE_AFTER_LAST_ACCEPT` — after accepting the final recipe, the text "Complete & Generate Shopping List" is not present in the DOM.
- `WIZARD_PARTIAL_COMPLETE_STILL_WORKS` — render with a slot that returns no recipes (empty state); click "Complete with current selections"; assert `completeWizard` called once, modal closes.
- `WIZARD_HANDLES_COMPLETE_ERROR_ON_LAST_SLOT` — `completeWizard` mock rejects; assert an error message is displayed and the modal is still open.

#### `MealPlan.test.jsx` (new file; mock `apiClient` and `date-fns`)

- `MEAL_PLAN_LEFTOVER_BUTTON_VISIBLE_ON_HOVER` — render with a meal entry; simulate hover; assert a button with text "Leftover" appears in the DOM.
- `MEAL_PLAN_TOGGLE_LEFTOVER_CALLS_UPDATE_MEAL_WITH_TRUE` — meal has `is_leftover: false`; click "Leftover"; assert `api.mealPlan.updateMeal` called with `(meal.id, { is_leftover: true })`.
- `MEAL_PLAN_TOGGLE_LEFTOVER_CALLS_UPDATE_MEAL_WITH_FALSE` — meal has `is_leftover: true`; click "✓ Leftover"; assert `api.mealPlan.updateMeal` called with `(meal.id, { is_leftover: false })`.
- `MEAL_PLAN_TOGGLE_LEFTOVER_REFRESHES_MEAL_PLAN` — after successful toggle, assert `api.mealPlan.getMealPlan` is called again (loadMealPlan invoked).
- `MEAL_PLAN_LEFTOVER_BADGE_VISIBLE` — meal with `is_leftover: true` renders the "Leftover" badge in the card (existing rendering; verify it hasn't regressed).

### Definition of Done

- [ ] Accepting the last wizard slot calls `completeWizard` immediately; wizard closes without an intermediate review screen.
- [ ] `review` step JSX block removed from `MealPlanWizard.jsx`; no dead code.
- [ ] `handleCompletePartial` (no-recipes empty state) still calls `completeWizard` and closes modal — verified manually and by test.
- [ ] "Leftover" / "✓ Leftover" button appears in the hover overlay of any meal cell in `MealPlan.jsx`.
- [ ] Clicking the button calls `PATCH /meal-plan/<meal_id>` with the correct `is_leftover` toggle value.
- [ ] `loadMealPlan()` is called after a successful toggle.
- [ ] All new vitest cases pass (`npm test` in `frontend/`).
- [ ] All pre-existing `MealPlanWizard.test.jsx` cases still pass.
- [ ] No new ESLint errors in touched files.

**Logic Audit items:**
- [ ] `handleAcceptRecipe` last-slot branch: calls `handleComplete` not `setStep('review')`.
- [ ] `handleCompletePartial` path: unchanged; still routes to `completeWizard`.
- [ ] Leftover toggle uses `!meal.is_leftover` (not `=== false`) — safe for undefined.
- [ ] `e.stopPropagation()` on Leftover button prevents recipe detail modal from opening.

---

**Gate:** Merge 04.1 and run `npm test -- --run` in `frontend/` before starting 04.2.

---

## Phase 04.2 — Shopping list display polish

### Technical Contract

#### `frontend/src/components/ShoppingList.jsx` — recipe-grouped display + item count

Current behavior: unpurchased items render as a single flat list. All items show `needed_for_recipe` inline per row.

**Changes (frontend only — no backend modifications):**

1. **Group unpurchased items by recipe.** Add a `useMemo` (import it if not already imported):

```js
const groupedUnpurchased = useMemo(() => {
  const map = new Map()
  for (const item of unpurchasedItems) {
    const key = item.needed_for_recipe?.trim() || 'General'
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(item)
  }
  return map
}, [unpurchasedItems])
```

2. **Render grouped sections.** Replace the flat `unpurchasedItems.map(...)` list with:
   ```jsx
   {[...groupedUnpurchased.entries()].map(([recipeName, groupItems]) => (
     <div key={recipeName}>
       <h4 className="text-sm font-semibold text-sage-light mb-1 mt-3 first:mt-0">
         {recipeName}
       </h4>
       <ul className="space-y-2">
         {groupItems.map((item) => (/* existing item row JSX — remove the "For: ..." sub-line since it's now the group header */)}
       </ul>
     </div>
   ))}
   ```
   Remove the existing `{item.needed_for_recipe && <p>For: ...</p>}` sub-line from each item row — it is now redundant.

3. **Item count badge** in the section header:
   ```jsx
   <h2 className="text-2xl font-display font-bold text-cream">Shopping List</h2>
   {unpurchasedItems.length > 0 && (
     <span className="text-sm text-sage-light ml-2">
       {unpurchasedItems.length} item{unpurchasedItems.length !== 1 ? 's' : ''} to buy
     </span>
   )}
   ```
   Wrap both in a `<div className="flex items-baseline gap-0">` or inline within the existing flex header.

4. **Purchased items section** — remains a flat list (unchanged); recipe grouping applies only to unpurchased items.

`needed_for_recipe` schema: TEXT column in `shopping_list` table (migration `009`). It is populated by `shopping_list_service.py` as `", ".join(req_data["recipes"][:3])` — a single concatenated string used as the group key verbatim; do not split it further.

No backend changes required. `apiClient.js` is not modified.

### Logic Guardrails

- `needed_for_recipe` null/empty/whitespace-only → group key is `'General'` (never an empty string heading).
- Group key is the raw `needed_for_recipe` string, not split by comma — one item can be "needed for" multiple recipes and that full string is the label.
- Empty list state ("All ingredients available!") is unchanged.
- Purchased items section: flat list, no grouping, no item count badge.
- `useMemo` must re-compute when `unpurchasedItems` changes (dependency array `[unpurchasedItems]`).
- The checkbox `onChange` for marking purchased remains wired to `handleMarkPurchased(item.id)` — no change to interaction logic.

### Test-First Suite

New file `frontend/src/tests/ShoppingList.test.jsx`.

Mock `apiClient`:
```js
const { shoppingListGet, markPurchased } = vi.hoisted(() => ({
  shoppingListGet: vi.fn(),
  markPurchased: vi.fn(),
}))
vi.mock('../services/apiClient', () => ({
  api: { shoppingList: { get: shoppingListGet, markPurchased } },
}))
```

- `SHOPPING_LIST_GROUPS_BY_RECIPE` — two items with the same `needed_for_recipe: 'Pasta Night'` render under one `<h4>Pasta Night</h4>`; an item with `needed_for_recipe: 'Taco Tuesday'` renders under a separate `<h4>Taco Tuesday</h4>`.
- `SHOPPING_LIST_NULL_RECIPE_KEY_GOES_TO_GENERAL` — item with `needed_for_recipe: null` appears under `<h4>General</h4>`.
- `SHOPPING_LIST_EMPTY_STRING_RECIPE_KEY_GOES_TO_GENERAL` — item with `needed_for_recipe: ''` appears under `<h4>General</h4>`.
- `SHOPPING_LIST_ITEM_COUNT_BADGE_SINGULAR` — one unpurchased item renders `'1 item to buy'`.
- `SHOPPING_LIST_ITEM_COUNT_BADGE_PLURAL` — three unpurchased items render `'3 items to buy'`.
- `SHOPPING_LIST_ITEM_COUNT_BADGE_NOT_SHOWN_WHEN_EMPTY` — zero unpurchased items: no count badge; "All ingredients available!" message shown.
- `SHOPPING_LIST_PURCHASED_NOT_GROUPED` — purchased items (shown when `includePurchased = true`) render without recipe sub-headings.
- `SHOPPING_LIST_FOR_LABEL_REMOVED_FROM_ITEM_ROW` — individual item rows do not contain "For:" text; the recipe name appears only as the section header.
- `SHOPPING_LIST_MARK_PURCHASED_CALLS_API` — clicking the checkbox calls `markPurchased(item.id)`.

### Definition of Done

- [ ] Unpurchased items visually grouped by recipe name (or "General") with `<h4>` sub-headings.
- [ ] "For: ..." sub-line removed from individual item rows.
- [ ] Item count badge ("N items to buy") visible in the "To Buy" header when list is non-empty.
- [ ] Purchased section unchanged (flat list).
- [ ] All `ShoppingList.test.jsx` cases pass.
- [ ] No backend files modified.
- [ ] No new ESLint errors.

**Logic Audit items:**
- [ ] `groupedUnpurchased` key for null/empty `needed_for_recipe` is `'General'`.
- [ ] `useMemo` dependency is `[unpurchasedItems]` only.
- [ ] Purchased items bypass the grouped render path entirely.
- [ ] Empty state displayed when `items.length === 0` (both purchased + unpurchased zero).
