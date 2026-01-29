"""Tests for pantry routes"""

import json
import pytest
from unittest.mock import Mock, AsyncMock
from backend.utils.exceptions import ValidationException, DatabaseException


class TestPantryRoutes:
    """Test cases for pantry API routes"""
    
    @pytest.fixture
    def mock_pantry_service(self):
        """Create mock pantry service with async methods"""
        service = Mock()
        # Mock async methods
        service.get_pantry_summary = AsyncMock()
        service.add_to_pantry = AsyncMock()
        service.consume_ingredients = AsyncMock()
        service.check_ingredient_availability = AsyncMock()
        return service
    
    @pytest.fixture
    def mock_supabase_service(self):
        """Create mock supabase service"""
        return Mock()
    
    @pytest.fixture
    def app_with_services(self, app, mock_pantry_service, mock_supabase_service):
        """App with mocked pantry and supabase services"""
        app.config['PANTRY_SERVICE'] = mock_pantry_service
        app.config['SUPABASE_SERVICE'] = mock_supabase_service
        return app
    
    @pytest.fixture
    def client_with_services(self, app_with_services):
        """Test client with mocked services"""
        return app_with_services.test_client()
    
    # =========================================================================
    # GET /api/pantry tests
    # =========================================================================
    
    def test_get_pantry_success(self, client_with_services, mock_pantry_service):
        """Test getting pantry summary"""
        # Setup
        mock_pantry_service.get_pantry_summary.return_value = {
            'total_items': 5,
            'unique_ingredients': 3,
            'items': [
                {'id': '1', 'normalized_name': 'butter (unsalted)', 'quantity': 2, 'unit': 'count'},
                {'id': '2', 'normalized_name': 'milk (whole)', 'quantity': 1, 'unit': 'gallon'},
            ],
            'grouped': [
                {
                    'base_ingredient': 'butter',
                    'variants': [
                        {'id': '1', 'normalized_name': 'butter (unsalted)', 'quantity': 2, 'unit': 'count'}
                    ]
                },
                {
                    'base_ingredient': 'milk',
                    'variants': [
                        {'id': '2', 'normalized_name': 'milk (whole)', 'quantity': 1, 'unit': 'gallon'}
                    ]
                }
            ],
            'household_id': 'household-123'
        }
        
        # Execute
        response = client_with_services.get(
            '/api/pantry',
            headers={'X-User-Id': 'user-456'}
        )
        
        # Verify
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data['total_items'] == 5
        assert data['unique_ingredients'] == 3
        assert len(data['grouped']) == 2
    
    def test_get_pantry_empty(self, client_with_services, mock_pantry_service):
        """Test getting empty pantry"""
        # Setup
        mock_pantry_service.get_pantry_summary.return_value = {
            'total_items': 0,
            'unique_ingredients': 0,
            'items': [],
            'grouped': [],
            'household_id': None
        }
        
        # Execute
        response = client_with_services.get(
            '/api/pantry',
            headers={'X-User-Id': 'user-456'}
        )
        
        # Verify
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data['total_items'] == 0
    
    def test_get_pantry_no_user_id(self, client_with_services):
        """Test getting pantry without user ID"""
        response = client_with_services.get('/api/pantry')
        
        assert response.status_code == 401
        data = json.loads(response.data)
        assert 'error' in data
    
    # =========================================================================
    # POST /api/pantry/items tests
    # =========================================================================
    
    def test_add_pantry_item_success(self, client_with_services, mock_pantry_service):
        """Test adding a pantry item"""
        # Setup
        mock_pantry_service.add_to_pantry.return_value = 'item-123'
        
        # Execute
        response = client_with_services.post(
            '/api/pantry/items',
            data=json.dumps({
                'base_ingredient': 'butter',
                'variant': 'unsalted',
                'quantity': 2,
                'unit': 'count',
                'category': 'REFRIG/FROZEN'
            }),
            content_type='application/json',
            headers={'X-User-Id': 'user-456'}
        )
        
        # Verify
        assert response.status_code == 201
        data = json.loads(response.data)
        assert data['item_id'] == 'item-123'
        assert 'message' in data
    
    def test_add_pantry_item_missing_fields(self, client_with_services):
        """Test adding item with missing required fields"""
        # Execute - missing quantity
        response = client_with_services.post(
            '/api/pantry/items',
            data=json.dumps({
                'base_ingredient': 'butter',
                'unit': 'count'
            }),
            content_type='application/json',
            headers={'X-User-Id': 'user-456'}
        )
        
        # Verify
        assert response.status_code == 400
        data = json.loads(response.data)
        assert 'error' in data
        assert 'quantity' in data['error'].lower()
    
    def test_add_pantry_item_invalid_quantity(self, client_with_services):
        """Test adding item with invalid quantity"""
        response = client_with_services.post(
            '/api/pantry/items',
            data=json.dumps({
                'base_ingredient': 'butter',
                'quantity': 'not-a-number',
                'unit': 'count'
            }),
            content_type='application/json',
            headers={'X-User-Id': 'user-456'}
        )
        
        assert response.status_code == 400
        data = json.loads(response.data)
        assert 'error' in data
    
    def test_add_pantry_item_no_user_id(self, client_with_services):
        """Test adding item without user ID"""
        response = client_with_services.post(
            '/api/pantry/items',
            data=json.dumps({
                'base_ingredient': 'butter',
                'quantity': 2,
                'unit': 'count'
            }),
            content_type='application/json'
        )
        
        assert response.status_code == 401
    
    # =========================================================================
    # PUT /api/pantry/items/<id> tests
    # =========================================================================
    
    def test_update_pantry_item_success(self, client_with_services, mock_supabase_service):
        """Test updating pantry item quantity"""
        # Execute
        response = client_with_services.put(
            '/api/pantry/items/item-123',
            data=json.dumps({'quantity': 5}),
            content_type='application/json',
            headers={'X-User-Id': 'user-456'}
        )
        
        # Verify
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data['quantity'] == 5
        mock_supabase_service.update_pantry_quantity.assert_called_once_with('item-123', 5)
    
    def test_update_pantry_item_missing_quantity(self, client_with_services):
        """Test updating without quantity"""
        response = client_with_services.put(
            '/api/pantry/items/item-123',
            data=json.dumps({}),
            content_type='application/json',
            headers={'X-User-Id': 'user-456'}
        )
        
        assert response.status_code == 400
        data = json.loads(response.data)
        assert 'error' in data
    
    def test_update_pantry_item_negative_quantity(self, client_with_services):
        """Test updating with negative quantity"""
        response = client_with_services.put(
            '/api/pantry/items/item-123',
            data=json.dumps({'quantity': -5}),
            content_type='application/json',
            headers={'X-User-Id': 'user-456'}
        )
        
        assert response.status_code == 400
        data = json.loads(response.data)
        assert 'error' in data
    
    # =========================================================================
    # DELETE /api/pantry/items/<id> tests
    # =========================================================================
    
    def test_delete_pantry_item_success(self, client_with_services, mock_supabase_service):
        """Test deleting pantry item"""
        # Execute
        response = client_with_services.delete(
            '/api/pantry/items/item-123',
            headers={'X-User-Id': 'user-456'}
        )
        
        # Verify
        assert response.status_code == 200
        mock_supabase_service.delete_pantry_item.assert_called_once_with('item-123')
    
    def test_delete_pantry_item_no_user_id(self, client_with_services):
        """Test deleting without user ID"""
        response = client_with_services.delete('/api/pantry/items/item-123')
        
        assert response.status_code == 401
    
    # =========================================================================
    # POST /api/pantry/consume tests
    # =========================================================================
    
    def test_consume_ingredients_success(self, client_with_services, mock_pantry_service):
        """Test consuming ingredients for a recipe"""
        # Setup
        mock_pantry_service.consume_ingredients.return_value = {
            'log_id': 'log-123',
            'consumed': [
                {'ingredient': 'butter (unsalted)', 'amount_used': 0.5, 'remaining': 1.5, 'unit': 'lb'}
            ],
            'warnings': []
        }
        
        # Execute
        response = client_with_services.post(
            '/api/pantry/consume',
            data=json.dumps({
                'recipe_id': 'recipe-123',
                'recipe_name': 'Chocolate Chip Cookies',
                'servings': 24,
                'ingredients': [
                    {'name': 'butter (unsalted)', 'amount': 0.5, 'unit': 'lb'},
                    {'name': 'sugar', 'amount': 1, 'unit': 'cup'}
                ]
            }),
            content_type='application/json',
            headers={'X-User-Id': 'user-456'}
        )
        
        # Verify
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data['log_id'] == 'log-123'
        assert len(data['consumed']) == 1
    
    def test_consume_ingredients_missing_fields(self, client_with_services):
        """Test consuming with missing required fields"""
        response = client_with_services.post(
            '/api/pantry/consume',
            data=json.dumps({
                'recipe_name': 'Test Recipe',
                'servings': 4
                # Missing recipe_id and ingredients
            }),
            content_type='application/json',
            headers={'X-User-Id': 'user-456'}
        )
        
        assert response.status_code == 400
        data = json.loads(response.data)
        assert 'error' in data
    
    def test_consume_ingredients_invalid_servings(self, client_with_services):
        """Test consuming with invalid servings"""
        response = client_with_services.post(
            '/api/pantry/consume',
            data=json.dumps({
                'recipe_id': 'recipe-123',
                'recipe_name': 'Test Recipe',
                'servings': 0,
                'ingredients': []
            }),
            content_type='application/json',
            headers={'X-User-Id': 'user-456'}
        )
        
        assert response.status_code == 400
    
    # =========================================================================
    # POST /api/pantry/check-recipe tests
    # =========================================================================
    
    def test_check_recipe_availability_success(self, client_with_services, mock_pantry_service):
        """Test checking recipe availability"""
        # Setup
        mock_pantry_service.check_ingredient_availability.return_value = {
            'can_make': True,
            'can_make_with_substitutions': True,
            'available': [
                {'ingredient': 'butter (unsalted)', 'required': 0.5, 'available': 2, 'unit': 'lb'}
            ],
            'insufficient': [],
            'missing': [],
            'substitutable': [],
            'household_id': 'household-123'
        }
        
        # Execute
        response = client_with_services.post(
            '/api/pantry/check-recipe',
            data=json.dumps({
                'ingredients': [
                    {'name': 'butter (unsalted)', 'amount': 0.5, 'unit': 'lb'}
                ]
            }),
            content_type='application/json',
            headers={'X-User-Id': 'user-456'}
        )
        
        # Verify
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data['can_make'] is True
        assert len(data['available']) == 1
    
    def test_check_recipe_cannot_make(self, client_with_services, mock_pantry_service):
        """Test checking recipe that cannot be made"""
        # Setup
        mock_pantry_service.check_ingredient_availability.return_value = {
            'can_make': False,
            'can_make_with_substitutions': False,
            'available': [],
            'insufficient': [],
            'missing': [
                {'ingredient': 'saffron', 'required': 1, 'unit': 'tsp'}
            ],
            'substitutable': [],
            'household_id': 'household-123'
        }
        
        # Execute
        response = client_with_services.post(
            '/api/pantry/check-recipe',
            data=json.dumps({
                'ingredients': [
                    {'name': 'saffron', 'amount': 1, 'unit': 'tsp'}
                ]
            }),
            content_type='application/json',
            headers={'X-User-Id': 'user-456'}
        )
        
        # Verify
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data['can_make'] is False
        assert len(data['missing']) == 1
    
    def test_check_recipe_missing_ingredients_list(self, client_with_services):
        """Test checking recipe without ingredients list"""
        response = client_with_services.post(
            '/api/pantry/check-recipe',
            data=json.dumps({}),
            content_type='application/json',
            headers={'X-User-Id': 'user-456'}
        )
        
        assert response.status_code == 400
        data = json.loads(response.data)
        assert 'error' in data
    
    def test_check_recipe_invalid_ingredient_format(self, client_with_services):
        """Test checking recipe with invalid ingredient format"""
        response = client_with_services.post(
            '/api/pantry/check-recipe',
            data=json.dumps({
                'ingredients': [
                    {'name': 'butter'}  # Missing 'amount'
                ]
            }),
            content_type='application/json',
            headers={'X-User-Id': 'user-456'}
        )
        
        assert response.status_code == 400
