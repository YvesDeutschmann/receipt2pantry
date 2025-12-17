"""Tests for AI Parser"""

import pytest
from unittest.mock import Mock, MagicMock, patch
from backend.parsers.ai_parser import AIParser, SmartParser
from backend.services.ai_service import AIService
from backend.utils.exceptions import ParserException


class TestAIParser:
    """Test cases for AIParser"""
    
    @pytest.fixture
    def mock_ai_service(self):
        """Create mock AI service"""
        service = Mock(spec=AIService)
        service.is_available = True
        service.total_tokens_used = 0
        return service
    
    @pytest.fixture
    def mock_ai_service_unavailable(self):
        """Create mock AI service that is unavailable"""
        service = Mock(spec=AIService)
        service.is_available = False
        return service
    
    @pytest.fixture
    def sample_email_content(self):
        """Sample receipt email content"""
        return """
Content-Type: text/plain

GROCERY
Land O Lakes Butter 1lb
$4.99
Quantity: 1

REFRIG/FROZEN
Lucerne Whole Milk 1 Gallon
$3.49
Quantity: 1

Total Items: 2
Total: $8.48
"""
    
    @pytest.fixture
    def sample_ai_parse_result(self):
        """Sample AI parsing result"""
        return {
            "store_name": "safeway",
            "order_id": "12345A6",
            "order_date": "2024-12-14",
            "items": [
                {
                    "name": "Butter",
                    "raw_name": "Land O Lakes Butter 1lb",
                    "price": 4.99,
                    "quantity": 1,
                    "category": "GROCERY",
                    "quantity_info": {"amount": 1, "unit": "lb"}
                },
                {
                    "name": "Milk",
                    "raw_name": "Lucerne Whole Milk 1 Gallon",
                    "price": 3.49,
                    "quantity": 1,
                    "category": "REFRIG/FROZEN",
                    "quantity_info": {"amount": 1, "unit": "gallon"}
                }
            ],
            "subtotal": 8.48,
            "tax": 0.00,
            "total": 8.48
        }
    
    def test_parser_name(self, mock_ai_service):
        """Test parser name property"""
        parser = AIParser(mock_ai_service)
        assert parser.parser_name == "ai"
    
    def test_parse_success(self, mock_ai_service, sample_email_content, sample_ai_parse_result):
        """Test successful parsing with AI"""
        mock_ai_service.parse_receipt.return_value = sample_ai_parse_result
        
        parser = AIParser(mock_ai_service)
        result = parser.parse(sample_email_content)
        
        assert result["order_id"] == "12345A6"
        assert result["order_date"] == "2024-12-14"
        assert len(result["items"]) == 2
        assert result["items"][0]["name"] == "Butter"
        assert result["items"][1]["name"] == "Milk"
        assert result["metadata"]["parser"] == "ai"
        assert result["metadata"]["store_name"] == "safeway"
    
    def test_parse_calculates_savings(self, mock_ai_service, sample_email_content):
        """Test that parser calculates savings from regular_price"""
        ai_result = {
            "order_id": "123",
            "order_date": "2024-12-14",
            "items": [
                {
                    "name": "Butter",
                    "price": 4.99,
                    "regular_price": 6.99,
                    "quantity": 1,
                    "category": "DAIRY"
                }
            ],
            "total": 4.99
        }
        mock_ai_service.parse_receipt.return_value = ai_result
        
        parser = AIParser(mock_ai_service)
        result = parser.parse(sample_email_content)
        
        assert result["items"][0]["savings"] == pytest.approx(2.00, rel=0.01)
    
    def test_parse_ai_unavailable_with_fallback(
        self, mock_ai_service_unavailable, sample_email_content
    ):
        """Test fallback to regex parser when AI unavailable"""
        parser = AIParser(mock_ai_service_unavailable)
        parser.set_fallback_parser("safeway")
        
        # Mock the ParserRegistry to return a working parser
        with patch('backend.parsers.ai_parser.ParserRegistry') as mock_registry:
            mock_fallback = Mock()
            mock_fallback.parse.return_value = {
                "order_id": "FALLBACK123",
                "order_date": "2024-12-14",
                "total_amount": 8.48,
                "items": [],
                "metadata": {"parser": "safeway"}
            }
            mock_registry.get_parser.return_value = mock_fallback
            
            result = parser.parse(sample_email_content)
            
            assert result["order_id"] == "FALLBACK123"
            mock_registry.get_parser.assert_called_with("safeway")
    
    def test_parse_ai_unavailable_no_fallback(
        self, mock_ai_service_unavailable, sample_email_content
    ):
        """Test exception when AI unavailable and no fallback"""
        parser = AIParser(mock_ai_service_unavailable)
        
        with pytest.raises(ParserException) as exc_info:
            parser.parse(sample_email_content)
        
        assert "no fallback" in str(exc_info.value)
    
    def test_validate_valid_data(self, mock_ai_service):
        """Test validation of valid parsed data"""
        parser = AIParser(mock_ai_service)
        
        valid_data = {
            "order_id": "123",
            "order_date": "2024-12-14",
            "total_amount": 10.00,
            "items": [
                {"name": "Product", "price": 5.00},
                {"name": "Product 2", "price": 5.00}
            ]
        }
        
        assert parser.validate(valid_data) is True
    
    def test_validate_missing_keys(self, mock_ai_service):
        """Test validation fails for missing required keys"""
        parser = AIParser(mock_ai_service)
        
        invalid_data = {
            "order_id": "123",
            "items": []
        }
        
        assert parser.validate(invalid_data) is False
    
    def test_validate_invalid_items_type(self, mock_ai_service):
        """Test validation fails when items is not a list"""
        parser = AIParser(mock_ai_service)
        
        invalid_data = {
            "order_id": "123",
            "order_date": "2024-12-14",
            "total_amount": 10.00,
            "items": "not a list"
        }
        
        assert parser.validate(invalid_data) is False
    
    def test_validate_low_item_validity(self, mock_ai_service):
        """Test validation fails when too many items are invalid"""
        parser = AIParser(mock_ai_service)
        
        data = {
            "order_id": "123",
            "order_date": "2024-12-14",
            "total_amount": 10.00,
            "items": [
                {"invalid": "item"},
                {"also": "invalid"},
                {"name": "Valid", "price": 5.00}  # Only 1 valid out of 3
            ]
        }
        
        # 33% valid < 50% threshold
        assert parser.validate(data) is False
    
    def test_extract_plain_text(self, mock_ai_service, sample_email_content):
        """Test plain text extraction from email"""
        parser = AIParser(mock_ai_service)
        
        plain_text = parser._extract_plain_text(sample_email_content)
        
        assert "Land O Lakes Butter" in plain_text
        assert "Lucerne Whole Milk" in plain_text
    
    def test_generate_order_id(self, mock_ai_service):
        """Test fallback order ID generation"""
        parser = AIParser(mock_ai_service)
        
        order_id = parser._generate_order_id()
        
        assert order_id.startswith("AI_")
        assert len(order_id) > 10


class TestSmartParser:
    """Test cases for SmartParser"""
    
    @pytest.fixture
    def mock_ai_service(self):
        """Create mock AI service"""
        service = Mock(spec=AIService)
        service.is_available = True
        return service
    
    @pytest.fixture
    def sample_email_content(self):
        """Sample email content"""
        return "Receipt from Safeway..."
    
    def test_smart_parser_uses_preferred(self, mock_ai_service, sample_email_content):
        """Test SmartParser uses preferred parser when available"""
        smart_parser = SmartParser(mock_ai_service)
        
        with patch('backend.parsers.ai_parser.ParserRegistry') as mock_registry:
            mock_registry.is_registered.return_value = True
            
            mock_parser = Mock()
            mock_parser.parse.return_value = {
                "order_id": "PREF123",
                "order_date": "2024-12-14",
                "total_amount": 10.00,
                "items": [{"name": "Test", "price": 10.00}]
            }
            mock_parser.validate.return_value = True
            mock_registry.get_parser.return_value = mock_parser
            
            result = smart_parser.parse(sample_email_content, preferred_parser="safeway")
            
            assert result["order_id"] == "PREF123"
            mock_registry.get_parser.assert_called_with("safeway")
    
    def test_smart_parser_detects_store(self, mock_ai_service, sample_email_content):
        """Test SmartParser detects store and uses appropriate parser"""
        mock_ai_service.detect_store.return_value = "safeway"
        smart_parser = SmartParser(mock_ai_service)
        
        with patch('backend.parsers.ai_parser.ParserRegistry') as mock_registry:
            mock_registry.is_registered.side_effect = lambda x: x == "safeway"
            
            mock_parser = Mock()
            mock_parser.parse.return_value = {
                "order_id": "STORE123",
                "order_date": "2024-12-14",
                "total_amount": 10.00,
                "items": [{"name": "Test", "price": 10.00}]
            }
            mock_parser.validate.return_value = True
            mock_registry.get_parser.return_value = mock_parser
            
            result = smart_parser.parse(sample_email_content)
            
            assert result["order_id"] == "STORE123"
    
    def test_smart_parser_falls_back_to_ai(self, mock_ai_service, sample_email_content):
        """Test SmartParser falls back to AI parser when store parser fails"""
        mock_ai_service.detect_store.return_value = None
        mock_ai_service.parse_receipt.return_value = {
            "order_id": "AI123",
            "order_date": "2024-12-14",
            "items": [{"name": "Test", "price": 10.00}],
            "total": 10.00
        }
        mock_ai_service.total_tokens_used = 100
        
        smart_parser = SmartParser(mock_ai_service)
        
        with patch('backend.parsers.ai_parser.ParserRegistry') as mock_registry:
            mock_registry.is_registered.return_value = False
            
            result = smart_parser.parse(sample_email_content)
            
            assert result["order_id"] == "AI123"

