"""Pytest configuration and fixtures for GrocerySync tests"""

import pytest
from unittest.mock import Mock, MagicMock
from typing import Dict, List
from backend.services.supabase_service import SupabaseService
from backend.services.pantry_service import PantryService
from backend.services.normalization_service import NormalizationService
from backend.services.receipt_processor import ReceiptProcessor


@pytest.fixture
def mock_supabase():
    """Mock Supabase service for testing"""
    mock = Mock(spec=SupabaseService)
    mock.client = MagicMock()
    mock.admin_client = MagicMock()
    return mock


@pytest.fixture
def mock_pantry_service():
    """Mock Pantry service for testing"""
    return Mock(spec=PantryService)


@pytest.fixture
def mock_normalization_service():
    """Mock Normalization service for testing"""
    return Mock(spec=NormalizationService)


@pytest.fixture
def sample_receipt_items() -> List[Dict]:
    """Sample receipt items for testing"""
    return [
        {
            'id': '1',
            'receipt_id': 'receipt-123',
            'user_id': 'user-456',
            'raw_name': 'Land O Lakes Salted Butter 1 lb',
            'name': 'Land O Lakes Salted Butter 1 lb',
            'category': 'REFRIG/FROZEN',
            'price': 4.99,
            'quantity': 1,
            'unit_price': 4.99,
            'quantity_info': {'amount': 1, 'unit': 'lb'}
        },
        {
            'id': '2',
            'receipt_id': 'receipt-123',
            'user_id': 'user-456',
            'raw_name': 'Lucerne Whole Milk 1 Gallon',
            'name': 'Lucerne Whole Milk 1 Gallon',
            'category': 'REFRIG/FROZEN',
            'price': 3.49,
            'quantity': 1,
            'unit_price': 3.49,
            'quantity_info': {'amount': 1, 'unit': 'gallon'}
        }
    ]


@pytest.fixture
def sample_normalized_product() -> Dict:
    """Sample normalized product for testing"""
    return {
        'base_ingredient': 'butter',
        'variant': 'salted',
        'normalized_name': 'butter (salted)',
        'product_type': 'dairy product',
        'category': 'dairy',
        'tags': ['salted', 'dairy'],
        'quantity_info': {'amount': 1, 'unit': 'lb'},
        'confidence_score': 0.9,
        'source': 'test',
        'verified': False
    }


@pytest.fixture
def sample_pantry_items() -> List[Dict]:
    """Sample pantry items for testing"""
    return [
        {
            'id': 'pantry-1',
            'user_id': 'user-456',
            'base_ingredient': 'butter',
            'variant': 'salted',
            'normalized_name': 'butter (salted)',
            'quantity': 1.0,
            'unit': 'lb',
            'category': 'dairy',
            'tags': ['salted']
        },
        {
            'id': 'pantry-2',
            'user_id': 'user-456',
            'base_ingredient': 'milk',
            'variant': 'whole',
            'normalized_name': 'milk (whole)',
            'quantity': 1.0,
            'unit': 'gallon',
            'category': 'dairy',
            'tags': ['whole']
        }
    ]


@pytest.fixture
def sample_substitutions() -> List[Dict]:
    """Sample ingredient substitutions for testing"""
    return [
        {
            'id': 'sub-1',
            'ingredient': 'butter (unsalted)',
            'substitute': 'butter (salted)',
            'substitution_type': 'variant',
            'ratio': 1.0,
            'acceptable': False,
            'notes': 'Not recommended for baking',
            'confidence': 0.9
        },
        {
            'id': 'sub-2',
            'ingredient': 'sour cream',
            'substitute': 'greek yogurt',
            'substitution_type': 'ingredient',
            'ratio': 1.0,
            'acceptable': True,
            'notes': 'Works well in most recipes',
            'confidence': 0.85
        }
    ]


@pytest.fixture
def test_user_id() -> str:
    """Test user ID"""
    return 'test-user-123'


@pytest.fixture
def test_receipt_id() -> str:
    """Test receipt ID"""
    return 'test-receipt-456'


@pytest.fixture
def test_household_id() -> str:
    """Test household ID"""
    return 'test-household-789'


@pytest.fixture
def sample_household() -> Dict:
    """Sample household data for testing"""
    return {
        'id': 'test-household-789',
        'name': 'Test Family',
        'join_code': 'ABC123',
        'created_by': 'test-user-123',
        'created_at': '2025-01-01T00:00:00Z',
        'role': 'owner',
        'joined_at': '2025-01-01T00:00:00Z'
    }


@pytest.fixture
def sample_household_members() -> List[Dict]:
    """Sample household members for testing"""
    return [
        {
            'id': 'member-1',
            'household_id': 'test-household-789',
            'user_id': 'test-user-123',
            'role': 'owner',
            'joined_at': '2025-01-01T00:00:00Z'
        },
        {
            'id': 'member-2',
            'household_id': 'test-household-789',
            'user_id': 'test-user-456',
            'role': 'member',
            'joined_at': '2025-01-02T00:00:00Z'
        }
    ]


@pytest.fixture
def mock_household_service():
    """Mock Household service for testing"""
    from backend.services.household_service import HouseholdService
    return Mock(spec=HouseholdService)