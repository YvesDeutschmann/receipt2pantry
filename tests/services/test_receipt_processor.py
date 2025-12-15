"""Tests for ReceiptProcessor"""

import pytest
from unittest.mock import AsyncMock, Mock
from backend.services.receipt_processor import ReceiptProcessor


class TestReceiptProcessor:
    """Test cases for ReceiptProcessor"""
    
    @pytest.mark.asyncio
    async def test_process_receipt_success(
        self,
        mock_supabase,
        mock_normalization_service,
        mock_pantry_service,
        sample_receipt_items,
        sample_normalized_product,
        test_receipt_id,
        test_user_id
    ):
        """Test successful receipt processing"""
        # Setup
        mock_supabase.get_receipt_items.return_value = sample_receipt_items
        # Return a list of normalized products (one per item)
        mock_normalization_service.normalize_products_batch.return_value = [
            sample_normalized_product,
            sample_normalized_product
        ]
        mock_pantry_service.add_to_pantry = AsyncMock(return_value='pantry-1')
        mock_supabase.update_receipt_status.return_value = None
        
        processor = ReceiptProcessor(mock_supabase, mock_normalization_service, mock_pantry_service)
        
        # Execute
        result = await processor.process_receipt(test_receipt_id, test_user_id)
        
        # Verify
        assert result['status'] == 'processed'
        assert result['total_items'] == 2
        assert result['items_processed'] == 2
        assert result['items_added_to_pantry'] == 2
        assert len(result['errors']) == 0
        
        # Verify batch normalization was called once with all items
        assert mock_normalization_service.normalize_products_batch.call_count == 1
        
        # Verify pantry was updated for each item
        assert mock_pantry_service.add_to_pantry.call_count == 2
        
        # Verify receipt status was updated
        mock_supabase.update_receipt_status.assert_called_once_with(test_receipt_id, 'processed')
    
    @pytest.mark.asyncio
    async def test_process_receipt_no_items(
        self,
        mock_supabase,
        mock_normalization_service,
        mock_pantry_service,
        test_receipt_id,
        test_user_id
    ):
        """Test processing receipt with no items"""
        # Setup
        mock_supabase.get_receipt_items.return_value = []
        
        processor = ReceiptProcessor(mock_supabase, mock_normalization_service, mock_pantry_service)
        
        # Execute
        result = await processor.process_receipt(test_receipt_id, test_user_id)
        
        # Verify
        assert result['status'] == 'no_items'
        assert result['items_processed'] == 0
        assert mock_normalization_service.normalize_product.call_count == 0
    
    @pytest.mark.asyncio
    async def test_process_receipt_with_errors(
        self,
        mock_supabase,
        mock_normalization_service,
        mock_pantry_service,
        sample_receipt_items,
        sample_normalized_product,
        test_receipt_id,
        test_user_id
    ):
        """Test receipt processing with some item errors"""
        # Setup
        mock_supabase.get_receipt_items.return_value = sample_receipt_items
        # Return a list of normalized products (one per item)
        mock_normalization_service.normalize_products_batch.return_value = [
            sample_normalized_product,
            sample_normalized_product
        ]
        
        # Make pantry service fail for first item
        mock_pantry_service.add_to_pantry = AsyncMock(side_effect=[
            Exception("Database error"),
            'pantry-1'
        ])
        mock_supabase.update_receipt_status.return_value = None
        
        processor = ReceiptProcessor(mock_supabase, mock_normalization_service, mock_pantry_service)
        
        # Execute
        result = await processor.process_receipt(test_receipt_id, test_user_id)
        
        # Verify
        assert result['status'] == 'processed_with_errors'
        assert result['items_processed'] == 2
        assert result['items_added_to_pantry'] == 1
        assert len(result['errors']) == 1
    
    @pytest.mark.asyncio
    async def test_process_multiple_receipts(
        self,
        mock_supabase,
        mock_normalization_service,
        mock_pantry_service,
        sample_receipt_items,
        sample_normalized_product,
        test_user_id
    ):
        """Test batch processing multiple receipts"""
        # Setup
        receipt_ids = ['receipt-1', 'receipt-2']
        mock_supabase.get_receipt_items.return_value = sample_receipt_items
        # Return a list of normalized products (one per item)
        mock_normalization_service.normalize_products_batch.return_value = [
            sample_normalized_product,
            sample_normalized_product
        ]
        mock_pantry_service.add_to_pantry = AsyncMock(return_value='pantry-1')
        mock_supabase.update_receipt_status.return_value = None
        
        processor = ReceiptProcessor(mock_supabase, mock_normalization_service, mock_pantry_service)
        
        # Execute
        result = await processor.process_multiple_receipts(receipt_ids, test_user_id)
        
        # Verify
        assert result['total_receipts'] == 2
        assert result['successful'] == 2
        assert result['failed'] == 0
        assert result['total_items_added'] == 4  # 2 items per receipt
    
    def test_get_processing_status(
        self,
        mock_supabase,
        mock_normalization_service,
        mock_pantry_service,
        sample_receipt_items,
        test_receipt_id
    ):
        """Test getting receipt processing status"""
        # Setup
        receipt_data = {
            'id': test_receipt_id,
            'status': 'processed',
            'processed_at': '2025-01-01T12:00:00Z',
            'fetched_at': '2025-01-01T11:00:00Z',
            'order_date': '2025-01-01',
            'provider': 'safeway'
        }
        
        mock_response = Mock()
        mock_response.data = [receipt_data]
        mock_supabase.client = Mock()
        mock_supabase.client.table.return_value.select.return_value.eq.return_value.execute.return_value = mock_response
        mock_supabase.get_receipt_items.return_value = sample_receipt_items
        
        processor = ReceiptProcessor(mock_supabase, mock_normalization_service, mock_pantry_service)
        
        # Execute
        result = processor.get_processing_status(test_receipt_id)
        
        # Verify
        assert result['receipt_id'] == test_receipt_id
        assert result['status'] == 'processed'
        assert result['total_items'] == 2
        assert result['provider'] == 'safeway'


