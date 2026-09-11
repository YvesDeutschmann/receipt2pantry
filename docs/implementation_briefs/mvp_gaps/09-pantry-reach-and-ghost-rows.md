# MVP Gap 09 — Pantry thumb reach + nameless ghost rows

> **Prerequisite:** Pantry Phase 4.4 view is shipped (`Pantry.jsx` / `PantryList.jsx` / `PantryItem.jsx`). Product rules in [`docs/PRODUCT_BRIEF.md`](../../PRODUCT_BRIEF.md) (pantry is a belief list, not a counted inventory; add is an escape hatch). Layer 2 already allows a FAB: [`pantry-layer-2-search.md`](../pantry-layer-2-search.md).
>
> **Scope:** Two sequential sub-phases. **09.1** stop nameless pantry rows from being inserted, merged, resurrected, or shown. **09.2** move Add to a bottom-right FAB above the tab bar (portaled to `document.body`) and unify the add entry points.
>
> **Do NOT touch in 09.1:** `Pantry.jsx`, `PageHeader.jsx`, tab bar, overlays, voice UI, suggestion ranking, cook loop, `upsert_pantry_item` RPC, CHECK constraints, quantity display rules on named rows, `_get_pantry_items`, a new util module.
>
> **Do NOT touch in 09.2:** backend, migrations, `receipt_processor.py`, `PageHeader.jsx` API, `BottomTabBar.jsx`, `AppShell.jsx`, `PageTransition.jsx`, `GraveyardSection.jsx`, quantity formatting on named rows, a new component file.

---

## Objective

The pantry list must not open on a blank row (`quantity=1` / `unit=count`, no name). Add must sit in the right-thumb zone on a phone with a bottom tab bar, without teaching manual entry as the primary job.

This is **not** a quantity-system rewrite, a staples-template change, or a new add API.

---

## Architecture (locked)

### Domain boundaries

| Domain | Owns | Does not own |
|---|---|---|
| **Ingest** (`PantryService.add_to_pantry`, `batch_add_or_merge_items`, `ReceiptProcessor`) | Reject / skip nameless payloads **before** match / merge / resurrect / upsert | UI chrome, FAB, overlay z-index |
| **Read model** (`get_pantry_summary`) | Omit nameless live rows from `items` / `grouped` / `total_items` | `_get_pantry_items` (cook, suggestions, merge still see raw rows; they already skip blank bases) |
| **Cleanup** (one-shot migration) | Soft-delete existing nameless live rows **without** writing `depletion_history` | Graveyard UX, hard-delete (FK `ON DELETE RESTRICT`), acting as a lock around ingest |
| **Pantry screen** (`Pantry.jsx`) | FAB placement via `createPortal(..., document.body)`, which sheet Add opens, empty-state CTA | New endpoints, PageHeader / AppShell / PageTransition edits |

### Why the ghost row always sits on top

`get_household_pantry` / `get_user_pantry` order by `base_ingredient` ascending. Postgres `''` sorts first. `PantryItem` displays `normalized_name || base_ingredient`. Receipt fallback when quantity_info is missing is `quantity=1`, `unit='count'`. A blank ingest therefore renders as an unnamed top row with `1 count`.

`TEXT NOT NULL` allows `''`. Quick-add and voice already reject blank labels. Receipt ingest and `add_to_pantry` do not.

### Reliability locks (from review)

These are contract, not commentary.

1. **Ingest reject is the invariant. GET filter is display-only.** A live nameless row still occupies the partial unique index `(household_id, base_ingredient, variant, unit) WHERE deleted_at IS NULL`. `_find_exact_pantry_match` / `_find_pantry_by_base` will **merge quantity into it or resurrect it** after migration 031 if a later blank payload is allowed to reach match. `get_pantry_summary` hiding the row does not stop that. Reject / skip **before** those lookups.
2. **Raise `ValidationException` outside `add_to_pantry`’s `except Exception`.** That `except` wraps everything as `DatabaseException` (500 on `POST /pantry/items`, receipt `processed_with_errors`). Raise blank-name before the `try`, or `except ValidationException: raise` then the generic handler. Do not “fix” this by only skipping in the receipt loop.
3. **Receipt skip is before `normalized_items.append`.** Same placement as `if normalized is None`. Skipping after append would record junk as successfully normalized. Do not call `add_to_pantry` (avoids a full `include_deleted` pantry load per junk line). Service reject still required for every other writer.
4. **Migration 031 is best-effort leftover cleanup, not a lock.** Concurrent ingest during migrate is fine if (1) holds. Do not `DELETE`. `depletion_history.pantry_item_id` is `ON DELETE RESTRICT`. Do not write `depletion_history` (graveyard leak). `now()` into `timestamptz` `deleted_at` is enough; do not touch `updated_at` beyond the existing trigger.
5. **FAB `position:fixed` inside `Pantry.jsx` will not stick on web.** `PageTransition` is a `motion.div` with `y` transform (web only). Transformed ancestors are the containing block for `fixed`, and that node lives inside `main.overflow-y-auto`. The FAB would scroll with the page — the whole point of 09.2. Native skips the motion wrapper, so the bug is web-only unless you portal. **Portal to `document.body`**, same as `Recipes.jsx` exit overlay and `AdaptiveModal`. Do not edit `PageTransition` / `AppShell`. `PullToRefresh`’s `relative` wrapper is not the containing-block bug; the transform is.
6. **Do not hide the FAB while `loading`.** Header Add is visible during fetch today. Gating on `loading` makes a hung/slow `getPantry` block the escape hatch. Show when `userId` is set and add/search/voice overlays are closed. Error state included.
7. **No new module for the predicate.** `receipt_processor.py` already imports `PantryService`. Export `pantry_item_has_display_name` from `pantry_service.py`. Do not add `pantryDisplay.js` / `pantry_names.py`. Client 09.2 filter is three trim lines inside `activeItems`, not a shared util.
8. **Do not log the normalized payload.** Existing skip log uses `raw_name` only. No extra user/household ids on this path.

Residual (accepted, not a task): zero-width / non-stripped unicode that `.strip()` leaves; named rows that still show stored `1 count`.

### API contract

**No new routes. No response-key changes.**

`GET /api/pantry` keeps `{ total_items, unique_ingredients, items, grouped, household_id }`. After 09.1, nameless live rows are absent from `items` / `grouped` and not counted in `total_items`.

`POST /api/pantry/items` already 400s on missing `base_ingredient`. Whitespace-only `" "` is truthy at the route; **09.1 rejects it in the service** (`ValidationException` → existing 400 handler). Do not change the route signature.

`POST /api/pantry/quick-add` already strips and 400s on empty base. No change.

Receipt ingest: a nameless normalized payload is **skipped** (same as `normalized is None`), not appended to `errors` or `normalized_items`. Do not mark the receipt `processed_with_errors` for junk lines.

### Migration needs

Latest numbered pantry migration is `030_unit_item_days_supply.sql`. Add **`031_soft_delete_blank_pantry_rows.sql`** (if 031 is taken on the branch, next unused `03x`; do not invent a second timestamped name for this).

- `UPDATE pantry_items SET deleted_at = now() WHERE deleted_at IS NULL AND btrim(coalesce(base_ingredient, '')) = '' AND btrim(coalesce(normalized_name, '')) = '';`
- **Do not** call `soft_delete_pantry_item` / write `depletion_history`.
- Partial unique indexes are `WHERE deleted_at IS NULL`, so the `('', variant, unit)` slot is freed **until a blank ingest resurrects it** — hence lock (1).
- **Do not** add a CHECK constraint in this slice.

### Coupling risks

1. **`add_to_pantry` swallows `ValidationException`.** See reliability lock (2).
2. **Match/resurrect of `base_ingredient=''`.** See lock (1). Skip/reject before `_find_exact_pantry_match` and `_find_pantry_by_base`.
3. **Do not filter `_get_pantry_items`.** Merge/resurrect uses `include_deleted=True`. Suggestions / cook already skip blank bases. Changing the getter ripples through depletion, meal plan, and sandbox.
4. **FAB vs tab bar vs transform.** Portal + `z-40` (tab `z-50`, add menu `z-[60]`, search overlay `z-[70]`, toasts `z-[100]`). Spatially above `pb-tab-bar`. Do not change the tab bar.
5. **Two Add entry points today.** Header `Add item` opens search overlay. Empty-state `Add your first item` opens Search / Tell me. 09.2 unifies both to the existing add menu. Set `searchOverlayOpen` / `voiceOpen` in the same event as closing the menu so React 18 batches and the FAB does not flash.
6. **Last-row occlusion.** FAB covers the bottom-right of the list. `pb-24` on the pantry column (portal does not remove overlay).
7. **Health card** reads `get_pantry_summary`. Filtering there is enough; do not touch `pantry_health_card`.
8. **`restore_pantry_item` can reinsert a nameless snapshot.** Out of scope. GET filter + client filter hide it. Do not block undo.

### Assumptions (not blocking)

- FAB is icon-only `Plus`, `aria-label="Add item"`. Not a labeled pill. Add stays an escape hatch.
- Empty-state primary button stays; FAB also shows on empty (same menu).
- Desktop (`lg+`, no tab bar): same portaled FAB, `lg:bottom-6`. No header button.
- Hide FAB while search overlay, voice sheet, or add menu is open. **Do not** hide for `loading`.
- Named rows may still show `1 count` when that is stored. Out of scope.
- Left-handed users lose a little reach; keep Material bottom-right.

---

## Product rules (locked)

- Nameless rows are never a user-facing pantry item.
- Add is reachable one-handed; it is not the 5pm job. Do not enlarge copy or add onboarding to the FAB.
- Do not ask the user to “clean up” the ghost row.

---

## Technical Contract

### Shared predicate (09.1)

Module-level function in [`backend/services/pantry_service.py`](../../../backend/services/pantry_service.py) (no new file):

```python
def pantry_item_has_display_name(item: Optional[Dict[str, Any]]) -> bool:
    if not item:
        return False
    name = (item.get("normalized_name") or "").strip()
    base = (item.get("base_ingredient") or "").strip()
    return bool(name or base)
```

A row is nameless iff this returns False. Whitespace-only counts as nameless. `None` names coalesce to `''`.

### Phase 09.1 — Nameless rows

#### `PantryService.add_to_pantry`

**First statement of the method body** (before household lookup, before `_get_pantry_items(include_deleted=True)`, before `_find_exact_pantry_match`):

If `not pantry_item_has_display_name(normalized_item)`, raise `ValidationException("Ingredient name is required")`.

Must not hit `upsert_pantry_item`, `update_pantry_quantity`, or `_resurrect_fields`. Must not be wrapped as `DatabaseException`.

#### `PantryService.batch_add_or_merge_items`

After reading `bi` / `nn`, if `not pantry_item_has_display_name({"base_ingredient": bi, "normalized_name": nn})`: `continue` **before** `_find_pantry_by_base`. Do not insert, merge, or resurrect.

#### `PantryService.get_pantry_summary`

After the live (`deleted_at` is None) list, drop items where `not pantry_item_has_display_name(item)` before grouping. Recompute `total_items` / `unique_ingredients` from the filtered list. This does **not** replace ingest reject.

#### `ReceiptProcessor` (process-one-receipt loop)

In [`backend/services/receipt_processor.py`](../../../backend/services/receipt_processor.py):

```python
from backend.services.pantry_service import pantry_item_has_display_name
```

Immediately after `if normalized is None: continue`, if `not pantry_item_has_display_name(normalized)`: info-log `raw_name` only, `items_processed += 1`, `continue`. **Before** `normalized_items.append`. Do not append to `errors`. Do not call `add_to_pantry`.

#### Migration `supabase/migrations/031_soft_delete_blank_pantry_rows.sql`

One-shot `UPDATE` as specified above. Idempotent: second run updates zero rows. Comment: no `depletion_history` write; graveyard stays clean; ingest reject prevents resurrect.

### Phase 09.2 — Add FAB

#### [`frontend/src/pages/Pantry.jsx`](../../../frontend/src/pages/Pantry.jsx)

1. Remove `actions={...Add item...}` from `PageHeader`.
2. `activeItems`: keep `!deleted_at`, and drop rows where both `normalized_name` and `base_ingredient` are empty after trim (mixed-version / restore defense; three lines, no util).
3. FAB via `createPortal(..., document.body)` (already used in `Recipes.jsx` / `AdaptiveModal.jsx`):
   - `type="button"`, `aria-label="Add item"`
   - `Plus` icon only, `btn btn-primary`, `min-h-touch min-w-touch`, rounded
   - `fixed right-4 z-40` and `bottom-[calc(4rem+env(safe-area-inset-bottom,0px)+1rem)] lg:bottom-6`
   - `onClick` → `setAddMenuOpen(true)` (same menu as empty-state)
   - Render when `userId` and **not** `searchOverlayOpen` / `voiceOpen` / `addMenuOpen`. **Not** gated on `loading`.
4. Empty-state `Add your first item` stays; still `setAddMenuOpen(true)`.
5. `pb-24` on the column below the header so the last list row / graveyard is not under the FAB.

Do not extract a new component file. Do not change `PantrySearchOverlay` or `VoiceInputSheet`.

---

## Logic Guardrails

- Blank-name reject happens at the **service**, not only the UI, and **before match/merge/resurrect**.
- Receipt skip ≠ receipt error, and ≠ a `normalized_items` entry.
- `get_pantry_summary` filter does not change `_get_pantry_items` and does not license skipping ingest reject.
- Cleanup is `deleted_at` only; never `DELETE FROM pantry_items`.
- FAB is portaled to `document.body`. In-tree `fixed` is a defect on web.
- FAB `z-40` < tab `z-50` < add menu `z-[60]` < search overlay `z-[70]` < toasts `z-[100]`.
- FAB must not sit on the Pantry tab; it sits in the padded content zone.
- Do not open search overlay directly from the FAB (today’s header behavior). Always the Search / Tell me menu.
- Do not hide FAB for loading/error.

---

## Test-First Suite

Scaffold tests **before** implementation. Named cases:

### 09.1 — `tests/services/test_pantry_service.py`

1. `test_add_to_pantry_rejects_blank_base_and_name` — empty strings; `upsert_pantry_item` not called; `get_*_pantry` not required to have been called; `ValidationException`.
2. `test_add_to_pantry_rejects_whitespace_only_name` — `"   "` base and name.
3. `test_add_to_pantry_blank_raises_validation_not_database` — exception type is `ValidationException` (not wrapped).
4. `test_add_to_pantry_does_not_resurrect_soft_deleted_blank` — pantry returns a soft-deleted `{base_ingredient:'', normalized_name:'', unit:'count'}`; blank add still raises; `update_pantry_item_fields` / `_resurrect_fields` not used (no update call).
5. `test_get_pantry_summary_omits_nameless_rows` — mix named + `{base_ingredient:'', normalized_name:''}`; `total_items` / `items` / `grouped` exclude the nameless row.
6. `test_batch_add_skips_blank_canonical_item` — one blank + one named; only named inserted; `_find_pantry_by_base` not applied to the blank (named insert still happens).
7. `test_batch_add_does_not_merge_into_existing_blank_base` — live nameless row already in pantry; batch with blank canonical item does not call `update_pantry_item_fields` for it.

### 09.1 — `tests/services/test_receipt_processor.py`

8. `test_blank_normalized_name_skipped_not_errored` — `normalized` with empty base/name; `add_to_pantry` not called; `errors == []`; `items_added` does not include it; blank not in `normalized_items`.

### 09.2 — `frontend/src/tests/PantryView.test.jsx`

9. `ADD_FAB_OPENS_ADD_MENU` — no header button named `/add item/i`; FAB `aria-label="Add item"` opens the `Add to pantry` dialog (Search + Tell me).
10. `EMPTY_STATE_AND_FAB_SHARE_MENU` — empty pantry still has `Add your first item`; both open the same dialog.
11. `NAMELESS_ROW_NOT_RENDERED` — API returns a nameless `quantity:1, unit:'count'` row plus a named row; named row visible; no empty-title row / no lone `1 count` as a row.
12. `FAB_HIDDEN_WHEN_ADD_MENU_OPEN` — after opening the menu, the FAB control is not in the document.
13. `FAB_VISIBLE_WHILE_LOADING` — before `getPantry` resolves, FAB `aria-label="Add item"` is present (when `userId` is set).

Portal: queries use `document.body` / `screen` (Testing Library already does). Do not assert in-tree `fixed` under `PullToRefresh`.

---

## Definition of Done

### 09.1

- [ ] Named tests 1–8 exist and pass.
- [ ] Migration `031_soft_delete_blank_pantry_rows.sql` is present and idempotent.
- [ ] Logic Audit: blank `add_to_pantry` / `batch_add` never match, merge, or resurrect a `''` row.
- [ ] Logic Audit: a receipt line that normalizes to empty name does not create a pantry row, does not fail the receipt, and is not listed in `normalized_items`.
- [ ] Logic Audit: `GET /api/pantry` never returns a live item with both names blank/whitespace.
- [ ] No CHECK on `pantry_items`; no RPC change; `_get_pantry_items` signature unchanged; no new Python module.

### 09.2

- [ ] Named tests 9–13 exist and pass.
- [ ] Header has no Add button. FAB is portaled to `document.body`, bottom-right, above tab-bar padding, icon-only.
- [ ] FAB and empty-state CTA open the existing Search / Tell me menu.
- [ ] FAB is visible during pantry loading.
- [ ] Logic Audit: on **web** (PageTransition transform present), FAB does not scroll with the pantry list (portal, not in-tree `fixed`).
- [ ] Logic Audit: with the tab bar visible, the FAB does not overlap tab icons (`4rem + safe-area + 1rem`).
- [ ] Logic Audit: last pantry row remains tappable (`pb-24` or equivalent).

---

## Out of scope (explicit)

- Hiding `1 count` on **named** items.
- CHECK constraint / DB trigger on `base_ingredient`.
- Filtering `_get_pantry_items` or changing suggestion/cook matching.
- Blocking `restore_pantry_item` for nameless snapshots.
- New add API, voice changes, staples template.
- Editing `PageTransition` / `AppShell` to “fix fixed”.
- Left-handed FAB placement.
- Desktop header dual-CTA.
- New shared util file for the display-name predicate.
- Unicode/zero-width name stripping.
