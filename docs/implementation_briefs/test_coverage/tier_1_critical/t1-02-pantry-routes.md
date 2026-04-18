# T1-02 — `backend/routes/pantry.py`

> **Tier:** 1 — Critical
> **Why risky:** 33 Flask endpoints funnel every pantry-related user action (receipt ingest, cook, deplete, put-back, graveyard, health card, staples, voice, correction). Existing tests (`test_pantry.py` + `test_pantry_phase4.py`) cover the Phase 4 routes well but drift is likely across the other 20+ endpoints.

---

## 1. Technical Contract

- **File:** `backend/routes/pantry.py`
- **Blueprint:** `pantry_bp`
- **Auth:** `get_user_id_from_request()` — raises/returns 401 if missing.
- **Service lookups:** `current_app.config.get("pantry_service")`, `get_supabase_service()`, `current_app.config.get("normalizer")`.
- **Response convention:** `jsonify({...}), <status>` — status must be explicit, never implied.

### Endpoints to characterize (group by theme)

- **Read:** `GET /api/pantry`, `GET /api/pantry/graveyard`, `GET /api/pantry/health-card`, `GET /api/pantry/search-ingredients`, `GET /api/pantry/staples-template`, `GET /api/pantry/staples-receipt-matches`.
- **Write (single-table):** `POST /api/pantry/items`, `PUT /api/pantry/items/<id>`, `DELETE /api/pantry/items/<id>`, `POST /api/pantry/quick-add`, `POST /api/pantry/items/<id>/correction`.
- **Write (multi-table — must be atomic):** `POST /api/pantry/cook`, `POST /api/pantry/items/<id>/deplete`, `POST /api/pantry/put-back`, `POST /api/pantry/restore-item`, `POST /api/pantry/confirm-staples`, `POST /api/pantry/consume`.
- **Voice:** `POST /api/pantry/voice-transcribe`, `POST /api/pantry/voice-confirm`.

---

## 2. Logic Guardrails

- **Auth gating:** every endpoint except `GET /api/pantry/staples-template` (public template) MUST return 401 when `X-User-Id` is absent.
- **Household-scope header:** endpoints that accept `household_id` (query param or body) MUST reject mismatches where the user is not a member (403), not 200 + empty data.
- **Atomic multi-table:** `cook`, `deplete`, `put-back`, `restore-item`, `confirm-staples` MUST call a Postgres RPC (per `.cursorrules.md` — "Atomic Transactions"). Audit for any endpoint that still does paired `client.table(...).execute()` calls.
- **Strict `is not None`:** `PUT /api/pantry/items/<id>` with `quantity=0` must update (0 is valid), not be rejected by a truthy check.
- **No substring ingredient match:** `search-ingredients` must exclude already-in-pantry items via exact base-ingredient equality, not `ilike`.
- **Validation:** `cook` requires `recipe_id`, `servings (>=1)`, non-empty `ingredients[]` with `name`. Missing → 400.

---

## 3. Test-First Suite

Extend `tests/backend/test_routes/test_pantry.py` (or split per theme). Use the Flask test client already wired in `tests/backend/conftest.py`.

### Test group A — auth

1. `test_all_write_routes_return_401_without_user_header` (parametrize the POST/PUT/DELETE routes)
2. `test_household_scoped_read_rejects_non_member_with_403`

### Test group B — atomic multi-table

3. `test_cook_calls_process_cook_event_with_deterministic_today`
4. `test_cook_rolls_back_on_depletion_history_insert_failure` (simulate RPC raise → pantry_items unchanged)
5. `test_put_back_rejects_meat_beyond_max_subclass_limit` (see `depletion_engine.MAX_PUT_BACK_SUBCLASSES`)
6. `test_restore_item_reinserts_soft_deleted_row_with_original_id`

### Test group C — validation

7. `test_cook_returns_400_when_servings_is_zero_or_missing`
8. `test_update_quantity_accepts_zero` (regression: `is not None` vs truthy)
9. `test_quick_add_rejects_blank_base_ingredient`

### Test group D — search

10. `test_search_ingredients_excludes_existing_pantry_by_exact_base_ingredient`
11. `test_search_ingredients_does_not_match_on_substring` (query "rice" must not return "rice vinegar")

### Test group E — voice

12. `test_voice_transcribe_accepts_webm_and_mp4_content_types`
13. `test_voice_confirm_persists_only_confirmed_items`

---

## 4. Definition of Done

- Every endpoint in the file has at least one auth test + one happy-path test.
- All 6 multi-table endpoints have an atomicity/rollback test.
- `test_search_ingredients_does_not_match_on_substring` is in the suite and passing (proves `.cursorrules.md` substring rule).
- All new tests use the shared PostgREST builder stub from T1-01.
- Suite runs in < 3 s with no network calls.
