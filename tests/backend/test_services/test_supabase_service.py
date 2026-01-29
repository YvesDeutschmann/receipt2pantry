"""Tests for Supabase service"""

import pytest
from backend.services.supabase_service import SupabaseService
from backend.utils.exceptions import DatabaseException


def test_supabase_service_initialization():
    """Test Supabase service can be initialized"""
    # Note: This will fail without valid credentials
    # In a real test environment, you'd use mocks or test credentials
    with pytest.raises(DatabaseException):
        service = SupabaseService("invalid-url", "invalid-key")


def test_supabase_service_with_mock(mocker):
    """Test Supabase service with mocked client"""
    mock_create_client = mocker.patch('backend.services.supabase_service.create_client')
    mock_client = mocker.MagicMock()
    mock_create_client.return_value = mock_client
    
    service = SupabaseService("https://test.supabase.co", "test-key")
    
    assert service.client is not None
    mock_create_client.assert_called_once()


def test_get_user_receipts_with_mock(mocker):
    """Test getting user receipts"""
    mock_create_client = mocker.patch('backend.services.supabase_service.create_client')
    mock_client = mocker.MagicMock()
    
    # Mock the chained query methods
    mock_response = mocker.MagicMock()
    mock_response.data = [
        {"id": "1", "order_id": "12345A6", "total_amount": 50.00},
        {"id": "2", "order_id": "67890B2", "total_amount": 75.50}
    ]
    
    mock_client.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = mock_response
    mock_create_client.return_value = mock_client
    
    service = SupabaseService("https://test.supabase.co", "test-key")
    receipts = service.get_user_receipts("user-123")
    
    assert len(receipts) == 2
    assert receipts[0]["order_id"] == "12345A6"
    assert receipts[1]["order_id"] == "67890B2"


def test_upsert_pantry_item_household_conflict_target(mocker):
    """upsert_pantry_item uses household_id conflict when household_id is set."""
    mock_create_client = mocker.patch('backend.services.supabase_service.create_client')
    mock_client = mocker.MagicMock()
    mock_create_client.return_value = mock_client
    mock_response = mocker.MagicMock()
    mock_response.data = [{"id": "pantry-1"}]
    mock_upsert = mocker.MagicMock()
    mock_upsert.execute.return_value = mock_response
    mock_client.table.return_value.upsert.return_value = mock_upsert

    service = SupabaseService("https://test.supabase.co", "test-key")
    service.admin_client = mock_client

    item_data = {
        "user_id": "user-1",
        "household_id": "hh-1",
        "base_ingredient": "butter",
        "variant": "salted",
        "unit": "lb",
        "normalized_name": "butter (salted)",
    }
    result = service.upsert_pantry_item(item_data)

    assert result == "pantry-1"
    mock_client.table.return_value.upsert.assert_called_once_with(
        item_data, on_conflict="household_id,base_ingredient,variant,unit"
    )


def test_upsert_pantry_item_null_household_conflict_target(mocker):
    """upsert_pantry_item uses user_id conflict when household_id is None (legacy)."""
    mock_create_client = mocker.patch('backend.services.supabase_service.create_client')
    mock_client = mocker.MagicMock()
    mock_create_client.return_value = mock_client
    mock_response = mocker.MagicMock()
    mock_response.data = [{"id": "pantry-2"}]
    mock_upsert = mocker.MagicMock()
    mock_upsert.execute.return_value = mock_response
    mock_client.table.return_value.upsert.return_value = mock_upsert

    service = SupabaseService("https://test.supabase.co", "test-key")
    service.admin_client = mock_client

    item_data = {
        "user_id": "user-1",
        "household_id": None,
        "base_ingredient": "flour",
        "variant": None,
        "unit": "cup",
        "normalized_name": "flour",
    }
    result = service.upsert_pantry_item(item_data)

    assert result == "pantry-2"
    mock_client.table.return_value.upsert.assert_called_once_with(
        item_data, on_conflict="user_id,base_ingredient,variant,unit"
    )

