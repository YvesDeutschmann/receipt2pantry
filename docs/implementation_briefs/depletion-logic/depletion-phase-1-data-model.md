# Meald Depletion System — Phase 1: Data Model

> **Reference:** Read `meald-depletion-master.md` before this document. All constraints and class definitions there apply here. This document defines only the scope of Phase 1.

---

## Objective

Design and implement the database schema that all subsequent phases depend on. Nothing else. No logic, no UI, no computation. The schema must accommodate every depletion class, confidence input, and deletion pattern described in the master doc without requiring structural changes in later phases.

Get this right before writing any application logic. Every phase 2–4 decision will be constrained by what is built here.

---

## Deliverable

A reviewed, tested database schema with:
- All tables defined with correct types and constraints
- Indexes on fields used in frequent queries
- Seed data fixtures covering all depletion classes
- A short written confirmation that the schema can support every master doc behavior without alteration

---

## Tables to Implement

### `pantry_items`

The live pantry state. One row per distinct item currently in the user's pantry.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `user_id` | uuid | FK to users table |
| `item_name` | string | Normalized name (e.g. "chicken breast") |
| `depletion_class` | enum | PERISHABLE, CONSUMABLE, STAPLE, UNIT_ITEM |
| `purchase_date` | date | Null for manually added staples |
| `quantity_purchased` | decimal | In native purchase unit |
| `quantity_unit` | string | e.g. "lbs", "oz", "bag", "count" |
| `quantity_remaining` | decimal | Null until a cook event decrements it |
| `shelf_life_days` | integer | Looked up from classification table at import |
| `available_until` | date | purchase_date + shelf_life_days. Null for consumables |
| `estimated_depletion_date` | date | purchase_date + days_supply. Null for perishables |
| `hard_expire_date` | date | available_until + grace_buffer. Triggers soft delete |
| `is_frozen` | boolean | Default false. Set at import for bulk meat |
| `frozen_expire_date` | date | purchase_date + 90 days. Null if not frozen |
| `use_soon` | boolean | Set true on put-back. Default false |
| `use_soon_expires` | date | today + 2 days on put-back. Null otherwise |
| `put_back_count` | integer | Counts how many times item has been put back. Default 0 |
| `source` | enum | RECEIPT_IMPORT, MANUAL_ADD |
| `quantity_known` | boolean | False for unknown-quantity staples |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |
| `deleted_at` | timestamp | Null until soft delete fires |

**Indexes:** `user_id`, `depletion_class`, `hard_expire_date`, `use_soon`, `deleted_at`

**Constraints:**
- `put_back_count` must be enforced at application level: if `depletion_class = PERISHABLE` and item is meat/fish sub-class and `put_back_count >= 1`, do not allow another put-back
- `quantity_remaining` is null by default — do not show a numeric quantity in UI unless it has been explicitly set by a cook event

---

### `depletion_history`

Permanent record of every item removed from the pantry. Never delete from this table.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `user_id` | uuid | FK to users table |
| `pantry_item_id` | uuid | FK to pantry_items (the deleted row) |
| `item_name` | string | Copied at deletion time |
| `depletion_class` | enum | Copied at deletion time |
| `purchase_date` | date | Copied at deletion time |
| `deleted_at` | timestamp | When soft delete fired |
| `reason` | enum | AUTO_EXPIRED, COOKED, USER_REMOVED, OVERRIDE |
| `days_in_pantry` | integer | Computed: deleted_at - purchase_date |
| `was_cooked` | boolean | True if a cook event ever referenced this item |
| `put_back_count` | integer | Copied from pantry_items at deletion |

**Purpose:** Powers the graveyard UI. Used for re-purchase cycle calibration. Identifies aspirational buyer patterns (items never cooked before removal).

**Indexes:** `user_id`, `item_name`, `deleted_at`, `reason`

---

### `item_classification`

Static lookup table mapping normalized item names to depletion class and shelf life. Built once, updated periodically. Not user-specific.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `item_name` | string | Normalized. e.g. "chicken breast" |
| `depletion_class` | enum | PERISHABLE, CONSUMABLE, STAPLE, UNIT_ITEM |
| `sub_class` | string | e.g. "raw_meat", "raw_fish", "leafy_green", "spice" — used for sub-class rules like meat put-back limit |
| `shelf_life_days` | integer | Null for non-perishables |
| `grace_buffer_days` | integer | Added to shelf_life_days for hard expiry |
| `default_days_supply` | integer | For consumables. Null for perishables |
| `spoonacular_id` | string | For calibration lookups. Nullable |
| `aisle` | string | From Spoonacular metadata |
| `is_soft_required` | boolean | True for spices/herbs — treated as soft-required in recipe suggestions |

Seed this table with the top ~200 common grocery items covering Costco and Safeway SKUs before any receipt import logic is built.

---

### `purchase_history`

One row per import event per item. Enables personal consumption rate calibration.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `user_id` | uuid | FK to users table |
| `item_name` | string | Normalized |
| `purchase_date` | date | |
| `quantity_purchased` | decimal | |
| `quantity_unit` | string | |
| `source_retailer` | string | "costco", "safeway", etc. |
| `days_since_last_purchase` | integer | Computed at import. Null if first purchase |
| `receipt_import_id` | uuid | FK to receipt_imports table |

**Purpose:** After 2+ entries for the same item, compute `avg(days_since_last_purchase)` to replace the default `days_supply` in the depletion engine.

**Indexes:** `user_id`, `item_name`, `purchase_date`

---

### `receipt_imports`

Tracks each import event for auditability and re-processing.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `user_id` | uuid | FK to users table |
| `retailer` | string | "costco", "safeway" |
| `import_date` | timestamp | |
| `raw_data` | jsonb | Original receipt data before normalization |
| `item_count` | integer | Number of items parsed |
| `parse_errors` | jsonb | Items that failed normalization |
| `status` | enum | PENDING, PROCESSED, FAILED |

---

### `user_preferences`

One row per user. Set at onboarding, rarely updated.

| Field | Type | Notes |
|---|---|---|
| `user_id` | uuid | Primary key, FK to users |
| `household_size` | enum | ONE, TWO, THREE_PLUS |
| `depletion_multiplier` | decimal | Derived from household_size at onboarding |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

---

## Schema Constraints Derived from Master Doc

These must be enforced at the application layer, not just documented:

1. **Confidence is never stored.** No `confidence` column anywhere. It is always computed at query time from fields that are stored.

2. **Soft delete only.** `pantry_items` rows are never hard deleted. Set `deleted_at` and copy to `depletion_history`.

3. **Consumables have no `hard_expire_date`.** That field is null for CONSUMABLE class. Deletion only happens via user action or max TTL (365 days without re-purchase — enforced in phase 2).

4. **`quantity_remaining` starts null.** Do not initialize it to `quantity_purchased`. It is only set when a cook event decrements it. A null value means "full purchase quantity, untracked."

5. **`put_back_count` gates resurrection.** For items where `sub_class IN ('raw_meat', 'raw_fish')` and `put_back_count >= 1`, the put-back action must be blocked at the application layer.

---

## Seed Data Fixtures

Produce test fixtures covering each depletion class for use in phase 2 unit tests:

```
Fixture A: Chicken breast, purchased 5 days ago, not frozen, put_back_count = 0
Fixture B: Chicken breast, purchased 5 days ago, not frozen, put_back_count = 1
Fixture C: Spinach, purchased 3 days ago
Fixture D: Spinach, purchased 10 days ago (past hard expiry)
Fixture E: Olive oil, purchased 20 days ago, first purchase
Fixture F: Olive oil, purchased 20 days ago, 2 prior purchases averaging 45 days apart
Fixture G: Paprika, manually added, quantity unknown
Fixture H: Canned chickpeas, purchased 7 days ago, full
Fixture I: Canned chickpeas, purchased 7 days ago, quantity_remaining = 0.5
Fixture J: Spinach, deleted_at set, in depletion_history (for graveyard UI)
```

---

## Definition of Done

- [x] All tables created with correct types, constraints, and indexes
- [x] `item_classification` seeded with ≥ 200 items covering Costco and Safeway top SKUs
- [x] All 10 fixtures created and queryable
- [x] Schema reviewed against every behavior in `meald-depletion-master.md` — no master doc behavior requires a schema change to implement
- [x] No `confidence` column exists anywhere in the schema (see migration; `confidence_override` is allowed)

---

## Implementation History

Migration: [`supabase/migrations/017_depletion_data_model.sql`](../../../supabase/migrations/017_depletion_data_model.sql)

Deviations from this document: `receipt_imports` from the design doc is implemented as additional columns on existing `receipts` (`parse_errors`, `status`). Phase 1 `item_name` / `quantity_unit` / `created_at` map to existing `base_ingredient`, `unit`, and `added_at` on `pantry_items` (no duplicate columns).
