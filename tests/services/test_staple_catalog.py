"""Staple recipe catalog loader and pantry matching."""

import pytest

from backend.services.staple_catalog import (
    get_staple_recipe,
    list_staples_for_pantry,
    staple_recipe_ids,
    thin_card_from_catalog,
)


def test_catalog_has_nine_ids():
    assert len(staple_recipe_ids()) == 9
    assert "staple_aglio_olio" in staple_recipe_ids()


def test_get_staple_recipe_returns_instructions():
    recipe = get_staple_recipe("staple_omelette")
    assert recipe is not None
    assert recipe["title"] == "Omelette"
    assert recipe["analyzedInstructions"][0]["steps"]


def test_egg_pantry_returns_breakfast_staples():
    pantry = {
        "i1": {"base_ingredient": "egg", "quantity": 6, "unit": "count"},
    }
    results = list_staples_for_pantry(pantry, "breakfast")
    ids = {r["id"] for r in results}
    assert "staple_omelette" in ids
    assert "staple_scrambled_eggs" in ids


def test_eggplant_does_not_unlock_omelette():
    pantry = {
        "i1": {"base_ingredient": "eggplant", "quantity": 1, "unit": "count"},
    }
    results = list_staples_for_pantry(pantry, "breakfast")
    assert "staple_omelette" not in {r["id"] for r in results}


def test_dinner_pantry_returns_three_dinners():
    pantry = {
        "p": {"base_ingredient": "pasta", "quantity": 1, "unit": "box"},
        "t": {"base_ingredient": "canned tomatoes", "quantity": 1, "unit": "can"},
        "r": {"base_ingredient": "white rice", "quantity": 1, "unit": "lb"},
        "b": {"base_ingredient": "canned black beans", "quantity": 1, "unit": "can"},
    }
    results = list_staples_for_pantry(pantry, "dinner")
    ids = {r["id"] for r in results}
    assert ids == {
        "staple_aglio_olio",
        "staple_tomato_pasta",
        "staple_rice_beans",
    }


def test_dinner_sparse_returns_empty():
    pantry = {
        "s": {"base_ingredient": "salt", "quantity": 1, "unit": "tsp"},
        "o": {"base_ingredient": "olive oil", "quantity": 1, "unit": "bottle"},
    }
    assert list_staples_for_pantry(pantry, "dinner") == []


def test_thin_card_has_no_extended_ingredients():
    full = get_staple_recipe("staple_pbj")
    thin = thin_card_from_catalog(full)
    assert thin["is_staple"] is True
    assert thin["image"] == "/staples/staple_pbj.webp"
    assert "extendedIngredients" not in thin
    assert "analyzedInstructions" not in thin


def test_catalog_rejects_html_in_summary(monkeypatch, tmp_path):
    import backend.services.staple_catalog as mod

    bad = [
        {
            "id": "staple_omelette",
            "meal_type": "breakfast",
            "required_bases": ["egg"],
            "title": "Bad",
            "readyInMinutes": 5,
            "servings": 1,
            "summary": "<script>",
            "image": "/staples/staple_omelette.webp",
            "extendedIngredients": [
                {"name": "egg", "original": "1 egg", "amount": 1, "unit": ""}
            ],
            "instructions": "x",
            "analyzedInstructions": [{"name": "", "steps": [{"number": 1, "step": "x"}]}],
        }
    ]
    path = tmp_path / "staple_recipes.json"
    path.write_text(__import__("json").dumps(bad), encoding="utf-8")
    monkeypatch.setattr(mod, "_DATA_PATH", path)
    with pytest.raises(ValueError, match="plain text"):
        mod._load_catalog()
