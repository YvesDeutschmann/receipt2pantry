"""Tests for ReceiptProcessor"""

import pytest
from unittest.mock import AsyncMock, Mock
from backend.services.receipt_processor import ReceiptProcessor
from backend.utils.exceptions import DatabaseException


class TestReceiptProcessor:
    """Test cases for ReceiptProcessor"""
    
    @pytest.mark.asyncio
    async def test_process_receipt_success(
        self,
        mock_supabase,
        mock_normalization_service,
        mock_pantry_service,
        sample_household,
        sample_receipt_items,
        sample_normalized_product,
        test_receipt_id,
        test_user_id
    ):
        """Test successful receipt processing"""
        # Setup
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_receipt_items.return_value = sample_receipt_items
        # Return a list of normalized products (one per item)
        mock_normalization_service.normalize_products_batch.return_value = [
            sample_normalized_product,
            sample_normalized_product
        ]
        mock_pantry_service.add_to_pantry = AsyncMock(return_value='pantry-1')
        
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
    
    @pytest.mark.asyncio
    async def test_process_receipt_no_items(
        self,
        mock_supabase,
        mock_normalization_service,
        mock_pantry_service,
        sample_household,
        test_receipt_id,
        test_user_id
    ):
        """Test processing receipt with no items"""
        # Setup
        mock_supabase.get_user_household.return_value = sample_household
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
        sample_household,
        sample_receipt_items,
        sample_normalized_product,
        test_receipt_id,
        test_user_id
    ):
        """Test receipt processing with some item errors"""
        # Setup
        mock_supabase.get_user_household.return_value = sample_household
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
        sample_household,
        sample_receipt_items,
        sample_normalized_product,
        test_user_id
    ):
        """Test batch processing multiple receipts"""
        # Setup
        receipt_ids = ['receipt-1', 'receipt-2']
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_receipt_items.return_value = sample_receipt_items
        # Return a list of normalized products (one per item)
        mock_normalization_service.normalize_products_batch.return_value = [
            sample_normalized_product,
            sample_normalized_product
        ]
        mock_pantry_service.add_to_pantry = AsyncMock(return_value='pantry-1')
        
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
        mock_supabase.admin_client = None
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

    @pytest.mark.asyncio
    async def test_process_receipt_with_explicit_household_id(
        self,
        mock_supabase,
        mock_normalization_service,
        mock_pantry_service,
        sample_receipt_items,
        sample_normalized_product,
        test_receipt_id,
        test_user_id,
        test_household_id,
    ):
        """When household_id is passed, get_user_household is not called."""
        mock_supabase.get_receipt_items.return_value = sample_receipt_items
        mock_normalization_service.normalize_products_batch.return_value = [
            sample_normalized_product,
            sample_normalized_product,
        ]
        mock_pantry_service.add_to_pantry = AsyncMock(return_value='pantry-1')

        processor = ReceiptProcessor(
            mock_supabase, mock_normalization_service, mock_pantry_service
        )
        result = await processor.process_receipt(
            test_receipt_id, test_user_id, household_id=test_household_id
        )

        mock_supabase.get_user_household.assert_not_called()
        assert result['status'] == 'processed'
        assert result['items_added_to_pantry'] == 2
        # add_to_pantry should be called with household_id
        calls = mock_pantry_service.add_to_pantry.call_args_list
        for call in calls:
            assert call.kwargs.get('household_id') == test_household_id

    @pytest.mark.asyncio
    async def test_process_receipt_no_household_still_processes(
        self,
        mock_supabase,
        mock_normalization_service,
        mock_pantry_service,
        sample_receipt_items,
        sample_normalized_product,
        test_receipt_id,
        test_user_id,
    ):
        """When user has no household (get_user_household returns None), processing still runs."""
        mock_supabase.get_user_household.return_value = None
        mock_supabase.get_receipt_items.return_value = sample_receipt_items
        mock_normalization_service.normalize_products_batch.return_value = [
            sample_normalized_product,
            sample_normalized_product,
        ]
        mock_pantry_service.add_to_pantry = AsyncMock(return_value='pantry-1')

        processor = ReceiptProcessor(
            mock_supabase, mock_normalization_service, mock_pantry_service
        )
        result = await processor.process_receipt(test_receipt_id, test_user_id)

        mock_supabase.get_user_household.assert_called_once_with(test_user_id)
        assert result['status'] == 'processed'
        assert result['items_added_to_pantry'] == 2


# ---------------------------------------------------------------------------
# Group A — happy path
# ---------------------------------------------------------------------------

class TestGroupA_HappyPath:
    @pytest.mark.asyncio
    async def test_process_receipt_returns_processed_status_on_full_success(
        self,
        mock_supabase,
        mock_normalization_service,
        mock_pantry_service,
        sample_household,
        sample_receipt_items,
        sample_normalized_product,
        test_receipt_id,
        test_user_id,
    ):
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_receipt_items.return_value = sample_receipt_items
        mock_normalization_service.normalize_products_batch.return_value = [
            sample_normalized_product,
            sample_normalized_product,
        ]
        mock_pantry_service.add_to_pantry = AsyncMock(return_value='pantry-1')

        processor = ReceiptProcessor(mock_supabase, mock_normalization_service, mock_pantry_service)
        result = await processor.process_receipt(test_receipt_id, test_user_id)

        assert result['status'] == 'processed'
        assert result['total_items'] == 2
        assert result['items_processed'] == 2
        assert result['items_added_to_pantry'] == 2
        assert result['errors'] == []

    @pytest.mark.asyncio
    async def test_process_receipt_sets_ai_used_true_when_any_source_is_openai(
        self,
        mock_supabase,
        mock_normalization_service,
        mock_pantry_service,
        sample_household,
        sample_receipt_items,
        sample_normalized_product,
        test_receipt_id,
        test_user_id,
    ):
        openai_product = {**sample_normalized_product, 'source': 'openai'}
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_receipt_items.return_value = sample_receipt_items
        mock_normalization_service.normalize_products_batch.return_value = [
            sample_normalized_product,
            openai_product,
        ]
        mock_pantry_service.add_to_pantry = AsyncMock(return_value='pantry-1')

        processor = ReceiptProcessor(mock_supabase, mock_normalization_service, mock_pantry_service)
        result = await processor.process_receipt(test_receipt_id, test_user_id)

        assert result['ai_used'] is True

    @pytest.mark.asyncio
    async def test_process_receipt_sets_ai_used_false_when_all_sources_are_mapping_or_cache(
        self,
        mock_supabase,
        mock_normalization_service,
        mock_pantry_service,
        sample_household,
        sample_receipt_items,
        sample_normalized_product,
        test_receipt_id,
        test_user_id,
    ):
        mapping_product = {**sample_normalized_product, 'source': 'mapping'}
        cache_product = {**sample_normalized_product, 'source': 'cache'}
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_receipt_items.return_value = sample_receipt_items
        mock_normalization_service.normalize_products_batch.return_value = [
            mapping_product,
            cache_product,
        ]
        mock_pantry_service.add_to_pantry = AsyncMock(return_value='pantry-1')

        processor = ReceiptProcessor(mock_supabase, mock_normalization_service, mock_pantry_service)
        result = await processor.process_receipt(test_receipt_id, test_user_id)

        assert result['ai_used'] is False


# ---------------------------------------------------------------------------
# Group B — partial failures
# ---------------------------------------------------------------------------

class TestGroupB_PartialFailures:
    @pytest.mark.asyncio
    async def test_process_receipt_reports_processed_with_errors_when_item_raises(
        self,
        mock_supabase,
        mock_normalization_service,
        mock_pantry_service,
        sample_household,
        sample_receipt_items,
        sample_normalized_product,
        test_receipt_id,
        test_user_id,
    ):
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_receipt_items.return_value = sample_receipt_items
        mock_normalization_service.normalize_products_batch.return_value = [
            sample_normalized_product,
            sample_normalized_product,
        ]
        mock_pantry_service.add_to_pantry = AsyncMock(
            side_effect=Exception("pantry write failed")
        )

        processor = ReceiptProcessor(mock_supabase, mock_normalization_service, mock_pantry_service)
        result = await processor.process_receipt(test_receipt_id, test_user_id)

        assert result['status'] == 'processed_with_errors'
        assert len(result['errors']) > 0

    @pytest.mark.asyncio
    async def test_process_receipt_continues_past_raising_item_to_next(
        self,
        mock_supabase,
        mock_normalization_service,
        mock_pantry_service,
        sample_household,
        sample_receipt_items,
        sample_normalized_product,
        test_receipt_id,
        test_user_id,
    ):
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_receipt_items.return_value = sample_receipt_items
        mock_normalization_service.normalize_products_batch.return_value = [
            sample_normalized_product,
            sample_normalized_product,
        ]
        mock_pantry_service.add_to_pantry = AsyncMock(
            side_effect=[Exception("first item fails"), 'pantry-1']
        )

        processor = ReceiptProcessor(mock_supabase, mock_normalization_service, mock_pantry_service)
        result = await processor.process_receipt(test_receipt_id, test_user_id)

        assert result['items_processed'] == 2
        assert result['items_added_to_pantry'] == 1
        assert len(result['errors']) == 1

    @pytest.mark.asyncio
    async def test_process_receipt_non_normalizable_item_increments_processed_not_added(
        self,
        mock_supabase,
        mock_normalization_service,
        mock_pantry_service,
        sample_household,
        sample_receipt_items,
        sample_normalized_product,
        test_receipt_id,
        test_user_id,
    ):
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_receipt_items.return_value = sample_receipt_items
        mock_normalization_service.normalize_products_batch.return_value = [
            None,
            sample_normalized_product,
        ]
        mock_pantry_service.add_to_pantry = AsyncMock(return_value='pantry-1')

        processor = ReceiptProcessor(mock_supabase, mock_normalization_service, mock_pantry_service)
        result = await processor.process_receipt(test_receipt_id, test_user_id)

        assert result['items_processed'] == 2
        assert result['items_added_to_pantry'] == 1
        assert result['errors'] == []


# ---------------------------------------------------------------------------
# Group C — no-items
# ---------------------------------------------------------------------------

class TestGroupC_NoItems:
    @pytest.mark.asyncio
    async def test_process_receipt_no_items_returns_no_items_status_without_ai_call(
        self,
        mock_supabase,
        mock_normalization_service,
        mock_pantry_service,
        sample_household,
        test_receipt_id,
        test_user_id,
    ):
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_receipt_items.return_value = []

        processor = ReceiptProcessor(mock_supabase, mock_normalization_service, mock_pantry_service)
        result = await processor.process_receipt(test_receipt_id, test_user_id)

        assert result['status'] == 'no_items'
        assert result['items_processed'] == 0
        assert result['items_added_to_pantry'] == 0
        assert result['errors'] == []
        mock_normalization_service.normalize_products_batch.assert_not_called()


# ---------------------------------------------------------------------------
# Group D — quantity derivation
# ---------------------------------------------------------------------------

class TestGroupD_QuantityDerivation:
    def _single_item(self, quantity_info, quantity=1):
        return [{
            'id': '1',
            'receipt_id': 'receipt-123',
            'user_id': 'user-456',
            'raw_name': 'Test Item',
            'name': 'Test Item',
            'category': 'GROCERY',
            'price': 2.99,
            'quantity': quantity,
            'unit_price': 2.99,
            'quantity_info': quantity_info,
        }]

    @pytest.mark.asyncio
    async def test_quantity_info_amount_and_unit_are_preferred(
        self,
        mock_supabase,
        mock_normalization_service,
        mock_pantry_service,
        sample_normalized_product,
        sample_household,
        test_receipt_id,
        test_user_id,
    ):
        item = self._single_item({'amount': 2.5, 'unit': 'kg'}, quantity=1)
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_receipt_items.return_value = item
        mock_normalization_service.normalize_products_batch.return_value = [sample_normalized_product]
        mock_pantry_service.add_to_pantry = AsyncMock(return_value='pantry-1')

        processor = ReceiptProcessor(mock_supabase, mock_normalization_service, mock_pantry_service)
        await processor.process_receipt(test_receipt_id, test_user_id)

        call_kwargs = mock_pantry_service.add_to_pantry.call_args.kwargs
        assert call_kwargs['quantity'] == 2.5
        assert call_kwargs['unit'] == 'kg'

    @pytest.mark.asyncio
    async def test_quantity_fallback_to_item_quantity_and_count_unit(
        self,
        mock_supabase,
        mock_normalization_service,
        mock_pantry_service,
        sample_household,
        test_receipt_id,
        test_user_id,
    ):
        normalized_no_qty = {
            'base_ingredient': 'item',
            'variant': None,
            'normalized_name': 'item',
            'source': 'mapping',
            'quantity_info': None,
        }
        item = self._single_item(None, quantity=3)
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_receipt_items.return_value = item
        mock_normalization_service.normalize_products_batch.return_value = [normalized_no_qty]
        mock_pantry_service.add_to_pantry = AsyncMock(return_value='pantry-1')

        processor = ReceiptProcessor(mock_supabase, mock_normalization_service, mock_pantry_service)
        await processor.process_receipt(test_receipt_id, test_user_id)

        call_kwargs = mock_pantry_service.add_to_pantry.call_args.kwargs
        assert call_kwargs['quantity'] == 3
        assert call_kwargs['unit'] == 'count'

    @pytest.mark.asyncio
    async def test_zero_quantity_amount_treated_as_missing_and_falls_back(
        self,
        mock_supabase,
        mock_normalization_service,
        mock_pantry_service,
        sample_normalized_product,
        sample_household,
        test_receipt_id,
        test_user_id,
    ):
        """amount=0 is falsy → truthy check skips it → falls back to item.quantity + 'count'."""
        item = self._single_item({'amount': 0, 'unit': 'kg'}, quantity=5)
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_receipt_items.return_value = item
        mock_normalization_service.normalize_products_batch.return_value = [sample_normalized_product]
        mock_pantry_service.add_to_pantry = AsyncMock(return_value='pantry-1')

        processor = ReceiptProcessor(mock_supabase, mock_normalization_service, mock_pantry_service)
        await processor.process_receipt(test_receipt_id, test_user_id)

        call_kwargs = mock_pantry_service.add_to_pantry.call_args.kwargs
        assert call_kwargs['unit'] == 'count'
        assert call_kwargs['quantity'] == 5


# ---------------------------------------------------------------------------
# Group E — household resolution
# ---------------------------------------------------------------------------

class TestGroupE_HouseholdResolution:
    @pytest.mark.asyncio
    async def test_household_id_looked_up_when_not_provided(
        self,
        mock_supabase,
        mock_normalization_service,
        mock_pantry_service,
        sample_household,
        sample_receipt_items,
        sample_normalized_product,
        test_receipt_id,
        test_user_id,
        test_household_id,
    ):
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_receipt_items.return_value = sample_receipt_items
        mock_normalization_service.normalize_products_batch.return_value = [
            sample_normalized_product,
            sample_normalized_product,
        ]
        mock_pantry_service.add_to_pantry = AsyncMock(return_value='pantry-1')

        processor = ReceiptProcessor(mock_supabase, mock_normalization_service, mock_pantry_service)
        result = await processor.process_receipt(test_receipt_id, test_user_id)

        mock_supabase.get_user_household.assert_called_once_with(test_user_id)
        assert result['household_id'] == test_household_id

    @pytest.mark.asyncio
    async def test_household_id_none_is_legal_legacy_path(
        self,
        mock_supabase,
        mock_normalization_service,
        mock_pantry_service,
        sample_receipt_items,
        sample_normalized_product,
        test_receipt_id,
        test_user_id,
    ):
        mock_supabase.get_user_household.return_value = None
        mock_supabase.get_receipt_items.return_value = sample_receipt_items
        mock_normalization_service.normalize_products_batch.return_value = [
            sample_normalized_product,
            sample_normalized_product,
        ]
        mock_pantry_service.add_to_pantry = AsyncMock(return_value='pantry-1')

        processor = ReceiptProcessor(mock_supabase, mock_normalization_service, mock_pantry_service)
        result = await processor.process_receipt(test_receipt_id, test_user_id)

        assert result['status'] == 'processed'
        assert result['household_id'] is None


# ---------------------------------------------------------------------------
# Group F — batch
# ---------------------------------------------------------------------------

class TestGroupF_Batch:
    @pytest.mark.asyncio
    async def test_process_multiple_receipts_isolates_per_receipt_failure(
        self,
        mock_supabase,
        mock_normalization_service,
        mock_pantry_service,
        test_user_id,
    ):
        processor = ReceiptProcessor(mock_supabase, mock_normalization_service, mock_pantry_service)
        processor.process_receipt = AsyncMock(
            side_effect=[
                DatabaseException("receipt-1 failed"),
                {'status': 'processed', 'items_added_to_pantry': 2, 'errors': []},
            ]
        )

        result = await processor.process_multiple_receipts(['receipt-1', 'receipt-2'], test_user_id)

        assert result['total_receipts'] == 2
        assert result['failed'] == 1
        assert result['successful'] == 1

    @pytest.mark.asyncio
    async def test_process_multiple_receipts_aggregates_items_added_correctly(
        self,
        mock_supabase,
        mock_normalization_service,
        mock_pantry_service,
        test_user_id,
    ):
        processor = ReceiptProcessor(mock_supabase, mock_normalization_service, mock_pantry_service)
        processor.process_receipt = AsyncMock(
            return_value={'status': 'processed', 'items_added_to_pantry': 3, 'errors': []}
        )

        result = await processor.process_multiple_receipts(
            ['receipt-1', 'receipt-2'], test_user_id
        )

        assert result['total_receipts'] == 2
        assert result['successful'] == 2
        assert result['failed'] == 0
        assert result['total_items_added'] == 6


# ---------------------------------------------------------------------------
# Group G — parity regression
# ---------------------------------------------------------------------------

class TestGroupG_ParityRegression:
    @pytest.mark.asyncio
    async def test_process_receipt_raises_if_normalizer_returns_short_list(
        self,
        mock_supabase,
        mock_normalization_service,
        mock_pantry_service,
        sample_household,
        sample_receipt_items,
        sample_normalized_product,
        test_receipt_id,
        test_user_id,
    ):
        """Normalizer returning fewer results than valid_items violates the parity contract."""
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_receipt_items.return_value = sample_receipt_items  # 2 items
        mock_normalization_service.normalize_products_batch.return_value = [
            sample_normalized_product  # only 1 result — violates parity
        ]

        processor = ReceiptProcessor(mock_supabase, mock_normalization_service, mock_pantry_service)

        with pytest.raises(DatabaseException):
            await processor.process_receipt(test_receipt_id, test_user_id)


