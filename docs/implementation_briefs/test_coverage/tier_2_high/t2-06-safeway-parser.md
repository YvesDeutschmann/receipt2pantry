# T2-06 — `backend/parsers/safeway_parser.py`

> **Tier:** 2 — High
> **Why risky:** ~14 KB of regex-heavy email parsing. **Zero dedicated test file** in `tests/backend/test_parsers/`. Parsing is the first mile of every receipt flow — a silent parser bug corrupts pantry for every Safeway user.

---

## 1. Technical Contract

- **File:** `backend/parsers/safeway_parser.py`
- **Class:** `SafewayParser(BaseParser)` registered via `@register_parser("safeway")`.
- **Public entry point:** `parse(raw_data: str) -> Dict` where `raw_data` is `.eml` file contents.
- **Private helpers:** `_parse_receipt_items`, `_extract_order_id`, `_extract_order_date`, plus any total / subtotal extractors.
- **Exceptions:** `ParserException` for unrecoverable format mismatches.

### Expected output shape

```
{
  order_id: str,
  order_date: datetime.date | str,
  items: [ {raw_name, category, quantity, unit, price, ...}, ... ],
  total: float | None,
  ... (fields used downstream by normalization_service)
}
```

---

## 2. Logic Guardrails

- **Fixture-based testing only.** Create `tests/backend/test_parsers/fixtures/safeway/` with at least 3 real-but-scrubbed `.eml` samples (remove PII before committing). Fuzzing regexes without real fixtures produces false confidence.
- **Missing-field tolerance:** when `order_id` or `order_date` cannot be extracted, raise `ParserException` with a message that names the missing field — do not return a partial dict.
- **Idempotency:** `parse(same_eml)` twice returns identical output (no hidden state, no timestamps from `datetime.now()` in the result).
- **No substring false positives:** item-name extraction must not collapse "Sparkling Water" into "Water" by loose regex.
- **Unit-aware:** `_parse_receipt_items` must distinguish `2 lb @ 3.99/lb` from `2 @ 3.99`. Both paths tested.
- **Encoding:** receipts can be MIME-encoded (quoted-printable, base64). Parser must decode before regex.

---

## 3. Test-First Suite

Create `tests/backend/test_parsers/test_safeway_parser.py` (new).

### Test group A — fixture golden path

1. `test_parse_sample_receipt_01_returns_expected_item_count` (fixture locks 10+ items)
2. `test_parse_sample_receipt_01_extracts_correct_order_id_and_date`
3. `test_parse_sample_receipt_02_handles_quoted_printable_encoding`

### Test group B — line-item shapes

4. `test_item_with_weight_pricing_extracts_lb_unit_and_amount`
5. `test_item_with_count_pricing_extracts_count_unit`
6. `test_item_with_discount_reflects_final_price`

### Test group C — failure modes

7. `test_parser_raises_with_missing_order_id_field_name` (assert message mentions `order_id`)
8. `test_parser_raises_on_empty_body`
9. `test_parser_raises_on_non_safeway_email` (e.g. a Costco receipt fed in)

### Test group D — purity

10. `test_parse_is_idempotent_across_two_calls`
11. `test_parse_does_not_use_datetime_now` (static scan or mock assertion)

### Test group E — no substring collapsing

12. `test_sparkling_water_not_reduced_to_water`
13. `test_brand_prefixed_items_preserve_brand`

---

## 4. Definition of Done

- ≥ 3 scrubbed `.eml` fixtures in `tests/backend/test_parsers/fixtures/safeway/`.
- 12+ test cases across all 5 groups.
- Fail-loud contract: parser raises rather than returns partial dict on missing required fields.
- Idempotency test (10) proves no hidden state.
- Parser file shows non-zero coverage for the first time in CI.
