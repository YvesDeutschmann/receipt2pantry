# T2-04 — `backend/services/receipt_processor.py`

> **Tier:** 2 — High
> **Why risky:** Orchestrates parse → normalize → pantry. Uses `zip(valid_items, normalized_results)` assuming length parity with `normalization_service` — brittle. Multi-receipt batch logic swallows per-receipt errors and reports aggregate counts. Existing test file (~9 KB) covers happy path only.

---

## 1. Technical Contract

- **File:** `backend/services/receipt_processor.py`
- **Class:** `ReceiptProcessor(supabase, normalizer, pantry)`
- **Async methods:**
  - `process_receipt(receipt_id, user_id, use_ai=True, household_id=None) -> Dict`
  - `process_multiple_receipts(receipt_ids, user_id) -> Dict`
- **Sync methods:** `get_processing_status(receipt_id)`.

### Result shape (process_receipt)

```
{
  receipt_id, household_id, status in {processed, processed_with_errors, no_items},
  total_items, items_processed, items_added_to_pantry,
  normalized_items: [...], errors: [...], ai_used: bool
}
```

---

## 2. Logic Guardrails

- **Length parity contract:** `normalized_results` MUST have `len(valid_items)` entries. This brief depends on T2-03's batch-parity tests being in place.
- **No-items path:** empty receipt → `status="no_items"`, counts all zero, does NOT raise.
- **Status selection:** if any per-item exception was caught → `status="processed_with_errors"`; else `status="processed"`.
- **`ai_used` flag:** true iff any normalized entry has `source == "openai"` (note: Gemini is NOT counted here — confirm the intent, or fix it).
- **Household resolution:** when `household_id` is not provided, look it up from `supabase.get_user_household`. `None` is allowed (legacy user-scoped).
- **Quantity / unit derivation:** if `quantity_info.amount` and `quantity_info.unit` are both present, use those; else fall back to `item.quantity` + `unit="count"`.
- **Non-normalizable skip:** when `normalized is None`, increment `items_processed` but NOT `items_added`. No error row.
- **Per-receipt error isolation:** `process_multiple_receipts` must not abort the loop on a single failure.

---

## 3. Test-First Suite

Augment `tests/services/test_receipt_processor.py`.

### Test group A — happy path

1. `test_process_receipt_returns_processed_status_on_full_success`
2. `test_process_receipt_sets_ai_used_true_when_any_source_is_openai`
3. `test_process_receipt_sets_ai_used_false_when_all_sources_are_mapping_or_cache`

### Test group B — partial failures

4. `test_process_receipt_reports_processed_with_errors_when_item_raises`
5. `test_process_receipt_continues_past_raising_item_to_next`
6. `test_process_receipt_non_normalizable_item_increments_processed_not_added`

### Test group C — no-items

7. `test_process_receipt_no_items_returns_no_items_status_without_ai_call`

### Test group D — quantity derivation

8. `test_quantity_info_amount_and_unit_are_preferred`
9. `test_quantity_fallback_to_item_quantity_and_count_unit`
10. `test_zero_quantity_amount_treated_as_missing_and_falls_back` (edge: `amount=0` should NOT be accepted; truthy check is correct here)

### Test group E — household resolution

11. `test_household_id_looked_up_when_not_provided`
12. `test_household_id_none_is_legal_legacy_path`

### Test group F — batch

13. `test_process_multiple_receipts_isolates_per_receipt_failure`
14. `test_process_multiple_receipts_aggregates_items_added_correctly`

### Test group G — parity regression

15. `test_process_receipt_raises_if_normalizer_returns_short_list` (proves parity contract is enforced; fail-fast preferred over silent zip truncation)

---

## 4. Definition of Done

- All 7 test groups present.
- Test 15 forces a defensive length assert into `process_receipt` — small impl change allowed within this brief.
- `ai_used` semantics for Gemini are either (a) confirmed-as-is by a test, or (b) followed up in a separate ticket.
- Multi-receipt isolation (test 13) prevents one bad receipt from failing a sync.
