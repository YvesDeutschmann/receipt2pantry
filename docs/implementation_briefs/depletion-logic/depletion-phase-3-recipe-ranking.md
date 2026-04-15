# Mise Depletion System — Phase 3: Recipe Suggestion Ranking

> **Reference:** Read `mise-depletion-master.md` before this document. Read the Phase 1 and Phase 2 Cursor plan docs (linked in their respective implementation history sections) for any decisions made during implementation that differ from spec. This document defines only the scope of Phase 3.

---

## Objective

Implement the recipe suggestion ranking system. This layer sits between the depletion engine (Phase 2) and the UI (Phase 4). It accepts a user's pantry state, calls `compute_confidence` for each relevant ingredient, and returns a ranked, tiered list of recipe suggestions.

No UI in this phase. The output is a structured data object consumed by Phase 4.

---

## Deliverable

A `get_recipe_suggestions(user_id) → SuggestionResult` function that returns:

```typescript
SuggestionResult {
  use_soon_shelf:    Recipe[]   // empty array if no use_soon items
  cook_tonight:      Recipe[]
  probably_have:     Recipe[]
  check_first:       Recipe[]  // includes which ingredient triggered the tier
}

Recipe {
  id:                string
  title:             string
  tier:              'use_soon' | 'cook_tonight' | 'probably_have' | 'check_first'
  ingredient_flags:  IngredientFlag[]
  score:             float      // internal ranking score within tier
}

IngredientFlag {
  ingredient_name:   string
  confidence:        float
  is_soft_required:  boolean
  is_use_soon:       boolean
  status_label:      'confirmed' | 'probably_have' | 'check_pantry' | 'check_freshness'
}
```

---

## Core Ranking Function

```
get_recipe_suggestions(user_id):

  pantry = pantry_items.where(user_id=user_id, deleted_at=null)
  preferences = user_preferences.find(user_id)
  use_soon_items = pantry.where(use_soon=true, use_soon_expires > today)

  candidate_recipes = fetch_candidate_recipes(pantry, use_soon_items)

  results = { use_soon_shelf: [], cook_tonight: [], probably_have: [], check_first: [] }

  for recipe in candidate_recipes:
    scored = score_recipe(recipe, pantry, preferences, use_soon_items)
    if scored.tier == 'suppressed': continue
    results[scored.tier].append(scored)

  # Sort within each tier by score descending
  for tier in results:
    results[tier].sort(by=score, descending=true)

  return results
```

---

## Function: `fetch_candidate_recipes`

Fetches recipes from Spoonacular that are plausible given current pantry. Do not fetch all recipes and filter — that is too slow. Use Spoonacular's `findByIngredients` endpoint with pantry items as input.

```
high_confidence_items = pantry
  .filter(item => compute_confidence(item, preferences) >= 0.50)
  .map(item => item.item_name)

# Always include use_soon items regardless of confidence
# (they were just confirmed by the user)
use_soon_names = use_soon_items.map(item => item.item_name)

ingredient_list = dedupe(high_confidence_items + use_soon_names)

candidate_recipes = spoonacular.findByIngredients(
  ingredients: ingredient_list,
  number: 50,
  ranking: 1,        # maximize used ingredients
  ignorePantry: true # don't auto-assume staples
)
```

Cache candidate recipes for 30 minutes per user. Do not re-fetch on every pantry query.

---

## Function: `score_recipe(recipe, pantry, preferences, use_soon_items)`

```
score_recipe(recipe, pantry, preferences, use_soon_items):

  required_ingredients = recipe.ingredients.filter(not is_soft_required)
  soft_ingredients = recipe.ingredients.filter(is_soft_required)

  ingredient_flags = []
  min_required_confidence = 1.0
  use_soon_matches = 0
  use_soon_primary_matches = 0

  for ingredient in required_ingredients:
    pantry_item = find_best_match(pantry, ingredient.name)

    if pantry_item is null:
      confidence = 0.0
    else:
      confidence = compute_confidence(pantry_item, preferences)

    is_use_soon = pantry_item?.use_soon == true
    if is_use_soon: use_soon_matches += 1
    if is_use_soon and ingredient.is_primary: use_soon_primary_matches += 1

    min_required_confidence = min(min_required_confidence, confidence)

    ingredient_flags.append({
      ingredient_name: ingredient.name,
      confidence: confidence,
      is_soft_required: false,
      is_use_soon: is_use_soon,
      status_label: get_status_label(confidence, is_use_soon)
    })

  # Determine tier from min required confidence
  # (soft-required ingredients do not affect tier)
  tier = get_tier(min_required_confidence)
  if tier == 'suppressed': return { tier: 'suppressed' }

  # Compute base score
  base_score = avg(ingredient_flags.map(f => f.confidence))

  # Use soon boost
  use_soon_score = 0
  if use_soon_primary_matches == len(use_soon_items): use_soon_score += 2.0
  elif use_soon_primary_matches > 0:                  use_soon_score += 1.0

  final_score = base_score + use_soon_score

  # Override tier to use_soon if any primary use_soon ingredient is in recipe
  if use_soon_primary_matches > 0:
    tier = 'use_soon'

  return {
    id:               recipe.id,
    title:            recipe.title,
    tier:             tier,
    ingredient_flags: ingredient_flags,
    score:            final_score
  }
```

---

## Tier Assignment

```
get_tier(min_required_confidence):
  if min_required_confidence >= 0.75:  return 'cook_tonight'
  if min_required_confidence >= 0.50:  return 'probably_have'
  if min_required_confidence >= 0.20:  return 'check_first'
  else:                                return 'suppressed'
```

Soft-required ingredients (spices, herbs) do not contribute to `min_required_confidence`. A recipe with all required ingredients at 0.90 and paprika at 0.40 is still "cook tonight."

---

## Status Labels for Ingredient Flags

Used by the Phase 4 UI to render per-ingredient indicators on recipe cards.

```
get_status_label(confidence, is_use_soon):
  if is_use_soon:           return 'check_freshness'
  if confidence >= 0.75:    return 'confirmed'
  if confidence >= 0.50:    return 'probably_have'
  if confidence >= 0.20:    return 'check_pantry'
  else:                     return null  # ingredient suppressed, not shown
```

---

## Ingredient Matching

Receipt-normalized item names won't always match Spoonacular ingredient names exactly. Implement fuzzy matching using the same normalization layer from receipt import.

```
find_best_match(pantry, ingredient_name):
  # 1. Exact match on item_name
  exact = pantry.find(item_name == ingredient_name)
  if exact: return exact

  # 2. Fuzzy match using normalized name tokens
  # e.g. "boneless chicken breast" matches "chicken breast"
  best = pantry
    .map(item => { item, score: fuzzy_score(item.item_name, ingredient_name) })
    .filter(result => result.score > 0.8)
    .sort(by=score, descending=true)
    .first()

  return best?.item ?? null
```

Use the same fuzzy matching library chosen during Phase 1 receipt normalization for consistency.

---

## Aspirational Buyer Signal

Track recipe suggestion dismissals to identify ingredients the user buys but doesn't cook with.

```
on_recipe_dismiss(user_id, recipe_id):
  recipe_ingredients = spoonacular.get_ingredients(recipe_id)
  
  for ingredient in recipe_ingredients:
    pantry_item = find_best_match(pantry, ingredient.name)
    if pantry_item:
      # Increment a soft counter — not stored on pantry_items
      # Stored on a separate signals table
      signals.upsert({
        user_id: user_id,
        item_name: pantry_item.item_name,
        dismiss_count: +1
      })

# Items with dismiss_count >= 3 are deprioritized:
# Reduce their effective confidence by 0.15 in score_recipe
# before computing final_score (not before tier assignment)
```

This deprioritizes aspirational ingredients in recipe ranking without removing them from the pantry.

---

## Test Scenarios

Run these against mock pantry states before Phase 4 begins.

| Scenario | Pantry state | Expected output |
|---|---|---|
| All high-confidence pantry | Chicken 0.95, spinach 0.90, garlic 0.80 | Frittata in cook_tonight |
| One borderline item | Chicken 0.95, spinach 0.55, garlic 0.80 | Frittata in probably_have |
| Use soon spinach | Spinach use_soon=true, chicken 0.90 | Spinach+chicken recipe in use_soon_shelf |
| Multiple use soon | Spinach use_soon + chicken use_soon | Recipe using both scores 2.0 boost, tops use_soon shelf |
| Spice only uncertainty | Chicken 0.90, paprika 0.40 (soft_required) | Recipe in cook_tonight — spice doesn't drop tier |
| Low protein confidence | Chicken 0.15 | Recipe suppressed |
| Unknown staple | Paprika manually added, quantity unknown (0.40) | Recipe not suppressed — paprika is soft_required |

---

## Definition of Done

- [ ] `get_recipe_suggestions` returns correctly structured `SuggestionResult`
- [ ] `use_soon_shelf` only populated when `use_soon` items exist and recipe uses them as primary ingredients
- [ ] Soft-required ingredients confirmed to not affect tier assignment
- [ ] Aspirational buyer signal correctly reduces score (not tier) for repeatedly dismissed ingredients
- [ ] Ingredient fuzzy matching handles common name variations (tested with 10 real receipt names vs Spoonacular names)
- [ ] Spoonacular candidate fetch is cached — not called on every function invocation
- [ ] All 7 test scenarios produce expected output

---

## Implementation History

Cursor plan doc: _link after plan run_

Phase 1 Cursor plan doc: _link from Phase 1 implementation history_

Phase 2 Cursor plan doc: _link from Phase 2 implementation history_

Deviations from this document: _see plan doc above_
