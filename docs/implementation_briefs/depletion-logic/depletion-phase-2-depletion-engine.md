# Meald Depletion System — Phase 2: Depletion Engine

> **Reference:** Read `meald-depletion-master.md` before this document. Read the Phase 1 Cursor plan doc (linked in the Phase 1 implementation history) for any schema decisions made during implementation that differ from the Phase 1 spec. This document defines only the scope of Phase 2.

---

## Objective

Implement the depletion engine: the set of functions that compute confidence scores, determine item status, fire hard expiry deletions, and calibrate consumption rates from purchase history. This is pure logic — no UI, no recipe ranking. Everything here must be unit testable against the fixtures produced in Phase 1.

---

## Deliverable

A set of tested, isolated functions that:
- Accept a `pantry_item` record and return a current confidence score
- Accept a user's full pantry and run expiry cleanup
- Accept a purchase history and return a calibrated days_supply estimate
- Are fully exercised by unit tests against all Phase 1 fixtures

---

## Function 1: `compute_confidence(pantry_item, user_preferences) → float`

The core function. Called at query time whenever pantry state is needed. Never stored.

### Logic by depletion class

**PERISHABLE**
```
if item.is_frozen:
  reference_date = item.frozen_expire_date
else:
  reference_date = item.available_until

days_remaining = reference_date - today

if days_remaining > 2:      return 0.95
if days_remaining >= 0:     return 0.50
if days_remaining >= -3:    return 0.10
else:                       return 0.00
```

Note: confidence = 0.00 should not be reached in normal operation — hard expiry (Function 3) should have already removed the item. If confidence = 0.00 is returned, treat as a cleanup miss and flag for removal.

**CONSUMABLE**
```
calibrated_days = get_calibrated_days_supply(user_id, item_name)
  # returns personal avg if ≥ 2 purchase cycles exist, else default from item_classification

estimated_depletion = item.purchase_date + calibrated_days
days_remaining = estimated_depletion - today

if days_remaining > (calibrated_days * 0.25):   return 0.80
if days_remaining > 0:                           return 0.60
if days_remaining > (calibrated_days * -0.5):   return 0.20
else:                                            return 0.10

# Hard floor: if (today - purchase_date) > 365: return 0.05
# (max TTL signal — item may genuinely still exist but confidence is minimal)
```

Note: consumables never reach 0.00 through time decay alone. Only user action removes them.

**STAPLE**
```
if item.quantity_known:
  # Treat as consumable from creation date
  # Falls through to CONSUMABLE logic with today as purchase_date
else:
  return 0.40  # Permanent floor for unknown-quantity staples
```

**UNIT_ITEM**
```
if item.quantity_remaining is null:
  return 0.90  # Full, untracked
elif item.quantity_remaining > 0:
  return 0.60  # Partially used
else:
  return 0.00  # Empty — trigger removal
```

### Applying modifiers

After base score is computed, apply multipliers from `user_preferences`:

```
depletion_multiplier = user_preferences.depletion_multiplier  # household size
engagement_multiplier = get_engagement_multiplier(user_id)    # from app open frequency

# Multipliers affect the time-based calculations, not the confidence score directly.
# Apply to days_remaining before the threshold comparisons above:
adjusted_days_remaining = days_remaining / (depletion_multiplier * engagement_multiplier)
```

The multipliers accelerate depletion by shrinking the effective days_remaining. A household of 3 with high engagement burns through olive oil faster — their confidence decays faster to reflect that.

### Special case: spices and soft-required items

```
if item_classification.is_soft_required:
  # Cap confidence at 0.60 regardless of computed score
  return min(computed_confidence, 0.60)
```

---

## Function 2: `get_calibrated_days_supply(user_id, item_name) → integer`

Returns the best available estimate of how many days a purchase of this item lasts for this user.

```
purchase_records = purchase_history
  .where(user_id = user_id, item_name = item_name)
  .order_by(purchase_date DESC)
  .limit(5)

if len(purchase_records) < 2:
  return item_classification.default_days_supply

intervals = []
for i in range(1, len(purchase_records)):
  interval = purchase_records[i-1].purchase_date - purchase_records[i].purchase_date
  intervals.append(interval.days)

return round(avg(intervals))
```

The re-purchase interval is the best real-world signal for actual consumption rate. No user input required.

---

## Function 3: `run_expiry_cleanup(user_id) → list[expired_items]`

Called on every app open. Finds items past their `hard_expire_date` and soft deletes them.

```
expired = pantry_items
  .where(user_id = user_id)
  .where(deleted_at IS NULL)
  .where(hard_expire_date < today)
  .where(depletion_class = 'PERISHABLE')

for item in expired:
  copy_to_depletion_history(item, reason='AUTO_EXPIRED')
  pantry_items.soft_delete(item)  # sets deleted_at = now()

return expired  # returned so UI can populate graveyard
```

**What this does not do:**
- Does not delete CONSUMABLEs (they decay but never auto-delete)
- Does not delete UNIT_ITEMs with quantity_remaining = 0 (user should confirm via cook event)
- Does not run on a server cron — only on app open

### copy_to_depletion_history

```
depletion_history.insert({
  user_id:          item.user_id,
  pantry_item_id:   item.id,
  item_name:        item.item_name,
  depletion_class:  item.depletion_class,
  purchase_date:    item.purchase_date,
  deleted_at:       now(),
  reason:           reason,
  days_in_pantry:   (now() - item.purchase_date).days,
  was_cooked:       has_cook_event(item.id),
  put_back_count:   item.put_back_count
})
```

---

## Function 4: `process_cook_event(user_id, recipe_id, servings) → void`

Called when user marks a recipe as cooked. Decrements UNIT_ITEM quantities and logs depletion events for all ingredient classes.

```
recipe_ingredients = spoonacular.get_ingredients(recipe_id, servings)

for ingredient in recipe_ingredients:
  pantry_item = find_pantry_item(user_id, ingredient.name)
  if pantry_item is null: continue

  if pantry_item.depletion_class == 'UNIT_ITEM':
    if pantry_item.quantity_remaining is null:
      pantry_item.quantity_remaining = pantry_item.quantity_purchased

    pantry_item.quantity_remaining -= ingredient.quantity
    pantry_item.quantity_remaining = max(0, pantry_item.quantity_remaining)

    if pantry_item.quantity_remaining == 0:
      copy_to_depletion_history(pantry_item, reason='COOKED')
      pantry_items.soft_delete(pantry_item)
    else:
      pantry_items.update(pantry_item)

  # For PERISHABLE and CONSUMABLE, the cook event is logged but
  # quantity is not tracked — depletion continues via time decay.
  # The cook event updates was_cooked in depletion_history if item
  # is subsequently removed.
  log_cook_association(pantry_item.id, recipe_id)
```

---

## Function 5: `process_put_back(user_id, depletion_history_id) → pantry_item | error`

Called when user taps "Put back" in the graveyard.

```
history_record = depletion_history.find(depletion_history_id)

# Check meat/fish put-back limit
original_item = pantry_items.find(history_record.pantry_item_id)
classification = item_classification.find(history_record.item_name)

if classification.sub_class IN ('raw_meat', 'raw_fish'):
  if history_record.put_back_count >= 1:
    return error('MAX_PUT_BACK_REACHED')
    # UI handles this silently — no second graveyard entry

new_item = pantry_items.insert({
  ...copy fields from history_record...,
  confidence:          null,  # computed, never stored
  use_soon:            true,
  use_soon_expires:    today + 2 days,
  hard_expire_date:    today + 2 days,  # no grace buffer on resurrection
  put_back_count:      history_record.put_back_count + 1,
  deleted_at:          null
})

return new_item
```

---

## Function 6: `get_engagement_multiplier(user_id) → float`

Approximates cooking frequency from app open events.

```
opens_last_14_days = app_events
  .where(user_id = user_id, event_type = 'APP_OPEN')
  .where(created_at > today - 14 days)
  .count()

opens_per_week = opens_last_14_days / 2

if opens_per_week >= 5: return 1.2
if opens_per_week >= 2: return 1.0
else:                   return 0.7
```

---

## Unit Tests Required

All tests run against Phase 1 fixtures. Each must pass before Phase 3 begins.

| Test | Fixture | Expected result |
|---|---|---|
| Chicken within shelf life | A | confidence = 0.95 |
| Chicken at put_back_count = 1, raw_meat | B | process_put_back returns MAX_PUT_BACK_REACHED |
| Spinach within date | C | confidence = 0.95 |
| Spinach past hard expiry | D | run_expiry_cleanup removes it, depletion_history row created |
| Olive oil first purchase, within supply | E | confidence = 0.80 |
| Olive oil calibrated, within supply | F | get_calibrated_days_supply returns personal avg, not default |
| Paprika unknown quantity | G | confidence = 0.40 |
| Chickpeas full | H | confidence = 0.90 |
| Chickpeas half remaining | I | confidence = 0.60 |
| Graveyard item | J | visible in depletion_history query, not in pantry_items |

---

## Definition of Done

- [ ] All 6 functions implemented and isolated (no UI dependencies)
- [ ] All 10 unit tests passing against Phase 1 fixtures
- [ ] `compute_confidence` verified to never read from or write to a stored confidence column
- [ ] `run_expiry_cleanup` verified to produce correct `depletion_history` rows
- [ ] `process_put_back` blocks second resurrection for raw_meat and raw_fish
- [ ] Spice confidence correctly capped at 0.60
- [ ] Engagement and household multipliers applied correctly

---

## Implementation History

Cursor plan doc: _link after plan run_

Phase 1 Cursor plan doc: _link from Phase 1 implementation history_

Deviations from this document: _see plan doc above_
