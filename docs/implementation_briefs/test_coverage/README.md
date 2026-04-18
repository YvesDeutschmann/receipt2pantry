# Test Coverage Micro-Briefs

One Micro-Brief per file-under-test, organized by risk tier. Each brief follows the `.cursorrules.md` 4-part structure:

1. **Technical Contract** — what exists today (file path, key signatures, dependencies).
2. **Logic Guardrails** — edge cases, invariants, and rule violations to pin down.
3. **Test-First Suite** — concrete `pytest` / `vitest` cases to write first.
4. **Definition of Done** — measurable outcomes that close the brief.

## How to use

- **One brief, one build.** Do not attempt multiple briefs in a single Composer session.
- **Read the brief in full first.** The Logic Guardrails section always references specific lines / constants that must be preserved.
- **Scaffold tests before touching implementation.** If a brief calls out a rule violation (e.g. substring matching in `depletion_engine`), write the failing test first, then fix the code.
- **Start at Tier 1.** Tiers are ordered by probability-of-breakage × blast-radius, not by effort.

## Tier map

| Tier | Theme | Files |
|------|-------|-------|
| 1 — Critical | Breakage here stops the app or corrupts data | 7 |
| 2 — High | Wrong answers rather than crashes; user-visible bugs | 7 |
| 3 — Frontend | Complex client state machines + cross-platform flows | 8 |
| 4 — Stable | Lower risk; sanity / regression coverage | 6 |

## Conventions

- Backend tests live under `tests/services/`, `tests/backend/test_routes/`, `tests/backend/test_parsers/`, `tests/backend/test_providers/`. Do not create parallel hierarchies.
- Frontend tests live under `frontend/src/tests/`. One spec per file-under-test.
- Every test that involves "today" MUST accept and pass a deterministic `today=date(YYYY, M, D)` parameter (per `.cursorrules.md` Time-Determinism rule). If the file-under-test does not expose this, the brief will call that out as a pre-requisite fix.
- Never assert on substring matches of business-critical identifiers (ingredients, household IDs). Use exact equality.
