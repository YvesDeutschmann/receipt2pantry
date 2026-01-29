"""Tests for NormalizationService"""

import pytest
from unittest.mock import Mock
from backend.services.normalization_service import NormalizationService
from backend.services.ai_service import AIService


class TestNormalizationService:
    """Test cases for NormalizationService"""
    
    def test_normalize_product_with_cache(self, mock_supabase, sample_normalized_product):
        """Test normalization with cache hit"""
        # Setup
        mock_supabase.get_product_mapping.return_value = sample_normalized_product
        
        service = NormalizationService(mock_supabase)
        
        # Execute
        result = service.normalize_product('Land O Lakes Salted Butter 1 lb', 'REFRIG/FROZEN')
        
        # Verify
        assert result['base_ingredient'] == 'butter'
        assert result['variant'] == 'salted'
        assert result['normalized_name'] == 'butter (salted)'
        mock_supabase.get_product_mapping.assert_called_once()
    
    def test_normalize_product_cache_miss(self, mock_supabase):
        """Test normalization with cache miss"""
        # Setup
        mock_supabase.get_product_mapping.return_value = None
        mock_supabase.store_product_mapping.return_value = 'mapping-1'
        
        service = NormalizationService(mock_supabase)
        
        # Execute
        result = service.normalize_product('Land O Lakes Salted Butter 1 lb', 'REFRIG/FROZEN')
        
        # Verify
        assert result['base_ingredient'] == 'butter'
        assert result['variant'] == 'salted'
        assert result['source'] == 'rule_based'
        mock_supabase.store_product_mapping.assert_called_once()
    
    def test_basic_normalization_butter_salted(self, mock_supabase):
        """Test basic normalization detects salted butter"""
        service = NormalizationService(mock_supabase)
        
        result = service._basic_normalization('Land O Lakes Salted Butter 1 lb', 'REFRIG/FROZEN')
        
        assert result['base_ingredient'] == 'butter'
        assert result['variant'] == 'salted'
        assert result['normalized_name'] == 'butter (salted)'
        assert 'salted' in result['tags']
    
    def test_basic_normalization_butter_unsalted(self, mock_supabase):
        """Test basic normalization detects unsalted butter"""
        service = NormalizationService(mock_supabase)
        
        result = service._basic_normalization('Land O Lakes Unsalted Butter 1 lb', 'REFRIG/FROZEN')
        
        assert result['base_ingredient'] == 'butter'
        assert result['variant'] == 'unsalted'
        assert result['normalized_name'] == 'butter (unsalted)'
        assert 'unsalted' in result['tags']
    
    def test_basic_normalization_milk_whole(self, mock_supabase):
        """Test basic normalization detects whole milk"""
        service = NormalizationService(mock_supabase)
        
        result = service._basic_normalization('Lucerne Whole Milk 1 Gallon', 'REFRIG/FROZEN')
        
        assert result['base_ingredient'] == 'milk'
        assert result['variant'] == 'whole'
        assert result['normalized_name'] == 'milk (whole)'
        assert 'whole' in result['tags']
    
    def test_extract_quantity_info_oz(self, mock_supabase):
        """Test quantity extraction for ounces"""
        service = NormalizationService(mock_supabase)
        
        result = service._extract_quantity_info('Cream Cheese 8 Oz')
        
        assert result is not None
        assert result['amount'] == 8
        assert result['unit'] == 'oz'
    
    def test_extract_quantity_info_lb(self, mock_supabase):
        """Test quantity extraction for pounds"""
        service = NormalizationService(mock_supabase)
        
        result = service._extract_quantity_info('Butter 1 lb')
        
        assert result is not None
        assert result['amount'] == 1
        assert result['unit'] == 'lb'
    
    def test_extract_quantity_info_hyphenated(self, mock_supabase):
        """Test quantity extraction for hyphenated format"""
        service = NormalizationService(mock_supabase)
        
        result = service._extract_quantity_info('Olipop Soda 4-12oz')
        
        assert result is not None
        assert result['amount'] == 12
        assert result['unit'] == 'oz'
    
    def test_extract_quantity_info_none(self, mock_supabase):
        """Test quantity extraction when no quantity present"""
        service = NormalizationService(mock_supabase)
        
        result = service._extract_quantity_info('Fresh Bread Loaf')
        
        assert result is None


class TestBatchNormalization:
    """Test cases for batch normalization with AI"""
    
    @pytest.fixture
    def mock_ai_service(self):
        """Create mock AI service"""
        service = Mock(spec=AIService)
        service.is_available = True
        # Add config with batch size
        service.config = Mock()
        service.config.OPENAI_BATCH_SIZE = 20
        return service
    
    @pytest.fixture
    def sample_products(self):
        """Sample products for batch testing"""
        return [
            {"raw_name": "Land O Lakes Salted Butter 1 lb", "category": "DAIRY"},
            {"raw_name": "Lucerne Whole Milk 1 Gallon", "category": "DAIRY"},
            {"raw_name": "Organic Chicken Breast 1.5 lb", "category": "MEAT"},
        ]
    
    def test_batch_normalize_all_cache_hits(self, mock_supabase, sample_products):
        """Test batch normalization with all cache hits"""
        # All products are in cache
        cached_results = [
            {"base_ingredient": "butter", "variant": "salted", "source": "openai"},
            {"base_ingredient": "milk", "variant": "whole", "source": "openai"},
            {"base_ingredient": "chicken", "variant": None, "source": "openai"},
        ]
        mock_supabase.get_product_mapping.side_effect = cached_results
        
        service = NormalizationService(mock_supabase)
        results = service.normalize_products_batch(sample_products)
        
        assert len(results) == 3
        assert results[0]["base_ingredient"] == "butter"
        assert results[1]["base_ingredient"] == "milk"
        assert results[2]["base_ingredient"] == "chicken"
        # AI should not be called since all cache hits
    
    def test_batch_normalize_all_cache_misses_with_ai(
        self, mock_supabase, mock_ai_service, sample_products
    ):
        """Test batch normalization with all cache misses using AI"""
        # No cache hits
        mock_supabase.get_product_mapping.return_value = None
        mock_supabase.store_product_mapping.return_value = "mapping-id"
        
        # AI returns normalized products
        mock_ai_service.normalize_products_batch.return_value = [
            {
                "raw_name": "Land O Lakes Salted Butter 1 lb",
                "base_ingredient": "butter",
                "variant": "salted",
                "normalized_name": "butter (salted)",
                "product_type": "dairy product",
                "category": "dairy",
                "tags": ["salted"],
                "confidence_score": 0.95,
                "source": "openai"
            },
            {
                "raw_name": "Lucerne Whole Milk 1 Gallon",
                "base_ingredient": "milk",
                "variant": "whole",
                "normalized_name": "milk (whole)",
                "product_type": "dairy product",
                "category": "dairy",
                "tags": ["whole"],
                "confidence_score": 0.95,
                "source": "openai"
            },
            {
                "raw_name": "Organic Chicken Breast 1.5 lb",
                "base_ingredient": "chicken breast",
                "variant": "organic",
                "normalized_name": "chicken breast (organic)",
                "product_type": "meat product",
                "category": "meat",
                "tags": ["organic", "boneless"],
                "confidence_score": 0.95,
                "source": "openai"
            }
        ]
        
        service = NormalizationService(mock_supabase, mock_ai_service)
        results = service.normalize_products_batch(sample_products, use_ai=True)
        
        assert len(results) == 3
        assert results[0]["source"] == "openai"
        assert results[0]["confidence_score"] == 0.95
        mock_ai_service.normalize_products_batch.assert_called_once()
        # Should store all 3 in database
        assert mock_supabase.store_product_mapping.call_count == 3
    
    def test_batch_normalize_mixed_cache(self, mock_supabase, mock_ai_service, sample_products):
        """Test batch normalization with some cache hits and some misses"""
        # First product cached, others not
        def get_mapping(raw_name):
            if raw_name == "Land O Lakes Salted Butter 1 lb":
                return {
                    "base_ingredient": "butter",
                    "variant": "salted",
                    "source": "openai"
                }
            return None
        
        mock_supabase.get_product_mapping.side_effect = get_mapping
        mock_supabase.store_product_mapping.return_value = "mapping-id"
        
        # AI returns for the 2 cache misses
        mock_ai_service.normalize_products_batch.return_value = [
            {
                "raw_name": "Lucerne Whole Milk 1 Gallon",
                "base_ingredient": "milk",
                "source": "openai"
            },
            {
                "raw_name": "Organic Chicken Breast 1.5 lb",
                "base_ingredient": "chicken",
                "source": "openai"
            }
        ]
        
        service = NormalizationService(mock_supabase, mock_ai_service)
        results = service.normalize_products_batch(sample_products, use_ai=True)
        
        assert len(results) == 3
        assert results[0]["base_ingredient"] == "butter"  # From cache
        assert results[1]["base_ingredient"] == "milk"    # From AI
        assert results[2]["base_ingredient"] == "chicken" # From AI
        
        # AI should only be called with 2 products
        call_args = mock_ai_service.normalize_products_batch.call_args[0][0]
        assert len(call_args) == 2
    
    def test_batch_normalize_without_ai(self, mock_supabase, sample_products):
        """Test batch normalization falls back to rules when AI not available"""
        mock_supabase.get_product_mapping.return_value = None
        mock_supabase.store_product_mapping.return_value = "mapping-id"
        
        # No AI service configured
        service = NormalizationService(mock_supabase, ai_service=None)
        results = service.normalize_products_batch(sample_products, use_ai=True)
        
        assert len(results) == 3
        assert results[0]["base_ingredient"] == "butter"
        assert results[0]["source"] == "rule_based"
        assert results[0]["confidence_score"] == 0.6
    
    def test_batch_normalize_ai_disabled(
        self, mock_supabase, mock_ai_service, sample_products
    ):
        """Test batch normalization with use_ai=False"""
        mock_supabase.get_product_mapping.return_value = None
        mock_supabase.store_product_mapping.return_value = "mapping-id"
        
        service = NormalizationService(mock_supabase, mock_ai_service)
        results = service.normalize_products_batch(sample_products, use_ai=False)
        
        assert len(results) == 3
        assert results[0]["source"] == "rule_based"
        mock_ai_service.normalize_products_batch.assert_not_called()
    
    def test_batch_normalize_ai_failure_fallback(
        self, mock_supabase, mock_ai_service, sample_products
    ):
        """Test fallback to rules when AI fails"""
        mock_supabase.get_product_mapping.return_value = None
        mock_supabase.store_product_mapping.return_value = "mapping-id"
        
        # AI raises exception
        mock_ai_service.normalize_products_batch.side_effect = Exception("API Error")
        
        service = NormalizationService(mock_supabase, mock_ai_service)
        results = service.normalize_products_batch(sample_products, use_ai=True)
        
        # Should fall back to rule-based
        assert len(results) == 3
        assert results[0]["source"] == "rule_based"
    
    def test_batch_normalize_empty_list(self, mock_supabase):
        """Test batch normalization with empty list"""
        service = NormalizationService(mock_supabase)
        results = service.normalize_products_batch([])
        
        assert results == []
    
    def test_set_ai_service(self, mock_supabase, mock_ai_service):
        """Test setting AI service after initialization"""
        service = NormalizationService(mock_supabase)
        assert service.ai_service is None
        
        service.set_ai_service(mock_ai_service)
        
        assert service.ai_service is mock_ai_service
    
    def test_batch_normalize_large_batch_exceeds_limit(self, mock_supabase, mock_ai_service):
        """Test batch normalization properly chunks when exceeding OPENAI_BATCH_SIZE"""
        # Create 25 products (exceeds default batch size of 20)
        large_products = [
            {"raw_name": f"Product {i}", "category": "GROCERY"}
            for i in range(25)
        ]
        
        # No cache hits
        mock_supabase.get_product_mapping.return_value = None
        mock_supabase.store_product_mapping.return_value = "mapping-id"
        
        # Configure mock AI service with batch size
        mock_ai_service.config = Mock()
        mock_ai_service.config.OPENAI_BATCH_SIZE = 10  # Small batch size for testing
        
        # AI returns normalized products for each batch call
        def mock_normalize_batch(products):
            return [
                {
                    "raw_name": p["raw_name"],
                    "base_ingredient": f"ingredient_{p['raw_name']}",
                    "normalized_name": f"normalized_{p['raw_name']}",
                    "source": "openai",
                    "confidence_score": 0.95
                }
                for p in products
            ]
        
        mock_ai_service.normalize_products_batch.side_effect = mock_normalize_batch
        
        service = NormalizationService(mock_supabase, mock_ai_service)
        results = service.normalize_products_batch(large_products, use_ai=True)
        
        # All 25 products should be normalized
        assert len(results) == 25
        assert all(r is not None for r in results), "No results should be None"
        assert all(r["source"] == "openai" for r in results)
        
        # AI should be called 3 times (10 + 10 + 5)
        assert mock_ai_service.normalize_products_batch.call_count == 3
        
        # Verify each result matches its original product
        for i, result in enumerate(results):
            assert result["raw_name"] == f"Product {i}"
            assert result["base_ingredient"] == f"ingredient_Product {i}"