"""Tests for backend.parsers.ai_parser.AIParser and SmartParser."""

import pytest
from unittest.mock import Mock, patch

from backend.parsers.ai_parser import AIParser, SmartParser
from backend.parsers.parser_registry import ParserRegistry
from backend.services.ai_service import AIService
from backend.utils.exceptions import AIServiceException, ParserException


@pytest.fixture
def mock_ai_service():
    service = Mock(spec=AIService)
    service.is_available = True
    service.total_tokens_used = 0
    return service


@pytest.fixture
def mock_ai_service_unavailable():
    service = Mock(spec=AIService)
    service.is_available = False
    return service


@pytest.fixture
def sample_email_content():
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
def sample_ai_parse_result():
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
                "quantity_info": {"amount": 1, "unit": "lb"},
            },
            {
                "name": "Milk",
                "raw_name": "Lucerne Whole Milk 1 Gallon",
                "price": 3.49,
                "quantity": 1,
                "category": "REFRIG/FROZEN",
                "quantity_info": {"amount": 1, "unit": "gallon"},
            },
        ],
        "subtotal": 8.48,
        "tax": 0.00,
        "total": 8.48,
    }


class TestAIParserHappyPath:
    def test_parse_returns_dict_in_expected_schema_from_mock_ai(
        self, mock_ai_service, sample_email_content, sample_ai_parse_result
    ):
        mock_ai_service.parse_receipt.return_value = sample_ai_parse_result
        parser = AIParser(mock_ai_service)
        result = parser.parse(sample_email_content)

        assert result["order_id"] == "12345A6"
        assert result["order_date"] == "2024-12-14"
        assert result["total_amount"] == pytest.approx(8.48)
        assert "num_items" in result
        assert len(result["items"]) == 2
        assert result["items"][0]["name"] == "Butter"
        assert result["metadata"]["parser"] == "ai"
        assert result["metadata"]["store_name"] == "safeway"

    def test_parse_calls_ai_service_exactly_once_on_success(
        self, mock_ai_service, sample_email_content, sample_ai_parse_result
    ):
        mock_ai_service.parse_receipt.return_value = sample_ai_parse_result
        parser = AIParser(mock_ai_service)
        parser.parse(sample_email_content)
        assert mock_ai_service.parse_receipt.call_count == 1


class TestAIParserFallback:
    def test_parse_delegates_to_fallback_on_ai_service_exception(
        self, mock_ai_service, sample_email_content
    ):
        mock_ai_service.parse_receipt.side_effect = AIServiceException("API down")
        parser = AIParser(mock_ai_service)
        parser.set_fallback_parser("safeway")

        with patch("backend.parsers.ai_parser.ParserRegistry") as mock_registry:
            mock_fallback = Mock()
            mock_fallback.parse.return_value = {
                "order_id": "FALLBACK123",
                "order_date": "2024-12-14",
                "total_amount": 8.48,
                "num_items": 1,
                "items": [{"name": "X", "price": 1.0, "quantity": 1, "category": "G"}],
                "metadata": {"parser": "safeway"},
            }
            mock_registry.get_parser.return_value = mock_fallback

            result = parser.parse(sample_email_content)
            assert result["order_id"] == "FALLBACK123"
            mock_registry.get_parser.assert_called_with("safeway")

    def test_parse_delegates_to_fallback_on_schema_mismatch(
        self, mock_ai_service, sample_email_content
    ):
        mock_ai_service.parse_receipt.return_value = {
            "order_id": "bad",
            "items": [],
        }
        parser = AIParser(mock_ai_service)
        parser.set_fallback_parser("safeway")

        with patch("backend.parsers.ai_parser.ParserRegistry") as mock_registry:
            mock_fallback = Mock()
            mock_fallback.parse.return_value = {
                "order_id": "FB2",
                "order_date": "2024-12-14",
                "total_amount": 1.0,
                "num_items": 1,
                "items": [{"name": "Y", "price": 1.0, "quantity": 1, "category": "G"}],
                "metadata": {"parser": "safeway"},
            }
            mock_registry.get_parser.return_value = mock_fallback

            result = parser.parse(sample_email_content)
            assert result["order_id"] == "FB2"

    def test_parse_reraises_when_no_fallback_configured(
        self, mock_ai_service, sample_email_content
    ):
        mock_ai_service.parse_receipt.side_effect = AIServiceException("fail")
        parser = AIParser(mock_ai_service)
        with pytest.raises(ParserException) as exc_info:
            parser.parse(sample_email_content)
        assert "no fallback" in str(exc_info.value).lower()

    def test_set_fallback_parser_raises_on_unregistered_name(self, mock_ai_service):
        parser = AIParser(mock_ai_service)
        with pytest.raises(ParserException) as exc_info:
            parser.set_fallback_parser("totally_unknown_parser_xyz")
        assert "not registered" in str(exc_info.value).lower()


class TestAIParserSchemaValidation:
    def test_ai_output_missing_order_id_raises_parser_exception(
        self, mock_ai_service, sample_email_content
    ):
        mock_ai_service.parse_receipt.return_value = {
            "items": [{"name": "A", "price": 1.0, "quantity": 1}],
        }
        parser = AIParser(mock_ai_service)
        with pytest.raises(ParserException) as exc_info:
            parser.parse(sample_email_content)
        assert "order_id" in str(exc_info.value).lower()

    def test_ai_output_with_empty_items_list_is_rejected(
        self, mock_ai_service, sample_email_content
    ):
        mock_ai_service.parse_receipt.return_value = {
            "order_id": "x",
            "items": [],
        }
        parser = AIParser(mock_ai_service)
        with pytest.raises(ParserException) as exc_info:
            parser.parse(sample_email_content)
        assert "items" in str(exc_info.value).lower()

    def test_ai_output_with_extra_unknown_fields_is_still_accepted(
        self, mock_ai_service, sample_email_content
    ):
        data = {
            "order_id": "EXTRA1",
            "order_date": "2024-12-14",
            "future_vendor_field": {"foo": "bar"},
            "items": [{"name": "A", "price": 2.0, "quantity": 1, "category": "G"}],
            "total": 2.0,
        }
        mock_ai_service.parse_receipt.return_value = data
        parser = AIParser(mock_ai_service)
        result = parser.parse(sample_email_content)
        assert result["order_id"] == "EXTRA1"
        assert len(result["items"]) == 1


class TestAIParserCostBudget:
    def test_parse_does_not_retry_beyond_ai_service_internal_retries(
        self, mock_ai_service, sample_email_content, sample_ai_parse_result
    ):
        mock_ai_service.parse_receipt.return_value = sample_ai_parse_result
        parser = AIParser(mock_ai_service)
        parser.parse(sample_email_content)
        assert mock_ai_service.parse_receipt.call_count == 1


class TestAIParserRegistryIntegration:
    def test_ai_parser_used_when_registered_provider_has_no_specific_parser(
        self, mock_ai_service, sample_email_content, sample_ai_parse_result
    ):
        """Callers without a store-specific parser resolve to the generic 'ai' parser."""

        provider_key = "unknown_store_without_dedicated_parser"
        assert not ParserRegistry.is_registered(provider_key)
        resolved = provider_key if ParserRegistry.is_registered(provider_key) else "ai"
        assert resolved == "ai"

        mock_ai_service.parse_receipt.return_value = sample_ai_parse_result
        parser = ParserRegistry.get_parser(resolved, ai_service=mock_ai_service)
        assert isinstance(parser, AIParser)
        out = parser.parse(sample_email_content)
        assert out["metadata"]["parser"] == "ai"


class TestAIParserMisc:
    def test_parser_name(self, mock_ai_service):
        assert AIParser(mock_ai_service).parser_name == "ai"

    def test_parse_calculates_savings(self, mock_ai_service, sample_email_content):
        ai_result = {
            "order_id": "123",
            "order_date": "2024-12-14",
            "items": [
                {
                    "name": "Butter",
                    "price": 4.99,
                    "regular_price": 6.99,
                    "quantity": 1,
                    "category": "DAIRY",
                }
            ],
            "total": 4.99,
        }
        mock_ai_service.parse_receipt.return_value = ai_result
        parser = AIParser(mock_ai_service)
        result = parser.parse(sample_email_content)
        assert result["items"][0]["savings"] == pytest.approx(2.00, rel=0.01)

    def test_parse_ai_unavailable_with_fallback(
        self, mock_ai_service_unavailable, sample_email_content
    ):
        parser = AIParser(mock_ai_service_unavailable)
        parser.set_fallback_parser("safeway")

        with patch("backend.parsers.ai_parser.ParserRegistry") as mock_registry:
            mock_fallback = Mock()
            mock_fallback.parse.return_value = {
                "order_id": "FALLBACK123",
                "order_date": "2024-12-14",
                "total_amount": 8.48,
                "num_items": 0,
                "items": [],
                "metadata": {"parser": "safeway"},
            }
            mock_registry.get_parser.return_value = mock_fallback

            result = parser.parse(sample_email_content)
            assert result["order_id"] == "FALLBACK123"

    def test_parse_ai_unavailable_no_fallback(
        self, mock_ai_service_unavailable, sample_email_content
    ):
        parser = AIParser(mock_ai_service_unavailable)
        with pytest.raises(ParserException) as exc_info:
            parser.parse(sample_email_content)
        assert "no fallback" in str(exc_info.value).lower()

    def test_validate_valid_data(self, mock_ai_service):
        parser = AIParser(mock_ai_service)
        valid_data = {
            "order_id": "123",
            "order_date": "2024-12-14",
            "total_amount": 10.00,
            "items": [
                {"name": "Product", "price": 5.00},
                {"name": "Product 2", "price": 5.00},
            ],
        }
        assert parser.validate(valid_data) is True

    def test_validate_missing_keys(self, mock_ai_service):
        parser = AIParser(mock_ai_service)
        invalid_data = {"order_id": "123", "items": []}
        assert parser.validate(invalid_data) is False

    def test_validate_invalid_items_type(self, mock_ai_service):
        parser = AIParser(mock_ai_service)
        invalid_data = {
            "order_id": "123",
            "order_date": "2024-12-14",
            "total_amount": 10.00,
            "items": "not a list",
        }
        assert parser.validate(invalid_data) is False

    def test_validate_low_item_validity(self, mock_ai_service):
        parser = AIParser(mock_ai_service)
        data = {
            "order_id": "123",
            "order_date": "2024-12-14",
            "total_amount": 10.00,
            "items": [
                {"invalid": "item"},
                {"also": "invalid"},
                {"name": "Valid", "price": 5.00},
            ],
        }
        assert parser.validate(data) is False

    def test_extract_plain_text(self, mock_ai_service, sample_email_content):
        parser = AIParser(mock_ai_service)
        plain_text = parser._extract_plain_text(sample_email_content)
        assert "Land O Lakes Butter" in plain_text
        assert "Lucerne Whole Milk" in plain_text

    def test_generate_order_id(self, mock_ai_service):
        parser = AIParser(mock_ai_service)
        order_id = parser._generate_order_id()
        assert order_id.startswith("AI_")
        assert len(order_id) > 10


class TestSmartParser:
    @pytest.fixture
    def mock_ai_service(self):
        service = Mock(spec=AIService)
        service.is_available = True
        return service

    @pytest.fixture
    def sample_email_content(self):
        return "Receipt from Safeway..."

    def test_smart_parser_uses_preferred(self, mock_ai_service, sample_email_content):
        smart_parser = SmartParser(mock_ai_service)

        with patch("backend.parsers.ai_parser.ParserRegistry") as mock_registry:
            mock_registry.is_registered.return_value = True

            mock_parser = Mock()
            mock_parser.parse.return_value = {
                "order_id": "PREF123",
                "order_date": "2024-12-14",
                "total_amount": 10.00,
                "items": [{"name": "Test", "price": 10.00}],
            }
            mock_parser.validate.return_value = True
            mock_registry.get_parser.return_value = mock_parser

            result = smart_parser.parse(sample_email_content, preferred_parser="safeway")

            assert result["order_id"] == "PREF123"
            mock_registry.get_parser.assert_called_with("safeway")

    def test_smart_parser_detects_store(self, mock_ai_service, sample_email_content):
        mock_ai_service.detect_store.return_value = "safeway"
        smart_parser = SmartParser(mock_ai_service)

        with patch("backend.parsers.ai_parser.ParserRegistry") as mock_registry:
            mock_registry.is_registered.side_effect = lambda x: x == "safeway"

            mock_parser = Mock()
            mock_parser.parse.return_value = {
                "order_id": "STORE123",
                "order_date": "2024-12-14",
                "total_amount": 10.00,
                "items": [{"name": "Test", "price": 10.00}],
            }
            mock_parser.validate.return_value = True
            mock_registry.get_parser.return_value = mock_parser

            result = smart_parser.parse(sample_email_content)

            assert result["order_id"] == "STORE123"

    def test_smart_parser_falls_back_to_ai(self, mock_ai_service, sample_email_content):
        mock_ai_service.detect_store.return_value = None
        mock_ai_service.parse_receipt.return_value = {
            "order_id": "AI123",
            "order_date": "2024-12-14",
            "items": [{"name": "Test", "price": 10.00, "quantity": 1, "category": "G"}],
            "total": 10.00,
        }
        mock_ai_service.total_tokens_used = 100

        smart_parser = SmartParser(mock_ai_service)

        with patch("backend.parsers.ai_parser.ParserRegistry") as mock_registry:
            mock_registry.is_registered.return_value = False

            result = smart_parser.parse(sample_email_content)

            assert result["order_id"] == "AI123"
