"""Shared Costco receipt text extraction helpers."""

from datetime import datetime
import re
from typing import Optional

ORDER_ID_PATTERN = re.compile(r"(\d{20,})")

ORDER_DATE_PATTERNS = (
    (re.compile(r"(\d{1,2}/\d{1,2}/\d{4})"), "%m/%d/%Y"),
    (re.compile(r"(\d{4}-\d{2}-\d{2})"), "%Y-%m-%d"),
    (re.compile(r"(\w{3} \d{1,2}, \d{4})"), "%b %d, %Y"),
)

TOTAL_PATTERNS = (
    re.compile(r"TOTAL\s+\$?(\d+\.\d{2})", re.IGNORECASE),
    re.compile(r"\*\*\*\*\s+TOTAL\s+\$?(\d+\.\d{2})", re.IGNORECASE),
    re.compile(r"AMOUNT:\s+\$?(\d+\.\d{2})", re.IGNORECASE),
)


def extract_costco_order_id(receipt_text: str) -> Optional[str]:
    """Extract Costco transaction/order ID from receipt text."""
    match = ORDER_ID_PATTERN.search(receipt_text)
    if match:
        return match.group(1)
    return None


def extract_costco_order_date(receipt_text: str) -> Optional[datetime]:
    """Extract Costco receipt date from known date formats."""
    for pattern, date_format in ORDER_DATE_PATTERNS:
        match = pattern.search(receipt_text)
        if not match:
            continue

        try:
            return datetime.strptime(match.group(1), date_format)
        except ValueError:
            continue

    return None


def extract_costco_total(receipt_text: str) -> float:
    """Extract total amount from Costco receipt text."""
    for pattern in TOTAL_PATTERNS:
        match = pattern.search(receipt_text)
        if not match:
            continue

        try:
            return float(match.group(1))
        except ValueError:
            continue

    return 0.0
