"""Tests for NormalizationService"""

import pytest
from backend.services.normalization_service import NormalizationService


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


