# Meald — MVP Scope, Coverage Analysis & Roadmap

**Document type:** Product scope + gap analysis
**Status:** Draft for review — **M6 in progress (NO-GO)**; Areas 1–4 live-verified; signed prod builds done; Area 5 checklist open
**Last updated:** 2026-07-28
**Inputs:** `docs/PRODUCT_BRIEF.md`, current codebase (`backend/`, `frontend/`, `supabase/migrations/`), existing implementation briefs.

---

## 🚨 Must-fix before release (security/config blockers)

Surfaced during the gap-closure brief authoring (see [`docs/implementation_briefs/mvp_gaps/06-launch-readiness.md`](implementation_briefs/mvp_gaps/06-launch-readiness.md)). Track live status in [`06-launch-readiness-findings.md`](implementation_briefs/mvp_gaps/06-launch-readiness-findings.md).

1. ~~**Committed LAN IP in `network_security_config.xml`**~~ **FIXED** — only `localhost` / `10.0.2.2`; verify still absent in release AAB.
2. ~~**`SUPABASE_JWT_SECRET` not validated at startup**~~ **FIXED** — `ProductionConfig.validate()` + set on Fly.
3. ~~**`MockSecretsService` in production**~~ **FIXED / Area 2 closed (2026-07-25).**

**Still open for friends beta:** Area 5 device QA checklist on signed prod builds; privacy/terms + delete-account; spend caps/backups; commit/merge of launch-readiness work. ~~Apple agreements + signed iOS/Android against `api.meald.app`~~ **DONE**.

---

## 0. How this document was produced

The scope below was assembled by weighing three perspectives against the product brief and the code that actually exists today:

- **The food-tech advisor** — cares about defensibility, unit economics, regulatory/ToS risk, and whether the core loop creates a habit. Pushes hard against scope that doesn't earn retention.
- **The busy parent (target user)** — cares about one thing: *"It's 5pm, what do I cook with what I already have, without thinking?"* Has near-zero tolerance for setup, data entry, or broken sync.
- **The launch PM** — cares about a shippable, testable slice with a clear critical path, demoable in a single session, and instrumented so we can learn after launch.

Where the brief and the code disagree, the **code is treated as ground truth** for "what exists," and the **personas drive "what ships in the MVP."**

> **Key finding up front:** Meald is *much* further along than the brief implies. The brief reads like a kickoff doc; the repo is a working Capacitor (iOS/Android) app with a Flask backend, a real pantry/depletion engine, a meal-planning wizard, Spoonacular recipe matching, household sharing, and two live grocery integrations (Safeway via native WebView, Costco via token API). The MVP problem is therefore **not "build the features"** — it is **"harden the critical path, cut the long tail, and make the cold-start-to-first-dinner moment reliable."**

---

## 1. The MVP North Star

> **A busy parent connects one grocery account, confirms a staples list in under 2 minutes, and gets a trustworthy "What's for Dinner" answer based on what they actually have — then keeps coming back because the pantry stays accurate without manual upkeep.**

Everything in the MVP either (a) makes that sentence true, or (b) is cut. The single critical path we must guarantee is:

```
Sign in → Connect 1 store → Receipts sync → Confirm staples → "What's for Dinner" → Cook → Pantry updates → Come back next week
```

---

## 2. Persona-weighted feature decisions

Legend: **MUST** = in MVP · **STUB** = ship a deliberately limited/mocked version · **DEFER** = explicitly out of MVP.

| # | Feature (from brief) | Decision | Advisor view | Parent view | PM view |
|---|---|---|---|---|---|
| 1 | Automated portal login | **MUST (1–2 chains)** | ToS/bot-detection risk is the #1 existential threat; keep surface small. | "Just connect my store and don't make me log in again." | Ship Safeway + Costco only; reconnect flow must be obvious. |
| 2 | Receipt fetching & parsing | **MUST** | This is the data moat. | Invisible, must "just work." | Already built for 2 chains; focus on reliability + dedup. |
| 3 | Pantry / digital inventory | **MUST** | The core asset; suggestions are worthless without it. | "Show me what I have." | Done; needs polish + confidence trust. |
| 4 | Cold-start staples onboarding | **MUST** | Determines activation rate. | Setup must feel like *picking*, not *typing*. | Built; protect the <2-min target. |
| 5 | Recipe matching / suggestions | **MUST** | The payoff that justifies the data work. | "Tell me what I can make tonight." | Built (Spoonacular + pool); needs cost control + caching. |
| 6 | Meal-planning assistant (weekly) | **DEFER** | Drives weekly retention cadence. | "Plan my week so I stop deciding daily." | Built but hidden behind `FEATURE_MEAL_PLANNER` / `VITE_FEATURE_MEAL_PLANNER`; ship What's for Dinner only. |
| 7 | Leftover tracking | **DEFER** | Reduces waste = stated value prop. | "Remind me I have leftovers." | Built into meal plan; deferred with meal planner. |
| 8 | Smart substitutions | **STUB** | Nice-to-have, not a reason to adopt. | "Out of X? tell me what swaps." | Data model + availability check exist; surface read-only, don't build a full engine. |
| 9 | Shopping list generation | **DEFER** | Closes the loop back to the store. | "Tell me what to buy for the plan." | Service exists; deferred with meal planner. |
| 10 | Household sharing | **STUB → MUST-keep** | Multiplies value but adds support cost. | "My partner adds stuff too." | Fully built already; keep but don't expand (no roles/perms work). |
| 11 | Hands-free / voice-guided cooking | **DEFER** | Cool demo, weak retention driver, build cost high. | Marginal at MVP; nice later. | **Not built** (voice *input* for pantry exists; voice-*guided cooking* does not). Cut cleanly. |
| 12 | Multi-chain (QFC/Kroger, Walmart) | **DEFER** | Each chain = recurring ToS/maintenance tax. | One store is enough to get value. | **Not built.** Ship 2 chains; architecture already supports adding more. |
| 13 | Silent / automatic background sync | **MUST (foreground, on by default)** | Huge UX win but fragile (cookie/token expiry) — now a launch-gating reliability item. | "I never want to think about syncing." | Owner decision: **on for everyone**. Ship foreground-triggered auto-sync default-on; OS background tasks still deferred. Silent failure must surface a visible reconnect prompt. |
| 14 | Secure credential storage | **MUST** | Table stakes; breach = company over. | Implicit trust requirement. | Built (Supabase Vault). |
| 15 | Email/password sign-up & sign-in | **DEFER** | SMTP/confirmation delivery is an ops tax at beta scale. | OAuth is enough to get started. | Built in `Auth.jsx`; hidden via `VITE_FEATURE_EMAIL_AUTH` (default off). Re-enable when custom SMTP is configured. |

### What the personas explicitly agreed to cut for MVP
- **Voice-guided hands-free cooking** (feature 11) — defer entirely.
- **QFC/Kroger & Walmart integrations** (feature 12) — defer; the modular provider system makes these additive later.
- **A real substitution recommendation engine** (feature 8) — stub with existing data only.
- **OS-level background sync** — defer; foreground auto-sync is enough to feel "automatic."

---

## 3. MVP feature spec (the "definition of done" per area)

### 3.1 MUST-HAVE

**A. Authentication & onboarding**
- Apple/Google sign-in at launch (OAuth-only beta); email/password form built but hidden behind `VITE_FEATURE_EMAIL_AUTH` (default off) to avoid Supabase built-in SMTP delivery failures.
- Protected routes; onboarding gate.
- Onboarding arc: household size → dietary restrictions → connect store → staples template → first "What's for Dinner."
- Cold-start completion target: **< 3 minutes** to first suggestion.

**B. Grocery connection (Safeway + Costco only)**
- Safeway: native WebView login → receipt ingest.
- Costco: One-Tap WebView token capture → API fetch.
- Reconnect path when credentials/tokens expire must be discoverable and non-technical.
- Manual "Sync now" button per connected store.
- **Foreground auto-sync on by default** (owner decision): triggers on app foreground with a throttle; on silent failure it must degrade gracefully to a visible "reconnect" prompt rather than failing quietly. OS-level background tasks remain deferred.

**C. Receipt → pantry pipeline**
- Fetch → parse → normalize (canonical ingredients) → dedup → add to pantry with purchase provenance.
- Idempotent on re-sync (no duplicate receipts/items).

**D. Digital pantry + confidence**
- Pantry grouped by base ingredient with confidence/depletion indicators.
- Manual add (search + quick-add), edit qty, delete, "still have it / used it up / never had it" corrections.
- Graveyard + put-back (undo depletion).

**E. Recipe suggestions ("What's for Dinner")**
- Pantry-aware ranked suggestions (Spoonacular + pre-generated pool).
- Recipe detail with ingredients matched against pantry.
- Cost guardrail: cache + pool to bound Spoonacular calls.
- Primary post-onboarding entry point (Dashboard CTA + nav tab).

**F. Weekly meal plan (DEFER — hidden at launch)**
- Wizard, calendar, shopping list, and leftover marking are built but gated off.
- Re-enable with `VITE_FEATURE_MEAL_PLANNER=1` (frontend) and `FEATURE_MEAL_PLANNER=1` (backend).

**G. Email/password auth (DEFER — hidden at launch)**
- Email sign-up, sign-in, and dev test-user fill are built but gated off for OAuth-only beta.
- Re-enable with `VITE_FEATURE_EMAIL_AUTH=1` (frontend build) after custom SMTP is configured in Supabase.

**H. Cook → pantry depletion**
- "I cooked this" consumes ingredients and updates pantry confidence.

### 3.2 STUB (ship limited)
- **Substitutions:** surface existing substitution data + `check-recipe-availability` output read-only ("you have a possible swap"); no learning/ranking engine.
- **Household:** keep existing create/join/leave/members; freeze further role/permission work.

> **Note:** Auto-sync was moved to MUST-HAVE (item B below) per the owner decision to ship it on-by-default. It is no longer a flag-gated stub.

### 3.3 DEFER (explicitly out)
- Weekly meal planner, shopping list, leftover tracking (built; hidden via feature flags) · Email/password auth (built; hidden via `VITE_FEATURE_EMAIL_AUTH`) · Voice-guided cooking · QFC/Kroger · Walmart · OS background sync · spend analytics dashboards · in-app grocery ordering · web (desktop) marketing parity beyond the app.

---

## 4. Current codebase coverage

Assessment scale: ✅ Done (shippable, polish only) · 🟡 Partial (works, gaps remain) · 🔴 Missing/Stub.

| Capability | State | Evidence in repo | Gap to MVP |
|---|---|---|---|
| Auth + protected routes + onboarding flow | ✅ | `frontend/src/contexts/AuthContext.jsx`, `OnboardingRoute.jsx`, `pages/onboarding/*`, `native/signInWithApple.js` | **DEFER:** email form hidden via `VITE_FEATURE_EMAIL_AUTH` (default off); OAuth-only at launch |
| Cold-start staples template + progress bar | ✅ | `pages/onboarding/StaplesTemplate.jsx`, `ColdStartContext.jsx`, `routes/pantry.py` (`/pantry/staples-template`, `/confirm-staples`) | QA the <2-min target |
| Safeway connection (native WebView) | 🟡 | `services/safeway*` , `hooks/useSafewaySync.js`, `routes/receipts.py` `/receipts/ingest` | Reliability, reconnect UX |
| Costco connection (token / One-Tap) | 🟡 | `providers/costco_provider.py`, `CostcoOneTapSync.jsx`, `routes/providers.py` (`/costco/connect-from-app`, token refresh) | Token-expiry/bot-detection edge cases |
| Receipt parse + normalize + dedup | ✅ | `parsers/{safeway,costco,ai}_parser.py`, `services/normalization_service.py`, `receipt_processor.py`, migration `006/007` | Dedup hardening (recent fixes exist) |
| Digital pantry + confidence/depletion | ✅ | `services/{pantry,confidence_engine,depletion_engine}.py`, migrations `003/017/018/019`, `pages/Pantry.jsx` | Trust/QA |
| Pantry corrections + graveyard + put-back | ✅ | `routes/pantry.py` (`/correction`, `/graveyard`, `/put-back`), `GraveyardSection.jsx` | — |
| Recipe matching (Spoonacular) | 🟡 | `services/recipe_service.py`, `routes/recipes.py`, `pages/Recipes.jsx` | Requires `SPOONACULAR_API_KEY`; cost/caching guardrails |
| Tiered suggestions + pre-gen pool | ✅ | `services/{suggestion_service,pool_generator,pool_store_service}.py`, `routes/pool.py`, migration `016` | Tuning |
| Meal-plan wizard + calendar | 🟡 | `services/meal_plan_service.py`, `routes/meal_plan.py`, `MealPlanWizard.jsx`, migration `009` | **DEFER:** hidden via `FEATURE_MEAL_PLANNER` / `VITE_FEATURE_MEAL_PLANNER` (default off) |
| Shopping list | 🟡 | `services/shopping_list_service.py`, `routes/meal_plan.py`, `ShoppingList.jsx` | **DEFER:** gated with meal planner |
| Leftover tracking | 🟡 | meal-plan `mark-leftover`, `update_meal(is_leftover)` | **DEFER:** gated with meal planner |
| Cook → depletion | ✅ | `routes/pantry.py` `/pantry/cook`, `/consume`, `confidence_engine.process_cook_event` | — |
| Household sharing | ✅ | `services/household_service.py`, `routes/households.py`, `HouseholdModal.jsx`, migration `005` | Freeze scope |
| Secure credential storage | ✅ | `services/secrets_service.py` (Supabase Vault + dev mock), migration `20260725140329`, RLS migrations `022` | Prod: service role + Vault RPCs |
| Smart substitutions | 🟡→🔴 | sub table in migration `003`, `scripts/populate_ingredient_substitutions.py`, `check_ingredient_availability` | No surfaced UX / engine → ship as STUB |
| Voice input (pantry add) | ✅ | `routes/pantry.py` `/voice-transcribe` `/voice-confirm`, `components/voice/*`, `useVoiceRecorder.js` | Pantry-only (not cooking) |
| Voice-guided **cooking** | 🔴 | none | DEFER |
| QFC/Kroger provider | 🔴 | none (only base/registry) | DEFER |
| Walmart provider | 🔴 | none | DEFER |
| Silent/auto background sync | 🟡 | `docs/implementation_briefs/silent_sync/*`, `services/syncTelemetry.js`, tier scaffolding | Foreground STUB; OS background DEFER |
| Test coverage | ✅ | 34 pytest files, 19 vitest files | Maintain on changes |

### Coverage summary
- **MUST-have features: ~85% built.** The core loop exists end-to-end.
- **The real MVP work is hardening, not greenfield:** connection reliability (Safeway/Costco), reconnect UX, Spoonacular cost control, and cold-start QA.
- **The brief's "headline" differentiators (multi-chain, hands-free cooking) are the least built** — and the personas agree they should be deferred.

---

## 5. Gap analysis (what stands between today and MVP launch)

**Critical (blocks launch):**
1. **Connection reliability & reconnect UX** for Safeway + Costco (token/cookie expiry, bot detection, clear "reconnect" prompts). This is the single biggest risk to the North Star.
2. **Spoonacular cost & rate guardrails** — ensure the pool/cache strategy bounds external calls so suggestions stay cheap and fast at launch scale.
3. **Cold-start arc QA** — verify the <3-min path on real devices (iOS TestFlight), including the case where receipt sync is still running.

**Important (degrades MVP if unaddressed):**
4. Idempotent re-sync / dedup edge cases at scale.
5. Empty/sparse-pantry states (new user with few items) still produce a credible "What's for Dinner."
6. Substitution **stub** surfaced cleanly (don't over-promise).
7. Observability/telemetry for the critical funnel (connect → sync → first suggestion → cook).

**Cleanup (cut or hide):**
8. Remove/feature-flag deprecated Safeway Playwright paths and dev-only debug logging (e.g. `pool.py` agent-debug block, `debug-ef2920.log`).
9. Hide unfinished surfaces (multi-chain provider cards beyond Safeway/Costco; any voice-cooking entry points; meal planner — `FEATURE_MEAL_PLANNER` / `VITE_FEATURE_MEAL_PLANNER` default off; email auth — `VITE_FEATURE_EMAIL_AUTH` default off).

---

## 6. Roadmap to close the gaps

Phased to the repo's "1-Brief-1-Build" convention. Each milestone has an exit gate.

### M0 — Scope lock & cleanup (≈ 0.5 week)
- Ratify this doc; flag-gate or hide deferred surfaces (multi-chain, voice cooking, auto-sync default-off).
- Strip dev debug logging from `routes/pool.py`; remove `debug-*.log` writers from prod paths.
- **Exit:** App shows only MVP surfaces; deferred features are invisible to end users.

### M1 — Connection reliability, auto-sync & reconnect (≈ 2–2.5 weeks) ⭐ highest risk
- Robust Safeway WebView sync (session/cookie expiry handling) + Costco token refresh edge cases.
- **Foreground auto-sync on by default** (owner decision): wire the tiered scheduler to app-foreground with throttle; silent failure must raise a visible "reconnect" prompt (no quiet failures).
- First-class **"Reconnect store"** UX with plain-language errors; surface `expired_credentials`/`needs-reconnect` events.
- Idempotent re-sync verification (dedup) across repeated/automatic syncs.
- **Exit:** A returning user's stores auto-sync on open with zero dev intervention across token/cookie expiry; failures surface a clear reconnect prompt; no duplicate receipts.

### M2 — Suggestion cost, caching & sparse-pantry resilience (≈ 1 week)
- Confirm pool generation + caching bounds Spoonacular usage; add rate/cost telemetry.
- Guarantee a credible suggestion with a thin pantry (fallbacks, staples-aware).
- **Exit:** P95 "What's for Dinner" < 2s from warm pool; external call budget per active user is bounded and measured.

### M3 — Cold-start arc hardening on-device (≈ 1 week)
- TestFlight build; walk the full arc on iPhone/iPad incl. sync-still-running case.
- Funnel telemetry: connect → sync complete → staples confirmed → first suggestion → first cook.
- **Exit:** ≥ X% of internal testers reach first suggestion in < 3 min (set baseline target during M3).

### M4 — Cook loop polish (≈ 0.5 week)
- Cook → depletion confidence sanity pass.
- **Exit:** A tester can cook a meal from "What's for Dinner" and see the pantry update correctly.

*(Meal-plan wizard, shopping list, and leftover marking moved to post-MVP — code remains, hidden behind feature flags.)*

### M5 — Stubs (≈ 0.5 week, parallelizable)
- Substitution read-only surface only. (Auto-sync moved to M1 as MUST per owner decision.)
- **Exit:** Stubs behave predictably and never block the core loop.

### M6 — Launch readiness (≈ 0.5–1 week) — **IN PROGRESS (NO-GO)**

Status as of **2026-07-28** (see [`06-launch-readiness-findings.md`](implementation_briefs/mvp_gaps/06-launch-readiness-findings.md)):

| Gate | Status |
|---|---|
| Security / RLS live audit | Done |
| Prod secrets (Vault) | Done |
| Prod API (`https://api.meald.app` on Fly) | Done |
| Crash/error monitoring (GlitchTip Cloud) + uptime | Done |
| Reconnect support runbook | Done |
| OAuth-only auth (`VITE_FEATURE_EMAIL_AUTH` off) | Done (working tree) |
| Apple agreements + signed iOS/Android against `api.meald.app` | Done |
| Dual-platform Area 5 checklist (cold-start / reconnect) | **Open** |
| Privacy/terms + delete-account + spend caps/backups | **Open** |
| Commit/merge launch-readiness tree | **Open** |

- **Exit:** TestFlight / Play **internal** friends beta (not open testing) after Area 5 + remaining ops above.

**Indicative total: ~6.5–7.5 weeks of focused work**, dominated by M1 (reliability + on-by-default auto-sync) and the iOS+Android dual-platform QA in M3/M6. No large greenfield builds are on the MVP critical path.

### Post-MVP backlog (deferred, in priority order)
1. Weekly meal planner UX polish and re-enable (`FEATURE_MEAL_PLANNER` / `VITE_FEATURE_MEAL_PLANNER`).
2. Email/password auth re-enable (`VITE_FEATURE_EMAIL_AUTH`) after custom SMTP in Supabase.
3. OS-level background sync tasks (iOS BGAppRefresh / Android WorkManager). *(Foreground auto-sync ships in MVP per owner decision.)*
4. QFC/Kroger provider, then Walmart.
5. Real substitution recommendation engine (learning from accept/reject).
6. Auto leftover detection.
7. Spend/waste analytics.
8. Voice-guided hands-free cooking.

---

## 7. Risks & open decisions

**Risks**
- **Grocery ToS / bot detection** (advisor's top concern): native WebView + token capture reduces but doesn't eliminate this; monitor breakage and have a reconnect-first fallback.
- **Spoonacular dependency**: pricing/quota is a launch cost lever; the pool architecture mitigates it but must be measured.
- **Two-platform native (iOS+Android), confirmed for simultaneous launch** roughly doubles device QA across M3/M6; staff and schedule accordingly.
- **Auto-sync on by default** raises the reliability bar: a flaky sync now affects every user on every app open, so M1's "no silent failures" exit gate is critical.

**Owner decisions (confirmed 2026-06-09)**
1. **Launch platform:** ✅ **iOS + Android simultaneously.** → M3 cold-start QA and M6 readiness must cover both platforms; budget for ~2× device QA.
2. **Stores at launch:** ✅ **Safeway + Costco.** → Costco bot-detection/token-expiry risk is accepted; M1 reconnect UX is mandatory, not optional.
3. **Substitutions:** ✅ **Read-only stub** using existing data; no engine in MVP.
4. **Auto-sync:** ✅ **On for everyone at launch.** → This promotes auto-sync from a default-off stub to an MVP-critical path. See updated M1/M5 below — foreground auto-sync reliability now gates launch, and silent failures must degrade gracefully to a visible "reconnect" prompt.
5. **Meal planner:** ✅ **Defer from MVP (2026-07-27).** → Weekly meal plan, shopping list, and leftover UI are built but hidden. Ship **"What's for Dinner"** as the sole recipe entry point. Re-enable with `FEATURE_MEAL_PLANNER=1` (backend) and `VITE_FEATURE_MEAL_PLANNER=1` (frontend build).
6. **Email auth:** ✅ **Defer from MVP (OAuth-only beta).** → Email sign-up/sign-in UI is built but hidden to avoid Supabase built-in SMTP delivery failures. Re-enable with `VITE_FEATURE_EMAIL_AUTH=1` after custom SMTP is configured.

---

*Bottom line: Meald already has the hard parts of the core loop built. The MVP is won or lost on **reliability of the connect→sync→suggest path** and the **cold-start experience**, not on building the brief's headline features — most of which the personas agree to defer.*
