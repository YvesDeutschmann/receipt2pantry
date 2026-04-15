# Phase 4.4 -- Full Pantry View Refactor

> **Prerequisite:** Phases 4.1, 4.2, and 4.3 must be complete. Read `meald-depletion-master.md` (Depletion Classes, Display rules) and `depletion-phase-4-ui.md` Surface 4.
>
> **Scope:** Refactor `Pantry.jsx`, `PantryList.jsx`, and `PantryItem.jsx` to use confidence-based grouping, status labels, swipe-to-remove, and tap correction. Remove all quantity editing UI. Zero backend changes.

---

## Objective

Transform the pantry view from a category-based inventory list with quantity controls into a confidence-aware status display. The pantry should feel like a glanceable health check, not a spreadsheet. "Correction should feel like a swipe, not a form."

---

## Technical Contract

### Backend Response Shape (from Phase 4.1 enhancement)

`GET /api/pantry` now returns items enriched with `confidence` and `depletion_class`:

```json
{
  "total_items": 12,
  "unique_ingredients": 8,
  "items": [
    {
      "id": "uuid",
      "base_ingredient": "chicken breast",
      "normalized_name": "Boneless Chicken Breast",
      "variant": "Kirkland",
      "category": "Meat",
      "quantity": 2,
      "unit": "lb",
      "depletion_class": "PERISHABLE",
      "confidence": 0.95,
      "is_frozen": false,
      "use_soon": false,
      "put_back_count": 0
    }
  ],
  "grouped": [
    {
      "base_ingredient": "chicken breast",
      "variants": [ ...same items as above... ]
    }
  ],
  "household_id": "uuid"
}
```

### Existing API Methods (already added in Phases 4.2 and 4.3)

- `api.correctPantryItem(userId, itemId, action)` -- 3-way correction
- `api.depletePantryItem(userId, itemId)` -- existing remove with snapshot
- `api.restorePantryItem(userId, snapshot)` -- existing undo
- `api.getGraveyard(userId, householdId)` -- from Phase 4.3
- `api.putBack(userId, depletionHistoryId)` -- from Phase 4.3

---

### Confidence Grouping Logic

Group pantry items into four tiers by confidence. This replaces the current category-based grouping in `PantryList.jsx`.

```javascript
function groupByConfidence(items) {
  const groups = {
    fresh:     { label: 'FRESH',      items: [] },
    low:       { label: 'GETTING LOW', items: [] },
    uncertain: { label: 'UNCERTAIN',   items: [] },
    gone:      { label: 'LIKELY GONE', items: [] },
  }
  for (const item of items) {
    const c = item.confidence ?? 0
    if (c >= 0.75)      groups.fresh.items.push(item)
    else if (c >= 0.50) groups.low.items.push(item)
    else if (c >= 0.20) groups.uncertain.items.push(item)
    else                groups.gone.items.push(item)
  }
  return Object.values(groups).filter(g => g.items.length > 0)
}
```

---

### Status Label Logic

Status labels differ by depletion class. This is a master doc constraint.

```javascript
function getStatusLabel(item) {
  const c = item.confidence ?? 0
  const cls = (item.depletion_class || '').toUpperCase()
  const isSoftRequired = item.is_soft_required || false

  if (isSoftRequired) return 'Check spice rack'
  if (item.use_soon) return 'Use soon'

  if (cls === 'PERISHABLE') {
    if (c >= 0.75) return 'Fresh'
    if (c >= 0.50) return 'Use soon'
    if (c >= 0.20) return 'Likely gone'
    return 'Likely gone'
  }

  // CONSUMABLE, STAPLE, UNIT_ITEM
  if (c >= 0.75) return 'In stock'
  if (c >= 0.50) return 'Probably still there'
  if (c >= 0.20) return 'Getting low'
  return 'Likely gone'
}
```

**Critical rule from master doc:** Perishables use "Fresh / Use soon / Likely gone". Consumables use "In stock / Getting low / Likely gone". Do NOT use the same language for both -- the mental model is different.

---

### Component Refactor: `PantryList.jsx`

**File:** `frontend/src/components/PantryList.jsx`

**Current behavior:** Groups items by category, then by base_ingredient. Has expand/collapse toggles.

**New behavior:** Groups items by confidence tier. No expand/collapse (flat list within each tier). No category headers.

**New props:**

```javascript
{
  items: Array<object>,           // flat list of pantry items with confidence
  onCorrection: (itemId, action) => Promise<void>,
  onRemove: (itemId) => void,
}
```

**Rendering:**

```jsx
{groupByConfidence(items).map(group => (
  <div key={group.label}>
    <h3 className="text-sm font-semibold text-sage-light uppercase tracking-wider mb-2 mt-6">
      {group.label}
    </h3>
    <div className="space-y-1">
      {group.items.map(item => (
        <PantryItem
          key={item.id}
          item={item}
          onCorrection={onCorrection}
          onRemove={onRemove}
        />
      ))}
    </div>
  </div>
))}
```

Remove all of the following from the current implementation:
- `expandedGroups` state and toggle logic
- Expand All / Collapse All buttons
- `groupedByCategory` computation
- Category header pills
- Nested variant grouping

---

### Component Refactor: `PantryItem.jsx`

**File:** `frontend/src/components/PantryItem.jsx`

**Current behavior:** Shows item name, quantity with edit controls (+/- buttons, inline number input), and delete button.

**New behavior:** Shows item name, status label, swipe-to-remove, and tap-to-correct.

**New props:**

```javascript
{
  item: {
    id: string,
    base_ingredient: string,
    normalized_name: string,
    variant: string | null,
    depletion_class: string,
    confidence: number,
    is_soft_required: boolean,
    use_soon: boolean,
  },
  onCorrection: (itemId, action) => Promise<void>,
  onRemove: (itemId) => void,
}
```

**Layout:**

```
┌──────────────────────────────────────────────────────┐
│  Chicken breast                              Fresh   │
│                                                      │
│  (tap to open correction)                            │
│                                                      │
│  ← swipe left reveals [Remove] →                     │
└──────────────────────────────────────────────────────┘
```

**Remove entirely:**
- `isEditing` state
- `editQuantity` state
- `handleSave`, `handleCancel`, `handleKeyDown` functions
- Number input field
- +/- quantity buttons
- `isLowStock` calculation based on quantity
- `formatQuantity` function

**Add:**

1. **Status label** on the right side: Use `getStatusLabel(item)`. Style:
   - "Fresh" / "In stock": `text-green-400`
   - "Probably still there" / "Use soon": `text-amber-400`
   - "Getting low" / "Check spice rack": `text-orange-400`
   - "Likely gone": `text-sage-light opacity-50` (faded)

2. **Swipe-to-remove:** Use `framer-motion` drag on x-axis. On `onDragEnd`, if `info.offset.x < -80`, call `onRemove(item.id)`. During swipe, reveal a red "Remove" panel behind the item. No confirmation dialog.

   ```jsx
   <motion.div
     drag="x"
     dragConstraints={{ left: -120, right: 0 }}
     dragElastic={0.1}
     onDragEnd={(e, info) => {
       if (info.offset.x < -80) {
         onRemove(item.id)
       }
     }}
   >
     {/* item content */}
   </motion.div>
   ```

3. **Tap-to-correct:** On tap (not on swipe), expand the item row to show the 3-way `IngredientCorrection` component (created in Phase 4.2). Only one item can be expanded at a time (manage this state in `PantryList` or `PantryItem`).

   ```javascript
   const [correctionOpen, setCorrectionOpen] = useState(false)

   const handleTap = () => {
     setCorrectionOpen(prev => !prev)
   }

   const handleCorrection = async (itemId, action) => {
     await onCorrection(itemId, action)
     setCorrectionOpen(false)
   }
   ```

   When expanded:
   ```
   ┌────────────────────────────────────────────────┐
   │  Olive oil                        Getting low  │
   │  ┌────────────────────────────────────────────┐│
   │  │ [Still have it] [Used it up] [Never had it]││
   │  └────────────────────────────────────────────┘│
   └────────────────────────────────────────────────┘
   ```

4. **Item name display:** Use `normalized_name` if available, else `base_ingredient`. Do NOT show variant text separately (keep it minimal).

---

### Page Refactor: `Pantry.jsx`

**File:** `frontend/src/pages/Pantry.jsx`

**Changes:**

1. **Replace stat cards.** Remove the "Total Items / Unique Ingredients / Categories" grid. Replace with a single-line summary: "{N} items in your pantry" (or remove stats entirely to keep it clean).

2. **Replace `PantryList` props.** Pass the flat `items` array (with confidence) instead of `groupedItems`:

   ```jsx
   <PantryList
     items={pantryData.items.filter(i => !i.deleted_at)}
     onCorrection={handleCorrection}
     onRemove={handleRemove}
   />
   ```

3. **Wire correction handler:**

   ```javascript
   const handleCorrection = async (itemId, action) => {
     try {
       await api.correctPantryItem(userId, itemId, action)
       fetchPantry() // refresh
     } catch (err) {
       console.error('Correction failed:', err)
       setError('Failed to update item.')
     }
   }
   ```

4. **Wire remove handler (swipe-to-remove):**

   ```javascript
   const handleRemove = async (itemId) => {
     try {
       await api.correctPantryItem(userId, itemId, 'used_it_up')
       fetchPantry()
     } catch (err) {
       console.error('Remove failed:', err)
       setError('Failed to remove item.')
     }
   }
   ```

   Note: We use `correctPantryItem` with `'used_it_up'` instead of `depletePantryItem` because the spec says swipe-to-remove triggers a soft delete with `reason=USER_REMOVED`, not the old snapshot-based deplete.

5. **Remove quantity update handler:** Delete `handleUpdateQuantity` and any `onUpdateQuantity` prop passing.

6. **Keep search.** The search bar stays -- it filters the items array locally.

7. **Keep add item.** The "Add item" button and `PantrySearchOverlay` stay.

8. **Add `GraveyardSection`** at the bottom (already done in Phase 4.3, but verify it's wired). Resolve `householdId`:

   ```javascript
   const [householdId, setHouseholdId] = useState(null)

   useEffect(() => {
     if (!userId) return
     api.getHousehold(userId).then(res => {
       if (res.household) setHouseholdId(res.household.id)
     }).catch(() => {})
   }, [userId])
   ```

9. **Remove `UndoToast` for swipe-remove.** The spec says "No undo offered here -- the user just confirmed it's gone" for the health card "✗". For the pantry swipe-to-remove, the spec says "one action, no confirmation." Keep it consistent -- no undo on the new correction-based removals. However, the existing deplete-and-restore flow for the "Add item" → "Remove" button can keep undo if desired for backward compatibility. The swipe interaction should NOT have undo.

---

### What Is NOT in This View (Master Doc Constraints)

These are explicitly called out in the spec and must NOT be present:

- No quantity editing fields
- No expiry date entry
- No category management
- No batch edit mode
- No sorting or filtering controls (MVP)

---

## Constraint Checklist

From `meald-depletion-master.md` and `depletion-phase-4-ui.md`:

- [ ] Pantry items are grouped by confidence tier: FRESH (>= 0.75), GETTING LOW (0.50-0.74), UNCERTAIN (0.20-0.49), LIKELY GONE (< 0.20).
- [ ] Perishables use "Fresh / Use soon / Likely gone" labels.
- [ ] Consumables use "In stock / Getting low / Likely gone" labels. (Different language from perishables.)
- [ ] Spices always show "Check spice rack" regardless of confidence.
- [ ] LIKELY GONE items render with faded text (reduced opacity).
- [ ] Swipe left on any item reveals "Remove" -- one action, no confirmation.
- [ ] Tap any item shows 3-way correction: "Still have it", "Used it up", "Never had it".
- [ ] No quantity editing fields exist anywhere in the UI.
- [ ] No +/- buttons, no inline number input, no quantity display.
- [ ] No expiry date entry.
- [ ] No category headers (replaced by confidence-tier headers).
- [ ] Empty confidence tiers are not rendered (no header if zero items in that tier).
- [ ] Search still works (filters items before grouping).
- [ ] `GraveyardSection` renders at bottom of pantry (from Phase 4.3).
- [ ] Perishables display as presence state, not quantity -- never show "0.5 bags of spinach."

---

## Validation Suite

Tests go in `frontend/src/tests/PantryView.test.jsx`.

### Test: CONFIDENCE_GROUPING_CORRECT
```
Setup:  Items with confidence 0.95, 0.60, 0.35, 0.10
Expect: Four groups rendered: FRESH (0.95), GETTING LOW (0.60), UNCERTAIN (0.35), LIKELY GONE (0.10)
```

### Test: EMPTY_TIER_NOT_RENDERED
```
Setup:  All items have confidence >= 0.75
Expect: Only FRESH header rendered. No GETTING LOW, UNCERTAIN, or LIKELY GONE headers.
```

### Test: STATUS_LABEL_PERISHABLE_FRESH
```
Setup:  Item with depletion_class='PERISHABLE', confidence=0.90
Expect: Status label text is "Fresh"
```

### Test: STATUS_LABEL_PERISHABLE_USE_SOON
```
Setup:  Item with depletion_class='PERISHABLE', confidence=0.55
Expect: Status label text is "Use soon"
```

### Test: STATUS_LABEL_CONSUMABLE_IN_STOCK
```
Setup:  Item with depletion_class='CONSUMABLE', confidence=0.85
Expect: Status label text is "In stock"
```

### Test: STATUS_LABEL_CONSUMABLE_GETTING_LOW
```
Setup:  Item with depletion_class='CONSUMABLE', confidence=0.55
Expect: Status label text is "Probably still there"
```

### Test: STATUS_LABEL_SPICE
```
Setup:  Item with is_soft_required=true, confidence=0.60
Expect: Status label text is "Check spice rack"
```

### Test: STATUS_LABEL_LIKELY_GONE_FADED
```
Setup:  Item with confidence=0.10
Expect: Item text has reduced opacity (faded appearance)
```

### Test: SWIPE_TO_REMOVE_CALLS_API
```
Setup:  Render PantryItem, trigger swipe-left gesture (offset.x < -80)
Mock:   api.correctPantryItem resolves
Expect: correctPantryItem called with (userId, itemId, 'used_it_up')
```

### Test: TAP_OPENS_CORRECTION
```
Setup:  Render PantryItem, click/tap on it
Expect: IngredientCorrection row appears with three options
```

### Test: CORRECTION_STILL_HAVE_IT
```
Setup:  Open correction, click "Still have it"
Mock:   api.correctPantryItem resolves
Expect: correctPantryItem called with 'still_have_it', correction row closes
```

### Test: CORRECTION_USED_IT_UP
```
Setup:  Open correction, click "Used it up"
Expect: correctPantryItem called with 'used_it_up', item removed after refresh
```

### Test: CORRECTION_NEVER_HAD_IT
```
Setup:  Open correction, click "Never had it"
Expect: correctPantryItem called with 'never_had_it', item removed after refresh
```

### Test: NO_QUANTITY_CONTROLS
```
Setup:  Render PantryItem for any item
Expect: No input[type="number"] in DOM
        No button with title "Increase" or "Decrease" in DOM
        No text matching formatQuantity patterns (e.g. "2.00 lb")
```

### Test: SEARCH_FILTERS_BEFORE_GROUPING
```
Setup:  Items: "chicken breast" (conf 0.95), "olive oil" (conf 0.35)
Action: Type "olive" in search
Expect: Only UNCERTAIN group rendered, containing "olive oil"
        No FRESH group (chicken filtered out)
```

### Test: GRAVEYARD_AT_BOTTOM
```
Setup:  Pantry has items, graveyard has items
Expect: GraveyardSection renders after PantryList in the DOM
```

### Test: ITEM_SHOWS_NORMALIZED_NAME
```
Setup:  Item with normalized_name="Boneless Chicken Breast", base_ingredient="chicken breast"
Expect: "Boneless Chicken Breast" displayed (not base_ingredient)
```

---

## Files to Modify

| File | Changes |
|---|---|
| `frontend/src/pages/Pantry.jsx` | Remove stat cards, remove quantity handler, add correction handler, add swipe remove, add householdId resolution, wire GraveyardSection |
| `frontend/src/components/PantryList.jsx` | Replace category grouping with confidence grouping, new props, remove expand/collapse |
| `frontend/src/components/PantryItem.jsx` | Remove all quantity UI, add status label, add swipe-to-remove, add tap-to-correct |

## Files to Create

| File | Description |
|---|---|
| `frontend/src/tests/PantryView.test.jsx` | Validation suite |

---

## Definition of Done

- [ ] Pantry items grouped by confidence tier (FRESH, GETTING LOW, UNCERTAIN, LIKELY GONE)
- [ ] Empty tiers produce zero DOM nodes
- [ ] Perishable items show "Fresh / Use soon / Likely gone" labels
- [ ] Consumable items show "In stock / Probably still there / Getting low / Likely gone" labels
- [ ] Spices show "Check spice rack" regardless of confidence
- [ ] LIKELY GONE items have visually faded text
- [ ] Swipe-left removes item (calls correction API with `used_it_up`)
- [ ] Tap opens inline 3-way correction
- [ ] No quantity editing fields exist anywhere (`input[type="number"]` for quantities removed)
- [ ] No +/- buttons exist
- [ ] No category headers (replaced by confidence-tier headers)
- [ ] Search filters items before confidence grouping
- [ ] `GraveyardSection` renders at bottom of pantry page
- [ ] All 17 tests in validation suite pass
- [ ] No existing tests broken
- [ ] No new linter errors
