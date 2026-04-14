Feature 2: Background Suggestion Pool — Architect's Planning Brief

1. Feature Summary
Right now, when a user wants meal suggestions, Mise reaches out to the Spoonacular API in real time and makes them wait. This feature eliminates that wait entirely by maintaining a pre-generated pool of meal suggestions that lives locally on the device, always ready before the user asks.
The pool is generated (or refreshed) in the background whenever something meaningful changes — the user finishes onboarding, their pantry shifts significantly after a receipt scan, they manually request a refresh, or the pool itself runs low. When the user opens the suggestions screen, they're swiping through results that were already fetched and ranked, with no spinner in sight.
The most important intelligence in this feature is depletion-aware planning: when generating suggestions for multiple days ahead, the algorithm doesn't just look at the pantry as it exists right now. It simulates what the pantry will look like after earlier meals in the week are hypothetically cooked, so that later suggestions are realistic given what ingredients will still be available. This simulation is purely for planning purposes — the real pantry is only decremented when a user marks a meal as actually cooked, which is existing behavior that does not change.
Before: User opens suggestions → spinner → API call → results appear (latency visible, failure possible in foreground).
After: User opens suggestions → results are already there. Background work happens invisibly; the user only notices if they trigger a refresh manually.

2. High-Level Component Breakdown
A. Pool Trigger Manager
Watches for the four conditions that should kick off pool generation and dispatches a generation job accordingly. It is the single entry point that decides when to generate — nothing else should be making that call independently.
Depends on: Onboarding completion events, receipt fetch completion events, pantry change diffing, pool low-watermark monitoring, and the Pool Generator itself.

B. Pantry Snapshot & Simulated Depletion Engine
Takes a point-in-time copy of the real pantry and runs a forward simulation across the planning window (e.g., a week). For each day slot, it applies the hypothetical ingredient consumption of meals already selected for earlier slots, producing a "simulated pantry state" for each day. This is the core of the intelligent planning logic.
Depends on: The real pantry data store (read-only). Does not write back to it. Produces simulated snapshots that are consumed by the Pool Generator.

C. Pool Generator
The workhorse. Given a simulated pantry snapshot for a given day slot, it queries Spoonacular with the appropriate ingredient constraints, fetches and normalizes the results, and writes them into the pool store. It works through the planning window sequentially — day 1's suggestions inform the depletion state fed into day 2, and so on.
Depends on: Simulated Depletion Engine (for pantry state per slot), Spoonacular API client (existing), Pool Store (to write results), and network/API availability.

D. Pool Store
The local persistence layer that holds all pre-fetched suggestions, tracks their state (unused, swiped, cooked), and exposes a clean interface for the UI to consume suggestions and for the Trigger Manager to check pool depth.
Depends on: Nothing upstream — this is a foundational data layer. Everything else depends on it.

E. Low-Watermark Monitor
Continuously (or on relevant events) checks the pool depth per slot. When any slot falls below 2 unused, non-swiped options, it notifies the Trigger Manager to regenerate. This is the "auto-refill" mechanism.
Depends on: Pool Store (to read current state), Pool Trigger Manager (to signal regeneration).

F. Suggestions UI Adapter
Connects the existing suggestions UI to the Pool Store instead of making live API calls. The UI should not know or care where results come from — this adapter makes that swap transparent.
Depends on: Pool Store. This is the component that replaces whatever currently wires the UI to on-demand Spoonacular calls.

3. Sequenced Build Order
Phase 1 — Foundation (must be sequential, nothing else can start without this)
Pool Store first. Every other component reads from or writes to it. Build and validate the data model for a suggestion record and the state machine (unused → swiped / cooked) before anything else touches it.
Phase 2 — Core Intelligence (sequential within this phase)
Pantry Snapshot & Simulated Depletion Engine next. This is the most algorithmically complex piece and has no external dependencies other than reading the real pantry. Build and validate the simulation logic in isolation — it should be testable without Spoonacular or the UI involved at all.
Pool Generator follows immediately, since it consumes the Depletion Engine's output and writes to the Pool Store. At this point you have the full generation pipeline end-to-end and can validate that a full week's pool is produced correctly.
Phase 3 — Trigger & Monitor (can be built in parallel with each other, after Phase 2)
Pool Trigger Manager and Low-Watermark Monitor can be developed simultaneously once the Pool Generator exists to call. The Trigger Manager wires the four entry-point conditions; the Monitor implements the depth-check and feedback loop.
Phase 4 — UI Swap (can begin as soon as Pool Store exists, but is low-risk to defer)
Suggestions UI Adapter can technically begin as soon as the Pool Store has a readable interface, even if pool data is sparse or stubbed. The engineer may prefer to defer this until the generation pipeline is validated, to avoid the UI reflecting incomplete pool states during development.

4. Key Decision Points
These are questions the Cursor agent should answer with codebase context before writing code. The answers will shape architecture significantly.
1. How should the Pool Generator handle Spoonacular rate limits and failures mid-generation?
Generating a full week's pool could mean many sequential API calls. If the network drops or the API rate-limits mid-run, does the generator commit partial results to the pool store, discard them, or retry? The answer affects whether pool state can ever be "partially generated" and how the UI should behave in that case.
2. What is the planning window, and how are "slots" defined?
Is the pool organized by day? By meal type (breakfast/lunch/dinner)? By an ordered queue with no time dimension? The shape of the slot structure directly determines how the Depletion Engine sequences its simulation and how the Low-Watermark Monitor checks depth. This should be resolved before either component is built.
3. Should pool generation run on-device or be deferrable to a background task / queue?
Generating a full week of suggestions could be expensive and slow. The engineer needs to decide whether this runs synchronously in the background on the main app process, uses a platform background task API, or is architected so it can be interrupted and resumed. This affects battery, UX during the generation window, and how the app handles being foregrounded mid-generation.
4. How does the simulated depletion handle ambiguity in ingredient matching?
Spoonacular returns ingredients with specific names and units; the user's pantry may have fuzzier representations. When the Depletion Engine simulates consuming "2 cups of chicken broth," does it decrement a pantry item named "chicken stock"? The matching strategy (exact, fuzzy, category-based) will meaningfully change how realistic the simulation feels and how complex the engine is to build.
5. What happens to the existing pool when a re-generation is triggered mid-week?
If the user scans a receipt on Wednesday and pantry changes by more than 3 items, does the pool regenerate from scratch (wiping Wednesday–Sunday suggestions), regenerate only future slots, or append new options to the existing pool? The answer has UX implications (do previously-swiped cards stay visible?) and affects Pool Store design.

5. Edge Cases and Failure Modes to Design for Upfront
Pantry is too sparse to generate a full week. If the user only has 4 ingredients, Spoonacular may return very few or no results for later slots after depletion simulation removes them. The system needs a graceful degradation path — either fall back to less-constrained queries, fill with pantry-agnostic suggestions, or surface a message rather than showing an empty pool.
Two triggers fire nearly simultaneously. A receipt scan completing at the same moment the pool drops below the watermark could kick off two generation jobs in parallel. Without a guard, this results in duplicate API calls and a race condition writing to the Pool Store. Design for a "generation in progress" lock upfront.
Pool generation completes but contains already-swiped suggestions. If a user swipes away a card and then a full regeneration runs, that same suggestion could reappear. The Pool Store's swiped-state records need to survive a regeneration, and the generator (or store) needs to filter them out on insert.
App is killed or backgrounded mid-generation. A partial generation run leaves the pool in an unknown state. The system needs to either detect and resume, detect and restart, or detect and mark the pool as stale on next launch.
Spoonacular API key exhaustion / quota hit. If the daily quota is consumed, the generator will fail silently or noisily. This should fail gracefully (keep whatever is in the pool already, don't wipe it) and surface something appropriate to the user if the pool is empty as a result.
Onboarding completes with a nearly-empty pantry. Step 5 triggers generation, but the user hasn't scanned a receipt yet. The pool will be sparse or pantry-agnostic. This is probably fine but should be an intentional design decision, not a surprise.
Clock/timezone edge cases across the planning window. If slots are time-bound (e.g., "Monday dinner"), generating a pool late Sunday night may produce a plan that's immediately partially stale. Decide upfront whether slots are relative (Day 1, Day 2…) or calendar-anchored, and handle midnight/timezone edge cases accordingly.

6. What Done Looks Like
A simple checklist of observable, user-facing behaviors that confirm the feature is working:

 After completing onboarding, the suggestions screen opens with results already populated — no spinner, no delay
 After scanning a receipt that changes the pantry by more than 3 items, new suggestions appear in the background without the user having to manually request them
 Tapping "Refresh suggestions" in settings triggers visible regeneration and surfaces updated results
 Swiping through suggestions never produces a loading state mid-swipe
 Suggestions for later in the week do not require ingredients that would have been consumed by earlier suggestions (the depletion simulation is working)
 Marking a meal as cooked does NOT change pantry inventory unless that's the existing behavior — the real pantry is untouched by pool generation
 After swiping away enough cards that a slot drops below 2 unused options, new options appear in the background without user action
 If the app is closed and reopened, the pool is still present and the user does not see a spinner
 Swiped suggestions do not reappear after a pool regeneration
 If generation fails (no network, API error), the existing pool is preserved and the user sees whatever was already there rather than an empty state