"""Tests for SafewayParser (fixture-backed)."""

from pathlib import Path

import pytest

from backend.parsers.safeway_parser import SafewayParser
from backend.utils.exceptions import ParserException

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "safeway"


@pytest.fixture
def parser():
    return SafewayParser()


class TestSafewayFixtureGoldenPath:
    def test_parse_sample_receipt_01_returns_expected_item_count(self, parser):
        raw = (FIXTURES / "sample_receipt_01.eml").read_text(encoding="utf-8")
        result = parser.parse(raw)
        assert len(result["items"]) >= 10

    def test_parse_sample_receipt_01_extracts_correct_order_id_and_date(self, parser):
        raw = (FIXTURES / "sample_receipt_01.eml").read_text(encoding="utf-8")
        result = parser.parse(raw)
        assert result["order_id"] == "811529499001"
        assert result["order_date"] == "2025-10-01"

    def test_parse_sample_receipt_02_handles_quoted_printable_encoding(self, parser):
        raw = (FIXTURES / "sample_receipt_02.eml").read_text(encoding="utf-8")
        result = parser.parse(raw)
        assert result["order_id"] == "811529499002"
        names = [i["raw_name"] for i in result["items"]]
        assert any("Quoted Printable" in n or "Crackers" in n for n in names)


class TestSafewayLineItemShapes:
    def test_item_with_weight_pricing_extracts_lb_unit_and_amount(self, parser):
        raw = (FIXTURES / "sample_receipt_03.eml").read_text(encoding="utf-8")
        result = parser.parse(raw)
        salmon = next(i for i in result["items"] if "Salmon" in i["raw_name"])
        assert salmon["unit"] == "lb"
        assert salmon["quantity"] == 2.1
        assert abs(salmon["unit_price"] - 9.99) < 0.01

    def test_item_with_count_pricing_extracts_count_unit(self, parser):
        raw = (FIXTURES / "sample_receipt_03.eml").read_text(encoding="utf-8")
        result = parser.parse(raw)
        water = next(i for i in result["items"] if "Sparkling Water" in i["raw_name"])
        assert water["unit"] == "each"
        assert water["quantity"] == 2.0

    def test_item_with_discount_reflects_final_price(self, parser):
        raw = (FIXTURES / "sample_receipt_03.eml").read_text(encoding="utf-8")
        result = parser.parse(raw)
        cheese = next(i for i in result["items"] if "Tillamook" in i["raw_name"])
        assert cheese["price"] == 4.99
        assert cheese["regular_price"] == 6.49
        assert cheese["savings"] == pytest.approx(1.5)


class TestSafewayFailureModes:
    def test_parser_raises_with_missing_order_id_field_name(self, parser):
        raw = """
From: "Safeway" <safeway@p.safeway.com>
Subject: Your Receipt From Safeway
Content-Type: text/plain; charset="utf-8"

Thanks for shopping with Safeway!

Here is your receipt from 10/05/2025.

GROCERY

Apple

$1.00

Quantity: 1

Total Items (1)

$1.00

Total

$1.00

Transaction Details

Authorization Date

Oct 05, 2025
"""
        with pytest.raises(ParserException) as excinfo:
            parser.parse(raw)
        assert "order_id" in str(excinfo.value).lower()

    def test_parser_raises_on_empty_body(self, parser):
        with pytest.raises(ParserException):
            parser.parse("")

    def test_parser_raises_on_non_safeway_email(self, parser):
        raw = """From: receipts@costco.com
Subject: Your Costco Receipt

COSTCO WHOLESALE #123
**** TOTAL 44.34
"""
        with pytest.raises(ParserException) as excinfo:
            parser.parse(raw)
        assert "safeway" in str(excinfo.value).lower()


class TestSafewayPurity:
    def test_parse_is_idempotent_across_two_calls(self, parser):
        raw = (FIXTURES / "sample_receipt_01.eml").read_text(encoding="utf-8")
        a = parser.parse(raw)
        b = parser.parse(raw)
        assert a == b

    def test_parse_does_not_use_datetime_now(self):
        src = Path(__file__).resolve().parents[3] / "backend" / "parsers" / "safeway_parser.py"
        text = src.read_text(encoding="utf-8")
        assert "datetime.now" not in text
        assert "utcnow" not in text


class TestSafewayNoSubstringCollapsing:
    def test_sparkling_water_not_reduced_to_water(self, parser):
        raw = (FIXTURES / "sample_receipt_03.eml").read_text(encoding="utf-8")
        result = parser.parse(raw)
        water = next(i for i in result["items"] if "Water" in i["raw_name"])
        assert "Sparkling" in water["raw_name"]
        assert water["raw_name"] == "Acme Sparkling Water 12 Oz"

    def test_brand_prefixed_items_preserve_brand(self, parser):
        raw = (FIXTURES / "sample_receipt_03.eml").read_text(encoding="utf-8")
        result = parser.parse(raw)
        cheese = next(i for i in result["items"] if "Tillamook" in i["raw_name"])
        assert cheese["raw_name"].startswith("Tillamook")
