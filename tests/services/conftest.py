"""Fixtures for depletion / confidence_engine tests."""

from datetime import date, timedelta
from typing import Any, Dict, Optional

import pytest

# Fixed clock — never use date.today() in tests (see meald-depletion-tests.md)
TEST_DATE = date(2026, 4, 10)


def make_pantry_item(**overrides: Any) -> Dict[str, Any]:
    """Default pantry row dict for unit tests."""
    base: Dict[str, Any] = {
        "id": "00000000-0000-0000-0000-000000000001",
        "user_id": "00000000-0000-0000-0000-000000000001",
        "base_ingredient": "spinach",
        "normalized_name": "spinach",
        "variant": "test",
        "unit": "bag",
        "depletion_class": "PERISHABLE",
        "is_frozen": False,
        "quantity_known": True,
        "put_back_count": 0,
    }
    base.update(overrides)
    return base


def make_classification(**overrides: Any) -> Dict[str, Any]:
    d: Dict[str, Any] = {
        "item_name": "spinach",
        "depletion_class": "PERISHABLE",
        "sub_class": "leafy_green",
        "shelf_life_days": 5,
        "grace_buffer_days": 3,
        "default_days_supply": None,
        "is_soft_required": False,
    }
    d.update(overrides)
    return d


@pytest.fixture
def test_today() -> date:
    return TEST_DATE


@pytest.fixture
def default_user_prefs() -> Dict[str, Any]:
    return {"depletion_multiplier": 1.0}


def days_ago(d: date, n: int) -> date:
    return d - timedelta(days=n)


def days_after(d: date, n: int) -> date:
    return d + timedelta(days=n)
