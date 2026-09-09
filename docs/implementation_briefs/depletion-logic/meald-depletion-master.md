# Mise Depletion System — Master Design Document

> This document defines the product intent, core constraints, and design decisions for the Mise pantry depletion system. All phase documents reference this file. Constraints listed here cannot be violated without updating this document first.

---

## Product Promise

Suggest meals users can actually cook tonight based on what they **probably** have.

The depletion system exists to make that promise trustworthy. A wrong suggestion — confidently recommending something the user doesn't have — is worse than a conservative one. When in doubt, be uncertain rather than wrong.

**The pantry is a belief system, not a complete inventory.** Product-facing claims, copy constraints, and the split between app-mediated cooking vs ambient consumption are defined in [`docs/PRODUCT_BRIEF.md`](../../PRODUCT_BRIEF.md) (section *Pantry premise*). This document must not contradict that premise.

Implications that bind engineering here:

- Ambient consumption (breakfast, snacks, cooking outside the app) is unobservable. Do not design features whose success depends on users reporting it.
- Re-purchase cadence is the ground-truth signal for household burn rate. Cook events are an optional accelerant for meals cooked *in* the app.
- `UNIT_ITEM` with no cook event must still degrade over time (consumable-style fallback). Missing events must not leave a row at high confidence forever.
- Recipe dismissals / "I don't have this" are high-value belief updates about the pantry, not only ranking downweights.

---

## What We Know at Import Time

- Item name (normalized from receipt)
- Quantity purchased
- Date purchased
- Purchase frequency history (if repeat buyer)

There is no barcode scanning at MVP. There is no manual quantity tracking after purchase.

---

## Core Constraints

- The user should almost never need to touch the pantry to get accurate suggestions
- Every manual correction step is friction that kills retention
- Wrong suggestions are worse than conservative suggestions
- The system must work for a solo developer building an MVP — no over-engineering

---

## Depletion Classes

Every item is assigned exactly one depletion class at import time, using a static lookup table of ~200 common grocery items.

### PERISHABLE
Time-based expiry. Confidence decays against a hardcoded shelf life.

Examples: milk, meat, produce, cheese, eggs.

```
available_until = purchase_date + shelf_life_days

confidence = 0.95  if today < available_until - 2 days
           = 0.50  if today is within 2 days of available_until
           = 0.10  if today > available_until
           = 0.00  at hard_expire_date (→ soft delete)
```

Shelf life reference values:

| Item class | Shelf life | Grace buffer | Hard expiry |
|---|---|---|---|
| Ground meat | 2 days | +1 day | Day 3 |
| Chicken breast | 3 days | +1 day | Day 4 |
| Leafy greens | 5 days | +3 days | Day 8 |
| Milk | 7 days | +2 days | Day 9 |
| Root vegetables | 14 days | +4 days | Day 18 |
| Eggs | 21 days | +5 days | Day 26 |
| Hard cheese | 21 days | +7 days | Day 28 |

**Frozen modifier:** If meat is purchased at Costco and quantity ≥ 3 lbs or ≥ 4 units, auto-apply a "likely frozen" flag extending shelf life by 90 days. Expose as a one-tap toggle at import — not a required field.

**Display rule:** Perishables display as a presence state, not a quantity. Never show "0.5 bags of spinach." Show Fresh / Use Soon / Likely Gone instead. Quantity is a fiction for bagged produce.

### CONSUMABLE
Usage-based linear decay. Confidence decays against an estimated depletion date.

Examples: olive oil, flour, spices, condiments, coffee.

```
days_supply = quantity_purchased / estimated_daily_use_rate
estimated_depletion = purchase_date + days_supply
```

Default supply durations (used until personal history is available):

| Item | Unit | Default days supply |
|---|---|---|
| Olive oil (33oz) | bottle | 45 days |
| All-purpose flour (5lb) | bag | 60 days |
| Spice jar | jar | 180 days |
| Coffee (12oz) | bag | 21 days |
| Ketchup | bottle | 60 days |
| Soy sauce | bottle | 90 days |

After 2+ purchase cycles, replace defaults with:
```
personal_days_supply = avg(days between repeat purchases of same item)
```

**Consumables never auto-delete.** They decay to low confidence but remain in the pantry until a re-purchase resets them. Max TTL: 365 days without a re-purchase signal.

**Spice rule:** All spices default to confidence = 0.6 (not 0.8+). They are "probably there" not "definitely there." Treat spices as soft-required in recipe suggestions — a recipe missing only spices still shows as cookable, with a note to check the spice rack.

### STAPLE
Manually added items with no purchase date anchor.

Two sub-classes:
- **Known quantity** (user specifies "2 cups of rice"): treat as CONSUMABLE, decay from today
- **Unknown quantity** (user adds "paprika" with no detail): confidence = 0.4 permanently until a real purchase is imported

Display unknown-quantity staples in recipe suggestions with a visual qualifier ("you listed this — check your pantry"). Never count them as confirmed available.

### UNIT_ITEM
Countable at purchase, partially consumed across meals.

Examples: canned goods, rice, pasta, eggs (overlap with PERISHABLE handled by class assignment at import).

Primary depletion method: meal-based. When a user marks a recipe as cooked, decrement pantry by the recipe's ingredient quantities at the specified serving size.

Fallback: if no recipe association, treat as CONSUMABLE.

---

## Confidence Scoring System

Confidence is **computed at query time, not stored.** It is always a fresh calculation.

```
confidence = base_score × recency_modifier × frequency_modifier
```

### Base scores by state

| State | Base score |
|---|---|
| Perishable, well within date | 0.95 |
| Consumable, within estimated supply | 0.80 |
| Consumable, past estimated supply | 0.20 |
| Unit item, full | 0.90 |
| Unit item, partially used (estimated) | 0.60 |
| Manually added, unknown quantity | 0.40 |
| Spice / herb (any state) | 0.60 |
| Expired (hard) | 0.00 |

### Household size modifier
Collected once at onboarding: "How many people cook in your household?"

| Household | Depletion multiplier |
|---|---|
| 1 person | 1.0× |
| 2 people | 1.5× |
| 3+ people | 2.0× |

### Engagement modifier
Approximates actual cooking frequency:

| App opens per week | Depletion multiplier |
|---|---|
| 5+ | 1.2× |
| 2–4 | 1.0× |
| <2 | 0.7× |

---

## Recipe Suggestion Tiers

Confidence gates how suggestions are displayed, not whether items exist in the pantry.

| Condition | Tier | Display |
|---|---|---|
| All required ingredients ≥ 0.75 | Cook tonight | Green, shown first |
| All ≥ 0.5, some between 0.5–0.75 | Probably have everything | Muted, shown second |
| Any required ingredient 0.2–0.5 | Quick check needed | Shown third, with callout naming the uncertain item |
| Any required ingredient < 0.2 | Suppressed | Not shown |

Spices are soft-required: their confidence does not gate a recipe into a lower tier. A recipe with all primary ingredients ≥ 0.75 shows in "Cook tonight" even if spice confidence is 0.4.

---

## Implicit Signals (No Direct Asking)

These user behaviors update pantry accuracy without prompting:

| Signal | What it tells us |
|---|---|
| Recipe marked as cooked | Decrement all ingredients by recipe quantity |
| Recipe dismissed ("I don't have this") | High-confidence item is actually gone — recalibrate |
| Grocery import containing existing item | Previous instance was consumed — use days-between-purchases to calibrate consumption rate |
| App open frequency | Proxy for cooking frequency — apply engagement multiplier |
| Repeat purchase of item never used in a recipe | Aspirational buyer pattern — deprioritize that ingredient in suggestions, do not remove from pantry |

---

## Pantry Deletion Behavior

**Perishables:** Soft delete at `hard_expire_date`. Keep row in `depletion_history` table with `deleted_at` and `reason = 'auto_expired'`. Never hard delete at the database level.

**Consumables:** Never auto-delete. Decay to low confidence only.

**Graveyard:** A "Recently removed" section at the bottom of the pantry view showing items auto-removed in the last 7 days, with a "Put back" option.

### Put Back Behavior
"Put back" is a high-intent signal — the user is saying "I have this and want to cook with it."

```
confidence: 0.85  (elevated — user confirmed)
override_expire: today + 2 days  (hard deadline, no grace buffer)
use_soon: true
use_soon_expires: today + 2 days
```

**Meat rule:** Raw meat and fish may only be put back once. If it hard-expires a second time, it is permanently removed with no graveyard entry. No yo-yoing on proteins.

### Use Soon Shelf
Appears at the top of recipe suggestions — above "Cook tonight" — whenever `use_soon` items exist.

- Only shows recipes where the `use_soon` ingredient is a primary ingredient, not a garnish
- Disappears automatically when `use_soon_expires` passes
- Multi-item scoring: recipes using ALL use_soon items score highest

```
recipe_score += 2.0  if recipe uses ALL use_soon items
recipe_score += 1.0  if recipe uses SOME use_soon items
```

---

## Food Safety and Legal Constraints

- Never surface meat or fish in the "use soon" shelf without the disclaimer: "Check before cooking — this was past its use-by date"
- Raw meat and fish: one put-back cycle maximum (see above)
- ToS must include explicit disclaimer that Mise does not guarantee ingredient freshness and users are solely responsible for assessing food safety
- The app's legal exposure is low but the reputational risk (viral complaint) is higher — design against the scenario, not just the liability

---

## Spoonacular Integration

Used for calibration, not real-time lookups. Pull once and cache locally, refresh quarterly.

- **Serving size ratios:** Average ingredient amounts across recipes to derive realistic consumption rates per ingredient
- **Recipe frequency by ingredient:** Tabulate which ingredients appear in popular recipes and at what quantities — use this to weight default depletion rates
- **Unit normalization:** Bridge between bulk purchase units (Costco 90oz olive oil) and recipe units (tablespoons)
- **Aisle/category metadata:** Map to depletion classes at import instead of maintaining a fully manual lookup table

Endpoint: `/food/ingredients/{id}/information` for top 100 most-imported ingredients.

---

## Known Failure Modes and Defenses

| Failure | Defense |
|---|---|
| Costco bulk meat assumed fresh, not frozen | Bulk threshold rule: quantity ≥ 3 lbs or ≥ 4 units → one-tap "Did you freeze this?" at import |
| Phantom ingredient (consumable never re-purchased) | Hard decay to confidence 0.2 at 1.5× estimated depletion date. Max TTL 365 days |
| Shared household depleting faster than model expects | Household size multiplier collected at onboarding (once, never revisited) |
| Aspirational buying (item purchased, never cooked) | Track click-through on suggestions — downweight ingredients in recipes user consistently skips |
| Receipt parsing errors | Fuzzy-match normalization layer against curated table of top 150 Costco + Safeway SKUs. Unclassified items default to STAPLE at confidence 0.4 |
| Spice immortality (spices never re-purchased, linger at high confidence) | All spices default to confidence 0.6. Treat as soft-required in recipe suggestions |

---

## MVP Build Order

1. Item classification lookup table (~200 items)
2. Perishable time-decay logic
3. Receipt import with normalization for Costco + Safeway top SKUs
4. Confidence-gated recipe display (3 tiers)
5. "Mark as cooked" → unit depletion
6. Graveyard + put-back + use-soon shelf
7. Consumable linear decay with personal re-purchase calibration

Items 1–4 are the trustworthy MVP. Items 5–7 are self-improving accuracy.

---

## Implementation History

| Phase | Plan doc | Notes |
|---|---|---|
| Phase 1 | _linked after Cursor plan run_ | |
| Phase 2 | _linked after Cursor plan run_ | |
| Phase 3 | _linked after Cursor plan run_ | |
| Phase 4 | _linked after Cursor plan run_ | |
