"""Tests for PantryService"""

import pytest
from unittest.mock import Mock, AsyncMock, patch
from backend.services.pantry_service import PantryService


class TestPantryService:
    """Test cases for PantryService"""
    
    @pytest.mark.asyncio
    async def test_add_to_pantry_new_item(
        self, mock_supabase, sample_normalized_product, test_user_id, test_receipt_id
    ):
        """Test adding a new item to pantry"""
        # Setup
        mock_supabase.get_user_pantry.return_value = []
        mock_supabase.upsert_pantry_item.return_value = 'pantry-item-1'
        
        service = PantryService(mock_supabase)
        
        # Execute
        result = await service.add_to_pantry(
            user_id=test_user_id,
            normalized_item=sample_normalized_product,
            quantity=1.0,
            unit='lb',
            receipt_id=test_receipt_id
        )
        
        # Verify
        assert result == 'pantry-item-1'
        mock_supabase.upsert_pantry_item.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_add_to_pantry_existing_item(
        self, mock_supabase, sample_normalized_product, test_user_id, test_receipt_id
    ):
        """Test adding to existing pantry item (quantity update)"""
        # Setup
        existing_item = {
            'id': 'pantry-1',
            'base_ingredient': 'butter',
            'variant': 'salted',
            'unit': 'lb',
            'quantity': 1.0
        }
        mock_supabase.get_user_pantry.return_value = [existing_item]
        mock_supabase.update_pantry_quantity.return_value = None
        mock_supabase.client = Mock()
        mock_supabase.client.table.return_value.update.return_value.eq.return_value.execute.return_value = None
        
        service = PantryService(mock_supabase)
        
        # Execute
        result = await service.add_to_pantry(
            user_id=test_user_id,
            normalized_item=sample_normalized_product,
            quantity=1.0,
            unit='lb',
            receipt_id=test_receipt_id
        )
        
        # Verify
        assert result == 'pantry-1'
        mock_supabase.update_pantry_quantity.assert_called_once_with('pantry-1', 2.0)
    
    @pytest.mark.asyncio
    async def test_get_pantry_summary(self, mock_supabase, sample_pantry_items, test_user_id):
        """Test getting pantry summary"""
        # Setup
        mock_supabase.get_user_pantry.return_value = sample_pantry_items
        
        service = PantryService(mock_supabase)
        
        # Execute
        result = await service.get_pantry_summary(test_user_id)
        
        # Verify
        assert result['total_items'] == 2
        assert result['unique_ingredients'] == 2
        assert len(result['items']) == 2
        assert len(result['grouped']) == 2
    
    @pytest.mark.asyncio
    async def test_consume_ingredients(
        self, mock_supabase, sample_pantry_items, test_user_id
    ):
        """Test consuming ingredients when recipe is cooked"""
        # Setup
        mock_supabase.get_user_pantry.return_value = sample_pantry_items
        mock_supabase.update_pantry_quantity.return_value = None
        mock_supabase.log_cooking_event.return_value = 'log-1'
        
        service = PantryService(mock_supabase)
        
        ingredients = [
            {'name': 'butter (salted)', 'amount': 0.5, 'unit': 'lb'}
        ]
        
        # Execute
        result = await service.consume_ingredients(
            user_id=test_user_id,
            recipe_id='recipe-1',
            recipe_name='Test Recipe',
            servings=4,
            ingredients=ingredients
        )
        
        # Verify
        assert result['log_id'] == 'log-1'
        assert len(result['consumed']) == 1
        assert result['consumed'][0]['ingredient'] == 'butter (salted)'
        assert result['consumed'][0]['remaining'] == 0.5
        mock_supabase.update_pantry_quantity.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_check_ingredient_availability(
        self, mock_supabase, sample_pantry_items, test_user_id
    ):
        """Test checking ingredient availability"""
        # Setup
        mock_supabase.get_user_pantry.return_value = sample_pantry_items
        mock_supabase.get_substitutions_for_ingredient.return_value = []
        
        service = PantryService(mock_supabase)
        
        required = [
            {'name': 'butter (salted)', 'amount': 0.5, 'unit': 'lb'},
            {'name': 'flour', 'amount': 2.0, 'unit': 'cup'}
        ]
        
        # Execute
        result = await service.check_ingredient_availability(
            user_id=test_user_id,
            required_ingredients=required
        )
        
        # Verify
        assert result['can_make'] == False  # Missing flour
        assert len(result['available']) == 1
        assert len(result['missing']) == 1
        assert result['missing'][0]['ingredient'] == 'flour'


