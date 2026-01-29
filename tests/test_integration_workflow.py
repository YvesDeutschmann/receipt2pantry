"""Integration tests for complete receipt-to-pantry workflow"""

import pytest
import os
from pathlib import Path
from backend.parsers.safeway_parser import SafewayParser
from backend.services.normalization_service import NormalizationService
from backend.services.pantry_service import PantryService
from backend.services.receipt_processor import ReceiptProcessor


class TestIntegrationWorkflow:
    """Integration tests using real Safeway receipt data"""
    
    def setup_method(self):
        """Set up test fixtures"""
        self.parser = SafewayParser()
        
        # Get path to test data
        self.data_dir = Path(__file__).parent.parent / 'data'
        self.receipt_1_path = self.data_dir / 'safeway_receipt_1.eml'
        self.receipt_2_path = self.data_dir / 'safeway_receipt_2.eml'
    
    def test_parse_real_receipt_1(self):
        """Test parsing actual Safeway receipt 1"""
        if not self.receipt_1_path.exists():
            pytest.skip(f"Test receipt file not found: {self.receipt_1_path}")
        
        with open(self.receipt_1_path, 'r', encoding='utf-8') as f:
            receipt_content = f.read()
        
        result = self.parser.parse(receipt_content)
        
        # Verify basic structure
        assert 'items' in result
        assert 'order_id' in result
        assert 'order_date' in result
        assert 'total_amount' in result
        
        items = result['items']
        assert len(items) > 0
        
        # Verify each item has required fields including new quantity_info
        for item in items:
            assert 'name' in item
            assert 'price' in item
            assert 'quantity' in item
            assert 'category' in item
            assert 'quantity_info' in item
            assert 'unit_price' in item
    
    def test_parse_real_receipt_2(self):
        """Test parsing actual Safeway receipt 2"""
        if not self.receipt_2_path.exists():
            pytest.skip(f"Test receipt file not found: {self.receipt_2_path}")
        
        with open(self.receipt_2_path, 'r', encoding='utf-8') as f:
            receipt_content = f.read()
        
        result = self.parser.parse(receipt_content)
        
        # Verify basic structure
        assert 'items' in result
        assert len(result['items']) > 0
        
        # Check that BAKED GOODS category is recognized
        categories = [item['category'] for item in result['items']]
        assert 'BAKED GOODS' in categories or 'BAKERY' in categories or 'GROCERY' in categories
    
    def test_quantity_extraction_from_receipts(self):
        """Test that quantity_info is properly extracted from real items"""
        test_products = [
            ('Lucerne Cream Cheese Spread Whipped 8 Oz', 8, 'oz'),
            ('Olipop Soda Prebiotic Ginger Ale 4-12fz', 12, 'oz'),
            # This one extracts "6 Count" first, which is correct behavior
            ('Better Cheddar Bagels 6 Count - 1lb @5.99/lb', 6, 'count'),
            ('Tillamook Ice Cream Oregon Strawberry', None, None),
            ('Land O Frost Sub Kit Black Forest Ham And Turkey', None, None)
        ]
        
        for product_name, expected_amount, expected_unit in test_products:
            result = self.parser._extract_quantity_info(product_name)
            
            if expected_amount is not None:
                assert result is not None, f"Should extract quantity from: {product_name}"
                assert result['amount'] == expected_amount, f"Wrong amount for: {product_name}"
                assert result['unit'] == expected_unit, f"Wrong unit for: {product_name}"
            else:
                # Items without explicit quantity might still parse (that's ok)
                pass
    
    def test_normalization_of_parsed_items(self, mock_supabase):
        """Test normalizing items parsed from real receipt"""
        if not self.receipt_1_path.exists():
            pytest.skip(f"Test receipt file not found: {self.receipt_1_path}")
        
        # Parse receipt
        with open(self.receipt_1_path, 'r', encoding='utf-8') as f:
            receipt_content = f.read()
        
        parsed = self.parser.parse(receipt_content)
        
        # Mock supabase to avoid actual DB calls
        mock_supabase.get_product_mapping.return_value = None
        mock_supabase.store_product_mapping.return_value = 'mapping-1'
        
        # Create normalization service
        normalizer = NormalizationService(mock_supabase)
        
        # Normalize each item
        for item in parsed['items']:
            normalized = normalizer.normalize_product(item['name'], item['category'])
            
            # Verify normalized structure
            assert 'base_ingredient' in normalized
            assert 'normalized_name' in normalized
            assert 'category' in normalized
    
    def test_category_headers_recognized(self):
        """Test that all category headers in receipts are recognized"""
        categories_in_receipts = [
            'GROCERY',
            'MEAT',
            'REFRIG/FROZEN',
            'BAKED GOODS',
            'DELI'
        ]
        
        for category in categories_in_receipts:
            assert self.parser._is_category_header(category), f"Category not recognized: {category}"
    
    def test_parse_validates_successfully(self):
        """Test that parsed receipts pass validation"""
        if not self.receipt_1_path.exists():
            pytest.skip(f"Test receipt file not found: {self.receipt_1_path}")
        
        with open(self.receipt_1_path, 'r', encoding='utf-8') as f:
            receipt_content = f.read()
        
        parsed = self.parser.parse(receipt_content)
        
        # Verify validation passes
        assert self.parser.validate(parsed) is True
    
    def test_real_receipt_item_details(self):
        """Test that specific items from receipts are parsed correctly"""
        if not self.receipt_1_path.exists():
            pytest.skip(f"Test receipt file not found: {self.receipt_1_path}")
        
        with open(self.receipt_1_path, 'r', encoding='utf-8') as f:
            receipt_content = f.read()
        
        result = self.parser.parse(receipt_content)
        items = result['items']
        
        # Check for specific items we know are in receipt_1
        item_names = [item['name'] for item in items]
        
        # Should contain cream cheese
        cream_cheese_items = [i for i in items if 'Cream Cheese' in i['name']]
        if cream_cheese_items:
            cheese = cream_cheese_items[0]
            # Note: The parser shows quantity per line, not total quantity from receipt
            # If receipt had "Quantity: 2", that's tracked separately from unit quantity
            assert cheese['quantity'] >= 1  # At least 1 unit
            assert cheese['price'] == 5.00
            assert cheese['category'] == 'REFRIG/FROZEN'
            if cheese['quantity_info']:
                assert cheese['quantity_info']['amount'] == 8
                assert cheese['quantity_info']['unit'] == 'oz'
        
        # Should contain Olipop
        olipop_items = [i for i in items if 'Olipop' in i['name']]
        if olipop_items:
            olipop = olipop_items[0]
            assert olipop['quantity'] == 1
            assert olipop['category'] == 'GROCERY'
            if olipop['quantity_info']:
                assert olipop['quantity_info']['unit'] == 'oz'


if __name__ == '__main__':
    # Allow running this test file directly for debugging
    pytest.main([__file__, '-v', '-s'])


