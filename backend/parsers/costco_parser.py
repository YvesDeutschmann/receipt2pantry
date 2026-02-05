"""Costco receipt parser implementing BaseParser interface"""

import re
from typing import Dict, List, Optional
from datetime import datetime

from backend.parsers.base_parser import BaseParser
from backend.parsers.parser_registry import register_parser
from backend.services.ai_service import AIService, create_ai_service
from backend.utils.exceptions import ParserException, AIServiceException
from backend.utils.logger import get_logger

logger = get_logger(__name__)


@register_parser("costco")
class CostcoParser(BaseParser):
    """Parser for Costco PDF receipts with cryptic line items"""
    
    def __init__(self, ai_service: Optional[AIService] = None):
        """
        Initialize CostcoParser
        
        Args:
            ai_service: AIService instance (creates one if not provided)
        """
        self.ai_service = ai_service or create_ai_service()
        self._fallback_parser_name: Optional[str] = None
    
    @property
    def parser_name(self) -> str:
        return "costco"
    
    def set_fallback_parser(self, parser_name: str) -> None:
        """
        Set a fallback parser to use if AI parsing fails
        
        Args:
            parser_name: Name of the fallback parser (e.g., 'ai')
        """
        self._fallback_parser_name = parser_name
    
    def parse(self, raw_data: str) -> Dict:
        """
        Parse Costco receipt using AI
        
        Args:
            raw_data: Raw PDF text content from Costco receipt
        
        Returns:
            Dictionary with parsed receipt data
        
        Raises:
            ParserException: If parsing fails
        """
        try:
            logger.info("Parsing Costco receipt with AI")
            
            if not self.ai_service.is_available:
                logger.warning("AI service not available, attempting fallback")
                return self._try_fallback(raw_data)
            
            # Use Costco-specific AI parsing
            try:
                ai_result = self.ai_service.parse_costco_receipt(raw_data)
            except AIServiceException as e:
                logger.warning(f"AI parsing failed: {e}, trying fallback")
                return self._try_fallback(raw_data)
            
            # Transform to standard format
            parsed_data = self._transform_ai_result(ai_result, raw_data)
            
            logger.info(
                f"AI parsed Costco receipt {parsed_data.get('order_id')} "
                f"with {len(parsed_data.get('items', []))} items"
            )
            
            return parsed_data
            
        except Exception as e:
            logger.error(f"Unexpected error in Costco parser: {e}")
            return self._try_fallback(raw_data)
    
    def _try_fallback(self, raw_data: str) -> Dict:
        """Try to use fallback parser"""
        if not self._fallback_parser_name:
            # Try basic rule-based parsing as last resort
            return self._basic_parse(raw_data)
        
        try:
            logger.info(f"Trying fallback parser: {self._fallback_parser_name}")
            from backend.parsers.parser_registry import ParserRegistry
            fallback = ParserRegistry.get_parser(self._fallback_parser_name)
            return fallback.parse(raw_data)
        except Exception as e:
            logger.warning(f"Fallback parser also failed: {e}, using basic parse")
            return self._basic_parse(raw_data)
    
    def _basic_parse(self, receipt_text: str) -> Dict:
        """
        Basic rule-based parsing as fallback
        
        Args:
            receipt_text: Raw receipt text
        
        Returns:
            Parsed receipt dictionary
        """
        items = []
        lines = receipt_text.split('\n')
        
        # Find receipt metadata
        order_id = self._extract_order_id(receipt_text)
        order_date = self._extract_order_date(receipt_text)
        total_amount = self._extract_total(receipt_text)
        
        # Parse line items - look for lines starting with "E" followed by numbers
        for line in lines:
            line = line.strip()
            if not line:
                continue
            
            # Match pattern: E [code] [name] [price] [flag]
            match = re.match(r'^E\s+(\d+)\s+(.+?)\s+(\d+\.\d{2})\s+([YN])?$', line)
            if match:
                code, name, price_str, flag = match.groups()
                try:
                    price = float(price_str)
                    items.append({
                        'name': name.strip(),
                        'raw_name': name.strip(),
                        'price': price,
                        'quantity': 1,
                        'category': 'GROCERY',
                        'regular_price': None,
                        'savings': None,
                        'quantity_info': None
                    })
                except ValueError:
                    continue
        
        return {
            'order_id': order_id,
            'order_date': order_date.strftime('%Y-%m-%d') if order_date else datetime.now().strftime('%Y-%m-%d'),
            'total_amount': total_amount,
            'num_items': len(items),
            'items': items,
            'metadata': {
                'parser': 'costco_basic',
                'parsed_at': datetime.utcnow().isoformat(),
                'store_name': 'Costco'
            }
        }
    
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
                "parser": "costco",
                "parsed_at": datetime.utcnow().isoformat(),
                "store_name": ai_result.get("store_name", "Costco"),
                "subtotal": ai_result.get("subtotal"),
                "tax": ai_result.get("tax"),
                "ai_tokens_used": getattr(self.ai_service, 'total_tokens_used', 0)
            }
        }
    
    def _generate_order_id(self) -> str:
        """Generate a fallback order ID"""
        return f"COSTCO_{datetime.now().strftime('%Y%m%d%H%M%S')}"
    
    def _extract_order_id(self, receipt_text: str) -> str:
        """Extract order ID from receipt text"""
        # Look for transaction ID pattern (long number)
        match = re.search(r'(\d{20,})', receipt_text)
        if match:
            return match.group(1)
        return self._generate_order_id()
    
    def _extract_order_date(self, receipt_text: str) -> Optional[datetime]:
        """Extract order date from receipt text"""
        date_patterns = [
            r'(\d{1,2}/\d{1,2}/\d{4})',
            r'(\d{4}-\d{2}-\d{2})',
            r'(\w{3} \d{1,2}, \d{4})'
        ]
        
        for pattern in date_patterns:
            match = re.search(pattern, receipt_text)
            if match:
                date_str = match.group(1)
                try:
                    if '/' in date_str:
                        return datetime.strptime(date_str, '%m/%d/%Y')
                    elif '-' in date_str:
                        return datetime.strptime(date_str, '%Y-%m-%d')
                    else:
                        return datetime.strptime(date_str, '%b %d, %Y')
                except ValueError:
                    continue
        
        return None
    
    def _extract_total(self, receipt_text: str) -> float:
        """Extract total amount from receipt text"""
        total_patterns = [
            r'TOTAL\s+\$?(\d+\.\d{2})',
            r'\*\*\*\*\s+TOTAL\s+\$?(\d+\.\d{2})',
            r'AMOUNT:\s+\$?(\d+\.\d{2})'
        ]
        
        for pattern in total_patterns:
            match = re.search(pattern, receipt_text, re.IGNORECASE)
            if match:
                try:
                    return float(match.group(1))
                except ValueError:
                    continue
        
        return 0.0
    
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
