"""Safeway receipt parser implementing BaseParser interface"""

import re
from datetime import date, datetime
from email import policy
from email.parser import Parser
from typing import Any, Dict, List, Optional, Tuple

from backend.parsers.base_parser import BaseParser
from backend.parsers.parser_registry import register_parser
from backend.utils.exceptions import ParserException
from backend.utils.logger import get_logger

logger = get_logger(__name__)

_WEIGHT_PRICE = re.compile(
    r"(?P<raw>.+?)(?P<lbs>\d+\.?\d*)\s*lb\s*@\s*(?P<rate>\d+\.?\d*)\s*/\s*lb",
    re.IGNORECASE | re.DOTALL,
)


@register_parser("safeway")
class SafewayParser(BaseParser):
    """Parser for Safeway receipt emails"""

    @property
    def parser_name(self) -> str:
        return "safeway"

    def parse(self, raw_data: str) -> Dict:
        """
        Parse Safeway receipt email.

        Args:
            raw_data: Raw email content (.eml file contents)

        Returns:
            Dictionary with parsed receipt data
        """
        logger.info("Parsing Safeway receipt")

        if raw_data is None or not str(raw_data).strip():
            raise ParserException("Cannot parse Safeway receipt: empty body")

        plain = self._decode_raw_to_plain_text(str(raw_data))
        if not plain.strip():
            raise ParserException("Cannot parse Safeway receipt: empty body after decoding")

        if not self._is_safeway_receipt(str(raw_data), plain):
            raise ParserException("Not a Safeway receipt email")

        order_id = self._extract_order_id(plain)
        if not order_id:
            raise ParserException("Missing required field: order_id")

        order_date = self._extract_order_date(plain)
        if order_date is None:
            raise ParserException("Missing required field: order_date")

        items = self._parse_receipt_items(plain)
        extracted_total = self._extract_total(plain)
        computed = sum(float(i["price"]) * float(i["quantity"]) for i in items)
        total_amount = float(extracted_total) if extracted_total is not None else computed

        order_date_out: Any
        if isinstance(order_date, date) and not isinstance(order_date, datetime):
            order_date_out = order_date.isoformat()
        elif isinstance(order_date, datetime):
            order_date_out = order_date.date().isoformat()
        else:
            order_date_out = order_date

        num_items = sum(float(i["quantity"]) for i in items)

        parsed_data: Dict = {
            "order_id": order_id,
            "order_date": order_date_out,
            "total_amount": total_amount,
            "total": extracted_total,
            "num_items": num_items,
            "items": items,
            "metadata": {
                "parser": "safeway",
            },
        }

        logger.info(
            "Successfully parsed receipt %s with %s item units",
            order_id,
            num_items,
        )
        return parsed_data

    def validate(self, parsed_data: Dict) -> bool:
        """Validate parsed receipt data"""
        required_keys = ["order_id", "order_date", "total_amount", "items"]
        for key in required_keys:
            if key not in parsed_data:
                logger.warning("Missing required key: %s", key)
                return False

        if not isinstance(parsed_data["items"], list):
            return False

        for item in parsed_data["items"]:
            required_item_keys = ["name", "raw_name", "price", "quantity", "category"]
            for key in required_item_keys:
                if key not in item:
                    logger.warning("Missing required item key: %s", key)
                    return False

        return True

    def _is_safeway_receipt(self, raw_data: str, plain: str) -> bool:
        """Reject obvious non-Safeway payloads (e.g. Costco PDF text)."""
        lower = raw_data.lower()
        if "costco wholesale" in lower and "safeway" not in lower:
            return False
        if re.search(r"\bcostco\b", lower) and "safeway" not in plain.lower():
            if "thanks for shopping with safeway" not in plain.lower():
                return False
        try:
            msg = Parser(policy=policy.default).parsestr(raw_data)
            subj = (msg["Subject"] or "").lower()
            from_ = (msg["From"] or "").lower()
            if "safeway" in subj or "p.safeway.com" in from_ or "safeway" in from_:
                return True
        except Exception:
            pass
        return "thanks for shopping with safeway" in plain.lower()

    def _decode_raw_to_plain_text(self, raw_data: str) -> str:
        """Decode MIME parts (quoted-printable, base64) and return best-effort plain text."""
        chunks: List[str] = []
        try:
            msg = Parser(policy=policy.default).parsestr(raw_data)
            if msg.is_multipart():
                for part in msg.walk():
                    if part.get_content_type() == "text/plain":
                        try:
                            body = part.get_content()
                            if body:
                                chunks.append(body)
                        except Exception as e:
                            logger.debug("Skipping text/plain part: %s", e)
            else:
                if msg.get_content_type() == "text/plain":
                    try:
                        body = msg.get_content()
                        if body:
                            chunks.append(body)
                    except Exception:
                        pass
        except Exception as e:
            logger.debug("email.Parser failed, using legacy extraction: %s", e)

        if chunks:
            return "\n".join(chunks)

        return self._legacy_extract_plain_text(raw_data)

    def _legacy_extract_plain_text(self, email_content: str) -> str:
        """Extract plain text when Message is not full MIME (tests, fragments)."""
        text_start = email_content.find("Content-Type: text/plain")
        if text_start == -1:
            if "Thanks for shopping with Safeway" in email_content:
                return email_content
            return ""

        hdr_end = email_content.find("\n\n", text_start)
        if hdr_end == -1:
            return ""

        body_start = hdr_end + 2
        boundary_markers = [
            "\n--",
            "\nContent-Type:",
        ]
        text_end = len(email_content)
        for m in boundary_markers:
            idx = email_content.find(m, body_start)
            if idx != -1:
                text_end = min(text_end, idx)

        text_content = email_content[body_start:text_end]

        encoding = "8bit"
        hdr_region = email_content[text_start:body_start]
        em = re.search(r"Content-Transfer-Encoding:\s*([^\s]+)", hdr_region, re.I)
        if em:
            encoding = em.group(1).strip().lower()

        if encoding == "quoted-printable":
            import quopri

            text_content = quopri.decodestring(
                text_content.encode("utf-8", errors="replace"), header=False
            ).decode("utf-8", errors="replace")
        elif encoding == "base64":
            import base64

            try:
                raw = "".join(text_content.split())
                text_content = base64.b64decode(raw).decode("utf-8", errors="replace")
            except Exception:
                pass

        lines = text_content.split("\n")
        cleaned_lines: List[str] = []
        for line in lines:
            line = line.strip()
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

    def _extract_order_id(self, email_content: str) -> Optional[str]:
        """Extract order / reference id from email body."""
        m = re.search(
            r"Reference\s+Number\s*\n\s*(\d{10,})",
            email_content,
            re.IGNORECASE | re.MULTILINE,
        )
        if m:
            return m.group(1).strip()

        m = re.search(r"Order\s*#?\s*(\d{7}[A-Za-z]\d)", email_content)
        if m:
            return m.group(1).strip()

        return None

    def _extract_order_date(self, email_content: str) -> Optional[date]:
        """Extract purchase date from email body."""
        m = re.search(
            r"Here is your receipt from\s+(\d{1,2})/(\d{1,2})/(\d{4})",
            email_content,
            re.IGNORECASE,
        )
        if m:
            mo, d, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            try:
                return date(y, mo, d)
            except ValueError:
                pass

        m = re.search(
            r"Authorization\s+Date\s*\n\s*(\w{3})\s+(\d{1,2}),\s+(\d{4})",
            email_content,
            re.IGNORECASE | re.MULTILINE,
        )
        if m:
            try:
                dt = datetime.strptime(
                    f"{m.group(1)} {int(m.group(2))}, {m.group(3)}",
                    "%b %d, %Y",
                )
                return dt.date()
            except ValueError:
                pass

        m = re.search(r"(\w{3} \d{1,2}, \d{4})", email_content)
        if m:
            try:
                dt = datetime.strptime(m.group(1), "%b %d, %Y")
                return dt.date()
            except ValueError:
                pass

        return None

    def _extract_total(self, email_content: str) -> Optional[float]:
        """Extract final charged total before Transaction Details when possible."""
        block = email_content
        td = re.search(r"Transaction\s+Details", email_content, re.I)
        if td:
            block = email_content[: td.start()]

        last: Optional[float] = None
        for m in re.finditer(
            r"(?mi)^\s*Total\s*$\s*(?:\n\s*)+\$\s*(\d+\.\d{2})",
            block,
        ):
            try:
                last = float(m.group(1))
            except ValueError:
                continue
        return last

    def _parse_receipt_items(self, email_content: str) -> List[Dict]:
        plain_text_content = email_content
        items: List[Dict] = []
        if plain_text_content:
            items = self._parse_comprehensive_receipt(plain_text_content)

        unique: List[Dict] = []
        seen: set = set()
        for item in items:
            key = item["raw_name"]
            if key not in seen:
                unique.append(item)
                seen.add(key)
        return unique

    def _parse_comprehensive_receipt(self, email_content: str) -> List[Dict]:
        """Parse receipt items using category structure."""
        items: List[Dict] = []
        current_category = "UNKNOWN"

        lines = email_content.split("\n")

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

            if self._is_category_header(line):
                current_category = line
                i += 1
                continue

            if not line or self._should_skip_line(line):
                i += 1
                continue

            if current_category == "UNKNOWN":
                i += 1
                continue

            product_name = line
            weight_match = _WEIGHT_PRICE.search(product_name)
            price: Optional[float] = None
            quantity = 1.0
            unit = "each"
            line_quantity: Optional[float] = None

            if weight_match:
                product_name = weight_match.group("raw").strip(" -")
                line_quantity = float(weight_match.group("lbs"))
                unit = "lb"

            j = i + 1
            while j < summary_start and j < i + 12:
                next_line = lines[j].strip()
                if not next_line:
                    j += 1
                    continue
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

            regular_price: Optional[float] = None
            if price is not None:
                j += 1
                while j < summary_start and j < i + 18:
                    next_line = lines[j].strip()
                    if not next_line:
                        j += 1
                        continue
                    if "Quantity:" in next_line:
                        qm = re.search(r"Quantity:\s*(\d+)", next_line)
                        if qm and line_quantity is None:
                            quantity = float(qm.group(1))
                        elif qm and line_quantity is not None:
                            quantity = line_quantity
                    if "Regular Price" in next_line:
                        reg_price_match = re.search(
                            r"Regular Price\s*\$?\s*(\d+\.\d{2})",
                            next_line,
                            re.I,
                        )
                        if reg_price_match:
                            regular_price = float(reg_price_match.group(1))
                    if self._is_category_header(next_line):
                        break
                    j += 1

            if price is None:
                i += 1
                continue

            if line_quantity is not None:
                quantity = line_quantity

            savings: Optional[float] = None
            if regular_price is not None:
                savings = regular_price - price

            quantity_info = self._extract_quantity_info(product_name)
            unit_price: Optional[float] = None
            if price is not None and quantity and quantity > 0:
                unit_price = price / quantity

            raw_name = lines[i].strip()
            item = {
                "name": product_name,
                "raw_name": raw_name,
                "price": price,
                "quantity": quantity,
                "unit": unit,
                "category": current_category,
                "regular_price": regular_price,
                "savings": savings,
                "quantity_info": quantity_info,
                "unit_price": unit_price,
            }
            items.append(item)

            i += 1

        return items

    def _should_skip_line(self, line: str) -> bool:
        """Check if a line should be skipped."""
        skip_patterns = [
            r"^\$",
            r"^Quantity:",
            r"^Regular Price",
            r"^Total\s*$",
            r"^Subtotal",
            r"^Tax",
            r"^Amount\s*$",
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
        """Check if a line is a category header."""
        category_headers = [
            "GROCERY",
            "MEAT",
            "REFRIG/FROZEN",
            "PRODUCE",
            "BAKERY",
            "BAKED GOODS",
            "DELI",
            "SEAFOOD",
            "PHARMACY",
            "HEALTH & BEAUTY",
            "HOUSEHOLD",
        ]
        return line.upper() in category_headers

    def _extract_quantity_info(self, product_name: str) -> Optional[Dict]:
        """
        Extract quantity/weight/volume information from product name.

        Avoids collapsing multi-word names (e.g. Sparkling Water) by requiring
        numeric + unit patterns, not bare trailing words.
        """
        patterns: List[Tuple[str, str]] = [
            (
                r"(\d+)-(\d+)\s*(oz|fz|fl\s*oz)\b",
                "hyphen",
            ),
            (
                r"(\d+)\s*count\b",
                "count",
            ),
            (
                r"(\d+)\s*pack\b",
                "pack",
            ),
            (
                r"(\d+\.?\d*)\s*(oz|ounce|lb|pound|kg|g|ml|l)\b",
                "std",
            ),
        ]

        for pattern, kind in patterns:
            match = re.search(pattern, product_name, re.IGNORECASE)
            if not match:
                continue
            if kind == "hyphen":
                return {
                    "amount": float(match.group(2)),
                    "unit": "oz",
                }
            if kind == "std":
                unit = match.group(2).lower()
                unit_map = {
                    "ounce": "oz",
                    "pound": "lb",
                    "fz": "oz",
                    "fl oz": "oz",
                }
                unit = unit_map.get(unit, unit)
                return {
                    "amount": float(match.group(1)),
                    "unit": unit,
                }
            if kind == "count":
                return {
                    "amount": float(match.group(1)),
                    "unit": "count",
                }
            if kind == "pack":
                return {
                    "amount": float(match.group(1)),
                    "unit": "pack",
                }

        return None
