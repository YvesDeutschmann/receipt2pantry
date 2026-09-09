# Mock receipt fixtures (DEV / CI)

Hand-curated JSON used to exercise the same ingestion path as the native apps, without calling Safeway or Costco.

## Files

| File | Format |
|------|--------|
| `safeway_receipts.json` | Array of receipts shaped like [`parseSafewayReceipt` output](../../frontend/src/services/safewayReceiptParser.js) (`order_id`, `order_date`, `total_amount`, `num_items`, `items`, `source`, `store`, …) |
| `costco_receipts.json` | Array of receipts shaped like [`parseApiReceipt` output](../../frontend/src/services/costcoNativeSync.js) (`order_id`, `order_date`, `total_amount`, `items`, `receipt_type: "In-Warehouse"`, …) |
| `cook_loop_sandbox.json` | Paired pantry rows + pool card + grader expectations for the DEV cook-loop QA harness (`recipe_id`: `dev_cook_loop`) |

`receipt_type` for Costco must not be gas-only types (see `backend/utils/costco_receipt_types.py`); warehouse receipts are included.

## Usage

- **Backend:** `POST /api/dev/load-mock-receipts` (Flask `debug` only) reads these files and runs `store_fetched_receipts` + pantry processing. The route rewrites each receipt `order_date` (and `date`) to today so perishable/consumable rows score as in-stock; JSON files on disk stay historical.
- **Frontend (DEV):** The same data is copied to `frontend/src/devFixtures/`; mock buttons import it and call `ingestReceipts` / `storeCostcoReceipts`.

## Cook-loop sandbox

[`cook_loop_sandbox.json`](cook_loop_sandbox.json) pairs pantry rows with a DEV pool card (`recipe_id`: `dev_cook_loop`). Ingredient names are real `item_classification` keys (`pasta`, `tomatoes`, `olive oil`, `white rice`).

**Live pytest** (wipes live pantry rows for the dedicated household only):

```bash
COOK_LOOP_LIVE=1 \
COOK_LOOP_LIVE_USER_ID=00000000-0000-0000-0000-000000000001 \
COOK_LOOP_LIVE_HOUSEHOLD_ID=00000000-0000-0000-0000-000000000002 \
uv run pytest tests/services/test_cook_loop_sandbox_live.py -q
```

Requires `SUPABASE_URL`, `SUPABASE_PUBLIC_KEY`, and `SUPABASE_SECRET_KEY` in `.env`, plus all three `COOK_LOOP_*` vars above (household name must contain `cook-loop`). IDs in `.env` without `COOK_LOOP_LIVE=1` do not run the live test. Do not run in parallel with the app on that household.

**Debug API:** `POST /api/dev/cook-loop/reset`, `POST /api/dev/cook-loop/run`, `GET /api/dev/cook-loop/report` (Flask `debug` only). Reset deletes live pantry rows (`deleted_at IS NULL`) only.

## Household join live test

Dedicated QA users from migration `028_qa_share_test_users.sql` (`to-be-merged-user-1` / `to-be-merged-user-2`, UUIDs `…0003`–`…0006`). **Not for daily use.** CASCADE delete runs only against joiner household `…0006`.

```bash
HOUSEHOLD_JOIN_LIVE=1 \
uv run pytest tests/services/test_household_join_live.py -q
```

Requires `SUPABASE_URL`, `SUPABASE_PUBLIC_KEY`, and `SUPABASE_SECRET_KEY` in `.env`. UUIDs are hardcoded in the test module (no env override). Do not run alongside the app on those households or under `pytest -n`.

See also [`docs/implementation_briefs/household-sharing-open-items.md`](../../docs/implementation_briefs/household-sharing-open-items.md) for open follow-ups.

## Keeping in sync

When the parser output shape changes, update the corresponding fixture arrays and the copy under `frontend/src/devFixtures/`.

## Order IDs

All mock `order_id` values are prefixed with `dev-mock-` so they are easy to spot in the database and to avoid clashing with real imports.
