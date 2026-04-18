"""Tests for DepletionEngine (simulated pantry depletion).

Recipe extendedIngredients are applied in order. For each ingredient, the engine
walks pantry rows in insertion order and depletes at most the first row whose
normalized base_ingredient exactly matches the recipe name (`break` after the
first match). One pantry row per recipe ingredient — a single recipe line does
not fan out across multiple pantry rows.
"""

import ast
from copy import deepcopy
from pathlib import Path
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


# --- Group A — snapshot


def test_snapshot_excludes_items_with_zero_quantity(engine, pantry_service):
    pantry_service._get_pantry_items.return_value = [
        {
            "id": "item-zero",
            "normalized_name": "Gone",
            "base_ingredient": "ghost",
            "quantity": 0.0,
            "unit": "each",
            "variant": None,
        },
        {
            "id": "item-ok",
            "normalized_name": "Milk",
            "base_ingredient": "milk",
            "quantity": 1.0,
            "unit": "cup",
            "variant": None,
        },
    ]
    snap = engine.snapshot_pantry("u", "h")
    assert "item-zero" not in snap
    assert "item-ok" in snap


def test_snapshot_is_independent_of_source_pantry_rows(engine, pantry_service):
    row = {
        "id": "item-1",
        "normalized_name": "Chicken",
        "base_ingredient": "chicken breast",
        "quantity": 1.0,
        "unit": "lb",
        "variant": None,
    }
    pantry_service._get_pantry_items.return_value = [row]
    snap = engine.snapshot_pantry("user-1", "hh-1")
    snap["item-1"]["quantity"] = 999.0
    assert row["quantity"] == 1.0


def test_snapshot_never_calls_pantry_service_write_methods(engine, pantry_service):
    engine.snapshot_pantry("user-1", "hh-1")
    pantry_service._get_pantry_items.assert_called_once_with("user-1", "hh-1")
    assert not pantry_service.add_to_pantry.called
    assert not pantry_service.consume_ingredients.called


def test_snapshot_is_deep_copy_of_pantry(engine, pantry_service):
    snap = engine.snapshot_pantry("user-1", "hh-1")
    assert "item-1" in snap
    snap["item-1"]["quantity"] = 0.0
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


# --- Group B — available ingredients


def test_available_ingredient_names_returns_sorted_unique_lowercase(engine):
    simulated = {
        "a": {
            "id": "a",
            "base_ingredient": "Spinach",
            "quantity": 1.0,
            "unit": "bag",
        },
        "b": {
            "id": "b",
            "base_ingredient": "spinach",
            "quantity": 2.0,
            "unit": "bag",
        },
        "c": {
            "id": "c",
            "base_ingredient": "milk",
            "quantity": 1.0,
            "unit": "cup",
        },
    }
    names = engine.available_ingredient_names(simulated)
    assert names == ["milk", "spinach"]


def test_available_ingredient_names_filters_zero_quantity(engine):
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


# --- Group C — depletion


def test_depletion_matches_on_exact_base_ingredient_only(engine):
    simulated = {
        "vinegar": {
            "id": "vinegar",
            "name": "rice vinegar",
            "base_ingredient": "rice vinegar",
            "quantity": 8.0,
            "unit": "fl oz",
            "variant": None,
        },
        "rice": {
            "id": "rice",
            "name": "rice",
            "base_ingredient": "rice",
            "quantity": 2.0,
            "unit": "cup",
            "variant": None,
        },
    }
    ex = [{"name": "rice", "amount": 1.0, "unit": "cup"}]
    out = engine.deplete_from_extended_ingredients(simulated, ex)
    assert float(out["vinegar"]["quantity"]) == 8.0
    assert float(out["rice"]["quantity"]) == 1.0


def test_depletion_does_not_match_egg_against_eggplant(engine):
    simulated = {
        "eggplant": {
            "id": "eggplant",
            "base_ingredient": "eggplant",
            "quantity": 2.0,
            "unit": "each",
            "variant": None,
        },
        "egg": {
            "id": "egg",
            "base_ingredient": "egg",
            "quantity": 6.0,
            "unit": "each",
            "variant": None,
        },
    }
    ex = [{"name": "egg", "amount": 1.0, "unit": "each"}]
    out = engine.deplete_from_extended_ingredients(simulated, ex)
    assert float(out["eggplant"]["quantity"]) == 2.0
    assert float(out["egg"]["quantity"]) == 5.0


def test_depletion_does_not_match_oil_against_olive_oil(engine):
    simulated = {
        "olive": {
            "id": "olive",
            "base_ingredient": "olive oil",
            "quantity": 16.0,
            "unit": "fl oz",
            "variant": None,
        },
        "oil": {
            "id": "oil",
            "base_ingredient": "oil",
            "quantity": 8.0,
            "unit": "fl oz",
            "variant": None,
        },
    }
    ex = [{"name": "oil", "amount": 1.0, "unit": "fl oz"}]
    out = engine.deplete_from_extended_ingredients(simulated, ex)
    assert float(out["olive"]["quantity"]) == 16.0
    assert float(out["oil"]["quantity"]) == 7.0


def test_depletion_skips_when_unit_differs(engine):
    simulated = {
        "chicken": {
            "id": "chicken",
            "base_ingredient": "chicken breast",
            "quantity": 2.0,
            "unit": "lb",
            "variant": None,
        },
    }
    ex = [{"name": "chicken breast", "amount": 500.0, "unit": "g"}]
    out = engine.deplete_from_extended_ingredients(simulated, ex)
    assert float(out["chicken"]["quantity"]) == 2.0


def test_depletion_clamps_at_zero_when_recipe_exceeds_pantry_quantity(engine):
    simulated = {
        "milk": {
            "id": "milk",
            "base_ingredient": "milk",
            "quantity": 2.0,
            "unit": "cup",
            "variant": None,
        },
    }
    ex = [{"name": "milk", "amount": 5.0, "unit": "cup"}]
    out = engine.deplete_from_extended_ingredients(simulated, ex)
    assert "milk" not in out


def test_depletion_removes_row_when_quantity_reaches_zero(engine):
    simulated = {
        "item-1": {
            "id": "item-1",
            "base_ingredient": "chicken breast",
            "quantity": 1.0,
            "unit": "lb",
            "variant": None,
        },
    }
    ex = [{"name": "chicken breast", "amount": 1.0, "unit": "lb"}]
    out = engine.deplete_from_extended_ingredients(simulated, ex)
    assert "item-1" not in out


def test_depletion_consumes_only_one_row_per_ingredient(engine):
    simulated = {
        "rice-a": {
            "id": "rice-a",
            "base_ingredient": "rice",
            "quantity": 1.0,
            "unit": "cup",
            "variant": None,
        },
        "rice-b": {
            "id": "rice-b",
            "base_ingredient": "rice",
            "quantity": 10.0,
            "unit": "cup",
            "variant": None,
        },
    }
    ex = [{"name": "rice", "amount": 0.25, "unit": "cup"}]
    out = engine.deplete_from_extended_ingredients(simulated, ex)
    assert float(out["rice-a"]["quantity"]) == 0.75
    assert float(out["rice-b"]["quantity"]) == 10.0


def test_deplete_from_extended_ingredients_does_not_mutate_input(engine):
    engine = create_depletion_engine(MagicMock())
    simulated = {
        "item-1": {
            "id": "item-1",
            "base_ingredient": "chicken breast",
            "quantity": 1.0,
            "unit": "lb",
        },
    }
    orig = deepcopy(simulated)
    ex = [{"name": "chicken breast", "amount": 1.0, "unit": "lb"}]
    out = engine.deplete_from_extended_ingredients(simulated, ex)
    assert simulated == orig
    assert "item-1" not in out or float(out.get("item-1", {}).get("quantity", 0)) == 0.0


def test_depletion_returns_new_dict_original_unchanged(engine):
    simulated = {
        "x": {
            "id": "x",
            "base_ingredient": "sugar",
            "quantity": 3.0,
            "unit": "tbsp",
            "variant": None,
        },
    }
    before = deepcopy(simulated)
    ex = [{"name": "sugar", "amount": 1.0, "unit": "tbsp"}]
    out = engine.deplete_from_extended_ingredients(simulated, ex)
    assert simulated == before
    assert float(out["x"]["quantity"]) == 2.0


def test_deplete_reduces_quantity_exact_name_match(engine):
    simulated = {
        "item-1": {
            "id": "item-1",
            "base_ingredient": "chicken breast",
            "quantity": 1.0,
            "unit": "lb",
        },
    }
    ex = [{"name": "chicken breast", "amount": 1.0, "unit": "lb"}]
    out = engine.deplete_from_extended_ingredients(simulated, ex)
    assert "item-1" not in out


# --- Group D — time-determinism guard


class _DateTimeCallVisitor(ast.NodeVisitor):
    def __init__(self) -> None:
        self.violations: list[str] = []

    def visit_Call(self, node: ast.Call) -> None:
        func = node.func
        if isinstance(func, ast.Attribute) and func.attr in ("today", "now"):
            self.violations.append(func.attr)
        self.generic_visit(node)


def test_depletion_engine_has_no_datetime_now_or_today_calls():
    root = Path(__file__).resolve().parents[2]
    path = root / "backend" / "services" / "depletion_engine.py"
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    visitor = _DateTimeCallVisitor()
    visitor.visit(tree)
    assert not visitor.violations, (
        "depletion_engine must not call datetime.now()/today(); " f"found: {visitor.violations}"
    )
