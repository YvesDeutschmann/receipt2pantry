"""Tests for shared Costco receipt extraction helpers."""

from backend.utils.costco_receipt_extraction import (
    extract_costco_order_date,
    extract_costco_order_id,
    extract_costco_total,
)


def test_extract_costco_order_id():
    """Extract transaction IDs when present."""
    assert extract_costco_order_id("21074700600732601231155") == "21074700600732601231155"
    assert extract_costco_order_id("No transaction ID here") is None


def test_extract_costco_order_date_supports_known_formats():
    """Parse known Costco date formats."""
    slash_date = extract_costco_order_date("01/23/2026 11:55")
    assert slash_date is not None
    assert slash_date.year == 2026
    assert slash_date.month == 1
    assert slash_date.day == 23

    iso_date = extract_costco_order_date("2026-01-23")
    assert iso_date is not None
    assert iso_date.year == 2026
    assert iso_date.month == 1
    assert iso_date.day == 23

    month_name_date = extract_costco_order_date("Jan 23, 2026")
    assert month_name_date is not None
    assert month_name_date.year == 2026
    assert month_name_date.month == 1
    assert month_name_date.day == 23


def test_extract_costco_order_date_returns_none_for_unknown_format():
    """Return None when no known date pattern exists."""
    assert extract_costco_order_date("No date here") is None


def test_extract_costco_total_patterns():
    """Extract totals from supported total line variants."""
    assert extract_costco_total("**** TOTAL 597.49") == 597.49
    assert extract_costco_total("TOTAL $100.00") == 100.0
    assert extract_costco_total("AMOUNT: $50.25") == 50.25


def test_extract_costco_total_returns_zero_when_missing():
    """Return zero when no total is found."""
    assert extract_costco_total("No total present") == 0.0
