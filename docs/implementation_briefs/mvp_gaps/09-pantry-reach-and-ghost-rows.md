# MVP Gap 09 — Pantry thumb reach + nameless ghost rows

> **Prerequisite:** Pantry Phase 4.4 view is shipped (`Pantry.jsx` / `PantryList.jsx` / `PantryItem.jsx`). Product rules in [`docs/PRODUCT_BRIEF.md`](../../PRODUCT_BRIEF.md) (pantry is a belief list, not a counted inventory; add is an escape hatch). Layer 2 already allows a FAB: [`pantry-layer-2-search.md`](../pantry-layer-2-search.md).
>
> **Scope:** Two sequential sub-phases. **09.1** stop nameless pantry rows from being inserted or shown. **09.2** move Add to a bottom-right FAB above the tab bar and unify the add entry points.
>
> **Do NOT touch in 09.1:** `Pantry.jsx`, `PageHeader.jsx`, tab bar, overlays, voice UI, suggestion ranking, cook loop, `upsert_pantry_item` RPC, CHECK constraints, quantity display rules on named rows.
>
> **Do NOT touch in 09.2:** backend, migrations, `receipt_processor.py`, `PageHeader.jsx` API, `BottomTabBar.jsx`, `GraveyardSection.jsx`, quantity formatting on named rows.

---

## Objective

The pantry list must not open on a blank row (`quantity=1` / `unit=count`, no name). Add must sit in the right-thumb zone on a phone with a bottom tab bar, without teaching manual entry as the primary job.

This is **not** a quantity-system rewrite, a staples-template change, or a new add API.

---

## Architecture (locked)

### Domain boundaries

| Domain | Owns | Does not own |
|---|---|---|
| **Ingest** (`PantryService.add_to_pantry`, `batch_add_or_merge_items`, `ReceiptProcessor`) | Reject / skip rows with no displayable name | UI chrome, FAB, overlay z-index |
| **Read model** (`get_pantry_summary`) | Omit nameless live rows from `items` / `grouped` / `total_items` | `_get_pantry_items` (cook, suggestions, merge still see raw rows; they already skip blank bases) |
| **Cleanup** (one-shot migration) | Soft-delete existing nameless live rows **without** writing `depletion_history` | Graveyard UX, hard-delete (FK `ON DELETE RESTRICT`) |
| **Pantry screen** (`Pantry.jsx`) | FAB placement, which sheet Add opens, empty-state CTA | New endpoints, PageHeader component contract |

### Why the ghost row always sits on top

`get_household_pantry` / `get_user_pantry` order by `base_ingredient` ascending. Postgres `''` sorts first. `PantryItem` displays `normalized_name || base_ingredient`. Receipt fallback when quantity_info is missing is `quantity=1`, `unit='count'`. A blank ingest therefore renders as an unnamed top row with `1 count`.

`TEXT NOT NULL` allows `''`. Quick-add and voice already reject blank labels. Receipt ingest and `add_to_pantry` do not.

### API contract

**No new routes. No response-key changes.**

`GET /api/pantry` keeps `{ total_items, unique_ingredients, items, grouped, household_id }`. After 09.1, nameless live rows are absent from `items` / `grouped` and not counted in `total_items`. Clients that only render `items` (current `Pantry.jsx`) stop showing the ghost without a frontend deploy — 09.2 still filters client-side as belt-and-suspenders.

`POST /api/pantry/items` already 400s on missing `base_ingredient`. Whitespace-only `" "` is truthy at the route; **09.1 rejects it in the service** (`ValidationException` → existing 400 handler). Do not change the route signature.

`POST /api/pantry/quick-add` already strips and 400s on empty base. No change.

Receipt ingest: a nameless normalized payload is **skipped** (same as `normalized is None`), not appended to `errors`. Do not mark the receipt `processed_with_errors` for junk lines.

### Migration needs

Latest numbered pantry migration is `030_unit_item_days_supply.sql`. Add **`031_soft_delete_blank_pantry_rows.sql`**.

- `UPDATE pantry_items SET deleted_at = now() WHERE deleted_at IS NULL AND btrim(coalesce(base_ingredient, '')) = '' AND btrim(coalesce(normalized_name, '')) = '';`
- **Do not** call `soft_delete_pantry_item` / write `depletion_history` (would leak unnamed rows into the graveyard).
- Partial unique indexes are `WHERE deleted_at IS NULL`, so the `('', variant, unit)` slot is freed.
- **Do not** add a CHECK constraint in this slice (RPC restore, sandbox, and tests that insert edges would break). Follow-up only.

### Coupling risks

1. **`add_to_pantry` swallows `ValidationException`.** The method’s `except Exception` wraps everything as `DatabaseException`. Raise the blank-name `ValidationException` **before** the `try`, or re-raise `ValidationException` explicitly. Otherwise `POST /pantry/items` returns 500 and receipt ingest records an error.
2. **Do not filter `_get_pantry_items`.** Merge/resurrect uses `include_deleted=True`. Suggestions / cook already skip blank bases. Changing the getter would ripple through depletion, meal plan, and sandbox.
3. **FAB vs tab bar.** `BottomTabBar` is `fixed bottom-0 z-50`, height token `pb-tab-bar` = `64px + safe-area`. FAB must sit *above* that, `z-40` (below tab and below add-menu `z-[60]` / search overlay `z-[70]`). Do not change the tab bar.
4. **Two Add entry points today.** Header `Add item` opens search overlay. Empty-state `Add your first item` opens Search / Tell me. 09.2 unifies both to the existing add menu. Do not add a third flow.
5. **Last-row occlusion.** FAB covers the bottom-right of the list. Add bottom padding on the pantry column so the last row and graveyard stay tappable.
6. **Health card** reads `get_pantry_summary`. Filtering there is enough; do not touch `pantry_health_card`.

### Assumptions (not blocking)

- FAB is icon-only `Plus`, `aria-label="Add item"`. Not a labeled pill. Add stays an escape hatch.
- Empty-state primary button stays; FAB also shows on empty (same menu).
- Desktop (`lg+`, no tab bar): same FAB, `lg:bottom-6`. No header button.
- Hide FAB while search overlay, voice sheet, or add menu is open.
- Named rows may still show `1 count` when that is stored. Out of scope. The ghost row going away is the “count: 1” bug the user reported.
- Left-handed users lose a little reach; keep Material bottom-right.

---

## Product rules (locked)

- Nameless rows are never a user-facing pantry item.
- Add is reachable one-handed; it is not the 5pm job. Do not enlarge copy or add onboarding to the FAB.
- Do not ask the user to “clean up” the ghost row.

---

## Technical Contract

### Shared predicate (09.1)

Add a module-level function in [`backend/services/pantry_service.py`](../../../backend/services/pantry_service.py):

```python
def pantry_item_has_display_name(item: Optional[Dict[str, Any]]) -> bool:
    if not item:
        return False
    name = (item.get("normalized_name") or "").strip()
    base = (item.get("base_ingredient") or "").strip()
    return bool(name or base)
```

A row is nameless iff this returns False. Whitespace-only counts as nameless.

### Phase 09.1 — Nameless rows

#### `PantryService.add_to_pantry`

If `not pantry_item_has_display_name(normalized_item)`, raise `ValidationException` with a stable message: `"Ingredient name is required"`. Must not hit `upsert_pantry_item`. Must not be wrapped as `DatabaseException`.

#### `PantryService.batch_add_or_merge_items`

After reading `bi` / `nn`, skip the canonical item when `not pantry_item_has_display_name({"base_ingredient": bi, "normalized_name": nn})`. Same as today’s `if not bi: continue`, but also skip whitespace. Do not insert `quantity=1, unit=''` for those.

#### `PantryService.get_pantry_summary`

After the live (`deleted_at` is None) list, drop items where `not pantry_item_has_display_name(item)` before grouping. Recompute `total_items` / `unique_ingredients` from the filtered list.

#### `ReceiptProcessor` (process-one-receipt loop)

In [`backend/services/receipt_processor.py`](../../../backend/services/receipt_processor.py), next to `if normalized is None: continue`, skip when `not pantry_item_has_display_name(normalized)`. Log at info, increment `items_processed`, do **not** append to `errors`, do **not** call `add_to_pantry`. Import the helper from `pantry_service` (avoid a third copy).

#### Migration `supabase/migrations/031_soft_delete_blank_pantry_rows.sql`

One-shot `UPDATE` as specified above. Idempotent: second run updates zero rows. Comment must state: no `depletion_history` write; graveyard stays clean.

### Phase 09.2 — Add FAB

#### [`frontend/src/pages/Pantry.jsx`](../../../frontend/src/pages/Pantry.jsx)

1. Remove `actions={...Add item...}` from `PageHeader`.
2. `activeItems` also drops rows where both `normalized_name` and `base_ingredient` are missing after trim (client filter; 09.1 already omits them).
3. Fixed FAB:
   - `type="button"`, `aria-label="Add item"`
   - `Plus` icon only, `btn btn-primary`, `min-h-touch min-w-touch`, rounded
   - `className` includes `fixed right-4 z-40` and bottom `bottom-[calc(4rem+env(safe-area-inset-bottom,0px)+1rem)] lg:bottom-6`
   - `onClick` → `setAddMenuOpen(true)` (same menu as empty-state)
   - Render when `userId` and not `loading` and not `searchOverlayOpen` / `voiceOpen` / `addMenuOpen`
4. Empty-state `Add your first item` stays; still `setAddMenuOpen(true)`.
5. Add `pb-24` (or equivalent) on the column below the header so the last list row / graveyard is not under the FAB.

Do not extract a new component file. Do not change `PantrySearchOverlay` or `VoiceInputSheet`.

---

## Logic Guardrails

- Blank-name reject happens at the **service**, not only the UI.
- Receipt skip ≠ receipt error.
- `get_pantry_summary` filter does not change `_get_pantry_items`.
- Cleanup is `deleted_at` only; never `DELETE FROM pantry_items` (RESTRICT on `depletion_history.pantry_item_id`).
- FAB `z-40` < tab `z-50` < add menu `z-[60]` < search overlay `z-[70]`.
- FAB must not sit on the Pantry tab; it sits in the padded content zone.
- Do not open search overlay directly from the FAB (today’s header behavior). Always the Search / Tell me menu.

---

## Test-First Suite

Scaffold tests **before** implementation. Named cases:

### 09.1 — `tests/services/test_pantry_service.py`

1. `test_add_to_pantry_rejects_blank_base_and_name` — empty strings; `upsert_pantry_item` not called; `ValidationException`.
2. `test_add_to_pantry_rejects_whitespace_only_name` — `"   "` base and name.
3. `test_add_to_pantry_blank_raises_validation_not_database` — assert exception type is `ValidationException` (not wrapped).
4. `test_get_pantry_summary_omits_nameless_rows` — mix named + `{base_ingredient:'', normalized_name:''}`; `total_items` / `items` / `grouped` exclude the nameless row.
5. `test_batch_add_skips_blank_canonical_item` — one blank + one named in the list; only named inserted.

### 09.1 — `tests/services/test_receipt_processor.py`

6. `test_blank_normalized_name_skipped_not_errored` — `normalized` with empty base/name; `add_to_pantry` not called; `errors == []`; `items_added` does not include it.

### 09.2 — `frontend/src/tests/PantryView.test.jsx`

7. `ADD_FAB_OPENS_ADD_MENU` — no header button named `/add item/i`; FAB `aria-label="Add item"` opens the `Add to pantry` dialog (Search + Tell me).
8. `EMPTY_STATE_AND_FAB_SHARE_MENU` — empty pantry still has `Add your first item`; both open the same dialog.
9. `NAMELESS_ROW_NOT_RENDERED` — API returns a nameless `quantity:1, unit:'count'` row plus a named row; named row visible; no empty-title row / no lone `1 count` as a row.
10. `FAB_HIDDEN_WHEN_ADD_MENU_OPEN` — after opening the menu, the FAB control is not in the document.

---

## Definition of Done

### 09.1

- [ ] Named tests 1–6 exist and pass.
- [ ] Migration `031_soft_delete_blank_pantry_rows.sql` is present and idempotent.
- [ ] Logic Audit: a receipt line that normalizes to empty name does not create a pantry row and does not fail the receipt.
- [ ] Logic Audit: `GET /api/pantry` never returns a live item with both names blank/whitespace.
- [ ] No CHECK on `pantry_items`; no RPC change; `_get_pantry_items` signature unchanged.

### 09.2

- [ ] Named tests 7–10 exist and pass.
- [ ] Header has no Add button. FAB is bottom-right, above tab-bar padding, icon-only.
- [ ] FAB and empty-state CTA open the existing Search / Tell me menu.
- [ ] Logic Audit: with the tab bar visible, the FAB does not overlap tab icons (position uses `4rem + safe-area + 1rem`).
- [ ] Logic Audit: last pantry row remains tappable (`pb-24` or equivalent).

---

## Out of scope (explicit)

- Hiding `1 count` on **named** items.
- CHECK constraint / DB trigger on `base_ingredient`.
- Filtering `_get_pantry_items` or changing suggestion/cook matching.
- New add API, voice changes, staples template.
- Left-handed FAB placement.
- Desktop header dual-CTA.
