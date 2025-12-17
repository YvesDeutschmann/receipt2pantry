"""Tests for AI Service"""

import pytest
from unittest.mock import Mock, MagicMock, patch
from backend.services.ai_service import AIService, create_ai_service
from backend.utils.exceptions import AIServiceException, AIRateLimitException


class TestAIService:
    """Test cases for AIService"""
    
    @pytest.fixture
    def mock_config(self):
        """Create mock config with OpenAI settings"""
        config = Mock()
        config.OPENAI_API_KEY = "test-api-key"
        config.OPENAI_MODEL = "gpt-4o-mini"
        config.OPENAI_BATCH_SIZE = 20
        config.OPENAI_TIMEOUT = 60
        return config
    
    @pytest.fixture
    def mock_config_no_key(self):
        """Create mock config without API key"""
        config = Mock()
        config.OPENAI_API_KEY = None
        config.OPENAI_MODEL = "gpt-4o-mini"
        config.OPENAI_BATCH_SIZE = 20
        config.OPENAI_TIMEOUT = 60
        return config
    
    def test_init_with_api_key(self, mock_config):
        """Test initialization with valid API key"""
        with patch('backend.services.ai_service.OpenAI'):
            service = AIService(mock_config)
            assert service.is_available is True
            assert service.total_tokens_used == 0
            assert service.total_requests == 0
    
    def test_init_without_api_key(self, mock_config_no_key):
        """Test initialization without API key"""
        service = AIService(mock_config_no_key)
        assert service.is_available is False
        assert service.client is None
    
    def test_get_usage_stats(self, mock_config):
        """Test usage statistics tracking"""
        with patch('backend.services.ai_service.OpenAI'):
            service = AIService(mock_config)
            service.total_tokens_used = 1000
            service.total_requests = 5
            
            stats = service.get_usage_stats()
            
            assert stats["total_tokens_used"] == 1000
            assert stats["total_requests"] == 5
            assert "estimated_cost_usd" in stats
    
    def test_estimate_cost(self, mock_config):
        """Test cost estimation calculation"""
        with patch('backend.services.ai_service.OpenAI'):
            service = AIService(mock_config)
            service.total_tokens_used = 1_000_000  # 1M tokens
            
            # 70% input + 30% output estimate
            # (700000 * 0.15 / 1M) + (300000 * 0.60 / 1M) = 0.105 + 0.18 = 0.285
            cost = service._estimate_cost()
            assert cost == pytest.approx(0.285, rel=0.01)
    
    @patch('backend.services.ai_service.OpenAI')
    def test_parse_receipt_success(self, mock_openai_class, mock_config):
        """Test successful receipt parsing"""
        # Setup mock response
        mock_client = MagicMock()
        mock_openai_class.return_value = mock_client
        
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = '''
        {
            "store_name": "safeway",
            "order_id": "12345A6",
            "order_date": "2024-12-14",
            "items": [
                {
                    "name": "Butter",
                    "raw_name": "Land O Lakes Butter 1lb",
                    "price": 4.99,
                    "quantity": 1,
                    "category": "DAIRY"
                }
            ],
            "subtotal": 4.99,
            "tax": 0.45,
            "total": 5.44
        }
        '''
        mock_response.usage = MagicMock()
        mock_response.usage.total_tokens = 500
        mock_client.chat.completions.create.return_value = mock_response
        
        service = AIService(mock_config)
        result = service.parse_receipt("Test email content")
        
        assert result["store_name"] == "safeway"
        assert result["order_id"] == "12345A6"
        assert len(result["items"]) == 1
        assert result["items"][0]["name"] == "Butter"
        assert service.total_tokens_used == 500
        assert service.total_requests == 1
    
    @patch('backend.services.ai_service.OpenAI')
    def test_normalize_products_batch_success(self, mock_openai_class, mock_config):
        """Test successful batch product normalization"""
        mock_client = MagicMock()
        mock_openai_class.return_value = mock_client
        
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = '''
        {
            "products": [
                {
                    "raw_name": "Land O Lakes Butter 1lb",
                    "base_ingredient": "butter",
                    "variant": "salted",
                    "normalized_name": "butter (salted)",
                    "product_type": "dairy product",
                    "category": "dairy",
                    "tags": ["salted"]
                }
            ]
        }
        '''
        mock_response.usage = MagicMock()
        mock_response.usage.total_tokens = 300
        mock_client.chat.completions.create.return_value = mock_response
        
        service = AIService(mock_config)
        products = [{"raw_name": "Land O Lakes Butter 1lb", "category": "DAIRY"}]
        result = service.normalize_products_batch(products)
        
        assert len(result) == 1
        assert result[0]["base_ingredient"] == "butter"
        assert result[0]["variant"] == "salted"
        assert result[0]["confidence_score"] == 0.95
        assert result[0]["source"] == "openai"
    
    @patch('backend.services.ai_service.OpenAI')
    def test_normalize_empty_batch(self, mock_openai_class, mock_config):
        """Test normalizing empty batch returns empty list"""
        mock_openai_class.return_value = MagicMock()
        
        service = AIService(mock_config)
        result = service.normalize_products_batch([])
        
        assert result == []
    
    @patch('backend.services.ai_service.OpenAI')
    def test_detect_store_success(self, mock_openai_class, mock_config):
        """Test successful store detection"""
        mock_client = MagicMock()
        mock_openai_class.return_value = mock_client
        
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "safeway"
        mock_response.usage = None
        mock_client.chat.completions.create.return_value = mock_response
        
        service = AIService(mock_config)
        result = service.detect_store("Receipt from Safeway...")
        
        assert result == "safeway"
    
    @patch('backend.services.ai_service.OpenAI')
    def test_detect_store_unknown(self, mock_openai_class, mock_config):
        """Test store detection returns None for unknown"""
        mock_client = MagicMock()
        mock_openai_class.return_value = mock_client
        
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "unknown"
        mock_response.usage = None
        mock_client.chat.completions.create.return_value = mock_response
        
        service = AIService(mock_config)
        result = service.detect_store("Random email content")
        
        assert result is None
    
    def test_call_openai_without_client(self, mock_config_no_key):
        """Test calling OpenAI without client raises exception"""
        service = AIService(mock_config_no_key)
        
        with pytest.raises(AIServiceException) as exc_info:
            service._call_openai([{"role": "user", "content": "test"}])
        
        assert "not initialized" in str(exc_info.value)
    
    @patch('backend.services.ai_service.OpenAI')
    def test_rate_limit_error(self, mock_openai_class, mock_config):
        """Test rate limit error is properly raised"""
        from openai import RateLimitError
        
        mock_client = MagicMock()
        mock_openai_class.return_value = mock_client
        
        # Create a proper RateLimitError
        mock_client.chat.completions.create.side_effect = RateLimitError(
            message="Rate limit exceeded",
            response=MagicMock(),
            body={}
        )
        
        service = AIService(mock_config)
        
        with pytest.raises(AIRateLimitException):
            service._call_openai([{"role": "user", "content": "test"}])


class TestCreateAIService:
    """Test the factory function"""
    
    def test_create_ai_service_with_config(self):
        """Test creating AI service with config"""
        config = Mock()
        config.OPENAI_API_KEY = None
        config.OPENAI_MODEL = "gpt-4o-mini"
        config.OPENAI_BATCH_SIZE = 20
        config.OPENAI_TIMEOUT = 60
        
        service = create_ai_service(config)
        
        assert isinstance(service, AIService)
        assert service.is_available is False
    
    def test_create_ai_service_without_config(self):
        """Test creating AI service uses default config"""
        with patch('backend.services.ai_service.Config') as mock_config:
            mock_config.OPENAI_API_KEY = None
            mock_config.OPENAI_MODEL = "gpt-4o-mini"
            mock_config.OPENAI_BATCH_SIZE = 20
            mock_config.OPENAI_TIMEOUT = 60
            
            service = create_ai_service()
            
            assert isinstance(service, AIService)

