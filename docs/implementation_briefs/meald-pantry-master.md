# Meald — Pantry Population: Engineering Design Brief
**Document type:** Master Brief  
**Status:** Active  
**Last updated:** 2026-03-12

---

## Purpose

This brief governs the design and implementation of the **manual pantry population feature** for Meald. The pantry is the data foundation that drives meal suggestions. When it is incomplete, suggestions are inaccurate or untrustworthy. When population feels like work, users abandon the app before the core value is ever delivered.

The goal of this feature is to get a cold-start user's pantry to a trustworthy baseline state **in under 2 minutes**, without the experience feeling like data entry — and to deliver a single, emotionally resonant payoff moment: the first tap of **"What's for Dinner."**

---

## Problem Statement

Receipt import from Safeway and Costco partially populates the pantry with recently purchased items. It does not capture:

- Long-lived staples (flour, oils, vinegars, baking ingredients)
- Pre-existing inventory (spice rack, canned goods, condiments)
- Items purchased elsewhere or gifted

Without these items, meal suggestions are systematically biased toward simple recipes with few pantry dependencies, eroding the product's core value proposition.

---

## User Context

**Primary user:** Busy parent, cooks at home most nights, moderate tech comfort.  
**State at cold start:** Has just connected a grocery account. Receipt sync is running in the background. User is mildly curious but has low patience for setup.  
**Threshold:** Any flow that feels like a form will be abandoned. The target completion time from store connection to first "What's for Dinner" tap is under 3 minutes. The experience should feel like *picking*, not *entering*.

---

## The Cold-Start Arc

The entire onboarding experience is a **single narrative arc** leading to one payoff moment. Every step exists to make that moment possible and trustworthy. The user is never doing setup — they are building toward something specific.

```
1. Grocery store setup
        ↓
   [receipt sync runs in background]
        ↓
2. Staples template
        ↓
   [receipt data silently validates and enriches confirmed staples]
        ↓
3. ★  "What's for Dinner" — first tap
```

**Why this order:**  
Grocery store setup comes first so that receipt sync begins immediately and runs in the background while the user completes the staples template. By the time the template is done (~90 seconds), the sync has a strong chance of being complete or nearly complete. Where receipt data overlaps with confirmed staples, items are silently enriched with purchase dates and receipt provenance — no user action required.

---

## The Progress Bar

The progress bar is the motivational mechanism that connects the three arc steps. It requires no API calls and no recipe matching logic — it is a purely local representation of onboarding progress.

- Always visible during the cold-start arc
- Three discrete steps: **Grocery store connected → Pantry set → What's for Dinner**
- Advances permanently as each step completes — steps do not revert
- The **"What's for Dinner" button activates** as the terminal state of the bar

Progress bar label states:
- Step 1 complete: **"Grocery store connected ✓"**
- Step 2 complete: **"Your pantry is set ✓"**
- Step 3 unlocked: **"What's for Dinner →"** (button activates with a pulse animation)

The progress bar replaces the live recipe-count counter from earlier drafts. The counter required a Spoonacular call on every item selection — too expensive and too slow to feel good. The progress bar achieves the same motivational goal (forward momentum, visible payoff) with zero external dependencies.

---

## The "What's for Dinner" Payoff

This is the moment the entire arc builds toward. It must feel like a **reveal**, not a navigation tap.

- The button activates or visually unlocks as the culmination of the progress bar — it is not a dormant tab bar item sitting ignored during setup
- On first tap, the result screen leads with the highest-confidence suggestion given the current pantry state
- If receipt data includes perishable items with purchase dates, surface suggestions that use those items — framed as helpful nudges: **"You picked up chicken thighs recently — good time to use them"** not "Chicken thighs expiring soon"
- If no perishability signal exists, lead with the recipe that uses the most confirmed pantry items with the fewest gaps

**Sync timeout fallback:** If receipt sync has not completed by the time the user finishes the staples template, do not block the "What's for Dinner" button. Activate it on staples alone with a quiet note: *"Your recent groceries are still syncing — we'll update your suggestions shortly."* Sync completes in the background and suggestions update silently without requiring user action.

---

## Feature Scope

This feature is delivered in **three sequential stages**, each a shippable increment:

| Stage | Feature | Brief |
|-------|---------|-------|
| 1 | Pre-filled staples template | [pantry-layer-1-template.md](./pantry-layer-1-template.md) |
| 2 | Search & add | [pantry-layer-2-search.md](./pantry-layer-2-search.md) |
| 3 | Voice input | [pantry-layer-3-voice.md](./pantry-layer-3-voice.md) |

Stage 1 ships alone and is the MVP. Stages 2 and 3 build on a working Stage 1.

---

## Core Design Principles

These apply to every layer and every decision in this feature. They are not guidelines — they are constraints.

**1. Default to done, not default to empty.**  
Start from a pre-populated state and let users remove items. Never ask a user to build from nothing.

**2. Tap and pick, never type and confirm.**  
The primary interaction is selection from presented options. Typing is a fallback, not a primary path. Confirmation dialogs for pantry adds are never acceptable.

**3. Every step earns the next.**  
The progress bar makes the arc visible. Each completed step should feel like forward momentum toward the payoff, not a task checked off a list.

**4. Partial completion is a valid outcome.**  
A user who abandons halfway through has still improved their pantry. All flows must save state on exit. No flow should require completion to produce value.

**5. Removal is always safe.**  
Removing a pantry item must never trigger a confirmation dialog. It is always undoable within the current session via a toast/snackbar with an undo action.

**6. Never surface pantry management as a destination.**  
After onboarding, route users to meal suggestions — not a pantry list screen. The pantry is infrastructure. Users should not feel they are managing a database.

**7. Errors are recoverable, not catastrophic.**  
The pantry will sometimes be wrong — an ingredient the user already consumed will occasionally surface in a suggestion. This is a normal miss, not a trust violation. The response is frictionless in-context correction, not prevention. See Recipe Card Correction below.

---

## Upstream Dependencies

This feature is **Step 3 of a larger onboarding sequence**. The pantry arc assumes the following data already exists in the user's account before the grocery store connection step begins. If any of these are missing, the "What's for Dinner" result will be wrong and the payoff moment will fail.

The full sequence is:

```
1. Sign up
        ↓
2. Household setup (size + dietary restrictions)
        ↓
3. Grocery store connection → [pantry arc — this brief]
        ↓
4. ★ "What's for Dinner"
```

**Required upstream inputs:**

| Input | Why it's needed before the pantry arc |
|-------|---------------------------------------|
| `household.size` | Drives portion logic on recipe suggestions |
| `household.dietary_restrictions` | Hard restrictions (allergies, intolerances) that would make a suggestion harmful — must be excluded from results on first reveal |

**Not required before the pantry arc** (can be collected later through recipe engagement):
- Cuisine preferences
- Soft dietary preferences (low-carb, vegetarian by choice)
- Cooking skill level
- Time-per-meal preferences

These upstream inputs are specified in the **Onboarding & Account Setup brief** (separate document). The implementing engineer for this feature should treat `household.size` and `household.dietary_restrictions` as pre-existing, validated data and not attempt to collect them within this flow.

---

## Data Model Assumptions

The implementing engineer should resolve these against the actual codebase, but functionally the feature requires:

- A **canonical ingredient list** that is the shared vocabulary between pantry items, recipe ingredients, and search suggestions. All pantry additions must resolve to items in this list.
- A **pantry item record** that minimally stores: canonical ingredient ID, confirmed status (true/false), source (receipt\_import | template | voice | search), date added, and optionally purchase\_date (populated from receipt data where available).
- Quantity is **optional** on all pantry items. The feature must not require quantity to complete an add.
- Deduplication logic that merges a template-confirmed item with a receipt-imported item of the same canonical ID, preferring the receipt data for source attribution and enriching with purchase\_date where available.

---

## Consumed Inventory Problem

**First-run risk is accepted.** The app cannot know what a user consumed before connecting their account. Users understand this implicitly — the trust contract is not "always know what I have" but "never forget what I told you." A suggestion for an ingredient the user already used is a normal miss, not a product failure.

The mitigation is **frictionless correction from the recipe card**, not prevention upfront.

After onboarding, ongoing pantry accuracy is maintained by:
- **Recipe-driven depletion:** when a user cooks a Meald recipe, those ingredients are decremented from the pantry automatically
- **Receipt re-sync:** recurring receipt imports update pantry state with new purchase dates
- **Shelf life confidence decay:** perishable items surface as lower-confidence suggestions as they age past expected window — implementation detail for a future brief

---

## Recipe Card Correction

⚠️ **This is a required feature, not a nice-to-have.** It is the primary mechanism for maintaining pantry accuracy after onboarding and the direct answer to the consumed inventory problem.

Every recipe card must provide a way for the user to indicate they are out of a specific ingredient — directly from the card, without navigating to the pantry.

**Functional requirement:** one or two taps maximum from recipe card to pantry item removed.

**Behavior:**
- User indicates they are out of an ingredient on the recipe card
- The item is removed from the pantry immediately, no confirmation dialog
- An undo toast appears: **"Removed [item] from your pantry · Undo"** — dismisses after 4 seconds
- The recipe card does not close or reload — the correction is silent and background
- The removed item is flagged as `depleted` in the pantry record for analytics

**Discoverability:** The affordance must be visible enough that users who need it find it, but not so prominent that it clutters the recipe card for users who don't. A reasonable pattern is a subtle indicator on each ingredient row, or a consolidated **"Update my pantry"** link at the bottom of the ingredients list. The exact UI pattern should be resolved against the recipe card design in the codebase — the functional contract above is what matters.

---

## Progress Bar vs. Meals Counter

Earlier drafts specified a live **"meals you can make"** counter that updated on every item selection. This has been replaced by the progress bar for the following reasons:

- A live counter requires a Spoonacular API call per selection — expensive and introduces latency that breaks the satisfying snap of the tap interaction
- The progress bar achieves the same motivational goal (visible forward momentum, clear payoff) with zero external dependencies
- The payoff moment — seeing real meal suggestions for the first time on the "What's for Dinner" screen — is more powerful than an abstract incrementing number during setup

A single Spoonacular call fires when the user taps "What's for Dinner" for the first time. That is the right moment for the API investment.

---

## Out of Scope (for all three stages)

- Expiry date tracking (shelf life decay is a future feature — see Consumed Inventory above)
- Quantity / volume tracking (optional field only, never required)
- Shopping list generation from pantry gaps
- Household sharing / multi-user pantry sync
- Barcode scanning

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Cold-start arc completion rate | ≥ 65% |
| Median time from store connection to first "What's for Dinner" tap | ≤ 3 minutes |
| Pantry items confirmed at end of cold-start | ≥ 20 |
| Day-7 pantry retention (items still present) | ≥ 80% |
| Recipe card "I'm out" correction usage within first week | ≥ 20% of active users |

---

## Shared UX Constraints

- **No confirmation dialogs** for add or remove actions anywhere in this feature
- **No quantity required** at point of add in any flow
- **No keyboard** as primary input in Stage 1 or Stage 3
- **Haptic feedback** on every pantry item toggle (selection haptic, not notification)
- **Undo via toast** for all removals, dismisses after 4 seconds
- **Auto-save on exit** — partial state is never lost
- **Receipt sync never blocks UI** — all sync operations are background processes with silent state updates
