"""Tests for receipt_service store path (01c.1 dedup hardening)."""

from datetime import datetime
from unittest.mock import MagicMock

import pytest

from backend.services.receipt_service import (
    fetch_and_parse_receipts,
    store_fetched_receipts,
    store_parsed_receipt,
)


TEST_USER_ID = "11111111-1111-1111-1111-111111111111"
TEST_PROVIDER = "safeway"


def _make_receipt(order_id: str, items=None) -> dict:
    return {
        "order_id": order_id,
        "order_date": "2025-01-15",
        "total_amount": 10.0,
        "items": items
        if items is not None
        else [{"name": "Milk", "price": 3.49, "quantity": 1}],
    }


def test_STORE_FETCHED_SINGLE_NEW_RECEIPT():
    """One receipt, RPC returns a UUID; stored=1, skipped=0, one id, no errors."""
    supabase = MagicMock()
    supabase.get_user_household.return_value = None
    supabase.store_receipt_with_items.return_value = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"

    result = store_fetched_receipts(
        TEST_USER_ID, TEST_PROVIDER, [_make_receipt("order-1")], supabase
    )

    assert result["receipts_stored"] == 1
    assert result["skipped_duplicates"] == 0
    assert result["receipt_ids"] == ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]
    assert result["errors"] == []


def test_STORE_FETCHED_DUPLICATE_RETURNS_NONE():
    """One receipt, RPC returns None; stored=0, skipped=1, no errors."""
    supabase = MagicMock()
    supabase.get_user_household.return_value = None
    supabase.store_receipt_with_items.return_value = None

    result = store_fetched_receipts(
        TEST_USER_ID, TEST_PROVIDER, [_make_receipt("order-dup")], supabase
    )

    assert result["receipts_stored"] == 0
    assert result["skipped_duplicates"] == 1
    assert result["receipt_ids"] == []
    assert result["errors"] == []


def test_STORE_FETCHED_SYNC_TWICE_NO_DUPES():
    """Same 3 receipts twice; second call skipped=3; pantry gate sees 3 unique ids total."""
    supabase = MagicMock()
    supabase.get_user_household.return_value = None
    receipt_ids = [
        "11111111-1111-1111-1111-111111111101",
        "11111111-1111-1111-1111-111111111102",
        "11111111-1111-1111-1111-111111111103",
    ]
    supabase.store_receipt_with_items.side_effect = receipt_ids + [None, None, None]

    receipts = [_make_receipt(f"order-{i}") for i in range(1, 4)]

    first = store_fetched_receipts(TEST_USER_ID, TEST_PROVIDER, receipts, supabase)
    second = store_fetched_receipts(TEST_USER_ID, TEST_PROVIDER, receipts, supabase)

    assert first["receipts_stored"] == 3
    assert first["skipped_duplicates"] == 0
    assert first["errors"] == []
    assert second["receipts_stored"] == 0
    assert second["skipped_duplicates"] == 3
    assert second["errors"] == []

    # Caller gate: process_receipt runs once per unique stored id, not 6
    all_stored_ids = first["receipt_ids"] + second["receipt_ids"]
    assert len(all_stored_ids) == 3


def test_STORE_FETCHED_AUTO_MANUAL_INTERLEAVE():
    """Submit [A,B] then [B,C]; 3 stored total across both calls."""
    supabase = MagicMock()
    supabase.get_user_household.return_value = None
    supabase.store_receipt_with_items.side_effect = [
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        None,
        "cccccccc-cccc-cccc-cccc-cccccccccccc",
    ]

    first = store_fetched_receipts(
        TEST_USER_ID,
        TEST_PROVIDER,
        [_make_receipt("A"), _make_receipt("B")],
        supabase,
    )
    second = store_fetched_receipts(
        TEST_USER_ID,
        TEST_PROVIDER,
        [_make_receipt("B"), _make_receipt("C")],
        supabase,
    )

    assert first["receipts_stored"] == 2
    assert second["receipts_stored"] == 1
    assert first["skipped_duplicates"] + second["skipped_duplicates"] == 1
    assert first["receipts_stored"] + second["receipts_stored"] == 3
    assert first["errors"] == []
    assert second["errors"] == []


def test_STORE_FETCHED_MISSING_ORDER_ID_GOES_TO_ERRORS():
    """Receipt missing order_id goes to errors, not skipped_duplicates."""
    supabase = MagicMock()

    result = store_fetched_receipts(
        TEST_USER_ID,
        TEST_PROVIDER,
        [{"order_date": "2025-01-15", "items": []}],
        supabase,
    )

    assert result["receipts_stored"] == 0
    assert result["skipped_duplicates"] == 0
    assert len(result["errors"]) == 1
    supabase.store_receipt_with_items.assert_not_called()


def test_STORE_FETCHED_MISSING_ITEMS_LIST_GOES_TO_ERRORS():
    """Receipt with non-list items goes to errors."""
    supabase = MagicMock()

    result = store_fetched_receipts(
        TEST_USER_ID,
        TEST_PROVIDER,
        [{"order_id": "x", "order_date": "2025-01-15", "items": "not-a-list"}],
        supabase,
    )

    assert result["receipts_stored"] == 0
    assert result["skipped_duplicates"] == 0
    assert len(result["errors"]) == 1
    supabase.store_receipt_with_items.assert_not_called()


def test_STORE_PARSED_RETURNS_NONE_ON_DUPLICATE():
    """store_parsed_receipt returns None when RPC returns None."""
    supabase = MagicMock()
    supabase.get_user_household.return_value = None
    supabase.store_receipt_with_items.return_value = None

    result = store_parsed_receipt(
        TEST_USER_ID,
        TEST_PROVIDER,
        _make_receipt("dup-order"),
        supabase,
    )

    assert result is None


def test_STORE_PARSED_PROPAGATES_NON_DUPLICATE_EXCEPTION():
    """store_parsed_receipt re-raises non-duplicate exceptions."""
    supabase = MagicMock()
    supabase.get_user_household.return_value = None
    supabase.store_receipt_with_items.side_effect = RuntimeError("db unavailable")

    with pytest.raises(RuntimeError, match="db unavailable"):
        store_parsed_receipt(
            TEST_USER_ID,
            TEST_PROVIDER,
            _make_receipt("err-order"),
            supabase,
        )


def test_FETCH_PARSE_DUPLICATE_NOT_COUNTED_AS_STORED():
    """fetch_and_parse_receipts skips idempotent duplicates in receipts_stored."""
    provider = MagicMock()
    provider.login.return_value = True
    provider.fetch_receipts.return_value = [_make_receipt("order-dup")]
    parser = MagicMock()
    supabase = MagicMock()
    supabase.get_user_household.return_value = None
    supabase.store_receipt_with_items.return_value = None

    result = fetch_and_parse_receipts(
        TEST_USER_ID,
        TEST_PROVIDER,
        provider,
        parser,
        supabase,
        datetime(2025, 1, 1),
        {"username": "x", "password": "y"},
    )

    assert result["receipts_fetched"] == 1
    assert result["receipts_stored"] == 0
    assert result["skipped_duplicates"] == 1
    assert result["errors"] == []
    provider.cleanup.assert_called_once()
