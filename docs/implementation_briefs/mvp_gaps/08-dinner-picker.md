# MVP Gap 08 — Dinner list is a picker (Track 2 + 4)

> **Prerequisite:** Brief `07-home-is-dinner.md` is complete (07.1–07.3 PASS). Track 3 (recipe sheet overlay) is a separate brief.
>
> **Scope:** Two sequential sub-phases. **08.1** additive card DTO on `GET /suggestions` (pool + live). **08.2** picker UI + MISE card chrome on `/recipes`.
>
> **Do NOT touch in 08.1:** Recipes UI, AdaptiveModal, sync mapper/hooks, pool routes (except tests).
>
> **Do NOT touch in 08.2:** AdaptiveModal stacking, ConfidenceIndicator colors, HealthCard, backend tier cutoffs, `get_tier` numbers.

---

## Objective

The dinner list is an eight-second **picker**: photo, time, why-this-meal copy. Tap to cook. Skip without pantry changes. **Cooked it** and ingredient corrections live only in the recipe sheet (Track 3). Visual language uses MISE tokens (`.card`, `.card-accent`, `.eyebrow`, terra/sage), not Phase 4.2 emerald/amber stripes.

---

## Product rules (locked)

- One cook-tonight shelf; client ranks by local time of day; cap 5 then Show more.
- List reads only `GET /suggestions` (no `getPool` for shelves). Keep `getDepth` + generate.
- **Do not re-bucket pool cards with `get_tier`.** Shelf membership stays match_score tiers. Honesty is copy (flags, highlights, trigger line).
- `pantry_highlights` are pantry-matched only (conf ≥ 0.50, non-soft). No raw `usedIngredients` fallback.
- Swipe/cook use `pool_suggestion_id` (pool row UUID), not Spoonacular `id`.

---

## Technical Contract

### Phase 08.1 — Card DTO (backend)

Extend each card on `GET /suggestions`:

```js
{
  readyInMinutes: number | null,
  pantry_highlights: string[],
  meal_type: "breakfast" | "lunch" | "dinner" | null,
  pool_suggestion_id: string | null
}
```

Pool enrich: flag helper (not `score_recipe`), per-row try/except, all pool serve paths including `_pool_fallback_suggestion_result`. Then `_attach_use_soon_when_pool_active`.

Live `score_recipe`: add same fields; `pool_suggestion_id: null`.

### Phase 08.2 — Picker + MISE (frontend)

- `fetchSuggestionsPayload`: `getSuggestions` only.
- Rank/cap cook-tonight; `.eyebrow` shelf labels; drop outer shelf `.card` and pool subtitle.
- `SuggestionRecipeCard`: MISE card, Not tonight button, no list Cooked it / IngredientCorrection.
- Dismiss via `pool_suggestion_id`; optimistic + rollback on network error.
- Reset session refs on `userId` change.

---

## Logic Guardrails

- Pool-first stays uncached.
- Enrichment cannot fail the page.
- Do not put `recipe_data` / `extendedIngredients` on list DTO.
- Do not change match_score cutoffs (0.90 / 0.70) or `get_tier` (0.75 / 0.50 / 0.20).
- Do not feed dismiss signals into `compute_confidence`.

---

## Test-First Suite

### 08.1

- `POOL_CARD_INCLUDES_READYIN_HIGHLIGHTS_MEAL_AND_POOL_ID`
- `POOL_MATCH_SCORE_TIER_UNCHANGED_WHEN_FLAGS_LOW`
- `POOL_USE_SOON_ATTACH_STILL_RUNS`
- `POOL_ENRICH_THROW_KEEPS_THIN_CARD`
- `HIGHLIGHTS_OMITTED_WHEN_NO_PANTRY_MATCH`
- `LIVE_SCORE_RECIPE_INCLUDES_READYIN_AND_HIGHLIGHTS`
- `POOL_FALLBACK_PATH_HAS_POOL_SUGGESTION_ID`

### 08.2

- `LIST_HAS_NO_COOKED_IT_OR_INGREDIENT_CORRECTION`
- `CARD_SHOWS_PHOTO_TIME_AND_USES_LINE`
- `NOT_TONIGHT_BUTTON_DISMISSES_WITHOUT_EXPAND`
- `DISMISS_USES_POOL_SUGGESTION_ID_NOT_RECIPE_ID`
- `DISMISS_NETWORK_ERROR_RESTORES_CARD`
- `NO_POOL_SUBTITLE_AND_NO_OUTER_SHELF_CARD`
- `COOK_TONIGHT_RANKS_DINNER_FIRST_AT_EVENING_AND_CAPS_AT_FIVE`
- `CHECK_FIRST_NAMED_LINE_WITHOUT_LIST_CORRECTION`
- `CARD_KEY_STABLE_FOR_SAME_RECIPE_TWO_SLOTS`
- `SHOW_MORE_AND_SESSION_REFS_RESET_ON_USER_CHANGE`
- `SKIPPED_OVERLAY_USES_ERROR_TOKEN`

---

## Definition of Done

### 08.1

- [x] Pool + live cards include additive DTO fields
- [x] Pool tier unchanged by flag helper
- [x] Fallback pool path enriched
- [x] Named 08.1 tests pass

### 08.2

- [x] Single GET for shelves; no list Cooked it
- [x] MISE card chrome; Not tonight visible
- [x] Swipe/cook use `pool_suggestion_id`
- [x] Named 08.2 tests pass
