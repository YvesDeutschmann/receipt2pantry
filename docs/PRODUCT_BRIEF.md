# Meald — Project Context

## Overview
Meald is a mobile app that connects grocery loyalty accounts (Safeway and Costco at launch), fetches digital receipts, and turns those purchases into pantry-aware dinner suggestions. The job to be done: *it's 5pm — what can I cook with what I probably have, without thinking?*

## Target Audience
- Busy households who cook at home most nights and have near-zero patience for setup or data entry
- Meal planners who want less waste and less 5pm decision fatigue
- Multi-chain shoppers who want one pantry view across stores (one connected store is enough for launch)

## Pantry premise (what we claim, and what we don't)

The pantry is a **belief system**, not a complete inventory. Confidence is computed at query time from what we can observe. We will never reconstruct every real-world consumption event, and we must not claim that we do.

Two kinds of consumption exist. Only one is worth capturing:

| Population | Examples | What we do |
|---|---|---|
| **App-mediated cooking** | User opens a Meald recipe and cooks it | Capture as a byproduct of cooking in the app (not as a chore after dinner) |
| **Ambient consumption** | Breakfast eggs, kids' snacks, a partner cooking, food gone slimy in the fridge | Do not ask the user to log it. No algorithm recovers an event we never observed |

The signal that keeps the pantry useful is **re-purchase**. When eggs appear on next week's receipt, the previous eggs are gone — including every breakfast scramble we never saw. After a few purchase cycles we know this household's burn rate without asking anything. Cook events are an optional accelerant, not the source of truth.

**The product promise is not "your pantry is accurate."** It is "these suggestions won't waste your time." A pantry that is ~70% right with honest uncertainty still produces good dinners, because the uncertain 30% lands in "quick check needed." A pantry that is 95% right but presents everything as certain produces betrayals in "cook tonight." Conservative uncertainty beats false precision.

### Claims we do not make (copy, store listings, onboarding, support)

Do not ship language that implies:

- The pantry is a live, complete inventory of what is in the kitchen
- Users will log breakfast, snacks, or other meals cooked outside the app
- Quantities on bagged produce or opened packages are exact
- Suggestions are a guarantee that every ingredient is still there and still safe
- More smart algorithms will eventually close the gap to a perfect digital twin of the fridge

Users remain responsible for checking freshness, especially meat and fish. Meald does not guarantee ingredient safety.

### Implications for the product

- Do not add prompts whose job is to catch ambient consumption ("what did you cook today?")
- Do not put roadmap items on the premise that event capture can become complete
- Prefer receipt-cadence calibration and conservative suggestion tiers over quantity fiction
- Prefer making cook events a free byproduct of using the recipe screen over asking people to "mark as cooked" later
- When the app is wrong to the user's face, an explicit per-ingredient correction ("still have it / used it up / never had it") updates belief about the pantry. Recipe swipes ("Not tonight") are taste/ranking signals only — they do not change pantry confidence. Cook events logged in the app also update belief.

Engineering detail for depletion classes, scoring, and failure modes lives in [`docs/implementation_briefs/depletion-logic/meald-depletion-master.md`](implementation_briefs/depletion-logic/meald-depletion-master.md). That document must not contradict this premise.

## Core Features
- **Grocery account connection** — Native login/token capture for Safeway and Costco; reconnect when sessions expire
- **Receipt fetching & parsing** — Structured ingredient and price data from digital receipts, with no barcode scanning at MVP
- **Pantry with confidence** — Presence and likely-still-there scores, not a counted inventory of every gram
- **Recipe matching** — Ranked "What's for Dinner" suggestions gated by pantry confidence tiers
- **Light corrections** — Search/quick-add, "still have it / used it up / never had it," graveyard put-back — used rarely, never as the primary upkeep loop
- **Household sharing** — One pantry for people who cook together
- **Secure storage** — User data stored and synced via Supabase

Deferred (do not advertise as current capabilities): weekly meal planner, leftover serving tracking, shopping lists, voice-guided cooking, additional grocery chains (QFC/Kroger, Walmart), a full substitution engine.

## Benefits
- Removes receipt tracking and most pantry data entry — not all of it, and not by asking people to log every meal
- Makes 5pm decisions faster by ranking dinners the household can probably cook tonight
- Surfaces "check this first" instead of confidently recommending missing ingredients
- Reduces waste only insofar as suggestions prefer what is already on hand and likely still good — not by tracking leftovers gram-for-gram
- Centralizes purchases across connected grocery chains

## Functional Focus
Each loyalty program is an independent provider. Launch with Safeway and Costco; add chains without rewriting the pantry or suggestion loop. Scope and launch gates: [`docs/MVP_SCOPE_AND_ROADMAP.md`](MVP_SCOPE_AND_ROADMAP.md).

## Vision
Meald turns grocery receipts into a meal intelligence system that stays useful because it knows what it does not know — enough to suggest dinner, never a replica of the fridge.

---

