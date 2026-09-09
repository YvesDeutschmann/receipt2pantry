# Mock receipt fixtures (DEV / CI)

Hand-curated JSON used to exercise the same ingestion path as the native apps, without calling Safeway or Costco.

## Files

| File | Format |
|------|--------|
| `safeway_receipts.json` | Array of receipts shaped like [`parseSafewayReceipt` output](../../frontend/src/services/safewayReceiptParser.js) (`order_id`, `order_date`, `total_amount`, `num_items`, `items`, `source`, `store`, …) |
| `costco_receipts.json` | Array of receipts shaped like [`parseApiReceipt` output](../../frontend/src/services/costcoNativeSync.js) (`order_id`, `order_date`, `total_amount`, `items`, `receipt_type: "In-Warehouse"`, …) |

`receipt_type` for Costco must not be gas-only types (see `backend/utils/costco_receipt_types.py`); warehouse receipts are included.

## Usage

- **Backend:** `POST /api/dev/load-mock-receipts` (Flask `debug` only) reads these files and runs `store_fetched_receipts` + pantry processing. The route rewrites each receipt `order_date` (and `date`) to today so perishable/consumable rows score as in-stock; JSON files on disk stay historical.
- **Frontend (DEV):** The same data is copied to `frontend/src/devFixtures/`; mock buttons import it and call `ingestReceipts` / `storeCostcoReceipts`.

## Keeping in sync

When the parser output shape changes, update the corresponding fixture arrays and the copy under `frontend/src/devFixtures/`.

## Order IDs

All mock `order_id` values are prefixed with `dev-mock-` so they are easy to spot in the database and to avoid clashing with real imports.
