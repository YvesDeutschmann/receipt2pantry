# Mise Depletion System — Phase 4: UI Surfaces

> **Reference:** Read `mise-depletion-master.md` before this document. Read the Phase 1, 2, and 3 Cursor plan docs (linked in their respective implementation history sections) for any decisions made during implementation that differ from spec. This document defines only the scope of Phase 4.

---

## Objective

Implement the UI surfaces that expose pantry state and recipe suggestions to the user. All data is provided by Phase 3's `get_recipe_suggestions` and Phase 2's depletion engine. This phase is rendering and interaction only — no new logic.

The guiding principle for every surface: **correction should feel like a swipe, not a form.** Users should never feel like they're doing data entry.

---

## Deliverable

Four UI surfaces, fully implemented:

1. Recipe suggestion screen with tiered shelves
2. Graveyard (recently removed items)
3. Weekly pantry health card
4. Full pantry view (passive, always available)

---

## Surface 1: Recipe Suggestion Screen

This is the primary screen. It renders the `SuggestionResult` from Phase 3.

### Shelf order (top to bottom)

```
[Use Before It's Gone shelf]   — only shown when use_soon items exist
[Cook Tonight shelf]
[Probably Have Everything shelf]
[Quick Check Needed shelf]
```

Never show an empty shelf header. If `use_soon_shelf` is empty, the shelf and its header do not render.

### Use Before It's Gone shelf

```
┌─────────────────────────────────────────┐
│  🕐  Use before it's gone               │
│  Recipes using your [item name(s)]      │
│                                         │
│  ┌──────────┐  ┌──────────┐            │
│  │ Recipe A │  │ Recipe B │            │
│  └──────────┘  └──────────┘            │
└─────────────────────────────────────────┘
```

- Header copy uses actual item names: "Recipes using your spinach and chicken"
- If 3+ use_soon items, truncate to: "Recipes using what needs using up"
- Cards in this shelf display a subtle amber border to visually distinguish from other tiers
- For any use_soon item that was resurrected from the graveyard (put_back_count > 0), add one line below the recipe card: "⚠️ Check before cooking — this was past its use-by date"
  - This applies only to meat and fish sub-classes
  - No modal, no required acknowledgment — just visible, honest copy

### Cook Tonight shelf

Standard recipe cards. No qualifiers. Green confidence indicator (dot or subtle border).

### Probably Have Everything shelf

Slightly muted styling (reduced opacity or lighter card background). No additional copy needed — the tier name communicates the uncertainty.

### Quick Check Needed shelf

Recipe card includes a callout below the title naming the uncertain ingredient:

```
┌────────────────────────────────────────┐
│  Pasta e Fagioli                       │
│  ⚠️  Confirm you still have: olive oil │
└────────────────────────────────────────┘
```

Only name the ingredient with the lowest confidence score. Do not list all uncertain ingredients — that feels alarming. One item, one line.

### Recipe card ingredient detail (on expand)

When user taps a recipe card, the expanded view shows the ingredient list with inline status indicators:

```
Chicken breast      ● confirmed
Spinach             ◐ probably have — check freshness
Garlic              ● confirmed
Olive oil           ○ check your pantry
Paprika             ~ check spice rack
```

- `●` confirmed (≥ 0.75)
- `◐` probably have (0.50–0.74)
- `○` check pantry (0.20–0.49)
- `~` soft-required (spice/herb, always shown with "check spice rack")

Tapping any ingredient shows a one-tap correction:

```
Olive oil
○ Still have it    ○ Used it up    ○ Never had it
```

Three options. One tap. Dismiss automatically. No save button. This is the inline pantry correction flow — it requires no navigation away from the recipe.

### Mark as Cooked

A prominent button on every recipe card (and expanded view):

```
[  ✓  Cooked it  ]
```

Tapping this:
1. Calls `process_cook_event` from Phase 2
2. Decrements UNIT_ITEM quantities
3. Clears `use_soon` flag for any use_soon ingredients in the recipe
4. Shows a brief confirmation ("Nice! Pantry updated.")
5. Re-fetches suggestion list

Make this button visually satisfying. It does real work — it's the highest-value user action in the app.

### Recipe dismiss

Swipe left on any recipe card to reveal a single action: "Don't have this."

```
[Recipe card] →→→ swipe left →→→ [ ✗ Don't have this ]
```

Tapping "Don't have this":
1. Calls `on_recipe_dismiss` from Phase 3 (increments dismiss signal)
2. Removes recipe from current suggestion list with a brief animation
3. No confirmation, no explanation asked

Do not ask which ingredient is missing. The dismiss signal is enough at MVP.

---

## Surface 2: Graveyard

Shown at the bottom of the full pantry view. Not a dedicated screen — a section.

### Layout

```
Recently Removed
──────────────────────────────────────────

Spinach          removed today          [Put back]
  💡 Put it back and we'll show you recipes to use it tonight →

Chicken breast   removed 3 days ago     [Put back]

Ground beef      removed 5 days ago     [Put back]
──────────────────────────────────────────
```

- Only show items removed within the last 7 days
- The "use it tonight" prompt shows only for the most recently removed item, not all items
- If `put_back_count >= 1` and `sub_class IN (raw_meat, raw_fish)`, do not show a "Put back" button — silently omit the item or show "Removed" with no action. Do not explain why.

### Put back behavior

Tapping "Put back":
1. Calls `process_put_back` from Phase 2
2. Sets `use_soon = true`, `use_soon_expires = today + 2 days`
3. If MAX_PUT_BACK_REACHED error is returned: show nothing (item should not have a button — see above)
4. Immediately refreshes recipe suggestion screen to show use_soon shelf
5. Brief animation: item slides out of graveyard, use_soon shelf fades in at top of recipe screen

The transition from graveyard to use_soon shelf should feel connected and immediate. The user just told the app something meaningful — the app should respond visibly.

---

## Surface 3: Weekly Pantry Health Card

A non-intrusive nudge that appears at the bottom of the recipe suggestion screen once per week. Not a notification. Not a modal. A card.

### Trigger logic

```
show_health_card = (
  days_since_last_health_card >= 7
  AND low_confidence_items.count > 0
)

low_confidence_items = pantry_items
  .where(deleted_at IS NULL)
  .filter(item => compute_confidence(item) BETWEEN 0.20 AND 0.60)
  .sort(by=confidence, ascending=true)
  .limit(5)
```

Show after a natural moment — ideally right after the user taps "Cooked it." Timing matters: the user is already engaged and has just done something satisfying.

### Layout

```
┌──────────────────────────────────────────┐
│  Quick pantry check  •  30 seconds       │
│                                          │
│  Olive oil        [✓ Still have it]  [✗] │
│  Paprika          [✓ Still have it]  [✗] │
│  Soy sauce        [✓ Still have it]  [✗] │
│                                          │
│                          [Done, thanks]  │
└──────────────────────────────────────────┘
```

- Show 3–5 items maximum. Never more.
- Two buttons per item: "Still have it" (sets confidence anchor, resets decay timer) and "✗" (marks as used up, triggers soft delete with reason=USER_REMOVED)
- "Done, thanks" dismisses and records `last_health_card_shown = today`
- No quantities. No dates. No categories. Two taps per item maximum.

### On "Still have it" tap

```
pantry_item.confidence_override = 0.80
pantry_item.confidence_override_expires = today + 14 days
```

This is the one place where an override confidence is stored — but only as a temporary anchor, not a permanent replacement for the computed score. After 14 days, it expires and the computed score takes over again.

### On "✗" tap

```
copy_to_depletion_history(item, reason='USER_REMOVED')
pantry_items.soft_delete(item)
```

Immediately removes from pantry. No undo offered here — the user just confirmed it's gone.

---

## Surface 4: Full Pantry View

A scrollable list of all current pantry items. Always available from navigation. Never required.

### Layout

```
Pantry
─────────────────────────────────────────
FRESH

  Chicken breast       Fresh
  Eggs                 Fresh
  Milk                 Fresh

GETTING LOW

  Olive oil            Getting low
  All-purpose flour    Getting low

UNCERTAIN

  Paprika              Check spice rack
  Soy sauce            Probably still there

─────────────────────────────────────────
Recently Removed
  [Graveyard section — see Surface 2]
```

### Status labels by confidence

| Confidence | Label |
|---|---|
| ≥ 0.75 | Fresh / In stock |
| 0.50–0.74 | Probably still there |
| 0.20–0.49 | Getting low / Check pantry |
| < 0.20 | Likely gone (faded text) |

Perishables use "Fresh / Use soon / Likely gone." Consumables use "In stock / Getting low / Likely gone." Do not use the same language for both — the mental model is different.

### Interaction

Swipe left on any item: reveals "Remove" (one action, no confirmation).

Tap any item: shows the same three-option correction as the recipe expanded view:
```
Olive oil
○ Still have it    ○ Used it up    ○ Never had it
```

**What is not in this view:**
- No quantity editing fields
- No expiry date entry
- No category management
- No batch edit mode
- No sorting or filtering controls (MVP)

---

## State Transitions Summary

All UI state changes that trigger backend calls:

| User action | Backend call | UI response |
|---|---|---|
| Tap "Cooked it" | `process_cook_event` | Re-fetch suggestions, brief confirmation |
| Swipe dismiss recipe | `on_recipe_dismiss` | Remove card with animation |
| Tap ingredient correction (used it up) | `soft_delete` with reason=USER_REMOVED | Remove from pantry, re-fetch |
| Tap ingredient correction (still have it) | Set `confidence_override` | Update ingredient indicator |
| Tap "Put back" | `process_put_back` | Slide out of graveyard, show use_soon shelf |
| Health card "Still have it" | Set `confidence_override` | Update item status label |
| Health card "✗" | `soft_delete` with reason=USER_REMOVED | Remove item from pantry view |

---

## Definition of Done

- [ ] Recipe suggestion screen renders all four tiers correctly, including empty-shelf suppression
- [ ] Use soon shelf only appears when `use_soon` items exist
- [ ] Meat/fish put-back disclaimer copy renders on use_soon shelf cards (not all cards)
- [ ] "Cooked it" button triggers `process_cook_event` and refreshes suggestions
- [ ] Recipe dismiss (swipe left) triggers dismiss signal and removes card
- [ ] Graveyard shows only last-7-day removals
- [ ] "Put back" correctly blocked (no button shown) for raw_meat/raw_fish at put_back_count ≥ 1
- [ ] Put back immediately surfaces use_soon shelf on recipe screen
- [ ] Weekly health card appears no more than once per 7 days, after a cook event
- [ ] Full pantry view shows correct status labels by confidence range
- [ ] Full pantry view swipe-to-remove works and triggers soft delete
- [ ] No quantity editing fields exist anywhere in the UI

---

## Implementation History

Cursor plan doc: _link after plan run_

Phase 1 Cursor plan doc: _link from Phase 1 implementation history_

Phase 2 Cursor plan doc: _link from Phase 2 implementation history_

Phase 3 Cursor plan doc: _link from Phase 3 implementation history_

Deviations from this document: _see plan doc above_
