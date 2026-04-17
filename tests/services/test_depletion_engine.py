"""Tests for DepletionEngine (simulated pantry depletion)."""

from copy import deepcopy
from unittest.mock import MagicMock

import pytest

from backend.services.depletion_engine import create_depletion_engine


@pytest.fixture
def pantry_service():
    ps = MagicMock()
    ps._get_pantry_items.return_value = [
        {
            "id": "item-1",
            "normalized_name": "Chicken",
            "base_ingredient": "chicken breast",
            "quantity": 1.0,
            "unit": "lb",
            "variant": None,
        },
        {
            "id": "item-2",
            "normalized_name": "Spinach",
            "base_ingredient": "spinach",
            "quantity": 2.0,
            "unit": "bag",
            "variant": None,
        },
    ]
    return ps


@pytest.fixture
def engine(pantry_service):
    return create_depletion_engine(pantry_service)


def test_snapshot_never_calls_pantry_service_write_methods(engine, pantry_service):
    engine.snapshot_pantry("user-1", "hh-1")
    pantry_service._get_pantry_items.assert_called_once_with("user-1", "hh-1")
    assert not pantry_service.add_to_pantry.called
    assert not pantry_service.consume_ingredients.called


def test_snapshot_is_deep_copy_of_pantry(engine, pantry_service):
    snap = engine.snapshot_pantry("user-1", "hh-1")
    assert "item-1" in snap
    snap["item-1"]["quantity"] = 0.0
    # Original mock data unchanged for next snapshot
    pantry_service._get_pantry_items.return_value = [
        {
            "id": "item-1",
            "normalized_name": "Chicken",
            "base_ingredient": "chicken breast",
            "quantity": 1.0,
            "unit": "lb",
            "variant": None,
        },
    ]
    snap2 = engine.snapshot_pantry("user-1", "hh-1")
    assert float(snap2["item-1"]["quantity"]) == 1.0


def test_deplete_from_extended_ingredients_does_not_mutate_input(engine):
    simulated = {
        "item-1": {
            "id": "item-1",
            "base_ingredient": "chicken breast",
            "quantity": 1.0,
            "unit": "lb",
        }
    }
    orig = deepcopy(simulated)
    ex = [{"name": "chicken breast", "amount": 1.0, "unit": "lb"}]
    out = engine.deplete_from_extended_ingredients(simulated, ex)
    assert simulated == orig
    assert "item-1" not in out or float(out.get("item-1", {}).get("quantity", 0)) == 0.0


def test_deplete_reduces_quantity_and_removes_when_zero(engine):
    simulated = {
        "item-1": {
            "id": "item-1",
            "base_ingredient": "chicken breast",
            "quantity": 1.0,
            "unit": "lb",
        }
    }
    ex = [{"name": "boneless chicken breast", "amount": 1.0, "unit": "lb"}]
    out = engine.deplete_from_extended_ingredients(simulated, ex)
    assert "item-1" not in out


def test_available_ingredient_names_excludes_zero_qty(engine):
    simulated = {
        "a": {
            "id": "a",
            "base_ingredient": "eggs",
            "quantity": 0.0,
            "unit": "count",
        },
        "b": {
            "id": "b",
            "base_ingredient": "milk",
            "quantity": 1.0,
            "unit": "cup",
        },
    }
    names = engine.available_ingredient_names(simulated)
    assert "eggs" not in names
    assert "milk" in names
