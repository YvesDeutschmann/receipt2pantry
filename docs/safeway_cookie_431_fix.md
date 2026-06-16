# Safeway sync — list API HTTP 431 (cookie header bloat)

After a successful Safeway WebView login (tokens + club card extracted), the native instore list POST can fail with:

```
Safeway list API failed (431)
```

HTTP **431** = request headers too large. Login still succeeds because token extraction reads `SWY_SHARED_SESSION` directly; the failure happens one step later when `safewayApiFetcher.js` attaches a `Cookie` header to the CapacitorHttp POST.

## Symptom (device, 2026-06-16)

```
[safewayLogin] tokens_ready {"hasToken":true,"hasClub":true}
Safeway list API failed (431)
```

Backend `POST /api/receipts/ingest` is never reached.

## Root cause

The April 2026 fix (`cb8a8ed`, "trim Safeway cookies to avoid HTTP 431") filtered analytics cookies (`_ga`, `reese84`, `AMCV*`, etc.) but kept a broad `SWY_*` allowlist. That still included **`SWY_SHARED_SESSION`**, a multi-KB JSON blob containing the JWT. The same access token is already sent in the POST body as `token`; duplicating it in `Cookie` pushes total header size past Safeway/nginx limits (~8 KB).

Contributing factors:

- Safeway intentionally does **not** call `clearSessionBeforeLogin` (unlike Costco), so allowed cookies can accumulate across repeated logins.
- Large `ACI_S_*` session cookies can also bloat the header when many are present.

## Fix (2026-06-16)

Shared cookie filtering lives in [`frontend/src/services/safewayCookieHeader.js`](../frontend/src/services/safewayCookieHeader.js):

1. **Denylist** `SWY_SHARED_SESSION` and `SWY_SHARED_SESSION_INFO` from the `Cookie` header (token parsing via `httpOnlyCookies` in `safewayWebViewBridge.js` is unchanged).
2. **Allowlist** WAF/session binding cookies only: `JSESSIONID`, `abs_gsession`, `akacd_PR-*`, `visid_incap_*`, `nlbi_*`, `incap_ses_*`, and small `ACI_S_*` (value ≤ 512 chars).
3. **4096-byte budget** — drop non-WAF cookies first when over budget.
4. **431 retry** in `safewayApiFetcher.js`: full header → WAF-only → token-only (no `Cookie` header).

Dev diagnostics (no cookie values) post to `/api/dev/log` as `safewayListFetch|{ tier, cookieHeaderLength, keys }`.

## Verification

- `cd frontend && npm test` — `safewayCookieHeader.test.js`, updated `webViewBridge.test.js`, `useSafewaySync.test.js`
- On device: Connect Safeway → sync completes; repeat login 3–5× without reinstall → still succeeds
- Check dev log for `safewayListFetch` tier (`success-waf-only` / `success-token-only` if retry was needed)

## Related docs

- Dedup symptom (different failure mode): [safeway_dedup_fix.md](safeway_dedup_fix.md)
- Future silent-sync Tier 2 should import `buildCookieHeader` from `safewayCookieHeader.js`: [implementation_briefs/silent_sync/phase-3-bridge-and-providers.md](implementation_briefs/silent_sync/phase-3-bridge-and-providers.md)
