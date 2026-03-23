# Meald — Pantry Layer 2: Search & Add
**Document type:** Feature Brief  
**Stage:** 2 of 3 — builds on Stage 1  
**Status:** Active  
**Master brief:** [meald-pantry-master.md](./meald-pantry-master.md) — read this first

---

## What This Is

A search-based input that allows users to add individual pantry items not covered by the pre-filled staples template. This is a **supplemental and persistent** mechanism — not an onboarding flow. It is available at any time from within the pantry and surfaced as an escape hatch at the end of the Stage 1 template flow.

Its primary users are:
- People with culturally specific pantries (fish sauce, miso, gochujang, tahini, preserved lemons)
- People who noticed something missing immediately after completing the template
- Returning users adding items they just bought

---

## User Stories

> As a user who just completed the staples template, I can search for and add individual items that weren't on the list so that my pantry accurately reflects what I actually have.

> As a returning user, I can quickly add a new item to my pantry from within the pantry view without going through the full template flow again.

---

## Entry Points

**Entry point 1 — After Stage 1 template completion**  
After the "What's for Dinner" reveal, a low-prominence link appears: **"Missing something? Add it to your pantry →"** This routes to the search bar, full-screen, keyboard up.

**Entry point 2 — Pantry management screen**  
A persistent **"+ Add item"** button or floating action button is always present on the pantry screen.

**Entry point 3 — Contextual prompt during recipe browsing**  
When a recipe is bookmarked or added to a meal plan and it contains 1–3 ingredients not confirmed in the pantry, a prompt appears: **"Quick pantry check — do you have these?"** followed by the missing items as toggle cards with Yes / No / I'll buy it options. "Yes" adds to pantry immediately. This is a progressive disclosure pattern that runs in parallel with search.

---

## Search Behavior

### Input

- Single search bar, keyboard up on open
- Placeholder text: **"What else is in your kitchen?"** — not "Search ingredients"

### Autocomplete

Autocomplete suggestions must come **exclusively from the canonical ingredient list** (see master brief). Freeform text entries that don't resolve to a canonical item produce orphaned records that cannot match recipes — this must not be possible.

Rules:
- Suggestions appear after 2 characters
- Normalize input to canonical names: "ev olive" → "Olive oil", "parm" → "Parmesan", "chx broth" → "Chicken broth"
- Show no more than 6 suggestions at a time
- Items already confirmed in the pantry are filtered out of results
- If the user types something with no canonical match: **"We don't recognize that yet — try a different name"** — never create a freeform entry

### Adding an item

Tapping a suggestion:
1. Immediately adds to pantry — no intermediate confirmation screen
2. Shows inline confirmation: **"[Item] added ✓"** with a brief animation
3. Search bar resets to empty, keyboard stays up, ready for next item
4. Enables rapid sequential adds: tap → instant add → reset → tap again

Quantity is never required. After an item is added, a subtle secondary action: **"Add quantity (optional)"** — dismissible by typing again. If tapped, a simple numerical input appears inline. Never a modal.

---

## Contextual Prompt (Entry Point 3) — Detailed Behavior

**Trigger:** User bookmarks a recipe or adds it to a meal plan.

**Condition:** Recipe contains 1–3 ingredients not confirmed in pantry AND not in the universal assumption list (salt, pepper, water, cooking oil).

**Do not trigger if:** Recipe has more than 3 unconfirmed ingredients, or user has dismissed 3+ contextual prompts without responding in the current session.

**UI:** Bottom sheet with title **"Quick pantry check"** and unconfirmed items as toggle cards. Each item: **I have it / I'll buy it / Skip**. "I have it" adds to pantry. Entire card dismissible in one swipe, no penalty.

---

## Recipe Card Correction

This feature is defined in the master brief under **Recipe Card Correction** and is a requirement of this stage. Search & add is the mechanism for *adding* items; recipe card correction is the mechanism for *removing* items that have been consumed. Both must ship together — one without the other leaves the pantry accuracy loop incomplete.

The search & add stage is the right moment to implement recipe card correction because:
- The recipe card UI is the natural complement to the pantry UI being built in this stage
- Pantry removal logic is architecturally shared with the removal behavior already required in Stage 1
- A user who can add items but cannot easily remove consumed items will end up with an increasingly inaccurate pantry

See master brief for full functional specification of recipe card correction behavior.

---

## What This Stage Does Not Include

- Voice input — Stage 3
- Freeform (non-canonical) ingredient creation
- Bulk import
- Category browsing without search
