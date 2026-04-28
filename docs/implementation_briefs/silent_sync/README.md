# Silent Sync Implementation Briefs

This directory contains the 4-phase micro-brief set for implementing tiered silent sync (cookie-only Tier 2 + foreground-triggered scheduler) for Safeway and Costco.

**Master plan:** see `.cursor/plans/tiered_silent_sync_*.plan.md` for architecture and rationale. The briefs here are the authoritative implementation inputs; when the plan and a brief disagree, **the brief wins**.

## The 1-Brief-1-Build Rule

Per `.cursorrules.md`, Composer implements exactly one brief per build session. Do not implement multiple phases simultaneously. Do not skip phases. Each phase has a gate that must pass before starting the next.

## Phase order

| Phase | Brief | Scope | Ships to production |
|---|---|---|---|
| 1 | [`phase-1-foundation.md`](phase-1-foundation.md) | Shared utilities + observability | No runtime change |
| 2 | [`phase-2-orchestrator.md`](phase-2-orchestrator.md) | Tier cascade coordinator (pure) | No runtime change |
| 3 | [`phase-3-bridge-and-providers.md`](phase-3-bridge-and-providers.md) | Bridge hooks + Safeway Tier 2 + Costco stub | Silent button uses orchestrator |
| 4 | [`phase-4-scheduler-and-ui.md`](phase-4-scheduler-and-ui.md) | App lifecycle scheduler + UX | Auto-sync (flag-gated) |

## Runtime flags (localStorage)

| Key | Purpose |
|---|---|
| `SYNC_TIER_TRACE` | Verbose per-tier trace logs (redacted). |
| `SYNC_TELEMETRY_DEV_PANEL` | Render dev overlay on Providers page. |
| `SYNC_AUTO_ENABLED` | Enable auto-sync on app foreground (Phase 4). |
| `SYNC_MIN_RESYNC_MS_OVERRIDE` | Override 4h throttle for testing. |

## Storage keys (Capacitor Preferences)

| Key pattern | Phase | Owner |
|---|---|---|
| `sync_telemetry_<provider>` | 1 | `syncTelemetry` |
| `sync_cookieProbe_<provider>` | 3 | `cookieStorePersistenceProbe` |
| `sync_lastRun_<provider>` | 4 | `useAppSyncScheduler` |
| `<provider>_meta_<key>` | 3 | `tokenStorage.storeMeta` |

## Event bus (window CustomEvents)

Dispatched by the scheduler (Phase 4). UI components subscribe rather than prop-drilling.

| Event | Detail |
|---|---|
| `<provider>-sync-started` | `{}` |
| `<provider>-sync-completed` | `{tier, receipts_stored, items_added}` |
| `<provider>-sync-skipped` | `{}` |
| `<provider>-sync-needs-reconnect` | `{}` |
| `<provider>-sync-error` | `{message}` |

## Out of scope

- OS-level background tasks (iOS BGAppRefreshTask / Android WorkManager).
- Costco real Tier 2 (refresh-token HTTP flow) -- stub only.
- Backend changes.
- Deletion of existing dead code paths (e.g. unused `getStoredTokens` exports). Cleanup is a post-Phase-4 PR.
