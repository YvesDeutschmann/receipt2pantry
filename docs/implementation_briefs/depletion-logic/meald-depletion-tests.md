# Mise Depletion System — Test Specification

> **Reference:** Read `mise-depletion-master.md` before this document. This spec covers all depletion logic across Phases 2 and 3. Phase 4 UI tests are defined separately at the bottom. Every scenario here maps to a named unit or integration test. All tests must pass before each phase is considered done.

---

## How to Read This Document

Each scenario has:
- **ID** — unique test name used in code
- **Setup** — the pantry state or function inputs
- **Action** — what is called
- **Expect** — the required output or side effect

Tests are grouped by function. Within each group, tests run from simplest to most edge-case. All time-based tests use a fixed mock date — never `Date.now()` directly in test code.

---

## Group 1: `compute_confidence` — PERISHABLE

### PERISHABLE_WELL_WITHIN_DATE
```
Setup:  spinach, shelf_life=5, purchase_date=today-2, not frozen
        household=1, engagement=1.0×
Action: compute_confidence(item, prefs)
Expect: 0.95
```

### PERISHABLE_BORDERLINE_ENTRY
```
Setup:  spinach, shelf_life=5, purchase_date=today-3 (exactly 2 days before available_until)
Action: compute_confidence(item, prefs)
Expect: 0.50
Note:   available_until = today-3+5 = today+2. days_remaining = 2. Boundary: ≤ 2 days triggers 0.50
```

### PERISHABLE_BORDERLINE_EXIT
```
Setup:  spinach, shelf_life=5, purchase_date=today-5 (available_until = today)
Action: compute_confidence(item, prefs)
Expect: 0.50
Note:   days_remaining = 0. Still in the ≥ 0 band, not yet past.
```

### PERISHABLE_PAST_SHELF_LIFE
```
Setup:  spinach, shelf_life=5, purchase_date=today-6 (available_until = yesterday)
Action: compute_confidence(item, prefs)
Expect: 0.10
Note:   days_remaining = -1. Within grace buffer.
```

### PERISHABLE_APPROACHING_HARD_EXPIRY
```
Setup:  spinach, shelf_life=5, grace_buffer=3, purchase_date=today-7
        (available_until=today-2, hard_expire=today+1)
Action: compute_confidence(item, prefs)
Expect: 0.10
Note:   Still alive but barely. Should appear in graveyard tomorrow.
```

### PERISHABLE_AT_HARD_EXPIRY
```
Setup:  spinach, hard_expire_date=today
Action: compute_confidence(item, prefs)
Expect: 0.00
Note:   run_expiry_cleanup should have caught this. Treat as cleanup miss.
```

### PERISHABLE_CHICKEN_WITHIN_DATE
```
Setup:  chicken breast, shelf_life=3, purchase_date=today-1
Action: compute_confidence(item, prefs)
Expect: 0.95
```

### PERISHABLE_CHICKEN_BORDERLINE
```
Setup:  chicken breast, shelf_life=3, purchase_date=today-2
        (available_until=today+1, days_remaining=1)
Action: compute_confidence(item, prefs)
Expect: 0.50
```

### PERISHABLE_EGGS_LONG_SHELF_LIFE
```
Setup:  eggs, shelf_life=21, purchase_date=today-10
        (available_until=today+11, days_remaining=11)
Action: compute_confidence(item, prefs)
Expect: 0.95
Note:   11 days remaining > 2 day threshold.
```

### PERISHABLE_MILK_APPROACHING_END
```
Setup:  milk, shelf_life=7, purchase_date=today-6
        (available_until=today+1, days_remaining=1)
Action: compute_confidence(item, prefs)
Expect: 0.50
```

---

## Group 2: `compute_confidence` — PERISHABLE with Frozen Modifier

### PERISHABLE_FROZEN_WELL_WITHIN
```
Setup:  chicken breast, purchase_date=today-5, is_frozen=true
        frozen_expire_date=today+85 (purchase_date + 90 days)
Action: compute_confidence(item, prefs)
Expect: 0.95
Note:   days_remaining against frozen_expire_date = 85. Well within threshold.
```

### PERISHABLE_FROZEN_BORDERLINE
```
Setup:  chicken breast, is_frozen=true, frozen_expire_date=today+1
Action: compute_confidence(item, prefs)
Expect: 0.50
```

### PERISHABLE_FROZEN_PAST_FROZEN_EXPIRY
```
Setup:  chicken breast, is_frozen=true, frozen_expire_date=yesterday
Action: compute_confidence(item, prefs)
Expect: 0.10
```

### PERISHABLE_FROZEN_IGNORES_ORIGINAL_SHELF_LIFE
```
Setup:  chicken breast, shelf_life=3, purchase_date=today-10, is_frozen=true
        frozen_expire_date=today+80
Action: compute_confidence(item, prefs)
Expect: 0.95
Note:   Without frozen flag this would be 0.00 (past hard expiry).
        Frozen flag uses frozen_expire_date, not available_until.
```

---

## Group 3: `compute_confidence` — CONSUMABLE

### CONSUMABLE_WELL_WITHIN_SUPPLY
```
Setup:  olive oil, purchase_date=today-10, default_days_supply=45
        no purchase history (uses default)
        calibrated_days=45, days_remaining=35
        household=1, engagement=1.0×
Action: compute_confidence(item, prefs)
Expect: 0.80
Note:   days_remaining (35) > calibrated_days * 0.25 (11.25) → 0.80
```

### CONSUMABLE_LOWER_BAND
```
Setup:  olive oil, purchase_date=today-40, calibrated_days=45
        days_remaining=5 (within 25% threshold = 11.25 days)
Action: compute_confidence(item, prefs)
Expect: 0.60
Note:   days_remaining (5) ≤ calibrated_days * 0.25 (11.25) but > 0 → 0.60
```

### CONSUMABLE_PAST_DEPLETION_DATE
```
Setup:  olive oil, purchase_date=today-50, calibrated_days=45
        days_remaining=-5
Action: compute_confidence(item, prefs)
Expect: 0.20
Note:   days_remaining (-5) > calibrated_days * -0.5 (-22.5) → 0.20
```

### CONSUMABLE_FAR_PAST_DEPLETION
```
Setup:  olive oil, purchase_date=today-80, calibrated_days=45
        days_remaining=-35 (past the -0.5× threshold of -22.5)
Action: compute_confidence(item, prefs)
Expect: 0.10
```

### CONSUMABLE_MAX_TTL_FLOOR
```
Setup:  soy sauce, purchase_date=today-366, calibrated_days=90
Action: compute_confidence(item, prefs)
Expect: 0.05
Note:   (today - purchase_date) > 365 → hard floor of 0.05 regardless of other calculation.
```

### CONSUMABLE_EXACTLY_365_DAYS
```
Setup:  soy sauce, purchase_date=today-365, calibrated_days=90
Action: compute_confidence(item, prefs)
Expect: 0.10
Note:   Exactly 365 days does NOT yet trigger the TTL floor. 366+ triggers it.
```

### CONSUMABLE_NEVER_AUTO_DELETES
```
Setup:  olive oil, purchase_date=today-400, calibrated_days=45
Action: run_expiry_cleanup(user_id)
        then query pantry_items for olive oil
Expect: olive oil still present in pantry_items (deleted_at IS NULL)
        compute_confidence returns 0.05 (TTL floor)
Note:   Consumables decay but are never auto-deleted.
```

---

## Group 4: `compute_confidence` — STAPLE

### STAPLE_UNKNOWN_QUANTITY
```
Setup:  paprika, source=MANUAL_ADD, quantity_known=false
Action: compute_confidence(item, prefs)
Expect: 0.40
Note:   Permanent floor. Does not decay over time.
```

### STAPLE_UNKNOWN_QUANTITY_AFTER_30_DAYS
```
Setup:  paprika, source=MANUAL_ADD, quantity_known=false, created_at=today-30
Action: compute_confidence(item, prefs)
Expect: 0.40
Note:   Time passing does not change the score for unknown-quantity staples.
```

### STAPLE_KNOWN_QUANTITY_ACTS_AS_CONSUMABLE
```
Setup:  rice, source=MANUAL_ADD, quantity_known=true, quantity_remaining=2 cups
        created_at=today-5, default_days_supply=30
Action: compute_confidence(item, prefs)
Expect: 0.80
Note:   Known-quantity staple uses CONSUMABLE logic with created_at as purchase_date.
        days_remaining = 25. 25 > 30*0.25 = 7.5 → 0.80
```

---

## Group 5: `compute_confidence` — UNIT_ITEM

### UNIT_ITEM_FULL_UNTRACKED
```
Setup:  canned chickpeas, quantity_purchased=2, quantity_remaining=null
Action: compute_confidence(item, prefs)
Expect: 0.90
Note:   null quantity_remaining means untouched since purchase.
```

### UNIT_ITEM_PARTIALLY_USED
```
Setup:  canned chickpeas, quantity_purchased=2, quantity_remaining=1
Action: compute_confidence(item, prefs)
Expect: 0.60
```

### UNIT_ITEM_EMPTY
```
Setup:  canned chickpeas, quantity_purchased=2, quantity_remaining=0
Action: compute_confidence(item, prefs)
Expect: 0.00
Note:   Should trigger removal. This is not an auto-expiry — flagged for user-confirmed cleanup.
```

---

## Group 6: `compute_confidence` — Spice Cap

### SPICE_CAP_WITHIN_SUPPLY
```
Setup:  paprika (is_soft_required=true), purchased today, default_days_supply=180
        raw computed score would be 0.80
Action: compute_confidence(item, prefs)
Expect: 0.60
Note:   Spice cap applies: min(0.80, 0.60) = 0.60
```

### SPICE_CAP_PAST_SUPPLY
```
Setup:  paprika (is_soft_required=true), purchase_date=today-200, calibrated_days=180
        raw computed score would be 0.10
Action: compute_confidence(item, prefs)
Expect: 0.10
Note:   Spice cap applies min(0.10, 0.60) = 0.10. Cap only prevents going above 0.60.
```

### SPICE_CAP_DOES_NOT_AFFECT_TIER
```
Setup:  chicken 0.90, garlic 0.85, paprika 0.60 (spice, soft_required)
Action: score_recipe(recipe_requiring_all_three)
Expect: tier = 'cook_tonight'
Note:   Paprika is soft_required. Its confidence does not affect min_required_confidence.
```

---

## Group 7: Household and Engagement Multipliers

### MULTIPLIER_HOUSEHOLD_3_PLUS
```
Setup:  olive oil, purchase_date=today-30, calibrated_days=45
        household_size=THREE_PLUS, depletion_multiplier=2.0
        engagement=1.0×
        raw days_remaining = 15
        adjusted_days_remaining = 15 / (2.0 * 1.0) = 7.5
Action: compute_confidence(item, prefs)
Expect: 0.60
Note:   7.5 ≤ calibrated_days * 0.25 (11.25) → lower band of 0.60
        Without multiplier would be 0.80 (15 > 11.25)
```

### MULTIPLIER_HIGH_ENGAGEMENT
```
Setup:  olive oil, purchase_date=today-38, calibrated_days=45
        household=1, engagement=1.2×
        raw days_remaining = 7
        adjusted_days_remaining = 7 / 1.2 = 5.83
Action: compute_confidence(item, prefs)
Expect: 0.60
Note:   5.83 ≤ 11.25 → 0.60. Without multiplier would also be 0.60 here — 
        use a case where the multiplier actually changes the band:
```

### MULTIPLIER_CHANGES_BAND
```
Setup:  olive oil, purchase_date=today-33, calibrated_days=45
        raw days_remaining = 12
        household=THREE_PLUS (2.0×), engagement=high (1.2×)
        adjusted = 12 / (2.0 * 1.2) = 5.0
Action: compute_confidence(item, prefs)
Expect: 0.60
Note:   adjusted 5.0 ≤ 11.25 → 0.60
        Without multiplier: 12 > 11.25 → would return 0.80
        Multiplier demonstrably changes the result.
```

### MULTIPLIER_LOW_ENGAGEMENT
```
Setup:  olive oil, purchase_date=today-5, calibrated_days=45
        raw days_remaining = 40
        engagement=0.7×, household=1×
        adjusted = 40 / 0.7 = 57.14
Action: compute_confidence(item, prefs)
Expect: 0.80
Note:   Low engagement slows depletion. adjusted_days > calibrated_days * 0.25 → 0.80
```

---

## Group 8: `get_engagement_multiplier`

### ENGAGEMENT_HIGH
```
Setup:  10 APP_OPEN events in last 14 days (5/week)
Action: get_engagement_multiplier(user_id)
Expect: 1.2
```

### ENGAGEMENT_HIGH_BOUNDARY
```
Setup:  10 APP_OPEN events exactly (5/week boundary)
Action: get_engagement_multiplier(user_id)
Expect: 1.2
Note:   ≥ 5 returns 1.2. Boundary is inclusive.
```

### ENGAGEMENT_MEDIUM
```
Setup:  6 APP_OPEN events in last 14 days (3/week)
Action: get_engagement_multiplier(user_id)
Expect: 1.0
```

### ENGAGEMENT_MEDIUM_LOWER_BOUNDARY
```
Setup:  4 APP_OPEN events in last 14 days (2/week)
Action: get_engagement_multiplier(user_id)
Expect: 1.0
Note:   ≥ 2 returns 1.0. Boundary is inclusive.
```

### ENGAGEMENT_LOW
```
Setup:  2 APP_OPEN events in last 14 days (1/week)
Action: get_engagement_multiplier(user_id)
Expect: 0.7
```

### ENGAGEMENT_NEW_USER
```
Setup:  0 APP_OPEN events in last 14 days
Action: get_engagement_multiplier(user_id)
Expect: 0.7
Note:   New users default to low engagement multiplier.
```

---

## Group 9: `get_calibrated_days_supply`

### CALIBRATION_FIRST_PURCHASE
```
Setup:  olive oil, 1 purchase record in history
Action: get_calibrated_days_supply(user_id, 'olive oil')
Expect: 45  (default from item_classification)
Note:   < 2 records → use default.
```

### CALIBRATION_EXACTLY_TWO_RECORDS
```
Setup:  olive oil, 2 purchase records: purchase 1 = today-60, purchase 2 = today
        interval = 60 days
Action: get_calibrated_days_supply(user_id, 'olive oil')
Expect: 60
Note:   ≥ 2 records → use personal average. avg([60]) = 60.
```

### CALIBRATION_MULTIPLE_RECORDS
```
Setup:  olive oil, purchase records at: today, today-40, today-80, today-130
        intervals: [40, 40, 50]
Action: get_calibrated_days_supply(user_id, 'olive oil')
Expect: 43  (round(avg(40, 40, 50)) = round(43.33) = 43)
```

### CALIBRATION_CAPS_AT_FIVE_RECORDS
```
Setup:  olive oil, 7 purchase records spanning 300 days
Action: get_calibrated_days_supply(user_id, 'olive oil')
        inspect SQL query
Expect: query uses LIMIT 5 — only most recent 5 records used
```

### CALIBRATION_REPURCHASE_RESETS_DEPLETION
```
Setup:  olive oil, purchase_date=today-50, calibrated_days=45 (past depletion)
        new receipt imported containing olive oil → new pantry_item created
Action: query pantry for olive oil
Expect: new pantry_item with purchase_date=today, confidence=0.80
        old pantry_item not present (or marked deleted)
Note:   Re-purchase is independent evidence of depletion of prior item.
```

---

## Group 10: `run_expiry_cleanup`

### CLEANUP_REMOVES_EXPIRED_PERISHABLE
```
Setup:  spinach, hard_expire_date=yesterday, deleted_at=null
Action: run_expiry_cleanup(user_id)
Expect: pantry_items row has deleted_at set to now()
        depletion_history row created with reason='AUTO_EXPIRED'
        returned list contains spinach
```

### CLEANUP_POPULATES_DEPLETION_HISTORY_CORRECTLY
```
Setup:  spinach, hard_expire_date=yesterday, purchase_date=today-10
        no cook events associated
Action: run_expiry_cleanup(user_id)
        inspect depletion_history row
Expect: days_in_pantry = 10
        was_cooked = false
        reason = 'AUTO_EXPIRED'
        put_back_count = 0
```

### CLEANUP_WAS_COOKED_FLAG
```
Setup:  chicken, hard_expire_date=yesterday
        cook event exists linking chicken to a recipe
Action: run_expiry_cleanup(user_id)
        inspect depletion_history row
Expect: was_cooked = true
```

### CLEANUP_DOES_NOT_DELETE_CONSUMABLE
```
Setup:  olive oil, purchase_date=today-400 (way past any supply estimate)
        no hard_expire_date (null)
Action: run_expiry_cleanup(user_id)
Expect: olive oil still in pantry_items with deleted_at = null
        NOT in depletion_history
```

### CLEANUP_DOES_NOT_DELETE_ALREADY_DELETED
```
Setup:  spinach, hard_expire_date=yesterday, deleted_at=yesterday (already deleted)
Action: run_expiry_cleanup(user_id)
Expect: no duplicate depletion_history entry created
        depletion_history count for this item = 1 (not 2)
```

### CLEANUP_HANDLES_MULTIPLE_EXPIRED_ITEMS
```
Setup:  spinach (expired), chicken (expired), milk (expired)
Action: run_expiry_cleanup(user_id)
Expect: all three soft deleted
        three depletion_history rows created
        returned list length = 3
```

### CLEANUP_DOES_NOT_DELETE_VALID_PERISHABLE
```
Setup:  spinach, hard_expire_date=tomorrow
Action: run_expiry_cleanup(user_id)
Expect: spinach untouched in pantry_items
```

### CLEANUP_GRAVEYARD_WINDOW
```
Setup:  three items auto-expired: item_A 3 days ago, item_B 6 days ago, item_C 8 days ago
Action: query depletion_history for graveyard (deleted_at > today-7)
Expect: item_A and item_B returned
        item_C NOT returned (outside 7-day window)
```

---

## Group 11: `process_cook_event`

### COOK_UNIT_ITEM_DECREMENT
```
Setup:  canned chickpeas, quantity_purchased=2, quantity_remaining=null
        recipe uses 1 can of chickpeas
Action: process_cook_event(user_id, recipe_id, servings=1)
Expect: quantity_remaining = 1
        (null initialized to quantity_purchased=2, then decremented by 1)
```

### COOK_UNIT_ITEM_ALREADY_PARTIAL
```
Setup:  canned chickpeas, quantity_purchased=2, quantity_remaining=1
        recipe uses 1 can
Action: process_cook_event(user_id, recipe_id, servings=1)
Expect: quantity_remaining = 0
        item soft deleted with reason='COOKED'
        depletion_history row created
```

### COOK_UNIT_ITEM_DOES_NOT_GO_NEGATIVE
```
Setup:  rice, quantity_remaining=0.5 cups
        recipe uses 2 cups of rice
Action: process_cook_event(user_id, recipe_id, servings=4)
Expect: quantity_remaining = 0  (clamped, not -1.5)
        item soft deleted
```

### COOK_PERISHABLE_NOT_DECREMENTED
```
Setup:  spinach (PERISHABLE), in pantry
        recipe uses spinach
Action: process_cook_event(user_id, recipe_id, servings=2)
Expect: spinach still in pantry with no quantity change
        cook_association log entry created
        time-decay continues normally
```

### COOK_MISSING_INGREDIENT_SKIPPED
```
Setup:  pantry contains chicken but not garlic
        recipe requires both chicken and garlic
Action: process_cook_event(user_id, recipe_id, servings=2)
Expect: no error thrown
        chicken processed normally
        garlic silently skipped (pantry_item = null → continue)
```

### COOK_CLEARS_USE_SOON_FLAG
```
Setup:  spinach with use_soon=true, use_soon_expires=tomorrow
        recipe uses spinach as primary ingredient
Action: process_cook_event(user_id, recipe_id, servings=2)
Expect: spinach.use_soon = false
        use_soon_expires = null
```

---

## Group 12: `process_put_back`

### PUT_BACK_STANDARD_ITEM
```
Setup:  spinach in depletion_history (auto expired), put_back_count=0
        sub_class = 'leafy_green'
Action: process_put_back(user_id, depletion_history_id)
Expect: new pantry_item created:
          use_soon = true
          use_soon_expires = today + 2
          hard_expire_date = today + 2
          put_back_count = 1
          deleted_at = null
```

### PUT_BACK_SETS_NO_GRACE_BUFFER
```
Setup:  spinach in depletion_history
Action: process_put_back(user_id, depletion_history_id)
Expect: hard_expire_date = today + 2 exactly
        (no additional grace buffer applied — resurrection gets no cushion)
```

### PUT_BACK_RAW_MEAT_FIRST_TIME
```
Setup:  chicken breast in depletion_history, put_back_count=0
        sub_class = 'raw_meat'
Action: process_put_back(user_id, depletion_history_id)
Expect: success — new pantry_item created with put_back_count=1
        use_soon = true
```

### PUT_BACK_RAW_MEAT_BLOCKED_SECOND_TIME
```
Setup:  chicken breast in depletion_history, put_back_count=1
        sub_class = 'raw_meat'
Action: process_put_back(user_id, depletion_history_id)
Expect: returns error MAX_PUT_BACK_REACHED
        no new pantry_item created
```

### PUT_BACK_RAW_FISH_BLOCKED
```
Setup:  salmon fillet in depletion_history, put_back_count=1
        sub_class = 'raw_fish'
Action: process_put_back(user_id, depletion_history_id)
Expect: returns error MAX_PUT_BACK_REACHED
```

### PUT_BACK_NON_MEAT_ALLOWS_MULTIPLE
```
Setup:  spinach in depletion_history, put_back_count=1
        sub_class = 'leafy_green'
Action: process_put_back(user_id, depletion_history_id)
Expect: success — put_back_count=2 on new item
Note:   Only raw_meat and raw_fish are limited to one put-back.
```

### PUT_BACK_CONFIDENCE_ELEVATED
```
Setup:  spinach put back successfully
Action: compute_confidence(new_pantry_item, prefs)
Expect: 0.95
Note:   days_remaining = 2. days_remaining (2) is NOT > 2, so it falls into
        the 0.50 band... actually let's check the logic:
        available_until = today+2, days_remaining = 2
        threshold is days_remaining > 2 → false
        threshold is days_remaining >= 0 → true → 0.50
        
        DESIGN NOTE: The master doc says confidence=0.85 on put-back but 
        compute_confidence would actually return 0.50 for an item 2 days from expiry.
        This is a spec conflict to resolve before implementation.
        Resolution options:
          A) Add a confidence_override=0.85 field set on put-back, 
             expires with use_soon_expires
          B) Accept 0.50 as correct — the item is 2 days from expiry, 
             0.50 is honest
        Flag for team decision before Phase 2 implementation.
```

---

## Group 13: `confidence_override` (Health Card)

### OVERRIDE_ACTIVE_REPLACES_COMPUTED
```
Setup:  olive oil, computed confidence would be 0.20 (past estimated supply)
        confidence_override = 0.80
        confidence_override_expires = today + 10
Action: compute_confidence(item, prefs)
Expect: 0.80
Note:   Active override takes precedence over computed score.
```

### OVERRIDE_EXPIRED_FALLS_BACK_TO_COMPUTED
```
Setup:  olive oil, computed confidence = 0.20
        confidence_override = 0.80
        confidence_override_expires = yesterday
Action: compute_confidence(item, prefs)
Expect: 0.20
Note:   Expired override is ignored. Computed score resumes.
```

### OVERRIDE_SET_BY_HEALTH_CARD_STILL_HAVE_IT
```
Setup:  olive oil at confidence 0.30 appearing in health card
Action: user taps "Still have it"
Expect: confidence_override = 0.80
        confidence_override_expires = today + 14
```

---

## Group 14: Recipe Tier Assignment (`get_tier`)

### TIER_COOK_TONIGHT_BOUNDARY
```
Setup:  min_required_confidence = 0.75 (exactly at threshold)
Action: get_tier(0.75)
Expect: 'cook_tonight'
Note:   ≥ 0.75 is inclusive.
```

### TIER_PROBABLY_HAVE_UPPER_BOUNDARY
```
Setup:  min_required_confidence = 0.74
Action: get_tier(0.74)
Expect: 'probably_have'
```

### TIER_PROBABLY_HAVE_LOWER_BOUNDARY
```
Setup:  min_required_confidence = 0.50 (exactly)
Action: get_tier(0.50)
Expect: 'probably_have'
```

### TIER_CHECK_FIRST_UPPER_BOUNDARY
```
Setup:  min_required_confidence = 0.49
Action: get_tier(0.49)
Expect: 'check_first'
```

### TIER_CHECK_FIRST_LOWER_BOUNDARY
```
Setup:  min_required_confidence = 0.20 (exactly)
Action: get_tier(0.20)
Expect: 'check_first'
```

### TIER_SUPPRESSED_BOUNDARY
```
Setup:  min_required_confidence = 0.19
Action: get_tier(0.19)
Expect: 'suppressed'
```

### TIER_SUPPRESSED_ZERO
```
Setup:  min_required_confidence = 0.0 (ingredient not in pantry)
Action: get_tier(0.0)
Expect: 'suppressed'
```

---

## Group 15: Recipe Scoring (`score_recipe`)

### SCORE_ALL_HIGH_CONFIDENCE
```
Setup:  chicken 0.95, spinach 0.90, garlic 0.80
        no use_soon items
Action: score_recipe(frittata_recipe, pantry, prefs, [])
Expect: tier = 'cook_tonight'
        score ≈ avg(0.95, 0.90, 0.80) = 0.883
```

### SCORE_ONE_BORDERLINE_DROPS_TIER
```
Setup:  chicken 0.95, spinach 0.55, garlic 0.80
Action: score_recipe(recipe, pantry, prefs, [])
Expect: tier = 'probably_have'
        (min_required = 0.55 → probably_have)
```

### SCORE_USE_SOON_ALL_MATCH_BOOST
```
Setup:  spinach use_soon=true (primary), chicken use_soon=true (primary)
        use_soon_items = [spinach, chicken]
        recipe uses both as primary ingredients
Action: score_recipe(recipe, pantry, prefs, use_soon_items)
Expect: tier = 'use_soon'
        use_soon_score = 2.0 (all use_soon items matched)
        final_score = base_score + 2.0
```

### SCORE_USE_SOON_PARTIAL_MATCH_BOOST
```
Setup:  spinach use_soon=true, chicken use_soon=true
        recipe uses spinach (primary) but not chicken
Action: score_recipe(recipe, pantry, prefs, use_soon_items)
Expect: tier = 'use_soon'
        use_soon_score = 1.0 (some but not all)
```

### SCORE_USE_SOON_AS_GARNISH_NO_BOOST
```
Setup:  parsley use_soon=true
        recipe uses parsley as garnish (is_primary=false)
Action: score_recipe(recipe, pantry, prefs, use_soon_items)
Expect: tier NOT 'use_soon'
        use_soon_primary_matches = 0 → no tier override
        parsley use_soon does not elevate recipe
```

### SCORE_MISSING_INGREDIENT_SUPPRESSES
```
Setup:  recipe requires chicken, spinach, garlic
        pantry has spinach 0.90, garlic 0.80
        chicken NOT in pantry (returns null → confidence = 0.0)
Action: score_recipe(recipe, pantry, prefs, [])
Expect: tier = 'suppressed'
```

### SCORE_ASPIRATIONAL_PENALTY
```
Setup:  olive oil in pantry at confidence 0.80
        signals table: olive oil dismiss_count = 3
        recipe uses olive oil as primary ingredient
Action: score_recipe(recipe, pantry, prefs, [])
Expect: final_score reduced by 0.15 compared to same recipe with dismiss_count < 3
        tier unchanged (penalty affects score, not tier)
```

### SCORE_ASPIRATIONAL_BELOW_THRESHOLD_NO_PENALTY
```
Setup:  olive oil, dismiss_count = 2
Action: score_recipe(recipe, pantry, prefs, [])
Expect: no score penalty applied
        (threshold is >= 3)
```

---

## Group 16: Status Labels (`get_status_label`)

### LABEL_USE_SOON_OVERRIDES_CONFIDENCE
```
Setup:  is_use_soon=true, confidence=0.85
Action: get_status_label(0.85, true)
Expect: 'check_freshness'
Note:   use_soon flag takes priority over confidence level.
```

### LABEL_CONFIRMED
```
Setup:  is_use_soon=false, confidence=0.75
Action: get_status_label(0.75, false)
Expect: 'confirmed'
```

### LABEL_PROBABLY_HAVE
```
Setup:  is_use_soon=false, confidence=0.60
Action: get_status_label(0.60, false)
Expect: 'probably_have'
```

### LABEL_CHECK_PANTRY
```
Setup:  is_use_soon=false, confidence=0.30
Action: get_status_label(0.30, false)
Expect: 'check_pantry'
```

### LABEL_NULL_BELOW_THRESHOLD
```
Setup:  is_use_soon=false, confidence=0.15
Action: get_status_label(0.15, false)
Expect: null
Note:   Ingredient is not shown in UI at this confidence level.
```

---

## Group 17: Use Soon Shelf Lifecycle

### USE_SOON_SHELF_APPEARS_AFTER_PUT_BACK
```
Setup:  spinach put back from graveyard (use_soon=true, use_soon_expires=today+2)
Action: get_recipe_suggestions(user_id)
Expect: use_soon_shelf is non-empty
        contains recipes where spinach is a primary ingredient
```

### USE_SOON_SHELF_DISAPPEARS_AFTER_EXPIRY
```
Setup:  spinach use_soon=true, use_soon_expires=yesterday
Action: get_recipe_suggestions(user_id)
Expect: use_soon_shelf is empty []
Note:   Expired use_soon items do not appear in use_soon shelf.
```

### USE_SOON_SHELF_EMPTY_WHEN_NO_USE_SOON_ITEMS
```
Setup:  pantry with multiple items, none have use_soon=true
Action: get_recipe_suggestions(user_id)
Expect: use_soon_shelf = []
```

### USE_SOON_MEAT_DISCLAIMER_REQUIRED
```
Setup:  chicken breast put back, use_soon=true, put_back_count=1
        sub_class = 'raw_meat'
Action: get_recipe_suggestions(user_id)
        inspect use_soon_shelf recipe ingredient_flags
Expect: chicken ingredient_flag has is_use_soon=true
        (UI layer uses this to render the safety disclaimer)
```

---

## Group 18: Ingredient Fuzzy Matching

### FUZZY_EXACT_MATCH
```
Setup:  pantry contains 'chicken breast'
        recipe ingredient = 'chicken breast'
Action: find_best_match(pantry, 'chicken breast')
Expect: returns chicken breast pantry item
```

### FUZZY_PARTIAL_MATCH
```
Setup:  pantry contains 'chicken breast'
        recipe ingredient = 'boneless chicken breast'
Action: find_best_match(pantry, 'boneless chicken breast')
Expect: returns chicken breast pantry item (fuzzy score > 0.8)
```

### FUZZY_NO_MATCH
```
Setup:  pantry contains 'chicken breast'
        recipe ingredient = 'tofu'
Action: find_best_match(pantry, 'tofu')
Expect: returns null
```

### FUZZY_REAL_RECEIPT_NAMES
```
Test each of the following Costco/Safeway receipt names against their
Spoonacular ingredient equivalents. Each must return the correct pantry item.

  'ORGANC WHOLE MLK 1GAL'   → matches 'whole milk'
  'KS EVOO 2PK'             → matches 'olive oil'
  'BONELESS SK CHKN BRST'   → matches 'chicken breast'
  'BABY SPNCH 1LB'          → matches 'spinach'
  'LARGE EGGS 2DOZ'         → matches 'eggs'
  'AP FLOUR 10LB BAG'       → matches 'all-purpose flour'
  'KIRKLAND SALTED BTR'     → matches 'butter'
  'ROMA TOMATOES 4LB'       → matches 'tomatoes'
  'PARMIGIANO REGGIANO'     → matches 'parmesan cheese'
  'GRD BEEF 93/7 3LB'       → matches 'ground beef'
```

---

## Group 19: Failure Mode Defenses

### FAILURE_PHANTOM_INGREDIENT_DECAY
```
Setup:  olive oil, purchase_date=today-68, calibrated_days=45
        (1.5× depletion date = 45*1.5 = 67.5 days — now past this)
Action: compute_confidence(item, prefs)
Expect: confidence ≤ 0.20
Note:   At 1.5× the depletion estimate, confidence should be in the 0.10–0.20 range.
        Phantom defense: this item should not appear in cook_tonight or probably_have.
```

### FAILURE_BULK_COSTCO_MEAT_THRESHOLD
```
Setup:  chicken breast, retailer='costco', quantity=6 lbs
Action: import receipt
Expect: is_frozen prompt triggered (one-tap at import)
        IF user confirms frozen: is_frozen=true, frozen_expire_date=purchase_date+90
        IF user dismisses: is_frozen=false, normal shelf life applies
```

### FAILURE_BULK_COSTCO_UNIT_THRESHOLD
```
Setup:  chicken breast, retailer='costco', quantity=4 units (count)
Action: import receipt
Expect: is_frozen prompt triggered
```

### FAILURE_BULK_BELOW_THRESHOLD
```
Setup:  chicken breast, retailer='costco', quantity=2 lbs
Action: import receipt
Expect: is_frozen prompt NOT triggered
        normal PERISHABLE shelf life applied
```

### FAILURE_UNCLASSIFIED_RECEIPT_ITEM
```
Setup:  receipt contains item 'EXOTIC GRAIN BLEND' — not in classification table
Action: import receipt, run normalization
Expect: item created with depletion_class=STAPLE, quantity_known=false
        confidence = 0.40
        NOT classified as PERISHABLE or given a shelf life
```

### FAILURE_SPICE_IMMORTALITY_PREVENTION
```
Setup:  paprika purchased today, is_soft_required=true
Action: compute_confidence at purchase date
Expect: 0.60 (cap applied immediately, never starts at 0.80+)
Note:   Spice immortality is prevented by the cap at purchase, not just over time.
```

---

## Group 20: Integration — Full Pantry to Suggestion Pipeline

### INTEGRATION_FULL_HAPPY_PATH
```
Setup:  User has:
          chicken breast (purchase_date=today-1, confidence≈0.95)
          spinach (purchase_date=today-2, confidence≈0.95)
          garlic (consumable, well within supply, confidence≈0.80)
          paprika (spice, confidence=0.60)
Action: get_recipe_suggestions(user_id)
Expect: spinach frittata appears in cook_tonight
        paprika listed as soft-required with 'check spice rack' label
        no items in use_soon_shelf
```

### INTEGRATION_GRAVEYARD_TO_USE_SOON_PIPELINE
```
Setup:  spinach auto-expired, appears in graveyard
Action: user taps "Put back"
        get_recipe_suggestions(user_id) called immediately after
Expect: use_soon_shelf is non-empty
        spinach recipes appear at top
        spinach ingredient_flag shows is_use_soon=true, status='check_freshness'
```

### INTEGRATION_COOK_EVENT_DEPLETES_AND_REFRESHES
```
Setup:  canned chickpeas (quantity=2), spinach (PERISHABLE), garlic (CONSUMABLE)
        recipe: chickpea and spinach curry (uses 1 can chickpeas)
Action: process_cook_event(user_id, recipe_id, servings=4)
        get_recipe_suggestions(user_id) called after
Expect: chickpeas.quantity_remaining = 1
        spinach still in pantry (PERISHABLE, time-decay continues)
        garlic still in pantry (CONSUMABLE, time-decay continues)
        use_soon flag cleared on any use_soon items used in the recipe
        suggestions refresh reflects updated pantry state
```

### INTEGRATION_REPURCHASE_CALIBRATES_CONSUMABLE
```
Setup:  olive oil, first purchased 50 days ago (calibrated_days=45, confidence=0.10)
Action: import new receipt containing olive oil
Expect: old olive oil entry soft-deleted or superseded
        new olive oil entry: purchase_date=today, confidence=0.80
        purchase_history now has 2 records → interval=50 days
        next call to get_calibrated_days_supply returns 50, not 45
```

---

## Test Count Summary

| Group | Function / Area | Test Count |
|---|---|---|
| 1 | compute_confidence — PERISHABLE | 10 |
| 2 | compute_confidence — PERISHABLE frozen | 4 |
| 3 | compute_confidence — CONSUMABLE | 7 |
| 4 | compute_confidence — STAPLE | 3 |
| 5 | compute_confidence — UNIT_ITEM | 3 |
| 6 | compute_confidence — Spice cap | 3 |
| 7 | Household + engagement multipliers | 4 |
| 8 | get_engagement_multiplier | 6 |
| 9 | get_calibrated_days_supply | 5 |
| 10 | run_expiry_cleanup | 8 |
| 11 | process_cook_event | 6 |
| 12 | process_put_back | 7 |
| 13 | confidence_override | 3 |
| 14 | get_tier boundaries | 7 |
| 15 | score_recipe | 8 |
| 16 | get_status_label | 5 |
| 17 | use_soon shelf lifecycle | 4 |
| 18 | Fuzzy matching | 4 + 10 named pairs |
| 19 | Failure mode defenses | 6 |
| 20 | Integration pipeline | 4 |
| **Total** | | **~116** |

---

## Notes for Implementation

**Mock the clock.** Every time-dependent test must use a fixed mock date, not `Date.now()`. A single `TEST_DATE = '2026-04-10'` constant used across all test files prevents flaky tests.

**One fixture file.** All Phase 1 fixtures plus the new scenarios here should live in a single `test-fixtures.ts` file. Duplication across test files will cause drift.

**The put-back confidence conflict (Group 12, PUT_BACK_CONFIDENCE_ELEVATED)** is a genuine spec ambiguity between the master doc (says 0.85) and the compute_confidence logic (would return 0.50 for an item 2 days from expiry). Resolve this before Phase 2 implementation begins.

**Don't test Spoonacular responses.** Mock the Spoonacular API in all tests. You're testing your logic, not their API. Use a consistent set of mock recipe fixtures with known ingredient lists.
