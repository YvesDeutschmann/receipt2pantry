# T2-03 — `backend/services/normalization_service.py`

> **Tier:** 2 — High
> **Why risky:** First mile of the receipt → pantry pipeline. AI-dependent path has brittle fallback; in-memory cache is process-local (discarded on worker restart). 17 KB of code, 15 KB of tests — decent but branch coverage is thin around AI errors.

---

## 1. Technical Contract

- **File:** `backend/services/normalization_service.py`
- **Class:** `NormalizationService(supabase, ai_service=None)`
- **Key methods:**
  - `normalize_product(raw_name, category) -> Dict` (basic, no AI)
  - `normalize_products_batch(products, use_ai=True) -> List[Dict | None]`
  - Lookup helpers against `product_mappings` table.
- **Cache:** `self.cache = {}` — in-memory, not shared across workers.

---

## 2. Logic Guardrails

- **Input-output parity:** `normalize_products_batch` MUST return a list of the same length as `products`, with `None` for items the pipeline could not normalize. Callers in `receipt_processor.py` `zip()` the two lists — a length mismatch silently misassigns normalized data.
- **AI fallback chain:** (1) check in-memory cache, (2) check `product_mappings` table, (3) call AI. AI failures must NOT corrupt the cache with an error object.
- **Exact-key caching:** cache key is the raw product name. Must be case-sensitive (or explicitly normalized) — two subtly different raw names should not collide.
- **Non-normalizable items:** returning `None` is valid; callers treat it as "skip". Never return `{}`.
- **Source tagging:** each normalized result must carry `source` in `{"cache", "mapping", "openai", "gemini"}` so `receipt_processor` can decide AI usage reporting.
- **No substring matching** for looking up `base_ingredient` — must be exact equality.

---

## 3. Test-First Suite

Augment `tests/services/test_normalization_service.py`.

### Test group A — cache hit path

1. `test_in_memory_cache_hit_short_circuits_db_and_ai`
2. `test_cache_miss_falls_through_to_db_mapping`
3. `test_db_hit_populates_in_memory_cache`

### Test group B — batch parity

4. `test_batch_returns_list_of_same_length_as_input`
5. `test_batch_returns_none_for_non_normalizable_item`
6. `test_batch_preserves_input_order`

### Test group C — AI fallback

7. `test_batch_calls_ai_only_when_db_misses`
8. `test_batch_does_not_cache_ai_error_results`
9. `test_batch_marks_openai_results_with_source_openai`
10. `test_batch_marks_mapping_results_with_source_mapping`

### Test group D — robustness

11. `test_normalize_rejects_empty_raw_name_gracefully` (returns None, doesn't raise)
12. `test_lookup_uses_exact_match_not_substring` (searching for "rice" must not return the "rice vinegar" mapping)

---

## 4. Definition of Done

- Batch-parity invariant (tests 4–6) is locked in — regression would break `receipt_processor.zip()`.
- AI fallback tests (7–10) mock `ai_service` and verify call counts.
- Cache pollution test (8) proves a thrown `AIServiceException` leaves the cache clean.
- Substring-regression test (12) is present.
- All tests run without calling real OpenAI/Gemini.
