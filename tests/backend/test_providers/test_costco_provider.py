"""Tests for Costco provider"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import requests

from backend.providers.costco_provider import (
    COSTCO_CLIENT_IDENTIFIER,
    CostcoProvider,
    verify_costco_client_identifier,
)
from backend.providers.provider_registry import ProviderRegistry
from backend.utils.exceptions import (
    AuthenticationException,
    MFARequiredException,
    ProviderException,
)


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


def test_costco_provider_extract_order_id_empty_text():
    """Order id helper falls back to hash when text has no ID (PDF parsing lives in app flow, not on provider)."""
    provider = CostcoProvider()
    oid = provider._extract_order_id("")
    assert oid.startswith("COSTCO_")
    assert len(oid) == len("COSTCO_") + 12


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


# --- Group A: client-identifier verification (Contentstack mocked) ---


@patch("backend.providers.costco_provider.Config")
@patch("backend.providers.costco_provider.requests.post")
def test_verify_client_identifier_returns_valid_true_on_match(mock_post, mock_config):
    mock_config.CONTENTSTACK_ACCESS_TOKEN = "test-token"
    resp = MagicMock()
    resp.raise_for_status.return_value = None
    resp.json.return_value = {
        "data": {
            "all_Configuration_Setting": {
                "items": [
                    {
                        "configkey": "site_context",
                        "custom": {"usbc": {"clientIdentifier": COSTCO_CLIENT_IDENTIFIER}},
                    }
                ]
            }
        }
    }
    mock_post.return_value = resp
    result = verify_costco_client_identifier()
    assert result["valid"] is True
    assert result["current"] == COSTCO_CLIENT_IDENTIFIER
    assert result["expected"] == COSTCO_CLIENT_IDENTIFIER
    assert result["error"] is None


@patch("backend.providers.costco_provider.Config")
@patch("backend.providers.costco_provider.requests.post")
def test_verify_client_identifier_returns_valid_false_on_drift(mock_post, mock_config):
    """If COSTCO_CLIENT_IDENTIFIER changes in code, update this expected drift value too."""
    mock_config.CONTENTSTACK_ACCESS_TOKEN = "test-token"
    resp = MagicMock()
    resp.raise_for_status.return_value = None
    drift_id = "00000000-0000-0000-0000-000000000001"
    assert drift_id != COSTCO_CLIENT_IDENTIFIER
    resp.json.return_value = {
        "data": {
            "all_Configuration_Setting": {
                "items": [
                    {
                        "configkey": "site_context",
                        "custom": {"usbc": {"clientIdentifier": drift_id}},
                    }
                ]
            }
        }
    }
    mock_post.return_value = resp
    result = verify_costco_client_identifier()
    assert result["valid"] is False
    assert result["current"] == drift_id
    assert result["expected"] == COSTCO_CLIENT_IDENTIFIER


@patch("backend.providers.costco_provider.Config")
@patch("backend.providers.costco_provider.requests.post")
def test_verify_client_identifier_returns_valid_false_when_contentstack_token_missing(
    mock_post, mock_config,
):
    mock_config.CONTENTSTACK_ACCESS_TOKEN = ""
    result = verify_costco_client_identifier()
    assert result["valid"] is False
    assert "CONTENTSTACK_ACCESS_TOKEN" in (result.get("error") or "")
    mock_post.assert_not_called()


@patch("backend.providers.costco_provider.Config")
@patch("backend.providers.costco_provider.requests.post")
def test_verify_client_identifier_returns_valid_false_on_http_error(mock_post, mock_config):
    mock_config.CONTENTSTACK_ACCESS_TOKEN = "test-token"
    resp = MagicMock()
    resp.raise_for_status.side_effect = requests.HTTPError("503")
    mock_post.return_value = resp
    result = verify_costco_client_identifier()
    assert result["valid"] is False
    assert result["error"]


# --- Group B: GraphQL envelope ---


@patch("backend.providers.costco_provider.requests.post")
@patch.object(CostcoProvider, "_is_token_expired", return_value=False)
def test_fetch_orders_raises_provider_exception_when_errors_array_present(_exp, mock_post):
    r_ok = MagicMock()
    r_ok.status_code = 200
    r_ok.json.return_value = {"errors": [{"message": "upstream failure"}]}
    mock_post.return_value = r_ok
    provider = CostcoProvider()
    with pytest.raises(ProviderException, match="GraphQL error"):
        provider.fetch_receipts_via_api("header.token")


@patch("backend.providers.costco_provider.requests.post")
@patch.object(CostcoProvider, "_is_token_expired", return_value=False)
def test_fetch_orders_returns_empty_list_for_empty_order_window(_exp, mock_post):
    r_ok = MagicMock()
    r_ok.status_code = 200
    r_ok.json.return_value = {"data": {"receiptsWithCounts": {"receipts": []}}}
    mock_post.return_value = r_ok
    provider = CostcoProvider()
    assert provider.fetch_receipts_via_api("header.token") == []


# --- Group C: token refresh (bounded single retry) ---


@patch.object(CostcoProvider, "_refresh_id_token")
@patch("backend.providers.costco_provider.requests.post")
@patch.object(CostcoProvider, "_is_token_expired", return_value=False)
def test_401_triggers_single_refresh_attempt_before_raising(_exp, mock_post, mock_refresh):
    mock_refresh.return_value = {
        "idToken": "refreshed.id.jwt",
        "refreshToken": "new-refresh",
    }
    r401 = MagicMock(status_code=401, text="nope")
    r200 = MagicMock(status_code=200)
    r200.json.return_value = {"data": {"receiptsWithCounts": {"receipts": []}}}
    mock_post.side_effect = [r401, r200]
    provider = CostcoProvider()
    out = provider.fetch_receipts_via_api("old.token", refresh_token="rt1")
    assert out == []
    assert mock_post.call_count == 2
    mock_refresh.assert_called_once()


@patch.object(CostcoProvider, "_refresh_id_token")
@patch("backend.providers.costco_provider.requests.post")
@patch.object(CostcoProvider, "_is_token_expired", return_value=False)
def test_double_401_raises_authentication_exception_without_looping(_exp, mock_post, mock_refresh):
    mock_refresh.return_value = {"idToken": "refreshed.id.jwt", "refreshToken": "new-refresh"}
    r401 = MagicMock(status_code=401, text="nope")
    mock_post.side_effect = [r401, r401]
    provider = CostcoProvider()
    with pytest.raises(AuthenticationException, match="invalid or expired"):
        provider.fetch_receipts_via_api("old.token", refresh_token="rt1")
    assert mock_post.call_count == 2
    mock_refresh.assert_called_once()


# --- Group D: MFA ---


@patch("backend.providers.costco_provider.requests.post")
@patch.object(CostcoProvider, "_is_token_expired", return_value=False)
def test_device_verification_required_raises_mfa_required_exception_with_options(_exp, mock_post):
    r_ok = MagicMock()
    r_ok.status_code = 200
    r_ok.json.return_value = {
        "errors": [
            {
                "message": "Device verification required",
                "extensions": {
                    "code": "DEVICE_VERIFICATION_REQUIRED",
                    "sessionId": "sess-abc",
                    "verificationOptions": {"methods": ["sms", "email"]},
                },
            }
        ]
    }
    mock_post.return_value = r_ok
    provider = CostcoProvider()
    with pytest.raises(MFARequiredException) as exc_info:
        provider.fetch_receipts_via_api("header.token")
    err = exc_info.value
    assert err.session_id == "sess-abc"
    assert err.options == {"methods": ["sms", "email"]}


# --- Group E: non-grocery filter via API path ---


@patch("backend.providers.costco_provider.requests.post")
@patch.object(CostcoProvider, "_is_token_expired", return_value=False)
def test_non_grocery_receipt_types_filtered_out(_exp, mock_post):
    r_ok = MagicMock()
    r_ok.status_code = 200
    r_ok.json.return_value = {
        "data": {
            "receiptsWithCounts": {
                "receipts": [
                    {
                        "receiptType": "Gas Station",
                        "transactionDateTime": "2026-01-10T12:00:00",
                        "warehouseName": "Costco",
                        "total": 40.0,
                        "itemArray": [],
                    },
                    {
                        "receiptType": "Membership Renewal",
                        "transactionDateTime": "2026-01-11T12:00:00",
                        "warehouseName": "Costco",
                        "total": 60.0,
                        "itemArray": [],
                    },
                    {
                        "receiptType": "Car Wash",
                        "transactionDateTime": "2026-01-12T12:00:00",
                        "warehouseName": "Costco",
                        "total": 8.0,
                        "itemArray": [],
                    },
                ]
            }
        }
    }
    mock_post.return_value = r_ok
    provider = CostcoProvider()
    receipts = provider.fetch_receipts_via_api("header.token")
    assert receipts == []


@patch("backend.providers.costco_provider.requests.post")
@patch.object(CostcoProvider, "_is_token_expired", return_value=False)
def test_grocery_warehouse_receipts_pass_through(_exp, mock_post):
    r_ok = MagicMock()
    r_ok.status_code = 200
    r_ok.json.return_value = {
        "data": {
            "receiptsWithCounts": {
                "receipts": [
                    {
                        "receiptType": "In-Warehouse",
                        "transactionDateTime": "2026-01-10T12:00:00",
                        "warehouseName": "Costco #1",
                        "total": 120.0,
                        "transactionBarcode": "21074700600732601231155",
                        "itemArray": [],
                    }
                ]
            }
        }
    }
    mock_post.return_value = r_ok
    provider = CostcoProvider()
    receipts = provider.fetch_receipts_via_api("header.token")
    assert len(receipts) == 1
    assert receipts[0]["order_id"] == "21074700600732601231155"


# --- Group F: extraction wrappers ---


def test_extract_costco_order_id_returns_string():
    provider = CostcoProvider()
    assert provider._extract_order_id("21074700600732601231155") == "21074700600732601231155"


def test_extract_costco_order_date_returns_iso_date():
    provider = CostcoProvider()
    d = provider._extract_order_date("01/23/2026 11:55")
    assert d is not None
    assert d.strftime("%Y-%m-%d") == "2026-01-23"


def test_extract_costco_total_handles_missing_total():
    provider = CostcoProvider()
    assert provider._extract_total("no total line here") == 0.0
