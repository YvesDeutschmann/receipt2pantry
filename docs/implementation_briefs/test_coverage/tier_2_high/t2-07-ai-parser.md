# T2-07 — `backend/parsers/ai_parser.py`

> **Tier:** 2 — High
> **Why risky:** ~11 KB, **zero dedicated tests**. Any prompt / schema drift in `ai_service` silently changes parsing output. Has a fallback-parser hook (`set_fallback_parser`) that's never exercised in tests.

---

## 1. Technical Contract

- **File:** `backend/parsers/ai_parser.py`
- **Class:** `AIParser(BaseParser)` registered via `@register_parser("ai")`.
- **Constructor:** `AIParser(ai_service=None)` — creates one via `create_ai_service()` if not provided.
- **Public methods:**
  - `parse(raw_data: str) -> Dict`
  - `set_fallback_parser(parser_name: str)` — name of another registered parser to try on AI failure.
- **Dependencies:** `AIService`, `ParserRegistry`.

---

## 2. Logic Guardrails

- **JSON schema fidelity:** AI output MUST conform to the same dict shape as the concrete parsers (`order_id`, `order_date`, `items[]`, ...). Mismatched shape → `ParserException`.
- **Fallback trigger:** on `AIServiceException` or schema mismatch, if `_fallback_parser_name` is set, delegate to that parser. If not set, re-raise.
- **No partial results:** if the AI returns an incomplete object, do NOT emit a half-populated dict downstream.
- **Token/cost budget:** every `parse` call runs exactly one AI request on happy path. No retries except those already inside `ai_service`.
- **Injectable `ai_service`:** tests MUST inject a fake; never hit OpenAI/Gemini.
- **Fallback name must be registered:** if `set_fallback_parser("nonexistent")` is called, fallback attempt raises a clear error (not a cryptic `KeyError`).

---

## 3. Test-First Suite

Create `tests/backend/test_parsers/test_ai_parser.py` (new).

### Test group A — happy path

1. `test_parse_returns_dict_in_expected_schema_from_mock_ai`
2. `test_parse_calls_ai_service_exactly_once_on_success`

### Test group B — fallback

3. `test_parse_delegates_to_fallback_on_ai_service_exception`
4. `test_parse_delegates_to_fallback_on_schema_mismatch`
5. `test_parse_reraises_when_no_fallback_configured`
6. `test_set_fallback_parser_raises_on_unregistered_name` (or returns a sentinel — assert current behavior first, then strengthen)

### Test group C — schema validation

7. `test_ai_output_missing_order_id_raises_parser_exception`
8. `test_ai_output_with_empty_items_list_is_rejected`
9. `test_ai_output_with_extra_unknown_fields_is_still_accepted` (forward-compat)

### Test group D — cost / budget

10. `test_parse_does_not_retry_beyond_ai_service_internal_retries`

### Test group E — integration

11. `test_ai_parser_used_when_registered_provider_has_no_specific_parser` (via `ParserRegistry`)

---

## 4. Definition of Done

- Every test injects a mock `AIService` — no real API calls.
- Fallback paths (3–5) are explicitly exercised; today they are dead code.
- Schema rejection tests (7–8) prove partial results cannot leak into normalization.
- Test 11 ties parser registration into the ecosystem test.
- Suite runs in < 1 s.
