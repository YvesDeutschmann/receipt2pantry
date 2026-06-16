"""Tests for Costco provider"""

import pytest
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
    assert provider.provider_name == "costco"


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


def test_costco_provider_cleanup():
    """Test provider cleanup is a no-op"""
    provider = CostcoProvider()
    provider.cleanup()


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
