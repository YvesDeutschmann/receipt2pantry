# Phase 4.3 -- Graveyard Section and Weekly Health Card

> **Prerequisite:** Phase 4.1 backend endpoints and Phase 4.2 suggestion screen must be complete. Read `meald-depletion-master.md` (Pantry Deletion Behavior, Food Safety) and `depletion-phase-4-ui.md` Surfaces 2 and 3.
>
> **Scope:** Two new frontend components (`GraveyardSection`, `HealthCard`), API client additions, and integration into the suggestion screen and pantry page. Zero backend changes.

---

## Objective

Implement the graveyard (recently removed items with put-back) and weekly health card (low-confidence nudge). These two surfaces close the feedback loop: the graveyard lets users correct false-negative expirations, and the health card lets users confirm what they still have.

---

## Technical Contract

### API Client Additions

Add to the `api` object in `frontend/src/services/apiClient.js`:

```javascript
getGraveyard: async (userId, householdId = null) => {
  const params = householdId ? { household_id: householdId } : {}
  const response = await apiClient.get('/pantry/graveyard', {
    params,
    headers: { 'X-User-Id': userId },
  })
  return response.data
},

putBack: async (userId, depletionHistoryId) => {
  const response = await apiClient.post(
    '/pantry/put-back',
    { depletion_history_id: depletionHistoryId },
    { headers: { 'X-User-Id': userId } }
  )
  return response.data
},

getHealthCard: async (userId, householdId = null) => {
  const params = householdId ? { household_id: householdId } : {}
  const response = await apiClient.get('/pantry/health-card', {
    params,
    headers: { 'X-User-Id': userId },
  })
  return response.data
},

dismissHealthCard: async (userId) => {
  const response = await apiClient.post(
    '/pantry/health-card/dismiss',
    {},
    { headers: { 'X-User-Id': userId } }
  )
  return response.data
},
```

Note: `correctPantryItem` was already added in Phase 4.2. The health card reuses it.

### Backend Response Shapes (from Phase 4.1)

**`GET /api/pantry/graveyard`:**
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

**`POST /api/pantry/put-back`:**
- Success: `{ "ok": true, "item": { ...pantry row } }` (200)
- Blocked: `{ "error": "MAX_PUT_BACK_REACHED" }` (409)

**`GET /api/pantry/health-card`:**
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

### Component: `GraveyardSection.jsx`

**File:** `frontend/src/components/GraveyardSection.jsx`

**Props:**

```javascript
{
  userId: string,
  householdId: string | null,
  onPutBack: () => void,      // callback when a put-back succeeds (triggers suggestion refresh)
}
```

**Internal state:** Fetches `api.getGraveyard(userId, householdId)` on mount and stores the items list.

**Rendering rules:**

1. **Title:** "Recently Removed" with a horizontal divider above.
2. **Items sorted by `deleted_at` descending** (most recent first -- the API already returns this order).
3. Each row shows:
   - `base_ingredient` (capitalized)
   - Relative time: "removed today", "removed 3 days ago", "removed 5 days ago". Compute from `deleted_at`.
   - **"Put back" button** -- a small outlined button on the right side.
4. **The "use it tonight" prompt** appears ONLY on the very first item (index 0): "Put it back and we'll show you recipes to use it tonight". Style as a subtle hint line below the item row.
5. **If `sub_class IN ('raw_meat', 'raw_fish') AND put_back_count >= 1`:** Do NOT render the "Put back" button for that item. Show the item with "Removed" text (no action). Do not explain why -- just omit the button silently.
6. **If the items list is empty:** Do not render the section at all (no header, no divider).

**Put back handler:**

```javascript
const handlePutBack = async (depletionHistoryId) => {
  try {
    await api.putBack(userId, depletionHistoryId)
    // Remove item from local state with slide-out animation
    setItems(prev => prev.filter(i => i.depletion_history_id !== depletionHistoryId))
    // Notify parent to refresh suggestions (use_soon shelf should now appear)
    onPutBack()
  } catch (err) {
    if (err.response?.status === 409) {
      // MAX_PUT_BACK_REACHED -- should not happen if button is hidden correctly
      // Silently remove the button
      return
    }
    console.error('Put back failed', err)
  }
}
```

**Animation:** Use `framer-motion` `AnimatePresence` with `motion.div` for each item. On removal, animate `{ opacity: 0, x: -100, height: 0 }` over 300ms.

**Relative time helper:**

```javascript
function relativeRemovalTime(deletedAt) {
  const days = Math.floor((Date.now() - new Date(deletedAt).getTime()) / 86400000)
  if (days === 0) return 'removed today'
  if (days === 1) return 'removed yesterday'
  return `removed ${days} days ago`
}
```

---

### Component: `HealthCard.jsx`

**File:** `frontend/src/components/HealthCard.jsx`

**Props:**

```javascript
{
  userId: string,
  householdId: string | null,
  visible: boolean,            // controlled by parent (shown after cook event)
  onDismiss: () => void,       // called when user taps "Done, thanks"
  onItemUpdated: () => void,   // callback to refresh pantry/suggestions after correction
}
```

**The parent (Recipes.jsx) controls visibility.** After a successful "Cooked it" event:
1. Call `api.getHealthCard(userId, householdId)`.
2. If `response.show === true` and `response.items.length > 0`, set `visible = true` and pass the items.
3. If `response.show === false`, do nothing.

**Internal state:** The `items` array is passed via a separate prop or loaded internally from `visible` trigger. Recommended: pass `items` as a prop alongside `visible` to avoid a redundant fetch.

**Updated props (preferred pattern):**

```javascript
{
  userId: string,
  items: Array<{
    item_id: string,
    base_ingredient: string,
    normalized_name: string,
    confidence: number,
    depletion_class: string,
  }>,
  visible: boolean,
  onDismiss: () => void,
  onItemUpdated: () => void,
}
```

**Layout:**

```
┌──────────────────────────────────────────────┐
│  Quick pantry check  ·  30 seconds           │
│                                              │
│  Olive oil          [Still have it]    [✗]   │
│  Paprika            [Still have it]    [✗]   │
│  Soy sauce          [Still have it]    [✗]   │
│                                              │
│                            [Done, thanks]    │
└──────────────────────────────────────────────┘
```

- Card background: `bg-forest-mid border border-sage/30 rounded-meald-lg p-4`
- Title: "Quick pantry check" with a muted "30 seconds" label beside it.
- Each item row: `base_ingredient` (or `normalized_name`) on the left. Two buttons on the right:
  - "Still have it": small outlined button, green-ish. On tap: call `api.correctPantryItem(userId, item.item_id, 'still_have_it')`. Animate a checkmark replacing the buttons. Remove the item from the list.
  - "✗" button: small, muted. On tap: call `api.correctPantryItem(userId, item.item_id, 'used_it_up')`. Animate item sliding out.
- **"Done, thanks" button:** At the bottom right. On tap:
  1. Call `api.dismissHealthCard(userId)`.
  2. Call `onDismiss()` to hide the card.
  3. Call `onItemUpdated()` to refresh parent state.
- No quantities. No dates. No categories.
- Maximum items: The backend caps at 5, but the component should also enforce `items.slice(0, 5)` defensively.

**Animation:** The card itself should animate in from the bottom (`framer-motion` `initial={{ y: 50, opacity: 0 }}` `animate={{ y: 0, opacity: 1 }}`). Individual item removals animate with `AnimatePresence`. When all items are actioned (list becomes empty), auto-dismiss the card.

---

### Integration: Recipes.jsx (from Phase 4.2)

Add health card state and trigger to the already-refactored `Recipes.jsx`:

```javascript
const [healthCardVisible, setHealthCardVisible] = useState(false)
const [healthCardItems, setHealthCardItems] = useState([])

const handleCookedIt = async (recipe) => {
  // ... existing cook logic from Phase 4.2 ...
  
  // After re-fetching suggestions, check health card
  try {
    const hc = await api.getHealthCard(userId, householdId)
    if (hc.show && hc.items?.length > 0) {
      setHealthCardItems(hc.items)
      setHealthCardVisible(true)
    }
  } catch (e) {
    // Health card is non-critical; fail silently
  }
}
```

Render the `HealthCard` at the bottom of the suggestion screen:

```jsx
<HealthCard
  userId={userId}
  items={healthCardItems}
  visible={healthCardVisible}
  onDismiss={() => {
    setHealthCardVisible(false)
    setHealthCardItems([])
  }}
  onItemUpdated={async () => {
    const updated = await api.getSuggestions(userId, householdId)
    setSuggestions(updated)
  }}
/>
```

### Integration: Pantry.jsx

The `GraveyardSection` renders at the bottom of the pantry page. Add it after the main `PantryList`:

```jsx
<GraveyardSection
  userId={userId}
  householdId={householdId}
  onPutBack={async () => {
    // Refresh pantry data
    fetchPantry()
  }}
/>
```

The `householdId` must be resolved in `Pantry.jsx`. Add a `fetchHousehold` call (same pattern as `Recipes.jsx` uses) if not already present.

---

## Constraint Checklist

From `meald-depletion-master.md` and `depletion-phase-4-ui.md`:

**Graveyard:**
- [ ] Only items removed within the last 7 days appear (the backend enforces this, but also do not render stale items if the component stays mounted across midnight).
- [ ] "Put it back and we'll show you recipes to use it tonight" prompt appears ONLY on the most recently removed item (index 0), not on all items.
- [ ] Raw meat (`raw_meat`) and raw fish (`raw_fish`) with `put_back_count >= 1` must NOT have a "Put back" button. Show the item with just "Removed" -- no action, no explanation.
- [ ] Non-meat items allow unlimited put-backs (the backend allows it, the UI must not block).
- [ ] Put back sets `use_soon = true`, `use_soon_expires = today + 2` on the backend. The frontend must refresh the suggestion screen so the use_soon shelf appears immediately.
- [ ] The graveyard is a section at the bottom of the pantry view, not a dedicated screen.
- [ ] If the graveyard is empty (zero items), the entire section including its header is not rendered.

**Health Card:**
- [ ] Appears no more than once per 7 days (backend enforces, but frontend also controls visibility via `show` flag).
- [ ] Shows 3-5 items maximum (backend caps at 5, frontend also caps defensively).
- [ ] Items are in the 0.20-0.60 confidence range (backend filters).
- [ ] "Still have it" sets `confidence_override = 0.80` expiring in 14 days (via `correctPantryItem` API).
- [ ] "✗" immediately soft-deletes with `reason = USER_REMOVED` (via `correctPantryItem` API).
- [ ] "Done, thanks" records `last_health_card_shown = today` and dismisses.
- [ ] The health card appears after a "Cooked it" event -- the user is already engaged.
- [ ] No quantities, no dates, no categories on the health card. Just item names and two buttons.
- [ ] No undo on the health card "✗" -- the user explicitly confirmed the item is gone.

**Food Safety:**
- [ ] The graveyard never allows raw meat/fish to be put back more than once (enforced by hiding the button).
- [ ] Never surface meat/fish in the use_soon shelf without the disclaimer (handled in Phase 4.2's `SuggestionRecipeCard`, but the graveyard put-back flow triggers this -- verify it works end-to-end).

---

## Validation Suite

Tests go in `frontend/src/tests/GraveyardAndHealthCard.test.jsx`.

### Graveyard Tests

### Test: GRAVEYARD_RENDERS_ITEMS
```
Setup:  Mock api.getGraveyard returns 3 items
Expect: 3 item rows rendered with base_ingredient names and relative time
```

### Test: GRAVEYARD_EMPTY_NOT_RENDERED
```
Setup:  Mock api.getGraveyard returns { items: [] }
Expect: No "Recently Removed" header in DOM
```

### Test: GRAVEYARD_PUT_BACK_BUTTON_SHOWN
```
Setup:  Item with sub_class='leafy_green', put_back_count=0
Expect: "Put back" button visible
```

### Test: GRAVEYARD_RAW_MEAT_BLOCKED_NO_BUTTON
```
Setup:  Item with sub_class='raw_meat', put_back_count=1
Expect: No "Put back" button rendered for that item
        Item still visible with "Removed" text
```

### Test: GRAVEYARD_RAW_FISH_BLOCKED_NO_BUTTON
```
Setup:  Item with sub_class='raw_fish', put_back_count=1
Expect: No "Put back" button rendered for that item
```

### Test: GRAVEYARD_RAW_MEAT_FIRST_PUT_BACK_ALLOWED
```
Setup:  Item with sub_class='raw_meat', put_back_count=0
Expect: "Put back" button IS visible (first time is allowed)
```

### Test: GRAVEYARD_NON_MEAT_MULTIPLE_PUT_BACKS
```
Setup:  Item with sub_class='leafy_green', put_back_count=3
Expect: "Put back" button IS visible (non-meat unlimited)
```

### Test: GRAVEYARD_USE_TONIGHT_PROMPT_FIRST_ONLY
```
Setup:  3 graveyard items
Expect: "Put it back and we'll show you recipes" text appears only on the first item
```

### Test: GRAVEYARD_PUT_BACK_CALLS_API
```
Setup:  Click "Put back" on an item
Mock:   api.putBack resolves successfully
Expect: api.putBack called with correct depletion_history_id
        Item removed from list with animation
        onPutBack callback called
```

### Test: GRAVEYARD_PUT_BACK_409_SILENT
```
Setup:  Click "Put back" (edge case: button shouldn't be there but is)
Mock:   api.putBack rejects with 409
Expect: No error shown to user, item remains
```

### Test: GRAVEYARD_RELATIVE_TIME_TODAY
```
Setup:  Item with deleted_at = today
Expect: "removed today" text
```

### Test: GRAVEYARD_RELATIVE_TIME_DAYS_AGO
```
Setup:  Item with deleted_at = 3 days ago
Expect: "removed 3 days ago" text
```

### Health Card Tests

### Test: HEALTH_CARD_RENDERS_ITEMS
```
Setup:  visible=true, items=[3 items]
Expect: 3 item rows with "Still have it" and "✗" buttons each
        "Done, thanks" button at bottom
        "Quick pantry check" header
```

### Test: HEALTH_CARD_NOT_VISIBLE
```
Setup:  visible=false
Expect: No health card in DOM
```

### Test: HEALTH_CARD_STILL_HAVE_IT
```
Setup:  Click "Still have it" on olive oil
Mock:   api.correctPantryItem resolves
Expect: correctPantryItem called with (userId, itemId, 'still_have_it')
        Item removed from card list
```

### Test: HEALTH_CARD_REMOVE_ITEM
```
Setup:  Click "✗" on paprika
Mock:   api.correctPantryItem resolves
Expect: correctPantryItem called with (userId, itemId, 'used_it_up')
        Item removed from card list
```

### Test: HEALTH_CARD_DISMISS
```
Setup:  Click "Done, thanks"
Mock:   api.dismissHealthCard resolves
Expect: api.dismissHealthCard called
        onDismiss callback called
```

### Test: HEALTH_CARD_AUTO_DISMISS_WHEN_EMPTY
```
Setup:  1 item in health card, user clicks "Still have it"
Mock:   api.correctPantryItem resolves
Expect: After item removed, card auto-dismisses (onDismiss called)
```

### Test: HEALTH_CARD_MAX_FIVE_ITEMS
```
Setup:  Pass 7 items as props
Expect: Only 5 rendered
```

### Test: HEALTH_CARD_AFTER_COOK_EVENT
```
Setup:  In Recipes.jsx, mock api.markCooked and api.getHealthCard({ show: true, items: [...] })
Action: Click "Cooked it"
Expect: Health card appears at bottom of suggestion screen after cook event completes
```

---

## Files to Create

| File | Description |
|---|---|
| `frontend/src/components/GraveyardSection.jsx` | Recently removed items with put-back |
| `frontend/src/components/HealthCard.jsx` | Weekly pantry check card |
| `frontend/src/tests/GraveyardAndHealthCard.test.jsx` | Validation suite |

## Files to Modify

| File | Changes |
|---|---|
| `frontend/src/services/apiClient.js` | Add `getGraveyard`, `putBack`, `getHealthCard`, `dismissHealthCard` |
| `frontend/src/pages/Recipes.jsx` | Add health card state, trigger after cook event |
| `frontend/src/pages/Pantry.jsx` | Add `GraveyardSection` at bottom, resolve `householdId` |

---

## Definition of Done

- [ ] `GraveyardSection` renders at bottom of Pantry page with correct items
- [ ] Graveyard only shows items from the last 7 days
- [ ] "Put back" button hidden for raw_meat/raw_fish with `put_back_count >= 1`
- [ ] "Put back" button shown for raw_meat/raw_fish with `put_back_count === 0`
- [ ] Non-meat/fish items always have "Put back" regardless of `put_back_count`
- [ ] "Use it tonight" prompt only on most recently removed item
- [ ] Put back calls API and triggers suggestion refresh
- [ ] Empty graveyard renders nothing
- [ ] Health card appears after "Cooked it" event when backend returns `show: true`
- [ ] Health card shows 3-5 items maximum
- [ ] "Still have it" sets confidence override via correction API
- [ ] "✗" soft-deletes via correction API
- [ ] "Done, thanks" records dismissal and hides card
- [ ] Health card auto-dismisses when all items are actioned
- [ ] No quantities, dates, or categories shown on health card
- [ ] All 20 tests in validation suite pass
- [ ] No existing tests broken
- [ ] No new linter errors
