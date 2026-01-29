"""AI-powered receipt parser implementing BaseParser interface"""

from typing import Dict, List, Optional
from datetime import datetime

from backend.parsers.base_parser import BaseParser
from backend.parsers.parser_registry import register_parser, ParserRegistry
from backend.services.ai_service import AIService, create_ai_service
from backend.utils.exceptions import ParserException, AIServiceException
from backend.utils.logger import get_logger

logger = get_logger(__name__)


@register_parser("ai")
class AIParser(BaseParser):
    """AI-powered parser for any grocery receipt using OpenAI"""
    
    def __init__(self, ai_service: Optional[AIService] = None):
        """
        Initialize AIParser
        
        Args:
            ai_service: AIService instance (creates one if not provided)
        """
        self.ai_service = ai_service or create_ai_service()
        self._fallback_parser_name: Optional[str] = None
    
    @property
    def parser_name(self) -> str:
        return "ai"
    
    def set_fallback_parser(self, parser_name: str) -> None:
        """
        Set a fallback parser to use if AI parsing fails
        
        Args:
            parser_name: Name of the fallback parser (e.g., 'safeway')
        """
        self._fallback_parser_name = parser_name
    
    def parse(self, raw_data: str) -> Dict:
        """
        Parse receipt using AI
        
        Args:
            raw_data: Raw email content
        
        Returns:
            Dictionary with parsed receipt data
        
        Raises:
            ParserException: If parsing fails
        """
        try:
            logger.info("Parsing receipt with AI")
            
            if not self.ai_service.is_available:
                logger.warning("AI service not available, attempting fallback")
                return self._try_fallback(raw_data)
            
            # Extract plain text content
            plain_text = self._extract_plain_text(raw_data)
            
            if not plain_text:
                logger.warning("Could not extract plain text, using raw data")
                plain_text = raw_data
            
            # Parse with AI
            ai_result = self.ai_service.parse_receipt(plain_text)
            
            # Transform to standard format
            parsed_data = self._transform_ai_result(ai_result, raw_data)
            
            logger.info(
                f"AI parsed receipt {parsed_data.get('order_id')} "
                f"with {len(parsed_data.get('items', []))} items"
            )
            
            return parsed_data
            
        except AIServiceException as e:
            logger.error(f"AI parsing failed: {e}")
            return self._try_fallback(raw_data)
        except Exception as e:
            logger.error(f"Unexpected error in AI parser: {e}")
            raise ParserException(f"Failed to parse receipt: {e}")
    
    def _try_fallback(self, raw_data: str) -> Dict:
        """Try to use fallback parser"""
        if not self._fallback_parser_name:
            raise ParserException(
                "AI parsing failed and no fallback parser configured"
            )
        
        try:
            logger.info(f"Trying fallback parser: {self._fallback_parser_name}")
            fallback = ParserRegistry.get_parser(self._fallback_parser_name)
            return fallback.parse(raw_data)
        except Exception as e:
            raise ParserException(f"Fallback parser also failed: {e}")
    
    def _extract_plain_text(self, email_content: str) -> str:
        """Extract plain text content from email"""
        # Look for text/plain section
        text_start = email_content.find("Content-Type: text/plain")
        if text_start == -1:
            return ""
        
        # Find the content after headers
        text_start = email_content.find("\n\n", text_start)
        if text_start == -1:
            return ""
        
        # Find the end boundary
        text_end = email_content.find("--", text_start + 2)
        if text_end == -1:
            text_end = len(email_content)
        
        text_content = email_content[text_start:text_end]
        
        # Clean up
        lines = []
        for line in text_content.split("\n"):
            line = line.strip()
            # Skip noise
            if (
                line
                and not line.startswith("http")
                and not line.startswith("<")
                and "%%=" not in line
                and "tel:" not in line
            ):
                lines.append(line)
        
        return "\n".join(lines)
    
    def _transform_ai_result(self, ai_result: Dict, raw_data: str) -> Dict:
        """Transform AI result to standard parser output format"""
        items = []
        
        for item in ai_result.get("items", []):
            transformed_item = {
                "name": item.get("name") or item.get("raw_name", "Unknown"),
                "raw_name": item.get("raw_name") or item.get("name", "Unknown"),
                "price": float(item.get("price", 0)),
                "quantity": float(item.get("quantity", 1)),
                "category": item.get("category", "GROCERY"),
                "regular_price": item.get("regular_price"),
                "savings": None,
                "quantity_info": item.get("quantity_info"),
                "unit_price": None
            }
            
            # Calculate savings if we have regular price
            if transformed_item["regular_price"] and transformed_item["price"]:
                transformed_item["savings"] = (
                    transformed_item["regular_price"] - transformed_item["price"]
                )
            
            # Calculate unit price
            if transformed_item["price"] and transformed_item["quantity"]:
                transformed_item["unit_price"] = (
                    transformed_item["price"] / transformed_item["quantity"]
                )
            
            items.append(transformed_item)
        
        # Build parsed data
        order_id = ai_result.get("order_id") or self._generate_order_id()
        order_date = ai_result.get("order_date") or datetime.now().strftime("%Y-%m-%d")
        
        total_amount = ai_result.get("total")
        if total_amount is None:
            total_amount = sum(
                item["price"] * item["quantity"] for item in items
            )
        
        return {
            "order_id": order_id,
            "order_date": order_date,
            "total_amount": float(total_amount),
            "num_items": int(round(sum(item["quantity"] for item in items))),
            "items": items,
            "metadata": {
                "parser": "ai",
                "parsed_at": datetime.utcnow().isoformat(),
                "store_name": ai_result.get("store_name"),
                "subtotal": ai_result.get("subtotal"),
                "tax": ai_result.get("tax"),
                "ai_tokens_used": self.ai_service.total_tokens_used
            }
        }
    
    def _generate_order_id(self) -> str:
        """Generate a fallback order ID"""
        return f"AI_{datetime.now().strftime('%Y%m%d%H%M%S')}"
    
    def validate(self, parsed_data: Dict) -> bool:
        """Validate parsed receipt data"""
        required_keys = ["order_id", "order_date", "total_amount", "items"]
        
        for key in required_keys:
            if key not in parsed_data:
                logger.warning(f"Missing required key: {key}")
                return False
        
        if not isinstance(parsed_data["items"], list):
            return False
        
        # Validate at least some items have required fields
        valid_items = 0
        for item in parsed_data["items"]:
            if "name" in item and "price" in item:
                valid_items += 1
        
        # At least 50% of items should be valid
        if len(parsed_data["items"]) > 0:
            validity_ratio = valid_items / len(parsed_data["items"])
            if validity_ratio < 0.5:
                logger.warning(f"Too many invalid items: {validity_ratio:.0%} valid")
                return False
        
        return True


class SmartParser:
    """
    Smart parser that automatically selects the best parser for a receipt.
    Uses AI to detect store and routes to appropriate parser.
    """
    
    def __init__(self, ai_service: Optional[AIService] = None):
        """
        Initialize SmartParser
        
        Args:
            ai_service: AIService instance
        """
        self.ai_service = ai_service or create_ai_service()
        self.ai_parser = AIParser(self.ai_service)
    
    def parse(self, raw_data: str, preferred_parser: Optional[str] = None) -> Dict:
        """
        Parse receipt using the most appropriate parser
        
        Args:
            raw_data: Raw email content
            preferred_parser: Preferred parser name (optional)
        
        Returns:
            Parsed receipt data
        """
        # Try preferred parser first
        if preferred_parser and ParserRegistry.is_registered(preferred_parser):
            try:
                parser = ParserRegistry.get_parser(preferred_parser)
                result = parser.parse(raw_data)
                if parser.validate(result) and len(result.get("items", [])) > 0:
                    logger.info(f"Successfully parsed with {preferred_parser} parser")
                    return result
            except Exception as e:
                logger.warning(f"Preferred parser {preferred_parser} failed: {e}")
        
        # Try to detect store and use specific parser
        if self.ai_service.is_available:
            try:
                store = self.ai_service.detect_store(raw_data)
                if store and ParserRegistry.is_registered(store):
                    try:
                        parser = ParserRegistry.get_parser(store)
                        result = parser.parse(raw_data)
                        if parser.validate(result) and len(result.get("items", [])) > 0:
                            logger.info(f"Detected store {store}, parsed successfully")
                            return result
                    except Exception as e:
                        logger.warning(f"Store-specific parser failed: {e}")
            except Exception as e:
                logger.warning(f"Store detection failed: {e}")
        
        # Fall back to AI parser
        logger.info("Using AI parser as primary")
        return self.ai_parser.parse(raw_data)




