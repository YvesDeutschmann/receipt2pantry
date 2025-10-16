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

