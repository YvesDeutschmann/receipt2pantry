# Code Review: Close three pantry trust gaps

**Feature:** UNIT_ITEM time-decay, ranking-only swipes + honest correction, cook-capture instrumentation  
**Plan:** `.cursor/plans/close_three_pantry_trust_gaps_fe0638db.plan.md`  
**Review date:** 2026-09-08  
**Reviewer:** AI code review  
**Scope:** Uncommitted pantry-trust-gap work (not `frontend/android/.../network_security_config.xml`)

## Executive summary

**Not approved as-is.** Gap 1 (UNIT_ITEM decay) is solid and already applied remotely. Gaps 2 and 3 have several behavioral misses against the plan: the honest correction path is hidden on the pool-first Recipes screen, correction taps on `check_first` cards will also open the detail modal, and the “sticky” Cooked it footer still sits below the instructions in AdaptiveModal’s scroll container.

### Summary of findings

- 3 high-severity behavioral bugs
- 4 medium issues (wiring, data alignment, leftover docs, missing tests)
- 3 low / test-quality notes

---

## 1. Plan implementation

| Todo | Status | Notes |
|---|---|---|
| UNIT_ITEM `min(event_band, time_ceiling)` | Done | Signature, denom, no-anchor → 1.00 |
| `UNIT_ITEM_DEFAULT_DAYS_SUPPLY` + migration 030 | Partial | Constant exists; production callers usually pass `calibrated_days` with a **45** fallback, so 90 rarely applies. 030 correctly uses `sub_class` (fixed before apply). |
| UNIT_ITEM tests | Done | Existing no-anchor tests still 0.90 / 0.60 / 0.00 |
| Swipe overlay “Not tonight” | Done | |
| Pool swipe increments `ingredient_signals` | Partial | Implemented, but only from `recipe_data.extendedIngredients` |
| Ranking-only comment + regression test | Weak | Comment added; test does not pass dismiss counts into `compute_confidence` |
| `check_first` IngredientCorrection | Partial | Wired, but shelf is not shown when `usingPool` |
| Docs | Partial | PRODUCT_BRIEF updated; implicit-signals table still wrong |
| Repeatable telemetry | Done | Client + route + migration 031 applied |
| Sticky Cooked it | Miss | `sticky bottom` last child inside overflow scroller |
| Exit confirm | Done with caveats | 30s + instructions intersection; empty `instructions` skips it |

---

## 2. Findings (severity order)

### High

#### H1. `check_first` correction never shows on the dominant Recipes path

`fetchSuggestionsPayload` prefers a warm pool. When `usingPool` is true, Recipes renders only `use_soon_shelf` + pool `cook_tonight`. `check_first` is inside the live-suggestions branch.

```614:631:frontend/src/pages/Recipes.jsx
              {usingPool ? (
                renderShelf(
                  'cook_tonight',
                  'Ready to cook',
                  'From your suggestion pool',
                  suggestions.cook_tonight
                )
              ) : (
                <>
                  ...
                  {renderShelf('check_first', 'Quick check needed', null, suggestions.check_first)}
                </>
              )}
```

The plan called pool the dominant path and Gap 2d the “unambiguous signal, captured at the moment the app admits doubt.” That moment is gated off whenever the pool has unused rows.

**Fix:** Render `check_first` (and probably `probably_have`) even when pool fills cook-tonight, or put the trigger-ingredient correction on pool cards another way.

#### H2. Correction buttons on the swipe card also expand the recipe

`Cooked it` calls `e.stopPropagation()`. `IngredientCorrection` buttons do not, and they sit inside `motion.div` `onTap={() => onExpand(recipe)}`.

Tapping “Still have it” / “Used it up” will fire the correction **and** open the detail modal (and may start a drag). Tests hide this because the framer-motion mock ignores `onTap` when the target is a `button`.

**Fix:** Stop pointer/click propagation on the correction block (same as Cooked it), and consider `onTap` filters.

#### H3. Cooked it is not actually sticky while reading steps

AdaptiveModal puts **all** children in `overflow-y-auto`. The new footer is a **sibling after** the long instructions block with `sticky bottom-0`. Sticky-bottom on a last child does not pin a bar for preceding content; the button stays below the fold until the user scrolls to the end (it may stick only when scrolling back up from the end).

The plan: “stays visible while reading steps.”

**Fix:** Footer slot **outside** the scroll pane (flex column: header / scroll body / footer), not `sticky` inside the scroller.

---

### Medium

#### M1. `UNIT_ITEM_DEFAULT_DAYS_SUPPLY = 90` is bypassed in production

`_unit_item_time_ceiling` uses `calibrated_days` first. Pantry GET and `score_recipe` always pass `calibrated_days` from `get_calibrated_days_supply(..., default)` where missing classification default becomes **45**, not 90:

```121:122:backend/routes/pantry.py
        default_days = cls.get("default_days_supply") or 45
        cal = get_calibrated_days_supply(client, user_id, base, int(default_days))
```

Same pattern in `suggestion_service.py` (`calibrated_for`). After 030, `grain_pasta`/`canned_goods` are fine. The 11 `international` UNIT_ITEM rows still NULL will decay on a 45-day ladder, not 90.

#### M2. Pool swipe may still increment nothing

`on_pool_swipe` only reads `recipe_data.extendedIngredients`. Complex-search snapshots always store `usedIngredients` / `missedIngredients` (`fillIngredients`); `extendedIngredients` can be empty even when those lists are not.

If a stored pool row has no `extendedIngredients`, swipe still marks `swiped` and the ranking signal stays dead — the original production bug, for a subset of rows.

**Fix:** Fall back to `usedIngredients` + `missedIngredients` names, same as cook BOM / search transform.

#### M3. Implicit-signals table still contradicts the product rule

`docs/PRODUCT_BRIEF.md` and the top of `meald-depletion-master.md` were updated. This table was not:

```189:191:docs/implementation_briefs/depletion-logic/meald-depletion-master.md
| Recipe marked as cooked | Decrement all ingredients by recipe quantity |
| Recipe dismissed ("I don't have this") | High-confidence item is actually gone — recalibrate |
```

Plan 2e called this out specifically.

#### M4. Missing tests the plan asked for

- No `emitRepeatable` tests (`funnelTelemetry.test.js` still only covers idempotent `emit`).
- No telemetry route test that `cook_logged` / `recipe_detail_opened` insert into `funnel_repeatable_events` rather than upserting `funnel_events`.
- `test_compute_confidence_ignores_dismiss_signal_counts` never supplies dismiss counts; `compute_confidence` has no such argument, so the test cannot fail if someone later threads signals in.
- `ASPIRATIONAL_*` tests were not updated to assert ranking-only vs belief.
- Exit-confirm tests cover “after threshold” but not “does not appear before threshold.”
- Exit-confirm tests replace `global.IntersectionObserver` and never restore it.

---

### Low

#### L1. Exit confirm depends on truthy `display.instructions`

The observer is attached only when `display.instructions` is truthy. Spoonacular rows with `analyzedInstructions` but empty `instructions` never set `instructionsReached`, so the bar never appears. Pool snapshots that omit instructions have the same outcome — then “Yes, cooked it” is also the path that was supposed to avoid the empty-BOM dead end, and it never runs.

#### M-adjacent: `showNeverHadIt={false}` on check_first

Plan said reuse IngredientCorrection (three actions). “Never had it” is hidden. Consistent with post-cook perishable prompt, but it drops a valid belief update on the “do you still have X?” line.

#### L2. Local vs remote migration versions

Remote history is timestamped (`20260908232104_unit_item_days_supply`, `20260908232109_repeatable_funnel_events`). Repo files are `030_` / `031_`. A later `db push --linked` can try to apply them again. 030 is idempotent; 031 `CREATE POLICY` is not.

#### L3. Unrelated dirty file

`frontend/android/app/src/main/res/xml/network_security_config.xml` is modified on this branch and is not part of this feature.

---

## 3. Data alignment

| Location | Expected | Risk |
|---|---|---|
| Pool swipe ingredients | `recipe_data.extendedIngredients` | Search payload often puts names on `usedIngredients` / `missedIngredients` |
| UNIT_ITEM days supply | 60 / 180 / 90 | Callers substitute 45 when classification default is null |
| Telemetry events | `recipe_detail_opened`, `cook_logged` | Backend `REPEATABLE_EVENTS` matches; client `FunnelEvent` matches; flush key uses `entryId` for repeatable |
| `session_id` column | UUID | Client `crypto.randomUUID()` — OK |
| `handleDetailClose(meta)` | Object from `requestClose` | AdaptiveModal X/backdrop go through `requestClose` — OK |
| Cook telemetry `recipeId` | `recipeIdForCook \|\| id` | Matches expand metadata — OK |

---

## 4. Over-engineering / size

No new files that need splitting. `SuggestionDetailModal` grew close/observer/sticky logic but is still one screen. `emit` + `emitRepeatable` is the right split.

---

## 5. Security

- Repeatable ingest still binds `user_id` from JWT. Good.
- `funnel_repeatable_events` has RLS. 031 does not follow 022’s explicit GRANT list or 026’s anon revoke; new public tables can pick up default privileges. Worth a GRANT/REVOKE pass if Data API defaults still include `anon`.
- Advisors after apply were pre-existing (security definer views, etc.), not introduced by 031.

---

## 6. What looks correct

- Event band 0.90 / 0.60 / 0.00 unchanged; time ceiling 1.00 / 0.60 / 0.20 / 0.10 as specified; empty remaining stays 0.
- No-anchor path keeps existing UNIT_ITEM unit tests green.
- Swipes still do not flow into `compute_confidence`.
- Pool swipe does not call Spoonacular (`get_recipe_details` asserted unused).
- Exit confirm does not block close; suppress set on cook or “Not this time.”
- Successful cook from the bar can keep `poolSuggestionId` via `_fromPool` + `id`.
- 030 applied remotely: 27 `grain_pasta` @ 60, 21 `canned_goods` @ 180.

---

## Recommended merge bar

1. Stop propagation on check_first correction controls (H2).  
2. Put the Cooked it footer outside AdaptiveModal’s scroll region (H3).  
3. Show `check_first` (or an equivalent trigger correction) when the pool is warm (H1).  
4. Fix the implicit-signals row (M3); add repeatable telemetry tests (M4).  
5. Align UNIT_ITEM null-default with 90 at the `get_calibrated_days_supply` call sites, or drop the unused constant (M1).
