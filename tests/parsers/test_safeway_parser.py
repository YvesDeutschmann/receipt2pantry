"""Tests for SafewayParser"""

import pytest
from backend.parsers.safeway_parser import SafewayParser


class TestSafewayParser:
    """Test cases for SafewayParser"""
    
    def setup_method(self):
        """Set up test fixtures"""
        self.parser = SafewayParser()
    
    def test_extract_quantity_info_oz(self):
        """Test extracting quantity in ounces"""
        result = self.parser._extract_quantity_info('Lucerne Cream Cheese Spread Whipped 8 Oz')
        
        assert result is not None
        assert result['amount'] == 8
        assert result['unit'] == 'oz'
    
    def test_extract_quantity_info_lb(self):
        """Test extracting quantity in pounds"""
        result = self.parser._extract_quantity_info('Land O Lakes Butter 1 lb')
        
        assert result is not None
        assert result['amount'] == 1
        assert result['unit'] == 'lb'
    
    def test_extract_quantity_info_hyphenated(self):
        """Test extracting quantity from hyphenated format"""
        result = self.parser._extract_quantity_info('Olipop Soda Prebiotic Ginger Ale 4-12fz')
        
        assert result is not None
        assert result['amount'] == 12
        assert result['unit'] == 'oz'
    
    def test_extract_quantity_info_count(self):
        """Test extracting count quantities"""
        result = self.parser._extract_quantity_info('Better Cheddar Bagels 6 Count')
        
        assert result is not None
        assert result['amount'] == 6
        assert result['unit'] == 'count'
    
    def test_extract_quantity_info_pack(self):
        """Test extracting pack quantities"""
        result = self.parser._extract_quantity_info('Seltzer Lime Fridge Pack 12 Pack')
        
        assert result is not None
        assert result['amount'] == 12
        assert result['unit'] == 'pack'
    
    def test_extract_quantity_info_decimal(self):
        """Test extracting decimal quantities"""
        result = self.parser._extract_quantity_info('Ground Beef 1.5 lb')
        
        assert result is not None
        assert result['amount'] == 1.5
        assert result['unit'] == 'lb'
    
    def test_extract_quantity_info_per_pound(self):
        """Test extracting from per-pound format"""
        result = self.parser._extract_quantity_info('Deviled Egg Potato Salad - 1.21lb @7.99/lb')
        
        assert result is not None
        assert result['amount'] == 1.21
        assert result['unit'] == 'lb'
    
    def test_extract_quantity_info_none(self):
        """Test extracting when no quantity present"""
        result = self.parser._extract_quantity_info('Fresh Bread Loaf')
        
        assert result is None
    
    def test_is_category_header_grocery(self):
        """Test category header detection for GROCERY"""
        assert self.parser._is_category_header('GROCERY') is True
    
    def test_is_category_header_baked_goods(self):
        """Test category header detection for BAKED GOODS"""
        assert self.parser._is_category_header('BAKED GOODS') is True
    
    def test_is_category_header_not_category(self):
        """Test category header detection for non-category"""
        assert self.parser._is_category_header('Product Name') is False
    
    def test_parse_with_quantity_info(self):
        """Test that parse includes quantity_info in items"""
        # Sample receipt with minimal data
        sample_receipt = """
Content-Type: text/plain

Thanks for shopping with Safeway!

Here is your receipt from 08/18/2025.

Order Details

Reference Number
1234567890123

GROCERY

Olipop Soda Prebiotic Ginger Ale 4-12fz

$7.99

Quantity: 1

REFRIG/FROZEN

Lucerne Cream Cheese Spread Whipped 8 Oz

$5.00

Quantity: 2

Total Items (3)

$17.99

--tqWfdDQPx0Nv=_?:
Content-Type: text/html
"""
        
        result = self.parser.parse(sample_receipt)
        
        # Verify
        assert 'items' in result
        items = result['items']
        
        # Check first item has quantity_info
        olipop_items = [i for i in items if 'Olipop' in i['name']]
        if olipop_items:
            olipop = olipop_items[0]
            assert 'quantity_info' in olipop
            assert olipop['quantity_info'] is not None
            assert olipop['quantity_info']['amount'] == 12
            assert olipop['quantity_info']['unit'] == 'oz'
        
        # Check second item has quantity_info
        cheese_items = [i for i in items if 'Cream Cheese' in i['name']]
        if cheese_items:
            cheese = cheese_items[0]
            assert 'quantity_info' in cheese
            assert cheese['quantity_info'] is not None
            assert cheese['quantity_info']['amount'] == 8
            assert cheese['quantity_info']['unit'] == 'oz'
    
    def test_parse_includes_unit_price(self):
        """Test that parse includes unit_price in items"""
        sample_receipt = """
Content-Type: text/plain

Thanks for shopping with Safeway!

Here is your receipt from 08/18/2025.

Reference Number
1234567890123

GROCERY

Test Product

$10.00

Quantity: 2

Total Items (2)

--tqWfdDQPx0Nv=_?:
"""
        
        result = self.parser.parse(sample_receipt)
        
        # Verify
        assert 'items' in result
        items = result['items']
        
        if items:
            item = items[0]
            assert 'unit_price' in item
            # unit_price should be price / quantity = 10 / 2 = 5
            if item['unit_price'] is not None:
                assert item['unit_price'] == 5.0


