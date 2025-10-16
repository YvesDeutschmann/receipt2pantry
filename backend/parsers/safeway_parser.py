"""Safeway receipt parser implementing BaseParser interface"""

import re
from typing import Dict, List, Optional
from datetime import datetime
from backend.parsers.base_parser import BaseParser
from backend.parsers.parser_registry import register_parser
from backend.utils.exceptions import ParserException
from backend.utils.logger import get_logger

logger = get_logger(__name__)


@register_parser("safeway")
class SafewayParser(BaseParser):
    """Parser for Safeway receipt emails"""
    
    @property
    def parser_name(self) -> str:
        return "safeway"
    
    def parse(self, raw_data: str) -> Dict:
        """
        Parse Safeway receipt email
        
        Args:
            raw_data: Raw email content (.eml file contents)
        
        Returns:
            Dictionary with parsed receipt data
        """
        try:
            logger.info("Parsing Safeway receipt")
            
            # Extract items from receipt
            items = self._parse_receipt_items(raw_data)
            
            # Extract order metadata
            order_id = self._extract_order_id(raw_data)
            order_date = self._extract_order_date(raw_data)
            
            # Calculate totals
            total_amount = sum(item["price"] * item["quantity"] for item in items)
            num_items = sum(item["quantity"] for item in items)
            
            parsed_data = {
                "order_id": order_id,
                "order_date": order_date,
                "total_amount": total_amount,
                "num_items": num_items,
                "items": items,
                "metadata": {
                    "parser": "safeway",
                    "parsed_at": datetime.utcnow().isoformat(),
                },
            }
            
            logger.info(f"Successfully parsed receipt {order_id} with {num_items} items")
            return parsed_data
        
        except Exception as e:
            logger.error(f"Failed to parse Safeway receipt: {e}")
            raise ParserException(f"Failed to parse Safeway receipt: {e}")
    
    def validate(self, parsed_data: Dict) -> bool:
        """Validate parsed receipt data"""
        required_keys = ["order_id", "order_date", "total_amount", "items"]
        
        # Check required keys exist
        for key in required_keys:
            if key not in parsed_data:
                logger.warning(f"Missing required key: {key}")
                return False
        
        # Validate items structure
        if not isinstance(parsed_data["items"], list):
            return False
        
        for item in parsed_data["items"]:
            required_item_keys = ["name", "price", "quantity", "category"]
            for key in required_item_keys:
                if key not in item:
                    logger.warning(f"Missing required item key: {key}")
                    return False
        
        return True
    
    def _extract_order_id(self, email_content: str) -> str:
        """Extract order ID from email"""
        # Look for patterns like "Order #12345A6"
        match = re.search(r"Order #?(\d{7}[A-Z]\d)", email_content)
        if match:
            return match.group(1)
        
        # Fallback: generate from timestamp
        return f"UNKNOWN_{datetime.now().strftime('%Y%m%d%H%M%S')}"
    
    def _extract_order_date(self, email_content: str) -> str:
        """Extract order date from email"""
        # Look for date patterns like "Dec 18, 2024"
        match = re.search(r"(\w{3} \d{1,2}, \d{4})", email_content)
        if match:
            date_str = match.group(1)
            try:
                date_obj = datetime.strptime(date_str, "%b %d, %Y")
                return date_obj.strftime("%Y-%m-%d")
            except ValueError:
                pass
        
        # Fallback: use current date
        return datetime.now().strftime("%Y-%m-%d")
    
    def _parse_receipt_items(self, email_content: str) -> List[Dict]:
        """Parse receipt items from email content"""
        items = []
        
        # Try comprehensive parsing on plain text content
        plain_text_content = self._extract_plain_text_content(email_content)
        if plain_text_content:
            items = self._parse_comprehensive_receipt(plain_text_content)
        
        # Remove duplicates based on product name
        unique_items = []
        seen_names = set()
        for item in items:
            if item["name"] not in seen_names:
                unique_items.append(item)
                seen_names.add(item["name"])
        
        return unique_items
    
    def _extract_plain_text_content(self, email_content: str) -> str:
        """Extract plain text content from the email"""
        text_start = email_content.find("Content-Type: text/plain")
        if text_start == -1:
            return ""
        
        text_start = email_content.find("\n\n", text_start)
        if text_start == -1:
            return ""
        
        text_end = email_content.find("--tqWfdDQPx0Nv=_?:", text_start)
        if text_end == -1:
            text_end = email_content.find("Content-Type: text/html", text_start)
        
        if text_end == -1:
            return ""
        
        text_content = email_content[text_start:text_end]
        
        # Clean up the text
        lines = text_content.split("\n")
        cleaned_lines = []
        
        for line in lines:
            line = line.strip()
            # Skip unwanted content
            if (
                line
                and not line.startswith("http")
                and not line.startswith("<")
                and not line.startswith("%%=")
                and "tel:" not in line
                and "&trade;" not in line
                and "&copy;" not in line
                and "Copyright" not in line
                and "Contact us at" not in line
                and "Having trouble viewing" not in line
                and "View in browser" not in line
                and "This email was sent" not in line
                and "no-reply@p.safeway.com" not in line
            ):
                cleaned_lines.append(line)
        
        return "\n".join(cleaned_lines)
    
    def _parse_comprehensive_receipt(self, email_content: str) -> List[Dict]:
        """Parse receipt items using category structure"""
        items = []
        current_category = "UNKNOWN"
        
        lines = email_content.split("\n")
        
        # Find where the summary section starts (Total Items)
        summary_start = -1
        for i, line in enumerate(lines):
            if "Total Items" in line:
                summary_start = i
                break
        
        if summary_start == -1:
            summary_start = len(lines)
        
        i = 0
        while i < summary_start:
            line = lines[i].strip()
            
            # Check for category headers
            if self._is_category_header(line):
                current_category = line
                i += 1
                continue
            
            # Skip empty lines and non-product lines
            if not line or self._should_skip_line(line):
                i += 1
                continue
            
            # Everything else under a category is a product name
            if current_category != "UNKNOWN":
                product_name = line
                price = None
                quantity = 1
                regular_price = None
                
                # Look for price in next few lines
                j = i + 1
                while j < summary_start and j < i + 10:
                    next_line = lines[j].strip()
                    
                    if not next_line:
                        j += 1
                        continue
                    
                    # Look for price
                    if (
                        next_line.startswith("$")
                        and "." in next_line
                        and "Regular Price" not in next_line
                    ):
                        price_match = re.search(r"\$(\d+\.\d{2})", next_line)
                        if price_match:
                            price = float(price_match.group(1))
                            break
                    
                    if self._is_category_header(next_line):
                        break
                    
                    j += 1
                
                # Look for quantity and regular price
                if price is not None:
                    j += 1
                    while j < summary_start and j < i + 15:
                        next_line = lines[j].strip()
                        
                        if not next_line:
                            j += 1
                            continue
                        
                        if "Quantity:" in next_line:
                            qty_match = re.search(r"Quantity:\s*(\d+)", next_line)
                            if qty_match:
                                quantity = int(qty_match.group(1))
                        
                        if "Regular Price" in next_line:
                            reg_price_match = re.search(
                                r"Regular Price \$(\d+\.\d{2})", next_line
                            )
                            if reg_price_match:
                                regular_price = float(reg_price_match.group(1))
                        
                        if self._is_category_header(next_line):
                            break
                        
                        j += 1
                    
                    # Calculate savings
                    savings = None
                    if regular_price:
                        savings = regular_price - price
                    
                    item = {
                        "name": product_name,
                        "price": price,
                        "quantity": quantity,
                        "category": current_category,
                        "regular_price": regular_price,
                        "savings": savings,
                    }
                    items.append(item)
            
            i += 1
        
        return items
    
    def _should_skip_line(self, line: str) -> bool:
        """Check if a line should be skipped"""
        skip_patterns = [
            r"^\$",
            r"^Quantity:",
            r"^Regular Price",
            r"^Total",
            r"^Subtotal",
            r"^Tax",
            r"^Amount",
            r"^Sales Tax",
            r"^Calculated",
            r"^Card ending",
            r"^Thanks for",
            r"^Here is your",
            r"^Order Details",
            r"^Total Price",
        ]
        
        for pattern in skip_patterns:
            if re.match(pattern, line, re.IGNORECASE):
                return True
        
        return False
    
    def _is_category_header(self, line: str) -> bool:
        """Check if a line is a category header"""
        category_headers = [
            "GROCERY",
            "MEAT",
            "REFRIG/FROZEN",
            "PRODUCE",
            "BAKERY",
            "DELI",
            "SEAFOOD",
            "PHARMACY",
            "HEALTH & BEAUTY",
            "HOUSEHOLD",
        ]
        return line.upper() in category_headers

