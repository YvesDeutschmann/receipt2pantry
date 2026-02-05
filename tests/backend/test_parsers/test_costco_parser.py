"""Tests for Costco parser"""

import pytest
from datetime import datetime
from backend.parsers.costco_parser import CostcoParser
from backend.parsers.parser_registry import ParserRegistry
from backend.utils.exceptions import ParserException


def test_costco_parser_registered():
    """Test that Costco parser is registered"""
    assert ParserRegistry.is_registered("costco")
    parser = ParserRegistry.get_parser("costco")
    assert isinstance(parser, CostcoParser)


def test_costco_parser_name():
    """Test parser name property"""
    parser = CostcoParser()
    assert parser.parser_name == "costco"


def test_costco_parser_basic_parse():
    """Test basic parsing of Costco receipt text"""
    parser = CostcoParser()
    
    receipt_text = """WOODINVILLE #747
24008 SNOHOMISH WOODINVIL
WOODINVILLE, WA 98072
21074700600732601231155
Member
111998941229
E   70000 KS BACON     16.49 N
E   251680 ORG RASPBERY 7.99 N
E   1951300 FISHSTICK  15.49 N
SUBTOTAL    39.97
TAX         4.37
**** TOTAL 44.34"""
    
    # Mock AI service to avoid actual API calls in tests
    class MockAIService:
        is_available = False
        
        def parse_costco_receipt(self, text):
            raise Exception("AI not available")
    
    parser.ai_service = MockAIService()
    
    # Should fall back to basic parsing
    result = parser.parse(receipt_text)
    
    assert result["order_id"] is not None
    assert result["order_date"] is not None
    assert result["total_amount"] > 0
    assert len(result["items"]) > 0
    assert result["items"][0]["name"] == "KS BACON"
    assert result["items"][0]["price"] == 16.49


def test_costco_parser_extract_order_id():
    """Test order ID extraction"""
    parser = CostcoParser()
    
    receipt_text = "21074700600732601231155"
    order_id = parser._extract_order_id(receipt_text)
    assert order_id == "21074700600732601231155"


def test_costco_parser_extract_total():
    """Test total amount extraction"""
    parser = CostcoParser()
    
    receipt_text = "**** TOTAL 597.49"
    total = parser._extract_total(receipt_text)
    assert total == 597.49


def test_costco_parser_extract_date():
    """Test date extraction"""
    parser = CostcoParser()
    
    receipt_text = "01/23/2026 11:55"
    date = parser._extract_order_date(receipt_text)
    assert date is not None
    assert date.year == 2026
    assert date.month == 1
    assert date.day == 23


def test_costco_parser_validate():
    """Test parser validation"""
    parser = CostcoParser()
    
    # Valid data
    valid_data = {
        "order_id": "12345",
        "order_date": "2026-01-23",
        "total_amount": 100.0,
        "items": [
            {"name": "Test Item", "price": 10.0}
        ]
    }
    assert parser.validate(valid_data) is True
    
    # Invalid data - missing order_id
    invalid_data = {
        "order_date": "2026-01-23",
        "total_amount": 100.0,
        "items": []
    }
    assert parser.validate(invalid_data) is False
    
    # Invalid data - no items
    invalid_data2 = {
        "order_id": "12345",
        "order_date": "2026-01-23",
        "total_amount": 100.0,
        "items": []
    }
    assert parser.validate(invalid_data2) is True  # Empty items is valid


def test_costco_parser_fallback():
    """Test fallback parser functionality"""
    parser = CostcoParser()
    parser.set_fallback_parser("ai")
    
    assert parser._fallback_parser_name == "ai"
