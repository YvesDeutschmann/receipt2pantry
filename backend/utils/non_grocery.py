"""Deny-list helpers: keep non-grocery receipt lines out of the pantry."""

import re
from typing import Any, Mapping, Optional

_NON_GROCERY_NORMALIZED_CATEGORIES = frozenset(
    {"household", "personal_care", "pet", "pharmacy", "non_food"}
)

# Multi-word and single-token name patterns (applied to uppercased raw_name)
_NAME_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\bGASOLINE\b",
        r"\bUNLEADED\b",
        r"\bDIESEL\b",
        r"\bFUEL\b",
        r"\bCAR\s+WASH\b",
        r"\bCARWASH\b",
        r"\bPREMIUM\s+GAS\b",
        r"\bREG\s+UNL\b",
        r"\bBAG\s+FEE\b",
        r"\bBAG\s+CHARGE\b",
        r"\bCARRYOUT\s+BAG\b",
        r"\bPAPER\s+BAG\b",
        r"\bREUSABLE\s+BAG\b",
        r"\bTOOTHPASTE\b",
        r"\bCOLGATE\b",
        r"\bCREST\b",
        r"\bSHAMPOO\b",
        r"\bDEODORANT\b",
        r"\bRAZOR\b",
        r"\bLOTION\b",
        r"\bMOUTHWASH\b",
        r"\bFLOSS\b",
        r"\bTAMPON\b",
        r"\bDIAPER\b",
        r"\bWIPES\b",
        r"\bDETERGENT\b",
        r"\bTIDE\b",
        r"\bBLEACH\b",
        r"\bCLOROX\b",
        r"\bDISH\s+SOAP\b",
        r"\bCASCADE\b",
        r"\bLYSOL\b",
        r"\bBATH\s+TISSUE\b",
        r"\bPAPER\s+TOWEL\b",
        r"\bTOILET\s+PAPER\b",
        r"\bNAPKINS\b",
        r"\bTRASH\s+BAG\b",
        r"\bZIPLOC\b",
        r"\bDOG\s+FOOD\b",
        r"\bCAT\s+FOOD\b",
        r"\bCAT\s+LITTER\b",
        r"\bRX\b",
        r"\bIBUPROFEN\b",
        r"\bTYLENOL\b",
        r"\bADVIL\b",
        r"\bALLERGY\b",
    )
)

# Whole-line bag fee lines only (not BAGEL / BAGGED / trailing BAG on produce)
_STANDALONE_BAG = re.compile(r"^\s*BAGS?\s*$", re.IGNORECASE)

# Foil as product (not substring of unrelated words)
_FOIL_PATTERN = re.compile(r"\b(ALUMINUM\s+)?FOIL\b", re.IGNORECASE)

# PET only as standalone word (not PETITE)
_PET_STANDALONE = re.compile(r"\bPET\b", re.IGNORECASE)

_DEPARTMENT_NON_GROCERY = frozenset(
    {
        "health beauty",
        "hbc",
        "pharmacy",
        "household",
        "general merchandise",
        "cleaning",
        "paper",
        "pet",
        "fuel",
        "automotive",
    }
)


def _normalize_department(category: Optional[str]) -> str:
    if not category:
        return ""
    s = category.strip().lower()
    s = re.sub(r"[&/]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _department_is_non_grocery(category: Optional[str]) -> bool:
    norm = _normalize_department(category)
    if not norm:
        return False
    if norm in _DEPARTMENT_NON_GROCERY:
        return True
    if "health" in norm and "beauty" in norm:
        return True
    if norm.startswith("general merch"):
        return True
    return False


def _is_vitamin_supplement_line(upper: str) -> bool:
    if re.search(r"\bVITAMIN\s+D\s+MILK\b", upper):
        return False
    return bool(re.search(r"\bVITAMIN\b", upper))


def is_non_grocery_line(raw_name: Optional[str], category: Optional[str] = "") -> bool:
    """True if a receipt line should not enter pantry normalization."""
    if _department_is_non_grocery(category):
        return True

    name = (raw_name or "").strip()
    if not name:
        return False

    upper = name.upper()

    if _STANDALONE_BAG.match(name):
        return True

    for pat in _NAME_PATTERNS:
        if pat.search(upper):
            return True

    if _FOIL_PATTERN.search(upper):
        return True

    if _PET_STANDALONE.search(upper):
        # PETITE PEAS etc.
        if re.search(r"\bPETITE\b", upper):
            return False
        return True

    if _is_vitamin_supplement_line(upper):
        return True

    return False


def is_non_grocery_normalized(normalized: Optional[Mapping[str, Any]]) -> bool:
    """True if a normalized product mapping should not be added to pantry."""
    if not normalized:
        return False
    cat = (normalized.get("category") or "").strip().lower().replace(" ", "_")
    if cat in _NON_GROCERY_NORMALIZED_CATEGORIES:
        return True
    return False
