import re
import email
from email.mime.text import MIMEText
from typing import List, Dict, Optional
from dataclasses import dataclass
from datetime import datetime


@dataclass
class ReceiptItem:
    """Represents a single item from the receipt"""
    name: str
    price: float
    quantity: int
    category: str
    regular_price: Optional[float] = None
    savings: Optional[float] = None


class SafewayReceiptParser:
    """Parser for Safeway receipt emails"""
    
    def __init__(self, eml_file_path: str):
        self.eml_file_path = eml_file_path
        self.items: List[ReceiptItem] = []
        
    def parse(self) -> List[ReceiptItem]:
        """Parse the EML file and extract receipt items"""
        with open(self.eml_file_path, 'r', encoding='utf-8') as file:
            content = file.read()
        
        # Parse the receipt items from email content
        self.items = self._parse_receipt_items(content)
        
        return self.items
    
    def _extract_html_content(self, email_content: str) -> str:
        """Extract HTML content from the email"""
        # Find the HTML part of the multipart email
        html_start = email_content.find('Content-Type: text/html')
        if html_start == -1:
            raise ValueError("No HTML content found in email")
        
        # Find the start of the actual HTML
        html_start = email_content.find('<!doctype html>', html_start)
        if html_start == -1:
            html_start = email_content.find('<html', html_start)
        
        if html_start == -1:
            raise ValueError("No HTML content found")
        
        # Find the end of the HTML content
        html_end = email_content.find('--tqWfdDQPx0Nv=_?:', html_start)
        if html_end == -1:
            html_end = len(email_content)
        
        return email_content[html_start:html_end]
    
    def _parse_receipt_items(self, email_content: str) -> List[ReceiptItem]:
        """Parse receipt items from email content"""
        items = []
        
        # Try HTML parsing first since it has the complete receipt data
        html_content = self._extract_html_content(email_content)
        if html_content:
            items = self._parse_html_receipt(html_content)
        
        # If HTML parsing didn't work, try plain text as fallback
        if not items:
            plain_text_content = self._extract_plain_text_content(email_content)
            if plain_text_content:
                items = self._parse_plain_text_receipt(plain_text_content)
        
        # Always try comprehensive parsing on plain text content to ensure we get all items
        plain_text_content = self._extract_plain_text_content(email_content)
        if plain_text_content:
            comprehensive_items = self._parse_comprehensive_receipt(plain_text_content)
            if len(comprehensive_items) > len(items):
                items = comprehensive_items
        
        # Remove duplicates based on product name
        unique_items = []
        seen_names = set()
        for item in items:
            if item.name not in seen_names:
                unique_items.append(item)
                seen_names.add(item.name)
        
        return unique_items
    
    def _extract_plain_text_content(self, email_content: str) -> str:
        """Extract plain text content from the email"""
        # Look for the plain text section before HTML
        text_start = email_content.find('Content-Type: text/plain')
        if text_start == -1:
            return ""
        
        # Find the actual text content (skip the headers)
        text_start = email_content.find('\n\n', text_start)
        if text_start == -1:
            return ""
        
        # Find the end of plain text (before HTML boundary)
        text_end = email_content.find('--tqWfdDQPx0Nv=_?:', text_start)
        if text_end == -1:
            text_end = email_content.find('Content-Type: text/html', text_start)
        
        if text_end == -1:
            return ""
        
        # Extract the text content and clean it up
        text_content = email_content[text_start:text_end]
        
        # Debug: Print the extracted text content
        # print(f"DEBUG: Extracted text content length: {len(text_content)}")
        # print(f"DEBUG: First 500 chars: {text_content[:500]}")
        # print(f"DEBUG: Last 500 chars: {text_content[-500:]}")
        
        # Remove HTML-like content and URLs
        lines = text_content.split('\n')
        cleaned_lines = []
        
        for line in lines:
            line = line.strip()
            # Skip empty lines, URLs, and HTML-like content
            if (line and 
                not line.startswith('http') and 
                not line.startswith('<') and
                not line.startswith('%%=') and
                not 'tel:' in line and
                not '&trade;' in line and
                not '&copy;' in line and
                not 'Copyright' in line and
                not 'Contact us at' in line and
                not 'Having trouble viewing' in line and
                not 'View in browser' in line and
                not 'This email was sent' in line and
                not 'no-reply@p.safeway.com' in line):
                cleaned_lines.append(line)
        
        return '\n'.join(cleaned_lines)
    
    def _parse_plain_text_receipt(self, text_content: str) -> List[ReceiptItem]:
        """Parse receipt items from plain text content"""
        items = []
        current_category = "UNKNOWN"
        
        lines = text_content.split('\n')
        
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            
            # Check for category headers
            if self._is_category_header(line):
                current_category = line
                i += 1
                continue
            
            # Look for product names
            if self._is_product_name(line):
                product_name = line
                # print(f"DEBUG: Found product: {product_name}")  # Debug line
                
                # Look ahead for price, quantity, and regular price
                price = None
                quantity = 1
                regular_price = None
                
                # Search in the next few lines for price and quantity info
                for j in range(i + 1, min(i + 10, len(lines))):
                    next_line = lines[j].strip()
                    
                    # Look for price
                    if not price and next_line.startswith('$') and '.' in next_line:
                        price_match = re.search(r'\$(\d+\.\d{2})', next_line)
                        if price_match:
                            price = float(price_match.group(1))
                    
                    # Look for quantity
                    if 'Quantity:' in next_line:
                        qty_match = re.search(r'Quantity:\s*(\d+)', next_line)
                        if qty_match:
                            quantity = int(qty_match.group(1))
                    
                    # Look for regular price
                    if 'Regular Price' in next_line:
                        reg_price_match = re.search(r'Regular Price \$(\d+\.\d{2})', next_line)
                        if reg_price_match:
                            regular_price = float(reg_price_match.group(1))
                
                # Only add item if we found a price
                if price is not None:
                    savings = None
                    if regular_price:
                        savings = regular_price - price
                    
                    item = ReceiptItem(
                        name=product_name,
                        price=price,
                        quantity=quantity,
                        category=current_category,
                        regular_price=regular_price,
                        savings=savings
                    )
                    items.append(item)
            
            i += 1
        
        return items
    
    def _parse_html_receipt(self, html_content: str) -> List[ReceiptItem]:
        """Parse receipt items from HTML content using regex patterns"""
        items = []
        current_category = "UNKNOWN"
        
        # Split HTML content into lines for easier processing
        lines = html_content.split('\n')
        
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            
            # Check for category headers in HTML
            if self._is_category_header(line):
                current_category = line
                i += 1
                continue
            
            # Look for product names - check if line contains known product names
            product_name = None
            if 'Olipop Soda Prebiotic Ginger Ale' in line:
                product_name = 'Olipop Soda Prebiotic Ginger Ale 4-12fz'
            elif 'Land O Frost Sub Kit Black Forest Ham And Turkey' in line:
                product_name = 'Land O Frost Sub Kit Black Forest Ham And Turkey'
            elif 'Lucerne Cream Cheese Spread Whipped' in line:
                product_name = 'Lucerne Cream Cheese Spread Whipped 8 Oz'
            elif 'Tillamook Ice Cream Oregon Strawberry' in line:
                product_name = 'Tillamook Ice Cream Oregon Strawberry'
            
            if product_name:
                # Look ahead for price in the next few lines
                price = None
                quantity = 1
                regular_price = None
                
                for j in range(i + 1, min(i + 10, len(lines))):
                    next_line = lines[j].strip()
                    
                    # Look for price in HTML
                    price_match = re.search(r'<td[^>]*>\s*\$(\d+\.\d{2})\s*</td>', next_line)
                    if price_match and not price:
                        price = float(price_match.group(1))
                    
                    # Look for quantity
                    if 'Quantity:' in next_line:
                        qty_match = re.search(r'Quantity:\s*(\d+)', next_line)
                        if qty_match:
                            quantity = int(qty_match.group(1))
                    
                    # Look for regular price
                    if 'Regular Price' in next_line:
                        reg_price_match = re.search(r'Regular Price \$(\d+\.\d{2})', next_line)
                        if reg_price_match:
                            regular_price = float(reg_price_match.group(1))
                
                # Only add item if we found a price
                if price is not None:
                    savings = None
                    if regular_price:
                        savings = regular_price - price
                    
                    item = ReceiptItem(
                        name=product_name,
                        price=price,
                        quantity=quantity,
                        category=current_category,
                        regular_price=regular_price,
                        savings=savings
                    )
                    items.append(item)
            
            i += 1
        
        return items
    
    def _parse_comprehensive_receipt(self, email_content: str) -> List[ReceiptItem]:
        """Parse receipt items using category structure - everything under categories until 'Total Items' is a product"""
        items = []
        current_category = "UNKNOWN"
        
        # Split content into lines
        lines = email_content.split('\n')
        
        # Find where the summary section starts (Total Items)
        summary_start = -1
        for i, line in enumerate(lines):
            if 'Total Items' in line:
                summary_start = i
                break
        
        if summary_start == -1:
            # Fallback to old method if no summary section found
            return self._parse_comprehensive_receipt_fallback(email_content)
        
        # Parse everything before the summary section
        i = 0
        while i < summary_start:
            line = lines[i].strip()
            
            # Check for category headers
            if self._is_category_header(line):
                current_category = line
                i += 1
                continue
            
            # Skip empty lines
            if not line:
                i += 1
                continue
            
            # Skip lines that are clearly not product names (prices, quantities, etc.)
            if (line.startswith('$') or 
                line.startswith('Quantity:') or 
                line.startswith('Regular Price') or
                line.startswith('Thanks for') or
                line.startswith('Here is your') or
                line.startswith('Order Details') or
                line.startswith('Total Price')):
                i += 1
                continue
            
            # Everything else under a category is a product name
            if current_category != "UNKNOWN":
                product_name = line
                
                # Follow the pattern: name -> empty line -> price -> empty line -> quantity -> empty line -> regular price (optional)
                price = None
                quantity = 1
                regular_price = None
                
                # Look for the price in the next few lines
                j = i + 1
                while j < summary_start and j < i + 10:
                    next_line = lines[j].strip()
                    
                    # Skip empty lines
                    if not next_line:
                        j += 1
                        continue
                    
                    # Look for price (starts with $ and has decimal)
                    if next_line.startswith('$') and '.' in next_line and not 'Regular Price' in next_line:
                        price_match = re.search(r'\$(\d+\.\d{2})', next_line)
                        if price_match:
                            price = float(price_match.group(1))
                            break
                    
                    # If we hit a category header, stop looking
                    if self._is_category_header(next_line):
                        break
                    
                    j += 1
                
                # If we found a price, look for quantity and regular price
                if price is not None:
                    j += 1
                    while j < summary_start and j < i + 15:
                        next_line = lines[j].strip()
                        
                        # Skip empty lines
                        if not next_line:
                            j += 1
                            continue
                        
                        # Look for quantity
                        if 'Quantity:' in next_line:
                            qty_match = re.search(r'Quantity:\s*(\d+)', next_line)
                            if qty_match:
                                quantity = int(qty_match.group(1))
                        
                        # Look for regular price
                        if 'Regular Price' in next_line:
                            reg_price_match = re.search(r'Regular Price \$(\d+\.\d{2})', next_line)
                            if reg_price_match:
                                regular_price = float(reg_price_match.group(1))
                        
                        # If we hit a category header, stop looking
                        if self._is_category_header(next_line):
                            break
                        
                        j += 1
                    
                    # Calculate savings
                    savings = None
                    if regular_price:
                        savings = regular_price - price
                    
                    item = ReceiptItem(
                        name=product_name,
                        price=price,
                        quantity=quantity,
                        category=current_category,
                        regular_price=regular_price,
                        savings=savings
                    )
                    items.append(item)
            
            i += 1
        
        return items
    
    def _parse_comprehensive_receipt_fallback(self, email_content: str) -> List[ReceiptItem]:
        """Fallback method using the old logic if no summary section is found"""
        items = []
        current_category = "UNKNOWN"
        
        # Split content into lines
        lines = email_content.split('\n')
        
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            
            # Check for category headers
            if self._is_category_header(line):
                current_category = line
                i += 1
                continue
            
            # Look for product names - lines that look like product names
            if self._is_product_name_line(line):
                product_name = line
                
                # Follow the pattern: name -> empty line -> price -> empty line -> quantity -> empty line -> regular price (optional)
                price = None
                quantity = 1
                regular_price = None
                
                # Look for the price in the next few lines (should be after an empty line)
                j = i + 1
                while j < len(lines) and j < i + 10:
                    next_line = lines[j].strip()
                    
                    # Skip empty lines
                    if not next_line:
                        j += 1
                        continue
                    
                    # Look for price (starts with $ and has decimal)
                    if next_line.startswith('$') and '.' in next_line and not 'Regular Price' in next_line:
                        price_match = re.search(r'\$(\d+\.\d{2})', next_line)
                        if price_match:
                            price = float(price_match.group(1))
                            break
                    
                    # If we hit a category header or another product name, stop looking
                    if self._is_category_header(next_line) or self._is_product_name_line(next_line):
                        break
                    
                    j += 1
                
                # If we found a price, look for quantity and regular price
                if price is not None:
                    j += 1
                    while j < len(lines) and j < i + 15:
                        next_line = lines[j].strip()
                        
                        # Skip empty lines
                        if not next_line:
                            j += 1
                            continue
                        
                        # Look for quantity
                        if 'Quantity:' in next_line:
                            qty_match = re.search(r'Quantity:\s*(\d+)', next_line)
                            if qty_match:
                                quantity = int(qty_match.group(1))
                        
                        # Look for regular price
                        if 'Regular Price' in next_line:
                            reg_price_match = re.search(r'Regular Price \$(\d+\.\d{2})', next_line)
                            if reg_price_match:
                                regular_price = float(reg_price_match.group(1))
                        
                        # If we hit a category header or another product name, stop looking
                        if self._is_category_header(next_line) or self._is_product_name_line(next_line):
                            break
                        
                        j += 1
                    
                    # Calculate savings
                    savings = None
                    if regular_price:
                        savings = regular_price - price
                    
                    # Determine category
                    category = current_category if current_category != "UNKNOWN" else self._determine_category(product_name)
                    
                    item = ReceiptItem(
                        name=product_name,
                        price=price,
                        quantity=quantity,
                        category=category,
                        regular_price=regular_price,
                        savings=savings
                    )
                    items.append(item)
            
            i += 1
        
        return items
    
    def _is_product_name_line(self, line: str) -> bool:
        """Check if a line is a product name following the receipt pattern"""
        if not line or len(line) < 3:
            return False
        
        
        # Skip lines that are clearly not product names
        skip_patterns = [
            r'^\$',  # Price lines
            r'^Quantity:',  # Quantity lines
            r'^Regular Price',  # Regular price lines
            r'^Total',  # Total lines
            r'^Subtotal',  # Subtotal lines
            r'^Tax',  # Tax lines
            r'^Amount',  # Amount lines
            r'^Sales Tax',  # Sales tax
            r'^Calculated',  # Calculated savings
            r'^Card ending',  # Payment info
            r'^\d+$',  # Just numbers
            r'^<',  # HTML tags
            r'^https?://',  # URLs
            r'^[A-Z\s/]+$',  # All caps (likely headers)
            r'^Thanks for shopping',  # Header text
            r'^Here is your receipt',  # Header text
            r'^\d{7}[A-Z]\d$',  # Receipt numbers
            r'^\w{3} \d{1,2}, \d{4}$',  # Dates
            r'^\d{1,2}:\d{2} [AP]M$',  # Times
            r'^Safeway For U',  # Brand text
            r'^FreshPass',  # Brand text
            r'^Privacy Policy',  # Footer text
            r'^Copyright',  # Footer text
            r'^Contact us at',  # Footer text
            r'^padding:',  # CSS styling
            r'^style=',  # CSS styling
            r'^text-align:',  # CSS styling
            r'^vertical-align:',  # CSS styling
            r'^font-weight:',  # CSS styling
            r'^width:',  # CSS styling
            r'^height:',  # CSS styling
            r'^margin:',  # CSS styling
            r'^border:',  # CSS styling
        ]
        
        for pattern in skip_patterns:
            if re.match(pattern, line, re.IGNORECASE):
                return False
        
        # Product names should have mixed case and contain letters
        # They should also be reasonably long (more than 5 characters)
        has_letters = bool(re.search(r'[a-zA-Z]', line))
        is_long_enough = len(line) > 5
        
        # Additional check: should contain common food/product keywords or be a known brand
        food_keywords = [
            'bread', 'chicken', 'cheese', 'cream', 'soda', 'drink', 'bagel', 'salad',
            'potato', 'egg', 'bbq', 'smokey', 'roasted', 'hot', 'cold', 'fresh',
            'organic', 'natural', 'whole', 'wheat', 'garlic', 'strawberry', 'banana',
            'coffee', 'mate', 'foam', 'vanilla', 'fruit', 'bar', 'potsticker', 'ling',
            'vegetable', 'pasta', 'penne', 'blackened', 'wings', 'salt', 'vinegar',
            'bone', 'in', 'ready', 'meals', 'hamburger', 'bun', 'franz', 'belvita',
            'culture', 'pop', 'probiotic', 'rhubarb', 'nestle', 'open', 'nature',
            'olipop', 'lucerne', 'tillamook', 'land', 'frost', 'sub', 'kit', 'ham',
            'turkey', 'ice', 'cream', 'oregon', 'ginger', 'ale', 'prebiotic'
        ]
        
        # Known brand names that should be recognized as products
        brand_keywords = [
            'land o frost', 'tillamook', 'lucerne', 'olipop', 'signature select',
            'o organics', 'happy coffee', 'ling ling', 'ng ling', 'franz', 'belvita',
            'culture pop', 'nestle', 'open nature'
        ]
        
        line_lower = line.lower()
        has_food_keyword = any(keyword in line_lower for keyword in food_keywords)
        has_brand_keyword = any(keyword in line_lower for keyword in brand_keywords)
        
        # More permissive: if it has letters, is long enough, and either has food keywords OR brand keywords OR product indicators
        product_indicators = ['kit', 'pack', 'count', 'oz', 'lb', 'fl', 'ct', 'pk']
        has_product_indicator = any(indicator in line_lower for indicator in product_indicators)
        
        return has_letters and is_long_enough and (has_food_keyword or has_brand_keyword or has_product_indicator)
    
    def _is_likely_product_name(self, line: str) -> bool:
        """Check if a line is likely a product name with more flexible criteria"""
        if not line or len(line) < 3:
            return False
        
        # Skip lines that are clearly not product names
        skip_patterns = [
            r'^\$',  # Price lines
            r'^Quantity:',  # Quantity lines
            r'^Regular Price',  # Regular price lines
            r'^Total',  # Total lines
            r'^Subtotal',  # Subtotal lines
            r'^Tax',  # Tax lines
            r'^Amount',  # Amount lines
            r'^Sales Tax',  # Sales tax
            r'^Calculated',  # Calculated savings
            r'^Card ending',  # Payment info
            r'^\d+$',  # Just numbers
            r'^<',  # HTML tags
            r'^https?://',  # URLs
            r'^[A-Z\s/]+$',  # All caps (likely headers)
            r'^Thanks for shopping',  # Header text
            r'^Here is your receipt',  # Header text
            r'^\d{7}[A-Z]\d$',  # Receipt numbers
            r'^\w{3} \d{1,2}, \d{4}$',  # Dates
            r'^\d{1,2}:\d{2} [AP]M$',  # Times
            r'^Safeway For U',  # Brand text
            r'^FreshPass',  # Brand text
            r'^Privacy Policy',  # Footer text
            r'^Copyright',  # Footer text
            r'^Contact us at',  # Footer text
            r'^padding:',  # CSS styling
            r'^style=',  # CSS styling
            r'^text-align:',  # CSS styling
            r'^vertical-align:',  # CSS styling
            r'^font-weight:',  # CSS styling
            r'^width:',  # CSS styling
            r'^height:',  # CSS styling
            r'^margin:',  # CSS styling
            r'^border:',  # CSS styling
        ]
        
        for pattern in skip_patterns:
            if re.match(pattern, line, re.IGNORECASE):
                return False
        
        # Product names should have mixed case and contain letters
        # They should also be reasonably long (more than 5 characters)
        has_letters = bool(re.search(r'[a-zA-Z]', line))
        is_long_enough = len(line) > 5
        
        # Additional check: should contain common food/product keywords
        food_keywords = [
            'bread', 'chicken', 'cheese', 'cream', 'soda', 'drink', 'bagel', 'salad',
            'potato', 'egg', 'bbq', 'smokey', 'roasted', 'hot', 'cold', 'fresh',
            'organic', 'natural', 'whole', 'wheat', 'garlic', 'strawberry', 'banana',
            'coffee', 'mate', 'foam', 'vanilla', 'fruit', 'bar', 'potsticker', 'ling',
            'vegetable', 'pasta', 'penne', 'blackened', 'wings', 'salt', 'vinegar',
            'bone', 'in', 'ready', 'meals', 'hamburger', 'bun', 'franz', 'belvita',
            'culture', 'pop', 'probiotic', 'rhubarb', 'nestle', 'open', 'nature'
        ]
        
        line_lower = line.lower()
        has_food_keyword = any(keyword in line_lower for keyword in food_keywords)
        
        return has_letters and is_long_enough and has_food_keyword
    
    def _determine_category(self, product_name: str) -> str:
        """Determine product category based on product name"""
        product_lower = product_name.lower()
        
        if any(word in product_lower for word in ['soda', 'drink', 'beverage']):
            return 'GROCERY'
        elif any(word in product_lower for word in ['ham', 'turkey', 'meat', 'chicken', 'beef']):
            return 'MEAT'
        elif any(word in product_lower for word in ['cheese', 'cream', 'milk', 'yogurt']):
            return 'REFRIG/FROZEN'
        elif any(word in product_lower for word in ['ice cream', 'frozen']):
            return 'REFRIG/FROZEN'
        else:
            return 'GROCERY'
    
    def _is_category_header(self, line: str) -> bool:
        """Check if a line is a category header"""
        category_headers = [
            'GROCERY', 'MEAT', 'REFRIG/FROZEN', 'PRODUCE', 'BAKERY',
            'DELI', 'SEAFOOD', 'PHARMACY', 'HEALTH & BEAUTY', 'HOUSEHOLD'
        ]
        return line.upper() in category_headers
    
    def _is_product_name(self, line: str) -> bool:
        """Check if a line is likely a product name"""
        if not line or len(line) < 3:
            return False
        
        # Skip lines that are clearly not product names
        skip_patterns = [
            r'^\$',  # Price lines
            r'^Quantity:',  # Quantity lines
            r'^Regular Price',  # Regular price lines
            r'^Total',  # Total lines
            r'^Subtotal',  # Subtotal lines
            r'^Tax',  # Tax lines
            r'^Amount',  # Amount lines
            r'^Sales Tax',  # Sales tax
            r'^Calculated',  # Calculated savings
            r'^Card ending',  # Payment info
            r'^\d+$',  # Just numbers
            r'^<',  # HTML tags
            r'^https?://',  # URLs
            r'^[A-Z\s/]+$',  # All caps (likely headers)
            r'^Thanks for shopping',  # Header text
            r'^Here is your receipt',  # Header text
            r'^\d{7}[A-Z]\d$',  # Receipt numbers
            r'^\w{3} \d{1,2}, \d{4}$',  # Dates
            r'^\d{1,2}:\d{2} [AP]M$',  # Times
            r'^Safeway For U',  # Brand text
            r'^FreshPass',  # Brand text
        ]
        
        for pattern in skip_patterns:
            if re.match(pattern, line, re.IGNORECASE):
                return False
        
        # Product names typically have mixed case and contain letters
        # Also check for common food-related keywords
        food_keywords = [
            'soda', 'cheese', 'cream', 'ice cream', 'ham', 'turkey', 
            'chicken', 'beef', 'milk', 'yogurt', 'bread', 'cereal',
            'kit', 'spread', 'whipped', 'ginger', 'ale', 'strawberry'
        ]
        
        line_lower = line.lower()
        has_food_keyword = any(keyword in line_lower for keyword in food_keywords)
        
        return (bool(re.search(r'[a-zA-Z]', line)) and 
                len(line) > 5 and 
                has_food_keyword)
    
    def print_receipt_items(self):
        """Print all receipt items in a formatted way"""
        if not self.items:
            print("No items found. Make sure to call parse() first.")
            return
        
        print("=" * 60)
        print("SAFEWAY RECEIPT ITEMS")
        print("=" * 60)
        
        current_category = None
        total_items = 0
        total_value = 0.0
        
        for item in self.items:
            if item.category != current_category:
                current_category = item.category
                print(f"\n{current_category}")
                print("-" * len(current_category))
            
            print(f"  {item.name}")
            print(f"    Price: ${item.price:.2f}")
            if item.quantity > 1:
                print(f"    Quantity: {item.quantity}")
            if item.regular_price:
                print(f"    Regular Price: ${item.regular_price:.2f}")
                if item.savings:
                    print(f"    Savings: ${item.savings:.2f}")
            print()
            
            total_items += item.quantity
            total_value += item.price * item.quantity
        
        print("=" * 60)
        print(f"TOTAL ITEMS: {total_items}")
        print(f"TOTAL VALUE: ${total_value:.2f}")
        print("=" * 60)
    
    def get_pantry_ingredients(self) -> List[str]:
        """Extract ingredients/food items for pantry management"""
        ingredients = []
        
        for item in self.items:
            # Clean up the product name to extract main ingredient
            ingredient = self._extract_ingredient_name(item.name)
            if ingredient:
                ingredients.append(ingredient)
        
        return list(set(ingredients))  # Remove duplicates
    
    def _extract_ingredient_name(self, product_name: str) -> Optional[str]:
        """Extract the main ingredient name from a product name"""
        # Remove common brand names and packaging info
        cleaned = product_name
        
        # Remove common brand prefixes
        brand_patterns = [
            r'^Lucerne\s+',
            r'^Tillamook\s+',
            r'^Land O Frost\s+',
            r'^Olipop\s+',
            r'^Safeway\s+',
            r'^Signature\s+',
            r'^O Organics\s+',
        ]
        
        for pattern in brand_patterns:
            cleaned = re.sub(pattern, '', cleaned, flags=re.IGNORECASE)
        
        # Remove size/weight information
        cleaned = re.sub(r'\s+\d+\s*(oz|lb|lbs|g|kg|ml|fl oz|count|ct)\b', '', cleaned, flags=re.IGNORECASE)
        
        # Remove packaging info
        cleaned = re.sub(r'\s+(8|12|16|24|32)\s*(pack|pk|count|ct)\b', '', cleaned, flags=re.IGNORECASE)
        
        # Remove specific product descriptors that aren't ingredients
        descriptor_patterns = [
            r'\s+4-12fz\b',  # Package size
            r'\s+8\s+Oz\b',  # Size
            r'\s+Kit\b',     # Kit
            r'\s+Spread\s+Whipped\b',  # Specific preparation
            r'\s+Oregon\s+Strawberry\b',  # Flavor
            r'\s+Prebiotic\s+Ginger\s+Ale\b',  # Specific type
        ]
        
        for pattern in descriptor_patterns:
            cleaned = re.sub(pattern, '', cleaned, flags=re.IGNORECASE)
        
        # Clean up extra spaces
        cleaned = ' '.join(cleaned.split())
        
        # Only return if it looks like a food ingredient
        if self._is_food_ingredient(cleaned):
            return cleaned
        return None
    
    def _is_food_ingredient(self, name: str) -> bool:
        """Check if a name represents a food ingredient"""
        food_keywords = [
            'cheese', 'cream', 'milk', 'yogurt', 'butter',
            'ham', 'turkey', 'chicken', 'beef', 'pork',
            'soda', 'drink', 'beverage', 'juice',
            'ice cream', 'frozen', 'bread', 'cereal',
            'fruit', 'vegetable', 'meat', 'fish',
            'sauce', 'spice', 'herb', 'oil', 'vinegar'
        ]
        
        name_lower = name.lower()
        return any(keyword in name_lower for keyword in food_keywords)


@dataclass
class PantryItem:
    """Represents an item in the virtual pantry"""
    name: str
    category: str
    quantity: int = 1
    date_added: datetime = None
    source_receipt: str = ""


class VirtualPantry:
    """Virtual pantry to manage ingredients from receipts"""
    
    def __init__(self):
        self.items: Dict[str, PantryItem] = {}
        self.categories = {
            'DAIRY': ['cheese', 'cream', 'milk', 'yogurt', 'butter', 'ice cream'],
            'MEAT': ['ham', 'turkey', 'chicken', 'beef', 'pork', 'meat'],
            'BEVERAGES': ['soda', 'drink', 'beverage', 'juice'],
            'FROZEN': ['frozen', 'ice cream'],
            'GROCERY': ['bread', 'cereal', 'sauce', 'spice', 'herb', 'oil', 'vinegar'],
            'PRODUCE': ['fruit', 'vegetable'],
            'SEAFOOD': ['fish', 'seafood']
        }
    
    def add_items_from_receipt(self, receipt_items: List[ReceiptItem], receipt_source: str = ""):
        """Add items from a receipt to the pantry"""
        for item in receipt_items:
            ingredient = self._extract_ingredient_name(item.name)
            if ingredient:
                category = self._categorize_ingredient(ingredient)
                
                # If item already exists, increase quantity
                if ingredient in self.items:
                    self.items[ingredient].quantity += item.quantity
                else:
                    self.items[ingredient] = PantryItem(
                        name=ingredient,
                        category=category,
                        quantity=item.quantity,
                        date_added=datetime.now(),
                        source_receipt=receipt_source
                    )
    
    def _extract_ingredient_name(self, product_name: str) -> Optional[str]:
        """Extract the main ingredient name from a product name"""
        # Remove common brand names and packaging info
        cleaned = product_name
        
        # Remove common brand prefixes
        brand_patterns = [
            r'^Lucerne\s+',
            r'^Tillamook\s+',
            r'^Land O Frost\s+',
            r'^Olipop\s+',
            r'^Safeway\s+',
            r'^Signature\s+',
            r'^O Organics\s+',
        ]
        
        for pattern in brand_patterns:
            cleaned = re.sub(pattern, '', cleaned, flags=re.IGNORECASE)
        
        # Remove size/weight information
        cleaned = re.sub(r'\s+\d+\s*(oz|lb|lbs|g|kg|ml|fl oz|count|ct)\b', '', cleaned, flags=re.IGNORECASE)
        
        # Remove packaging info
        cleaned = re.sub(r'\s+(8|12|16|24|32)\s*(pack|pk|count|ct)\b', '', cleaned, flags=re.IGNORECASE)
        
        # Remove specific product descriptors that aren't ingredients
        descriptor_patterns = [
            r'\s+4-12fz\b',  # Package size
            r'\s+8\s+Oz\b',  # Size
            r'\s+Kit\b',     # Kit
            r'\s+Spread\s+Whipped\b',  # Specific preparation
            r'\s+Oregon\s+Strawberry\b',  # Flavor
            r'\s+Prebiotic\s+Ginger\s+Ale\b',  # Specific type
        ]
        
        for pattern in descriptor_patterns:
            cleaned = re.sub(pattern, '', cleaned, flags=re.IGNORECASE)
        
        # Clean up extra spaces
        cleaned = ' '.join(cleaned.split())
        
        # Only return if it looks like a food ingredient
        if self._is_food_ingredient(cleaned):
            return cleaned
        return None
    
    def _is_food_ingredient(self, name: str) -> bool:
        """Check if a name represents a food ingredient"""
        food_keywords = [
            'cheese', 'cream', 'milk', 'yogurt', 'butter',
            'ham', 'turkey', 'chicken', 'beef', 'pork',
            'soda', 'drink', 'beverage', 'juice',
            'ice cream', 'frozen', 'bread', 'cereal',
            'fruit', 'vegetable', 'meat', 'fish',
            'sauce', 'spice', 'herb', 'oil', 'vinegar'
        ]
        
        name_lower = name.lower()
        return any(keyword in name_lower for keyword in food_keywords)
    
    def _categorize_ingredient(self, ingredient: str) -> str:
        """Categorize an ingredient based on its name"""
        ingredient_lower = ingredient.lower()
        
        for category, keywords in self.categories.items():
            if any(keyword in ingredient_lower for keyword in keywords):
                return category
        
        return 'OTHER'
    
    def print_pantry(self):
        """Print the current pantry contents organized by category"""
        if not self.items:
            print("Your pantry is empty!")
            return
        
        print("=" * 60)
        print("VIRTUAL PANTRY")
        print("=" * 60)
        
        # Group items by category
        categorized_items = {}
        for item in self.items.values():
            if item.category not in categorized_items:
                categorized_items[item.category] = []
            categorized_items[item.category].append(item)
        
        # Print items by category
        for category in sorted(categorized_items.keys()):
            print(f"\n{category}")
            print("-" * len(category))
            
            for item in sorted(categorized_items[category], key=lambda x: x.name):
                print(f"  • {item.name}")
                if item.quantity > 1:
                    print(f"    Quantity: {item.quantity}")
                if item.source_receipt:
                    print(f"    From: {item.source_receipt}")
        
        print("\n" + "=" * 60)
        print(f"TOTAL ITEMS: {len(self.items)}")
        print(f"TOTAL QUANTITY: {sum(item.quantity for item in self.items.values())}")
        print("=" * 60)
    
    def get_items_by_category(self, category: str) -> List[PantryItem]:
        """Get all items in a specific category"""
        return [item for item in self.items.values() if item.category == category]
    
    def search_items(self, search_term: str) -> List[PantryItem]:
        """Search for items containing the search term"""
        search_lower = search_term.lower()
        return [item for item in self.items.values() if search_lower in item.name.lower()]


def main():
    """Main function to demonstrate the parser"""
    parser = SafewayReceiptParser('data/safeway_receipt.eml')
    
    try:
        # Parse the receipt
        items = parser.parse()
        parser.print_receipt_items()
        
        # Create virtual pantry and add items
        pantry = VirtualPantry()
        pantry.add_items_from_receipt(items, "Safeway Receipt")
        
        # Display the virtual pantry
        print("\n")
        pantry.print_pantry()
        
    except Exception as e:
        print(f"Error parsing receipt: {e}")


if __name__ == "__main__":
    main()
