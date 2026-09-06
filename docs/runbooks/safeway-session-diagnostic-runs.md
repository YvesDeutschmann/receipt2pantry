# Safeway session diagnostic runs

Status: **closed (2026-09-06).** Bounded four-case matrix passed on a debug Android APK + laptop Flask.

This chapter does **not** substitute for Area 5 on signed builds vs `https://api.meald.app`.

Do **not** reopen [431 cookie fix](../safeway_cookie_431_fix.md), [dedup fix](../safeway_dedup_fix.md), or MFA unless they appear on this APK.

## Verdict (2026-09-06)

| Run | Result |
|-----|--------|
| **S-live** | **PASS** ~12:58 PT `66097c6a` — silent ingest, no reconnect |
| **S-reconnect** | **PASS** ~13:00 PT smash `59e55641` → login `89cd0cc2` |
| **S-leftover** | **PASS** ~13:11 PT `fa349725` — fresh silent instance, extract + ingest |
| **S-cooldown** | **PASS** ~13:13–13:15 PT `37dfad2e` — scheduler smash, then `reconnect_cooldown` skip; Costco still ran |

## Ground rules

- Debug Android APK, LAN API override, Flask `--debug` + tee (`/api/dev/log`).
- `SYNC_AUTO_ENABLED=0` unless the step turns it on.
- Rebuild JS before a new APK: `npm run build:mobile` then `cap:run:android`.
- One variable per run; record `sync_id` even on failure.
- Never paste JWT secrets or cookie values in logs or tickets.

## Pre-run checklist

1. Laptop Flask running with `--debug`.
2. Meald inspect tab on device (`chrome://inspect`).
3. Confirm `SYNC_AUTO_ENABLED` is `0` for manual matrix steps.
4. For **S-cooldown** only: set `SYNC_AUTO_ENABLED=1` and `SYNC_MIN_RESYNC_MS_OVERRIDE=0` on Meald inspect after a real scheduler reconnect.

## Matrix

| Run | Setup | Pass = proves |
|-----|--------|---------------|
| **S-live** | Connected Safeway session. Tap **Silent Sync** (or foreground auto-sync with live cookie). | Receipts ingest; **no** reconnect banner; no `sync_reconnectCooldown_safeway`. |
| **S-reconnect** | Arm smash **or** logout in WebView, then Silent / auto-sync. | Smash: Flask `[safewaySilent] s_reconnect_smash consumed=1` → `needs_reconnect`, banner, Retry → login → pantry updates. Must **not** be `silent_timeout` with leftover `[safewayLogin]` lines during silent. Logout without smash may take up to 15s + `cookie_probe cookie=absent`. |
| **S-leftover** | Interactive Safeway login, then Silent **in the same process** (no force-stop). | Fresh instance; no zombie login listeners; no timeout with no extract. Timeout with leftover login lines = shared cleanup regression (Settings → Force close WebViews), **not** reconnect pass/fail. |
| **S-cooldown** | After a real **scheduler** `needs_reconnect`, enable auto-sync + resync override, background/foreground. | `sync_reconnectCooldown_safeway` armed; next tick skips Safeway with `reconnect_cooldown`; banner stays; Costco can still run. |

## Device evidence (2026-09-06)

Debug APK on Pixel 8, LAN Flask (`http://<lan-ip>:5000/api`). Same process for leftover and cooldown (no force-stop). Never paste JWT secrets or cookie values.

**Superseded (not passes):** 11:47 PT silent `8f440c41` timed out 15s then `needs_reconnect` (pre-matrix APK treated timeout as reconnect). 11:51 PT silent `dc423932` incomplete (`webview_opened` only).

### S-live — **PASS**

| Field | Value |
|---|---|
| When (PT) | ~12:58 |
| `sync_id` | `66097c6a-1e1f-414f-ad3b-6aafcce15471` |
| Mode | `silent` |
| Terminal | `sync_succeeded` |
| Ingest | 1 Safeway receipt at 12:58:26 |
| Reconnect / cooldown | none |

Telemetry on this attempt was thin (flushed `sync_succeeded` only). Product gate still holds: ingest, no banner, no `sync_reconnectCooldown_safeway`.

### S-reconnect — **PASS** (smash path)

Flask at smash time was `python -m backend` without tee; `consumed=1` is not in `/tmp/meald-flask-c1.log`. Terminal `reason=s_reconnect_smash` is the equivalent marker.

| Field | Value |
|---|---|
| Smash `sync_id` | `59e55641-43ff-4c21-9c7a-f8ebf7ea5f9a` (~13:00:14) |
| Smash terminal | `needs_reconnect` / `s_reconnect_smash` (~2.4s) |
| Login `sync_id` | `89cd0cc2-489c-4b43-b5d7-ce79b44dc2d9` (~13:00:29) |
| Login terminal | `tokens_received` → `ingest_started` → `sync_succeeded` |
| Ingest | 5 Safeway receipts at 13:00:31 |

Not a leftover timeout: no `silent_timeout`, no `[safewayLogin]` during smash silent.

### S-leftover — **PASS**

Silent in the same process as the 13:00 login (no force-stop). Flask tee on.

| Field | Value |
|---|---|
| When (PT) | 13:11:48–13:11:56 |
| `sync_id` | `fa349725-1613-4e43-aa1f-120e02c03a6a` |
| Instance | `bc9cb8a8-9ac` (new silent id) |
| Flask | `tryExtract` / `tokens_ready` `hasToken=true` `hasClub=true` |
| Leftover `[safewayLogin]` during silent | none |
| Terminal | `ingest_started` → `sync_succeeded` |

`executeScript failed … WebView is not initialized` and `close_unconfirmed` / `no_close_event` ran after tokens posted. Close-event noise, not a leftover fail.

### S-cooldown — **PASS**

Scheduler path (`SYNC_AUTO_ENABLED=1`, `SYNC_MIN_RESYNC_MS_OVERRIDE=0`). Smash armed on Meald inspect. Manual Silent button does not count.

| Tick | When (PT) | Signal |
|---|---|---|
| 1 (arm) | 13:13:21 | `[safewaySilent] s_reconnect_smash consumed=1` → `s_reconnect_smash_result kind=needs_reconnect`. `sync_id` `37dfad2e-fa5e-43f7-a91c-ed1ccb980d86`. Costco silent on the same tick (`receiptCount: 3`) |
| 2 (skip) | 13:15:35, 13:15:43 | `sync_skipped` / `reconnect_cooldown`. **No** new `[safewaySilent] startSilentSync`. Costco silent ran again at 13:15:41 |

Late `tokens_ready` after smash is the dying page; terminal result was already `needs_reconnect`. Skip rows reused the Tick 1 `sync_id` (active attempt not cleared on reconnect). Not a second Safeway fetch.

## S-reconnect smash (debug only)

Arm on Meald inspect (`https://localhost`):

```js
localStorage.setItem('SAFEWAY_S_RECONNECT_SMASH', '1');
```

Requires dev gate: `import.meta.env.DEV` or build with `VITE_ENABLE_DEV_SETTINGS=1`.

Expected Flask sequence (smash path):

1. `[safewaySilent] s_reconnect_smash consumed=1`
2. Terminal `needs_reconnect`, reconnect banner, Silent hidden until reconnect

Re-arm after inconclusive run (no `consumed=1`, or tokens still arrive after smash):

```js
localStorage.setItem('SAFEWAY_S_RECONNECT_SMASH', '1');
```

Interactive login clears the smash flag automatically.

## Triage

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Silent timeout + `cookie_probe cookie=present` | Leftover WebView / slow extract | Force-close WebViews; retry S-leftover. Not a dead-session reconnect. |
| Silent timeout + `cookie_probe cookie=unread` | `getCookies` failed | Retry; check InAppBrowser plugin. Not reconnect. |
| `needs_reconnect` + `cookie=absent` | Real session dead | Expected for S-reconnect / logout path. |
| Smash armed but no `consumed=1` | Dev gate off or stale `dist` | Rebuild with `VITE_ENABLE_DEV_SETTINGS=1`; re-arm. |
| Leftover `[safewayLogin] urlChange` during silent | Shared cleanup regression | Settings → Force close WebViews; file as C1-class bug, not Safeway auth. |

## Exit criteria

| Criterion | Status |
|-----------|--------|
| S-live | **PASS** 2026-09-06 `66097c6a` |
| S-reconnect | **PASS** 2026-09-06 smash `59e55641` + login `89cd0cc2` |
| S-leftover | **PASS** 2026-09-06 `fa349725` |
| S-cooldown | **PASS** 2026-09-06 `37dfad2e` |

Debug-APK + LAN Flask chapter is **closed**. Next: signed builds for Area 5 vs `api.meald.app`. Redeploy Fly only if the API changed.

## Related

- Costco matrix (closed): [costco-token-diagnostic-runs.md](costco-token-diagnostic-runs.md)
- Reconnect UX: [reconnect.md](reconnect.md)
- July 29 cluster (`needs_reconnect` ×3 + `sync_skipped` ×5): motivation for this bounded chapter; see Costco runbook “Separate thread” note.
