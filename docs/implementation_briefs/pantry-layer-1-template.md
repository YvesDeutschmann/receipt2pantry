# Meald — Pantry Layer 1: Pre-Filled Staples Template
**Document type:** Feature Brief  
**Stage:** 1 of 3 — MVP, ships alone  
**Status:** Active  
**Master brief:** [meald-pantry-master.md](./meald-pantry-master.md) — read this first

---

## What This Is

The second step in the cold-start arc, presented after the user has connected their grocery store account and while receipt sync runs in the background. The user is shown a pre-populated set of common pantry staples organized into categories. They review, remove anything they don't have, tap to add anything that isn't pre-selected, and confirm in one action — advancing the progress bar to its final state and activating the "What's for Dinner" button.

This is the **default experience for every cold-start user**. It is not optional and not presented as one choice among several. It simply starts after grocery store setup completes.

---

## User Story

> As a new user who just connected my grocery account, I can review and confirm a pre-filled list of common pantry staples — while my receipts sync in the background — so that my first "What's for Dinner" result is accurate and useful, without having to type anything or make decisions about categories or quantities.

---

## Position in the Arc

The progress bar at the top of the screen shows:
- **Step 1 — Grocery store connected ✓** (already complete)
- **Step 2 — Set up your pantry** (active, in progress)
- **Step 3 — What's for Dinner** (locked, shown as destination)

The progress bar is the persistent reminder that this step has a payoff. The user is not doing setup — they are unlocking something specific.

---

## Entry Point

Triggered automatically after grocery store setup completes. Presented as a **bottom sheet or full-screen modal** that does not replace the home screen, so users can dismiss at any time without losing progress.

The opening state shows:
- The progress bar (Step 2 active)
- Headline: **"What's already in your kitchen?"**
- Subhead: **"We pre-filled the staples most kitchens have. Remove anything you don't, tap anything we missed."**
- The category grid (see below)
- A single CTA at the bottom: **"Done — show me what's for dinner"**

There is no multi-step wizard. Everything is on one scrollable screen.

---

## The Staples List

### Pre-selection logic

Six items are **pre-selected by default** — the highest-confidence assumptions for any home kitchen:

1. Salt
2. Black pepper
3. Olive oil
4. Garlic
5. Sugar
6. All-purpose flour

These are shown with a distinct visual treatment and a label: **"We assumed you have these — tap to remove."** This inverts the psychology: users are editing a reasonable assumption, not building from nothing.

All remaining items are **unselected by default**, available to tap.

### Categories and items

Five categories, presented as horizontally swipeable sections or vertically stacked accordions. Each shows its name and item count.

**Oils & Vinegars** (6 items)
- Olive oil *(pre-selected)*
- Vegetable oil
- Sesame oil
- White wine vinegar
- Apple cider vinegar
- Balsamic vinegar

**Baking Basics** (7 items)
- All-purpose flour *(pre-selected)*
- Sugar *(pre-selected)*
- Brown sugar
- Baking powder
- Baking soda
- Vanilla extract
- Cornstarch

**Spices & Seasonings** (9 items)
- Salt *(pre-selected)*
- Black pepper *(pre-selected)*
- Garlic powder
- Onion powder
- Cumin
- Paprika
- Chili flakes
- Dried oregano
- Cinnamon

**Canned & Jarred** (7 items)
- Canned tomatoes
- Canned chickpeas
- Canned black beans
- Chicken broth
- Vegetable broth
- Soy sauce
- Dijon mustard

**Grains & Pasta** (5 items)
- White rice
- Pasta
- Dried lentils
- Panko breadcrumbs
- Oats

**Total: 34 items across 5 categories.**  
This list is the product baseline. It should be configurable in a content management layer so it can be updated without a code release.

### Item display

Each item is a **tappable card** with:
- An icon or food illustration (not a photo — icons render faster and scale better)
- The item name in plain language ("Olive oil" not "Extra virgin olive oil EVOO")
- Selected / unselected visual state (filled checkmark vs empty circle)
- **Immediate toggle on tap** — no intermediate state, no delay
- Haptic feedback on every toggle (selection haptic, not notification intensity)

---

## Receipt Validation — Silent Enrichment

While the user taps through the template, receipt sync may complete in the background. When it does, the app silently cross-references confirmed staples against receipt data:

- Where a confirmed staple matches a receipt item, enrich the pantry record with the receipt's purchase date and mark source as `receipt_confirmed`
- Do not interrupt the user — no modal, no blocking prompt
- A subtle visual treatment on the item card (a small receipt icon or "recently bought" badge) can indicate the match for users who notice it, but must not demand attention
- Surface a quiet summary after the user taps the confirmation CTA: **"We matched 4 of your staples to your recent receipts ✓"** as a toast — not a modal

This enrichment is the foundation for the "about to expire" nudges on the "What's for Dinner" screen. Items with confirmed purchase dates and known shelf life heuristics can surface perishability signals; items without purchase dates cannot. No purchase date = no expiry nudge.

---

## Confirmation

When the user taps **"Done — show me what's for dinner"**:

1. All selected items are written to the pantry in a single batch transaction
2. Receipt validation enrichment runs if not already complete
3. The progress bar advances to Step 3 complete
4. The **"What's for Dinner" button activates** with a pulse or unlock animation
5. The sheet dismisses and the user is routed directly to the "What's for Dinner" result screen — not to a pantry management view

The transition from template completion to the first recipe result is the product's most important moment. It should feel immediate and rewarding, not like navigating through menus.

### Dismissal without completing

If the user dismisses the sheet before tapping the CTA:
- Show a brief inline prompt: **"Save what you've selected so far?"** with **Save** and **Discard** options
- Default to Save
- Do not show this prompt if the user has made zero changes from the default state

### Skip entirely

A low-prominence **"Skip for now"** link lives at the top of the sheet. Tapping it:
- Saves the 6 pre-selected defaults (never discards them)
- Advances the progress bar to Step 2 complete
- Activates the "What's for Dinner" button on staples-only data
- The user can return to the full template from pantry settings

---

## Deduplication

Before writing template-confirmed items to the pantry:
- Check for existing pantry entries from receipt import for the same canonical ingredient
- If a match exists, do not create a duplicate — enrich the existing record with `template_confirmed: true`
- Include matched items in the post-confirmation toast: **"We matched 4 of your staples to your recent receipts ✓"**

---

## What This Stage Does Not Include

- Voice input — Stage 3
- Search bar — Stage 2 (an "Add something else" link can be present in the UI but routes to a coming-soon state or is hidden until Stage 2 ships)
- Quantity fields at any point in this flow
- Category management
- Pantry editing post-confirmation (separate feature)
