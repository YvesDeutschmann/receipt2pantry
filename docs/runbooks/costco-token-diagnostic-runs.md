# Runbook — Costco token discovery diagnostic runs (A, B, C)

Status: **closed (2026-08-27).** Runs A and B executed on a debug APK against laptop Flask.
Run C was **not executed** and is **closed as a diagnostic requirement** (see [Run C](#run-c--play-build-baseline--closed-without-running)).
Created 2026-07-29 after Phase 0 of the Costco token discovery investigation.

**Read first:** [costco-login-postmortem.md](../costco-login-postmortem.md) for resolved root
causes and hypotheses already ruled out. Do not re-litigate them here.

## Verdict (2026-08-27)

| Claim | Result |
|---|---|
| Does `pm clear` empty InAppBrowser `www.costco.com` storage? | **Yes.** Run A A0 `censusSeen=0`. |
| Live B2C policy (`tfp`) — Bug B | **`B2C_1A_SSO_WCS_signup_signin_209`**. Backend `_get_b2c_token_endpoint` reads `tfp`/`acr` (fallback `209`). |
| Does an expired IdToken in that origin block interactive `/token`? | **No.** Run B1: expired cache present, `/token` **200**, sync succeeded. **Do not ship expired-only cleanup. Do not run B3.** |
| AccessToken on success | **Never present.** Extract uses the IdToken. RefreshToken is present; silent redeem shipped 2026-08-27 (was Bug A). |
| IdToken lifetime | **~15 minutes**, not ~1 hour. |
| Run C (Play ×3 vs Fly) | **Closed without running.** A/B already settled interactive login; C would not diagnose silent auto-fetch. |
| Next chapter | **Silent sync after expiry.** Bug A fix shipped 2026-08-27; resilience shipped 2026-08-29. Device matrix S1–S5 **pass** (S3 2026-08-31). WebView listener leak + instance scoping shipped 2026-08-31; re-verify S3 **without** force-stop after interactive login. |

---

## Why these runs existed

Phase 0 proved *what* the injected script saw at one moment: an `IdToken` for
`environment: signin.costco.com` that had been expired for ~15 days, a `RefreshToken`, and no
`AccessToken`. `tryPost()` correctly refused to send a dead token, so no overlay appeared and
the poll ran silently for five minutes until the user gave up.

Phase 0 never captured the token *exchange*. The question that decided the **interactive-login**
fix was:

> Was the expired cache entry **causing** the failed exchange, or merely sitting next to it?

Each run was designed to kill one claim:

- **Run A** — see the exchange on a cold start (clean cache). **Done.**
- **Run B** — prove or kill the stale-cache wedge. **Killed at B1.**
- **Run C** — measure Play+Fly vs debug. **Closed without running** (not needed to answer the
  question above; not the automated-fetch path).

---

## Ground rules

1. **Never paste a token secret anywhere.** The census snippet below emits lengths, claim
   names, `exp`, and `tfp`/`acr` only. Do not decode or copy full JWT payloads — they contain
   personal data. If you need to share output, share the census JSON, not raw storage dumps.
2. One variable per run. If you clear storage *and* change code, the run is worthless.
3. Record the `sync_id` for every attempt, including failures. A failure with no `sync_id` is
   an unrecorded data point.
4. **`npm run cap:run:android` copies `frontend/dist` and does not rebuild JS.** After extract
   or probe changes, run `npm run build:mobile` first. A 2026-08-27 attempt after the capture
   closeout was invalid: the phone still emitted `idPreview` / `idJwtExp` from an 11:24 bundle
   while source was 13:45. Ignore that attempt.
5. Debug APK + LAN Flask is enough to close the **interactive login** chapter. Play+Fly is a
   later launch smoke test, not a gate on Bug A / Bug B.
6. **WebView session cleanup shipped (2026-08-31):** listener leak fixed, instance scoping, and
   Dev Tools **Force close WebViews** (`Settings` → Dev Tools). After interactive login you
   should no longer need force-stop for S3 — but if silent still times out, use force-stop or
   the Dev Tools button before re-arming. See
   [Leftover InAppBrowser after login](#leftover-inappbrowser-after-login-2026-08-31).

## Shared setup

### Device and build

```bash
cd frontend
npm run build:mobile
unset DEV_SERVER_URL
npm run cap:run:android
```

This installs the **debug** build. `chrome://inspect` only exposes WebViews from a debuggable
build — this is why the earlier Play-build logcat attempts produced nothing but system noise.

Package id: `com.meald.app`

### Clearing app storage

```bash
adb shell pm clear com.meald.app
```

**Settled (Run A):** `pm clear` **does** empty the InAppBrowser `www.costco.com` origin
(`a0` `censusSeen=0`). The 2026-07-29 10:08 failure after an app-storage clear is **not**
explained by leftover MSAL credentials in that origin.

`pm clear` also wipes Meald login, the LAN API override in Dev Tools, and the auto-sync kill
switch (`SYNC_AUTO_ENABLED`). Re-apply all three after every clear (see pre-run checklist below).

### Force-stop (does not clear storage)

Force-stop kills the Capacitor process, leftover InAppBrowser Chromium instances, and JS
listeners. It does **not** wipe Meald login, LAN API override, or `COSTCO_S3_SMASH_RT`.

```bash
adb shell am force-stop com.meald.app
```

Or: Settings → Apps → Meald → **Force stop**, then tap the icon (cold start, do not resume a
leftover task). Swiping from recents is **not** reliable — Android can keep the process cached.

Use this between interactive login and Silent / S3 until session cleanup ships. Do **not**
use `pm clear` for that (it wipes the page RT you need for S3).

### Pre-run checklist (mandatory for Runs A/B)

1. **Disable auto silent sync** — Settings → Auto-sync Receipts is a stub. The real kill switch
   is `localStorage.setItem('SYNC_AUTO_ENABLED', '0')` in the **Meald** WebView (safe to set via
   `chrome://inspect` on `https://localhost` before Costco sync; do not inspect the Costco
   InAppBrowser during login).
2. **Pin LAN API** — Settings → Dev Tools → set Effective URL to your laptop Flask
   (`http://<lan-ip>:5000/api`) → Save override → Test connection.
3. **Run B purge** — leave **off** for Run A and B1. B3 was not run; leave the toggle off.

### Automated capture (no Chrome DevTools during login)

When `import.meta.env.DEV` or `VITE_ENABLE_DEV_SETTINGS=1`, the Costco **login** bridge auto-captures.
Silent sync does **not** install this probe.

| Checkpoint | When | Stored as |
|---|---|---|
| **A0** | First load of `www.costco.com` before sign-in | `sync_events` phase `diagnostic_checkpoint`, reason `a0` |
| **A1** | Right after `auth_complete` (`OAuthLogonCmd` / B2C confirmed) | reason `a1` |
| **A2** | ~30 s after A1 on Orders & Purchases | reason `a2` |
| **A3** | ~90 s after A1 (if sync still running) | reason `a3` |
| **tokens-found** | When extract finds a live JWT (success path) | reason `tokens-found` — carries live **`tfp`** (Bug B) |
| **`/token`** | MSAL exchange (continuous observer + 400 ms sweep) | phase `token_exchange`, reason `observed` or `missed` |

**Observed timing (both A and B1):** A1 runs on a transient `OAuthLogonCmd` document and often
shows `censusSeen=0` even when the attempt later succeeds. Treat **`tokens-found`**, not A1, as
the success census. Tokens typically appear ~40–50 s after `auth_complete` (MSAL writes cache
on `www.costco.com` late). A2 can still show the *old* expired IdToken a couple of seconds
before `/token` 200 and a new JWT.

Data also streams to `/api/dev/log` (`costcoLogin|webview debug: …`) for live tailing on a laptop
(rate limit 240/min in dev). **Do not attach `chrome://inspect` during login** — paste
credentials from Dashlane instead of autofill.

On-device: expand the **Costco diag…** pill (bottom-left) after the WebView closes. Dev builds
use a **15-minute** login timeout (production stays 5 minutes).

**Run B purge (B3 only):** Settings → Dev Tools → enable *Run B: purge expired IdToken/AccessToken
before sign-in*. Leave off. B3 was skipped after B1 succeeded.

### Logcat (secondary capture)

```bash
adb logcat -c && adb logcat | grep -Ei 'WebViewDialog|costco|meald'
```

`WebViewDialog: Received message from JavaScript:` lines carry `diag-checkpoint`, `token-exchange`,
`page-diagnostic`, and `msal-*` payloads posted by the injected script.

### Pulling outcomes afterwards

```sql
select sync_id, provider, mode, terminal_phase, terminal_reason,
       started_at, round(duration_ms) as ms
from sync_attempt_outcomes
where provider = 'costco'
  and started_at > now() - interval '6 hours'
order by started_at desc;
```

```sql
select occurred_at, phase, reason, metadata
from sync_events
where sync_id = '<SYNC_ID>'
order by occurred_at;
```

**Run A/B recording template (one query):** pivots auto-captured checkpoints for the latest attempt.

```sql
with latest as (
  select sync_id
  from sync_attempt_outcomes
  where provider = 'costco'
  order by started_at desc
  limit 1
)
select
  e.sync_id,
  max(e.metadata->>'censusSeen') filter (where e.phase = 'diagnostic_checkpoint' and e.reason = 'a0') as a0_credentials_count,
  max(e.metadata->>'censusSeen') filter (where e.phase = 'diagnostic_checkpoint' and e.reason = 'a1') as a1_seen,
  max(e.metadata->>'censusTokenFailureCount') filter (where e.phase = 'diagnostic_checkpoint' and e.reason = 'a1') as a1_token_failure_count,
  max(e.metadata->>'censusIdTokens') filter (where e.phase = 'diagnostic_checkpoint' and e.reason = 'a1') as a1_id_tokens,
  max(e.metadata->>'censusAccessTokens') filter (where e.phase = 'diagnostic_checkpoint' and e.reason = 'a1') as a1_access_tokens,
  max(e.metadata->>'censusTfp') filter (where e.phase = 'diagnostic_checkpoint' and e.reason in ('a1','a2','a3')) as tfp_from_checkpoint,
  max(e.metadata->>'tfp') filter (where e.phase = 'diagnostic_checkpoint' and e.reason = 'tokens-found') as tfp_from_jwt,
  max(e.reason) filter (where e.phase = 'token_exchange') as token_exchange_reason,
  bool_or((e.metadata->>'tokenFired')::boolean) filter (where e.phase = 'token_exchange') as token_post_fired,
  max(e.metadata->>'tokenStatus') filter (where e.phase = 'token_exchange') as token_status,
  max(e.metadata->>'tokenPolicy') filter (where e.phase = 'token_exchange') as token_policy,
  max(e.metadata->>'tokenSweepRuns') filter (where e.phase = 'token_exchange' and e.reason = 'missed') as token_sweep_runs,
  max(e.metadata->>'tokenError') filter (where e.phase = 'token_exchange') as token_error,
  max(e.metadata->>'purgeRemovedCount') filter (where e.reason = 'purge-expired') as purge_removed
from sync_events e
join latest l on e.sync_id = l.sync_id
group by e.sync_id;
```

Do not treat empty A1 as failure. Prefer `tfp_from_jwt` (`tokens-found`) and
`token_exchange_reason` / `token_status`.

---

## Run A — cold-start exchange capture — **done**

**Claim under test:** on a genuinely empty cache, the interactive `code` in the redirect hash
is exchanged successfully for a fresh IdToken and AccessToken.

**Also settles:** the live B2C policy (`tfp` claim), which decides Bug B, and whether `pm clear`
reaches the Costco InAppBrowser origin.

### Steps (as executed)

1. Force-stop the app, then `adb shell pm clear com.meald.app`.
2. Launch the app and sign in to Meald. Do **not** start the Costco sync yet.
3. `SYNC_AUTO_ENABLED=0` and re-save LAN API override after the clear.
4. Start **Sync Costco Receipts** (interactive `startLogin`). Paste password; stay on Orders.
5. Read pill + `sync_events` for that `sync_id`.

Use the **primary** button. Silent Sync is a different path (no probe, no purge, no session
clear) and was not part of Run A.

### Recording — 2026-08-27 14:12 PT

Invalid prior attempt (~14:03): stale `dist` (old `idPreview` payload). Discarded.

Valid attempt after `npm run build:mobile`:

| Field | Value |
|---|---|
| Attempt time | 2026-08-27 **14:12 PT** |
| Build | debug APK, LAN Flask, capture closeout bundle (13:45+ source) |
| `sync_id` | `6a8a1d14-1427-47bd-ade2-1aaf97fcbcce` |
| Mode | `login` |
| A0 credentials count (pre-sign-in) | **0** (`censusSeen=0`, no IdToken/AccessToken/RT) |
| A0 timing | 21:12:07.543Z — 618 ms after `webview_opened` |
| `/token` POST fired | **not observed** (`reason=missed`, `sweepRuns=0`) |
| `/token` status | n/a |
| `/token` policy | n/a |
| A1 | `censusSeen=0` (wrong document after `auth_complete`) |
| A2 | `censusSeen=0`, `hashPresent=true` (21:12:42Z) |
| `tokens-found` | 21:12:50.9Z — **`tfp=B2C_1A_SSO_WCS_signup_signin_209`**, `idSecondsLeft=837` (~14 min left), **no AccessToken**, RefreshToken present |
| Overlay / receipts | yes — GraphQL 200, 3 receipts (`receipts_stored: 0` = idempotent re-store) |
| Terminal phase | `sync_succeeded` (21:12:55.9Z) |

Timeline: empty A0 → empty A1 (~4 s) → empty A2 (~30 s later) → live JWT ~8 s after A2
(~43 s after A0). Cold start succeeded **without** a dirty cache.

`missed` / `sweepRuns: 0` means the wrap never lived on the document that minted the JWT
(likely `signin.costco.com` during password/OTP, or the verdict ran on Orders with fresh
probe globals). It is **not** proof the exchange never happened. B1 later observed `/token` 200.

IdToken clock: `idSecondsLeft` is `exp − now − 60`. Captured 14:12:50 PT → extract treats it
dead ~**14:26:47 PT**, JWT `exp` ~**14:27:47 PT**. Safe to start B1 from **14:28 PT**.

### Interpreting Run A (actual)

- **A0 empty** → `pm clear` reached the Costco origin. Wedge is not “clear never worked.”
- **Cold start healthy** → overlay, receipts, `sync_succeeded` with a live IdToken.
- **No AccessToken** is normal on this path; Bug A (unused RefreshToken) is still open.
- **`tfp` `…209`** → Bug B confirmed. Backend now reads `tfp`/`acr` from the JWT (fallback `209`).
- Proceeded to Run B because cold start worked; `/token` capture on A was a weak negative.

---

## Run B — stale-cache reproduction — **done; wedge dead at B1**

**Claim under test:** an expired `IdToken` left in `www.costco.com` `localStorage` prevents a
fresh **interactive** exchange, and removing only the expired entries unblocks it.

**Verdict:** B1 **succeeded** with that expired entry still present. The wedge is **dead** for
interactive login. **Do not write the cleanup. Do not run B3.**

**Why natural expiry, not a fabricated token:** MSAL decides whether to attempt silent renewal
from its own cache metadata, while our reader decides from the JWT `exp`. Only natural expiry
puts both in the failing state simultaneously.

### Steps (as executed)

1. Started from successful Run A. **No** `pm clear`, **no** APK reinstall.
2. Waited until past Run A JWT `exp` (~14:28 PT). IdTokens lasted **~15 minutes**, not ~1 hour.
3. **B1** — **Sync Costco Receipts** (not Silent Sync). Purge **off**. Paste password; stay on Orders.

### Recording — B1 2026-08-27 14:42 PT

| Field | B1 (expired cache) | B3 (after expired-only delete) |
|---|---|---|
| Attempt time | 2026-08-27 **14:42 PT** | **not run** |
| `sync_id` | `d444bd85-300e-484f-8eaa-cb07d6f0322b` | — |
| Mode | `login` | — |
| A0 (dirty origin) | `censusSeen=2`, `censusExpired=1`, `censusHasRt=true`, `censusMinSecondsLeft=-863` (~14 min past `exp`) | — |
| `/token` POST fired | **yes** (`reason=observed`, resource-timing) | — |
| `/token` status | **200** | — |
| `/token` policy | `/b2c_1a_sso_wcs_signup_signin_209` | — |
| A1 | empty again (wrong document) | — |
| A2 | still the **expired** IdToken (`minSecondsLeft≈-905`) | — |
| `tokens-found` | `tfp=B2C_1A_SSO_WCS_signup_signin_209`, `idSecondsLeft=837`, no AccessToken, RT present | — |
| Overlay / receipts | yes — GraphQL 200, 3 receipts | — |
| Terminal phase | `sync_succeeded` | — |

A2 still showed the leftover expired IdToken; ~2 s later `/token` 200 and a **new** IdToken.
The expired entry was a neighbor, not the cause. A0 `censusTfp` on the leftover matched **209**
(same policy, new `exp` after the exchange).

### Historical trap — still true, now moot for this chapter

[costco_msal_wipe_fix.md](../costco_msal_wipe_fix.md) records that in May 2026 a localStorage
MSAL wipe deleted **fresh** tokens mid-flow. That cleanup must not be revived: B1 showed it is
not needed for interactive login.

---

## Run C — Play build baseline — **closed without running**

**Claim under test (original):** the failure rate on the debug build is representative of the
Play release build against Fly.

**Closed 2026-08-27 without executing C1–C3.** A and B already showed interactive Costco login
works on a clean cache **and** on an expired cache. Re-running the same `startLogin` flow three
times on Play+Fly would not add evidence to the wedge question, cannot capture `/token` or A0
(the probe is debug-gated), and is not the product loop that matters (silent auto-fetch after
connect). An optional one-shot Play smoke can live on the launch checklist; it is not a
diagnostic gate for Bug A / Bug B.

The procedure below is left as historical context only.

### Prerequisite (if a launch smoke is ever run)

Land **Phase 2** first (`DEV_LOG_ENABLED` in [../../backend/config.py](../../backend/config.py)
and the `/dev/log` guard in [../../backend/routes/dev.py](../../backend/routes/dev.py)).
`sync_events` already persist on Fly without that window; `/dev/log` is unauthenticated while
the secret is on — minutes, not days.

```bash
fly secrets set DEV_LOG_ENABLED=1 --app meald-api
# ... smoke ...
fly secrets unset DEV_LOG_ENABLED --app meald-api
```

### Steps (not executed)

For each of three attempts: `pm clear` → Play internal-testing build → Meald sign-in → Costco
sync → wait on Orders up to 90 s → record `sync_id` / terminal phase.

| Attempt | Overlay | `sync_id` | Terminal phase | Duration | `/dev/log` lines seen |
|---|---|---|---|---|---|
| C1 | *not run* | | | | |
| C2 | *not run* | | | | |
| C3 | *not run* | | | | |

---

## Baseline for comparison — 2026-07-29

Eight Costco login attempts, one success:

| Time | `sync_id` | Outcome |
|---|---|---|
| 08:51 | `aca09155` | closed before tokens |
| 09:32 | `3dc535d7` | 5-minute login timeout |
| 09:39 | `b5ef6a1c` | closed before tokens |
| 10:08 | `bf75d2fb` | closed before tokens (**after an app-storage clear**) |
| 11:10 | `c7094042` | closed before tokens |
| 11:14 | `b1adbcd2` | closed before tokens |
| 11:15 | `f0807bf6` | 5-minute login timeout |
| 11:32 | `5b03be54` | **succeeded** — 1 receipt, 38 items, 42.6 s |

The 10:08 attempt is now explained **negatively** by Run A A0: a storage clear *does* reach
`www.costco.com`. Whatever killed 10:08 was not leftover MSAL credentials in that origin.

The 11:32 success came with **no code change**, which is why this was treated as an
intermittent state problem. Run B1 shows expired cache is not that state for **interactive**
login.

## After A/B — silent sync (next chapter, not part of these runs)

Interactive login is not the product loop. After a successful connect, auto-fetch uses
`startSilentSync` (hidden 1×1 WebView, **no** diagnostic probe, 45 s timeout, no session
clear, no B2C password UI).

**2026-08-27 ~15:27 PT**, after B1, two silent attempts failed. Captured:

| Field | Value |
|---|---|
| `sync_id` | `bf226d1b-4a6b-4432-831a-4380b87a25cd` |
| Mode | `silent` |
| Terminal | `silent_timeout` (45 s, `lastUrl=https://www.costco.com`) |
| Census | `expired_id_rt_present` |
| IdToken | expired ~29 min (`minSecondsLeft=-1734`) |
| AccessToken | none |
| RefreshToken | **present** (`hasUsableRt=true`) |
| `tfp` | `B2C_1A_SSO_WCS_signup_signin_209` |
| UI | “Sync timed out. Check your connection and try again.” (misleading — not a network failure) |

Same dirty cache B1 survived. Silent `tryPost()` correctly rejected the dead JWT and never
redeemed the RefreshToken (Bug A). **Fix shipped 2026-08-27:** in-WebView `grant_type=refresh_token`
from `www.costco.com`, MSAL write-back on rotation, Capacitor mirror via `costco-token-rotated`,
honest `needs_reconnect` (no fake connection timeout). GraphQL stays in-WebView (Akamai). Run C
closed without executing.

### Silent sync device matrix (S1–S5)

Debug APK + laptop Flask (same as Runs A/B). `SYNC_AUTO_ENABLED=0`. `npm run build:mobile` before
`cap:run:android`. Record every `sync_id`.

| Run | Setup | Pass criteria | Status |
|---|---|---|---|
| **S1** | Silent while IdToken still live (~first 10–12 min after login) | Receipts; no `rt-refresh-start` | **PASS** 2026-08-27 `b698eb09` (~14 min JWT left) |
| **S2** | Silent after expiry (reproduces `bf226d1b`) | `rt-refresh-result` status 200, policy `…209`, one grant, receipts posted; UI not a connection timeout | **PASS** 2026-08-27 `1cf95578` (~6 min after expiry). Flask `rt-refresh-*` scrolled off; product gate holds |
| **S3** | Refresh forced to fail (revoked page MSAL RT) | Immediate `needs_reconnect`, Reconnect banner, Silent hidden, Retry opens interactive login. Scheduler cooldown only if `SYNC_AUTO` is on | **PASS** 2026-08-31 ~09:43 PT; reconfirmed ~13:30 PT after force-stop. Afternoon 13:12/13:14 timeouts are leftover-session, not product fails. See [S3 evidence](#s3-device-evidence-2026-08-31) |
| **S4** | **Second** silent after S2 succeeded, still expired | Second grant 200, no `invalid_grant` (rotation authority gate) | **PASS** 2026-08-27 `cd0dc96d` (90 s later; `rotated: true`, GraphQL 3 receipts) |
| **S5** | Home immediately after Silent (during fetch, before or after `rt-refresh-start`) | Resume may timeout or ingest-retry; **Silent Sync stays enabled** unless DB shows terminal `needs_reconnect` (`invalid_grant`). Swipe-from-recents not required. Retry uses Silent when tokens remain. Auto-success on resume is a pass | **PASS** 2026-08-29 `b526f593` (post-resilience). See below |

S2 is the product gate; S4 is the architecture gate; S5 is the lifecycle gate. If S2 hits CORS,
app-side CapacitorHttp grant (B2C only) is used; GraphQL still in-WebView.

### S5 device evidence (2026-08-29)

Resilience ship (same day, before this run): keep Capacitor tokens on transient
`Network Error`, freeze the silent deadline while backgrounded, ingest only when
foreground + ~1 s settle + one retry, clear session only on terminal B2C
(`invalid_grant` / `login_required` / `interaction_required`).

**Superseded failures (pre-resilience — not S5 passes):**

| When (PT) | `sync_id` | What happened |
|---|---|---|
| 2026-08-27 21:56 | `c7ca2770` | Home mid-silent → `ingest_started` → `sync_failed: Network Error`. Catch wiped tokens. Retry opened **login** `fc9bc3d5` (no password; page RT still good) |
| 2026-08-29 07:02 | `7efb7c93` | Same wipe path. Silent hidden on resume. Recovered via interactive login `ceeaecfe` at 07:11 (`tokenStatus` 200, policy `…209`) |

**Passing run (post-resilience):**

| Field | Value |
|---|---|
| `sync_id` | `b526f593-9879-4f5b-b345-dcd93bfc6102` |
| Mode | `silent` |
| Terminal | `sync_succeeded` (07:47:53–07:49:02 PT) |
| UI | Completed after return to the app. No interactive Costco WebView. No reconnect copy |
| Flask | `store-receipts` 200, `connect-from-app` 200. Later `[costcoSilent] doFetchReceipts success receiptCount: 3` then `executeScript failed … WebView is not initialized` (leftover inject after close, not a second attempt) |
| DB phases | `session_begin` → `webview_opened` → `close_*` → `ingest_started` → `sync_succeeded` |
| `receipts_stored` | `0` (expected idempotency; same three receipts already stored) |
| `needs_reconnect` | none |

JWT from the 07:11 login was ~36 min old at tap, so this silent was after expiry.
`rt-refresh-*` is still Flask-only; those lines had scrolled off before ingest. No
`invalid_grant`. Gap: silent `sync_events` still have no census / refresh metadata.

`ingest_started` at 07:48:25 and `store-receipts` at 07:48:59 match the new gate:
the hook logs ingest, then `submitSilentReceipts` waits for foreground + settle
before POST. That is the path the 07:02 run lacked.

### S3 device evidence (2026-08-31)

Debug APK + laptop Flask (`--debug` / `DEV_LOG_ENABLED`). Meald `COSTCO_S3_SMASH_RT=1`,
`SYNC_AUTO_ENABLED=0`. Single `executeScript` (nonce + smash + extract).

**Passing run:**

| Field | Value |
|---|---|
| When (PT) | 2026-08-31 09:43:35–09:43:39 |
| Mode | `silent` |
| Flask | `[costcoSilent] s3_smash consumed=1` → `rt-refresh-result` `status: 400`, `errorCode: invalid_grant`, `cors: false`, `source: page` → `s3_result kind=needs_reconnect` |
| Duration | ~4 s (not a 45 s `silent_timeout`) |
| UI | Reconnect Costco banner shown |
| `sync_id` | Not stored: `POST /api/telemetry/sync` **400** after the terminal event (separate ingest validation; does not undo the gate) |

Page-side B2C grant failed honestly; Capacitor app-side rescue did not run (`source: page`).
That is the S3 product gate.

Reconfirmed **2026-08-31 ~13:30 PT** after force-stop (operator): same gate (`invalid_grant` →
`needs_reconnect`), then interactive recovery also succeeded. The 13:12 / 13:14 timeouts in
the same process as the 12:31 login are leftover-session, not a product fail.

`script_run` logged `nonce: 1a410fdd` with `"reset": false`. No Flask line for `s3-smash-rt`
or `rt-refresh-start` (first posts raced before `mobileApp` was ready). `policy: "oauth2"` on
the result line is a path-slice logging bug, not a wrong token URL.

**Superseded failures (not S3 passes):**

| When (PT) | What happened |
|---|---|
| 2026-08-30 07:21 `4f8145be`, 07:42 `c2a0958a` | Smash was a separate swallowed `executeScript`. Flask: `script_run` / `page-diagnostic` only → `silent_timeout`. No `invalid_grant` |
| 2026-08-31 09:35 `e40c3b0a` | Flask restarted **without debug**. Every `POST /api/dev/log` **403**. Telemetry: `silent_timeout`. Inconclusive |
| 2026-08-31 ~13:12 and ~13:14 | Leftover login InAppBrowser. `s3_smash consumed=1` (flag read) then `s3_result kind=timeout` at 45s. No `s3-smash-rt`, no `rt-refresh-*`, no `invalid_grant`, no `script_run` `"reset": true`. Same timestamps: `[costcoLogin] urlChange` with `tokensReceived=true`. **Not an S3 product fail.** See [leftover session](#leftover-inappbrowser-after-login-2026-08-31) |

### Leftover InAppBrowser after login (2026-08-31)

Silent can inject into a **still-alive login session** instead of a clean silent WebView. The
leftover is usually **invisible**: silent uses a 1×1 off-screen instance (`x/y: -9999`), and
login `urlChange` / `close` listeners can stay registered after success (`beginTokenCleanupGrace`
only drops the message listener). Capgo `executeScript` with no WebView id runs in every open
instance. First `script_run` already `"reset": false` → `__mealdSyncNonce` seen and
`__costcoPollActive` true → smash / `tryPost` never start.

**Confirmed workaround (2026-08-31 ~13:30 PT):** force-stop Meald, cold start, re-arm
`COSTCO_S3_SMASH_RT` on Meald inspect (`https://localhost`), Silent Sync only. **S3 passed**
(`invalid_grant` → `needs_reconnect`) and **interactive recovery after that S3 also passed**.

Automatic cleanup (close leftover WebView, remove all login listeners on success, close before
silent `openWebView`, prefer targeted `executeScript`) **shipped 2026-08-31**. If S3 still
times out after login without force-stop, check Flask for `tryPost-branch` / instance-id
instrumentation (Phase 0) — the hang may be a stuck refresh latch, not a second WebView.
Force-stop or **Settings → Dev Tools → Force close WebViews** remains the fallback.

### S3 — Revoked page RT via Meald flag (re-run)

`chrome://inspect` on the Costco InAppBrowser closes too fast to smash MSAL storage manually.
Arm S3 from the **Meald** WebView (`https://localhost`) only — same tab as `SYNC_AUTO_ENABLED`.

**Do not** use desktop Chrome, Android Chrome, or the Costco inspect tab. Those are different
storage jars.

```bash
cd frontend
npm run build:mobile
unset DEV_SERVER_URL
npm run cap:run:android
```

**Capture the full Flask log** (terminal scrollback loses the opening lines):

```bash
# from repo root, in a dedicated terminal
# --debug is required: without it /api/dev/log returns 403 and S3 is invisible
uv run flask --app backend.app --debug run --host 0.0.0.0 --port 5000 2>&1 | tee /tmp/meald-flask-s3.log
```

1. Flask tee running; LAN API override (`http://<laptop-ip>:5000/api`); `SYNC_AUTO_ENABLED=0` on Meald inspect.
2. Ensure you already have a successful Costco login (page RT present from a prior sync).
3. **If that login ran in this process** (or Flask showed `[costcoLogin]` after the WebView closed): use **Settings → Dev Tools → Force close WebViews** or force-stop, cold start, re-apply LAN override if needed. See [leftover session](#leftover-inappbrowser-after-login-2026-08-31).
4. On **Meald** inspect console:

```js
localStorage.setItem('COSTCO_S3_SMASH_RT', '1');
localStorage.getItem('COSTCO_S3_SMASH_RT');
```

5. Tap **Silent Sync** only (do **not** tap Sync Costco Receipts).
6. **Pass** = all six lines in order (grep `/tmp/meald-flask-s3.log`):

| Step | Flask / UI signal |
|------|-------------------|
| 1 | `[costcoSilent] s3_smash consumed=1` (Meald side — flag was read) |
| 2 | `script_run` with `"reset":true` and a `nonce` field |
| 3 | `s3-smash-rt` with `smashed` ≥ 1 |
| 4 | `rt-refresh-start` with `source: page` |
| 5 | `rt-refresh-result` with `errorCode: invalid_grant` |
| 6 | Terminal `needs_reconnect`, reconnect copy, Silent hidden, Retry opens interactive login |

7. Recover with interactive login (burns the RT chain; expect a fresh grant). After recovery, force-stop again before the next Silent / S3.

**Triage — first missing line:**

| Missing | Likely cause | Action |
|---------|--------------|--------|
| Step 1 | Flag not armed, or dev gate off (`VITE_ENABLE_DEV_SETTINGS` not in build) | Rebuild with `VITE_ENABLE_DEV_SETTINGS=1` in `.env.local`; re-arm on Meald inspect |
| Step 2 with step 1 present, plus `[costcoLogin] urlChange` `tokensReceived=true` during silent | Leftover login listeners (should be fixed 2026-08-31) | Force-stop or Dev Tools force-close, cold start, re-arm. **Not an S3 product fail** if cleanup regresses |
| Step 2 with step 1 present (no leftover login lines) | WebView never reached `www.costco.com` | Check `urlChange` lines; retry after successful login |
| Step 3 with step 2 present | Smash IIFE did not run in page context | Rebuild (single-inject fix); check `executeScript failed` lines |
| Step 4 with step 3 present | Force-refresh or RT selection failed | Check `msal-census` / `msal-tokens-found` in log |
| Step 5 with `errorCode: cors` | Page CORS on B2C grant (inconclusive) | Flag auto-restores; re-arm and retry |
| Step 5 with step 4 but no `invalid_grant` | Wrong test path (successful refresh = S2, not S3) | Confirm `smashed` > 0 and `source: page` |

**Inconclusive:** `errorCode: cors` on the smashed grant (app-side Capacitor refresh is
suppressed during S3). The flag is restored automatically — re-arm and retry.

**Arm again after inconclusive run:**

```js
localStorage.setItem('COSTCO_S3_SMASH_RT', '1');
```

## Separate thread, still not covered

Safeway silent sync hit `needs_reconnect` three times on 2026-07-29 (08:57, 09:25, 09:42) plus
five `sync_skipped`. Same critical path, different provider, not yet investigated.

## Remaining Costco silent items

| Item | Status |
|---|---|
| **S3** (revoked page RT → honest reconnect) | **PASS** 2026-08-31 (09:43; reconfirmed ~13:30 after force-stop). Procedure retained for regression |
| Leftover InAppBrowser after interactive login | **Mitigated 2026-08-31** (listener cleanup + instance scoping + silent open gate). S3 should pass without force-stop; use Dev Tools force-close only if timeout persists. See [leftover session](#leftover-inappbrowser-after-login-2026-08-31) |
| Scheduler 6 h `sync_reconnectCooldown_costco` | **Untested on device.** Code only sets it on terminal `needs_reconnect` in `adaptCostcoSilentSync`. Manual Silent button does not set it. Test with S3 then `SYNC_AUTO` on |
| Silent `sync_events` census / `rt-refresh-*` on the terminal row | **Open.** Still Flask `/api/dev/log` only; buffer rotates |
| Durable ingest queue across process death | **Out of scope** for the resilience ship. Force-kill before ingest still drops the in-memory payload; next silent re-fetches |
| Launch Area 5 (cold-start / auto-sync / forced-reconnect on prod iOS + Android) | **Still open** in [06-launch-readiness-findings.md](../implementation_briefs/mvp_gaps/06-launch-readiness-findings.md). S1–S5 is debug-APK + LAN Flask, not that sign-off |

## Exit criteria

| Criterion | Status |
|---|---|
| Whether `POST .../oauth2/v2.0/token` fires, and its status | **Observed on B1:** 200, policy `…209`. Run A was `missed` / `sweepRuns: 0` (weak negative). |
| Live `tfp` (Bug B) | **`B2C_1A_SSO_WCS_signup_signin_209`** (Run A and B1 `tokens-found`) |
| Whether `pm clear` empties Costco origin (A0) | **Yes** — Run A `censusSeen=0` |
| Wedge (B1 → B3) | **Dead at B1.** B3 not run. No expired-only cleanup. |
| Play ×3 vs Fly (Run C) | **Closed without running** (see Run C). |
| Silent S1 / S2 / S4 | **PASS** 2026-08-27 |
| Silent S5 (background / resume keeps session) | **PASS** 2026-08-29 `b526f593` |
| Silent S3 (forced refresh fail → reconnect) | **PASS** 2026-08-31 (reconfirmed after force-stop ~13:30 PT) |

Interactive-login token chapter is **closed**. Bug A fix shipped 2026-08-27 (in-WebView RT redeem).
Resilience shipped 2026-08-29 (transient failures keep tokens). Do not commit an expired-cache
wipe. Device validation: **S1–S5 pass.**
