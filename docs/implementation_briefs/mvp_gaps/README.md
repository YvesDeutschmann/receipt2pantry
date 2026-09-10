# MVP Gap-Closure — Implementation Brief Set

**Document type:** Brief index / orchestration plan
**Status:** Active
**Last updated:** 2026-09-08
**Parent scope:** [`docs/MVP_SCOPE_AND_ROADMAP.md`](../../MVP_SCOPE_AND_ROADMAP.md)

This directory contains the agent-ready micro-briefs that close the gaps between the current codebase and the Meald MVP. Each brief is a self-contained work order designed to be handed directly to an implementation agent (Cursor Composer, a Cursor SDK agent, or any coding agent). They are the authoritative implementation inputs; when the parent roadmap and a brief disagree, **the brief wins**.

> **Owner decisions baked into this set (confirmed 2026-06-09):** launch on **iOS + Android simultaneously**; ship **Safeway + Costco**; **substitutions = read-only stub**; **foreground auto-sync ON by default**. These change the shape of several briefs (notably 01b and 03).

---

## The 1-Brief-1-Build rule

Per [`.cursorrules.md`](../../../.cursorrules.md), an agent implements **exactly one brief per build session**. Do not implement multiple briefs simultaneously. Do not skip the test-first step. Every brief follows the mandated 4-part structure:

1. **Technical Contract** — API signatures, component props, schema references, exact file paths.
2. **Logic Guardrails** — edge cases and invariants the implementation must honor.
3. **Test-First Suite** — the named pytest/vitest cases that define success, written before implementation.
4. **Definition of Done** — the concrete, verifiable outcomes (incl. a Logic Audit).

If any brief is found to exceed 5 logic-heavy tasks or touch more than 3 distinct files during implementation, split it into sub-phases (e.g. `01b.1`, `01b.2`) before continuing.

---

## Brief catalog

Ordered by the roadmap milestone they serve. The **Gate** column is the condition that must hold before the dependent briefs may start.

| Brief | Milestone | Scope | Depends on | Ships to users |
|---|---|---|---|---|
| [`00-scope-lock-cleanup.md`](00-scope-lock-cleanup.md) | M0 | Strip dev debug logging; hide deferred surfaces (multi-chain cards, voice-cooking entry points) | — | Cleaner UI, no behavior change |
| [`01a-reconnect-ux.md`](01a-reconnect-ux.md) | M1 ⭐ | Frontend reconnect UX + `needs-reconnect`/`expired_credentials` surfacing | 00 | Yes |
| [`01b-foreground-auto-sync.md`](01b-foreground-auto-sync.md) | M1 ⭐ | App-foreground auto-sync scheduler, **on by default**, graceful-degrade to reconnect | 01a | Yes |
| [`01d-sync-feedback-surfaces.md`](01d-sync-feedback-surfaces.md) | M1 ⭐ | Selective sync toasts + persisted "Needs attention" for reconnect and fetch failures | 01b | Yes |
| [`01e-import-reliability-surfaces.md`](01e-import-reliability-surfaces.md) | M1 ⭐ | Fetch-completed outcomes, per-store health row, honest receipt stats (Settings) | 01d (01e.3 independent) | Yes |
| [`01e-import-reliability-gaps.md`](01e-import-reliability-gaps.md) | M1 ⭐ | Close 01e DoD holes: hook failed events, prefs lifecycle, classifier/skipped | 01e (partial) | Yes |
| [`01c-resync-idempotency.md`](01c-resync-idempotency.md) | M1 ⭐ | Backend re-sync dedup hardening + connection-health signal | — (parallel to 01a/b) | Invisible (correctness) |
| [`02a-suggestion-cost-caching.md`](02a-suggestion-cost-caching.md) | M2 | Spoonacular call budget: caching + pool reuse + cost telemetry | 01c | Faster suggestions |
| [`02b-sparse-pantry-resilience.md`](02b-sparse-pantry-resilience.md) | M2 | Credible "What's for Dinner" with a thin pantry (fallbacks) | 02a | Yes |
| [`03-funnel-telemetry.md`](03-funnel-telemetry.md) | M3 | Instrument the activation funnel (connect→sync→staples→first suggestion→first cook) | 01b | Invisible (analytics) |
| [`04-weekly-loop-polish.md`](04-weekly-loop-polish.md) | M4 | Meal-plan flow trim + shopping-list basics + manual leftover marking polish | 02b | Yes |
| [`05-substitution-readonly-stub.md`](05-substitution-readonly-stub.md) | M5 | Surface existing substitution data read-only; **no engine** | 02b | Yes |
| [`06-launch-readiness.md`](06-launch-readiness.md) | M6 | Security/RLS review, prod secrets, crash/error monitoring, reconnect runbook, dual-platform QA gate | all above | Launch gate |

---

## Suggested execution order & parallelism

```
M0:  00  ──────────────┐
                        ▼
M1:  01a ─► 01b ─► 01d ─► 01e ─► 01e-gaps  01c   (01a/01b/01d/01e frontend chain; 01c backend, parallel)
                              │     (01e.3 receipt stats may run in parallel with 01e.1)
M2:                           02a ─► 02b
                              │
M3:  03  (after 01b)          │
                              ▼
M4/M5:                        04   05     (parallel; both need 02b)
                              ▼
M6:                           06          (launch gate; needs all)
```

- **Frontend track:** 00 → 01a → 01b → 01d → 01e → 03 → (04, 05)
- **Backend track:** 01c → 02a → 02b (01e.3 adds a small receipts summary on the backend)
- The two tracks converge at **06 (launch readiness)**.

---

## Shared conventions for every brief

These apply to all briefs and are not repeated in each file:

- **Architecture:** Controller–Service pattern. Flask routes in `backend/routes/` orchestrate; pure/testable logic lives in `backend/services/`. Frontend API calls go through `frontend/src/services/apiClient.js`.
- **Schema source of truth:** `supabase/migrations/` (latest is `022_*`). Do not invent columns.
- **Data integrity:** explicit `is not None` checks; UUID/normalized-key identity (never substring matching for logic); multi-table writes use Postgres RPCs/transactions; date/time functions accept an optional `today`/`reference_date` for deterministic tests.
- **Package management:** `uv add` (Python), `npm install` (frontend). Never `pip`.
- **Test-first:** scaffold `pytest` (backend) / `vitest` (frontend) cases named in the brief **before** implementation.
- **Secrets/PII:** no tokens, cookies, credentials, or PII in logs/telemetry.
- **Format template:** mirror [`../silent_sync/phase-1-foundation.md`](../silent_sync/phase-1-foundation.md) exactly (header block with Prerequisite/Scope/Do-NOT-touch, then the 4 sections).

---

## Definition of "ready to hand to an agent"

A brief is ready when an implementation agent can complete it **without asking the product owner a question** — every file path, signature, edge case, and test name is explicit, and the Definition of Done is mechanically verifiable.
