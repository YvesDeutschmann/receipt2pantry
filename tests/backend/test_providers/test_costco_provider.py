"""Tests for Costco provider"""

import pytest
from datetime import datetime, timedelta
from backend.providers.costco_provider import CostcoProvider
from backend.providers.provider_registry import ProviderRegistry
from backend.utils.exceptions import AuthenticationException, ProviderException


def test_costco_provider_registered():
    """Test that Costco provider is registered"""
    assert ProviderRegistry.is_registered("costco")
    provider = ProviderRegistry.get_provider("costco")
    assert isinstance(provider, CostcoProvider)


def test_costco_provider_name():
    """Test provider name property"""
    provider = CostcoProvider()
    assert provider.provider_name == "costco"


def test_costco_provider_initialization():
    """Test provider initialization"""
    provider = CostcoProvider(headless=True, timeout=30000)
    assert provider.headless is True
    assert provider.timeout == 30000
    assert provider.browser is None
    assert provider.context is None
    assert provider.page is None


def test_costco_provider_parse_api_receipt_without_transaction_barcode():
    """Test that missing transactionBarcode generates unique order_id fallback"""
    provider = CostcoProvider()
    
    raw1 = {
        "transactionDateTime": "2025-01-15T14:30:00",
        "warehouseName": "Costco #123",
        "total": 50.00,
        "itemArray": [{"itemDescription01": "Item A", "amount": 50.00}],
    }
    raw2 = {
        "transactionDateTime": "2025-01-15T14:30:00",
        "warehouseName": "Costco #123",
        "total": 50.00,
        "itemArray": [{"itemDescription01": "Item B", "amount": 50.00}],
    }
    
    receipt1 = provider._parse_api_receipt(raw1)
    receipt2 = provider._parse_api_receipt(raw2)
    
    assert receipt1["order_id"].startswith("COSTCO_")
    assert receipt2["order_id"].startswith("COSTCO_")
    assert receipt1["order_id"] != receipt2["order_id"], "Different receipts must get unique order_ids"


def test_costco_provider_parse_api_receipt_with_transaction_barcode():
    """Test that transactionBarcode is used when present"""
    provider = CostcoProvider()
    
    raw = {
        "transactionBarcode": "21074700600732601231155",
        "transactionDateTime": "2025-01-15T14:30:00",
        "warehouseName": "Costco",
        "total": 50.00,
        "itemArray": [],
    }
    
    receipt = provider._parse_api_receipt(raw)
    assert receipt["order_id"] == "21074700600732601231155"
    assert receipt["transaction_id"] == "21074700600732601231155"


def test_costco_provider_extract_order_id():
    """Test order ID extraction from receipt text"""
    provider = CostcoProvider()
    
    receipt_text = "21074700600732601231155"
    order_id = provider._extract_order_id(receipt_text)
    assert order_id == "21074700600732601231155"
    
    # Test fallback hash generation
    receipt_text2 = "No transaction ID here"
    order_id2 = provider._extract_order_id(receipt_text2)
    assert order_id2.startswith("COSTCO_")


def test_costco_provider_extract_total():
    """Test total amount extraction"""
    provider = CostcoProvider()
    
    receipt_text = "**** TOTAL 597.49"
    total = provider._extract_total(receipt_text)
    assert total == 597.49
    
    receipt_text2 = "TOTAL $100.00"
    total2 = provider._extract_total(receipt_text2)
    assert total2 == 100.0
    
    receipt_text3 = "AMOUNT: $50.25"
    total3 = provider._extract_total(receipt_text3)
    assert total3 == 50.25


def test_costco_provider_extract_order_date():
    """Test order date extraction"""
    provider = CostcoProvider()
    
    receipt_text = "01/23/2026 11:55"
    date = provider._extract_order_date(receipt_text)
    assert date is not None
    assert date.year == 2026
    assert date.month == 1
    assert date.day == 23
    
    receipt_text2 = "2026-01-23"
    date2 = provider._extract_order_date(receipt_text2)
    assert date2.year == 2026
    
    receipt_text3 = "Jan 23, 2026"
    date3 = provider._extract_order_date(receipt_text3)
    assert date3.year == 2026


def test_costco_provider_extract_pdf_text():
    """Test PDF text extraction"""
    provider = CostcoProvider()
    
    # Create a simple PDF-like content (in real tests, this would be actual PDF bytes)
    # For now, we'll just test that the method exists and handles empty input
    empty_pdf = b""
    text = provider._extract_pdf_text(empty_pdf)
    assert text == ""


def test_costco_provider_cleanup():
    """Test provider cleanup"""
    provider = CostcoProvider()
    provider.cleanup()
    
    # After cleanup, browser and context should be None
    assert provider.browser is None
    assert provider.context is None
    assert provider.page is None
    assert provider._playwright is None


def test_costco_provider_login_missing_credentials():
    """Test login with missing credentials"""
    provider = CostcoProvider()
    
    with pytest.raises(AuthenticationException):
        provider.login({})
    
    with pytest.raises(AuthenticationException):
        provider.login({"username": "test"})
    
    with pytest.raises(AuthenticationException):
        provider.login({"password": "test"})


def test_costco_provider_fetch_receipts_not_logged_in():
    """Test fetching receipts without login"""
    provider = CostcoProvider()
    
    with pytest.raises(ProviderException) as exc_info:
        provider.fetch_receipts(datetime.now() - timedelta(days=7))
    
    assert "not started" in str(exc_info.value).lower()
