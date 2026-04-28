"""Validate data/fixtures JSON can be ingested via store_fetched_receipts (real pipeline shape)."""

import json
from pathlib import Path
from unittest.mock import Mock

from backend.services.receipt_service import store_fetched_receipts

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_FIXTURES = _PROJECT_ROOT / "data" / "fixtures"


def _load(name: str) -> list:
    with open(_FIXTURES / name, "r", encoding="utf-8") as f:
        data = json.load(f)
    assert isinstance(data, list) and len(data) > 0
    return data


def _mock_supabase():
    s = Mock()
    s.get_user_household = Mock(return_value=None)

    def store_receipt_with_items(receipt_data, items):
        assert "order_id" in receipt_data
        assert isinstance(items, list) and len(items) >= 1
        return f"receipt-uuid-for-{receipt_data['order_id']}"

    s.store_receipt_with_items = Mock(side_effect=store_receipt_with_items)
    return s


def test_safeway_fixtures_store_without_errors():
    receipts = _load("safeway_receipts.json")
    supa = _mock_supabase()
    r = store_fetched_receipts("00000000-0000-0000-0000-000000000001", "safeway", receipts, supa)
    assert r["receipts_stored"] == len(receipts)
    assert len(r["errors"]) == 0
    assert supa.store_receipt_with_items.call_count == len(receipts)


def test_costco_fixtures_store_without_errors():
    receipts = _load("costco_receipts.json")
    supa = _mock_supabase()
    r = store_fetched_receipts("00000000-0000-0000-0000-000000000001", "costco", receipts, supa)
    assert r["receipts_stored"] == len(receipts)
    assert len(r["errors"]) == 0
    assert supa.store_receipt_with_items.call_count == len(receipts)


def test_safeway_fixture_each_item_has_required_keys():
    for rec in _load("safeway_receipts.json"):
        for item in rec["items"]:
            assert "name" in item
            assert "price" in item
            assert "quantity" in item
