"""Costco GraphQL receiptType normalization and grocery vs non-grocery classification."""

import re
from typing import Any, Mapping

_NON_GROCERY_NORMALIZED = frozenset(
    {"gasstation", "carwash", "gasandcarwash", "membershiprenewal"}
)


def normalize_costco_receipt_type(rt: str) -> str:
    """Lowercase and strip spaces/hyphens so e.g. 'Gas Station' -> 'gasstation'."""
    return re.sub(r"[\s\-]", "", rt or "").lower()


def is_non_grocery_costco_receipt_type(rt: str) -> bool:
    """True if receiptType is gas, car wash, combined gas/car wash, or membership renewal (spacing/hyphen variants)."""
    return normalize_costco_receipt_type(rt) in _NON_GROCERY_NORMALIZED


def receipt_type_from_payload(r: Mapping[str, Any]) -> str:
    """Parsed payloads use receipt_type; raw API uses receiptType."""
    return str(r.get("receipt_type") or r.get("receiptType") or "")
