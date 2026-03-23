"""Tests for Costco receiptType normalization."""

from backend.utils.costco_receipt_types import (
    is_non_grocery_costco_receipt_type,
    normalize_costco_receipt_type,
    receipt_type_from_payload,
)


def test_normalize_strips_spaces_and_hyphens():
    assert normalize_costco_receipt_type("Gas Station") == "gasstation"
    assert normalize_costco_receipt_type("In-Warehouse") == "inwarehouse"
    assert normalize_costco_receipt_type("carWash") == "carwash"


def test_non_grocery_blacklist():
    assert is_non_grocery_costco_receipt_type("Gas Station") is True
    assert is_non_grocery_costco_receipt_type("Car Wash") is True
    assert is_non_grocery_costco_receipt_type("Gas And Car Wash") is True
    assert is_non_grocery_costco_receipt_type("In-Warehouse") is False
    assert is_non_grocery_costco_receipt_type("warehouse") is False


def test_receipt_type_from_payload():
    assert receipt_type_from_payload({"receipt_type": "In-Warehouse"}) == "In-Warehouse"
    assert receipt_type_from_payload({"receiptType": "Gas Station"}) == "Gas Station"
    assert receipt_type_from_payload({}) == ""
