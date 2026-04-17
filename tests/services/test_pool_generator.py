"""Tests for PoolGenerator."""

from pathlib import Path

from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.services.pool_generator import PoolGenerator, create_pool_generator
from backend.utils.exceptions import AIServiceException


@pytest.fixture
def pool_store():
    ps = MagicMock()
    ps.supabase = MagicMock()
    ps.supabase.get_household_members.return_value = [{"user_id": "u1"}]
    ps.start_generation.return_value = {"generation_id": "gen-1", "already_running": False}
    ps.get_swiped_recipe_ids.return_value = set()
    ps.add_suggestions.return_value = 2
    return ps


@pytest.fixture
def depletion():
    d = MagicMock()
    d.snapshot_pantry.return_value = {
        "pi1": {
            "id": "pi1",
            "base_ingredient": "chicken breast",
            "quantity": 1.0,
            "unit": "lb",
        },
        "pi2": {
            "id": "pi2",
            "base_ingredient": "pasta",
            "quantity": 1.0,
            "unit": "lb",
        },
    }

    def avail(sim):
        from backend.services.depletion_engine import DepletionEngine

        # delegate to real logic for names
        real = DepletionEngine(MagicMock())
        return real.available_ingredient_names(sim)

    d.available_ingredient_names.side_effect = avail

    from backend.services.depletion_engine import DepletionEngine

    real_de = DepletionEngine(MagicMock())

    def deplete(sim, ex):
        return real_de.deplete_from_extended_ingredients(sim, ex)

    d.deplete_from_extended_ingredients.side_effect = deplete
    return d


@pytest.fixture
def recipe_service():
    rs = MagicMock()
    return rs


@pytest.fixture
def meal_plan_service():
    ms = MagicMock()
    ms.suggest_staple_meals = AsyncMock(
        return_value=[
            {
                "id": "staple_1",
                "title": "Staple Bowl",
                "is_staple": True,
                "match_percentage": 1.0,
            }
        ]
    )
    return ms


@pytest.fixture
def generator(pool_store, depletion, recipe_service, meal_plan_service):
    gen = create_pool_generator(pool_store, depletion, recipe_service, meal_plan_service)
    # recipe bans query
    rc = MagicMock()
    rc.table.return_value.select.return_value.eq.return_value.gt.return_value.execute.return_value = MagicMock(
        data=[]
    )
    gen._client = MagicMock(return_value=rc)
    return gen


def test_generate_pool_returns_already_running_if_mutex_held(
    pool_store, depletion, recipe_service, meal_plan_service
):
    pool_store.start_generation.return_value = {
        "generation_id": "existing",
        "already_running": True,
    }
    gen = create_pool_generator(pool_store, depletion, recipe_service, meal_plan_service)
    gen._client = MagicMock(return_value=MagicMock())

    out = gen.generate_pool("hh", "user", "receipt_scan", ["dinner"])
    assert out["status"] == "already_running"
    assert out["suggestions_generated"] == 0
    pool_store.clear_unused.assert_not_called()


def test_generate_pool_preserves_existing_unused_on_network_failure(
    pool_store, depletion, recipe_service, meal_plan_service
):
    recipe_service.get_recipes_by_pantry.side_effect = AIServiceException("quota")
    gen = create_pool_generator(pool_store, depletion, recipe_service, meal_plan_service)
    # bans
    rc = MagicMock()
    rc.table.return_value.select.return_value.eq.return_value.gt.return_value.execute.return_value = MagicMock(
        data=[]
    )
    gen._client = MagicMock(return_value=rc)

    out = gen.generate_pool("hh", "user", "manual_refresh", ["dinner"])
    assert out["status"] == "partial"
    pool_store.clear_unused.assert_not_called()
    pool_store.add_suggestions.assert_not_called()


def test_generate_pool_depletion_across_steps_excludes_consumed_ingredient(
    pool_store, depletion, recipe_service, meal_plan_service
):
    """After first dinner depletes chicken, later get_recipes_by_pantry calls omit chicken."""
    av_seen = []

    def recipes_by_pantry(hid, uid, av, number=5):
        av_seen.append(list(av))
        if "chicken breast" in av:
            return [
                {
                    "id": 101,
                    "title": "Chicken Pasta",
                    "usedIngredientCount": 2,
                    "missedIngredientCount": 0,
                    "image": "x",
                }
            ]
        return [
            {
                "id": 202,
                "title": "Pasta Only",
                "usedIngredientCount": 1,
                "missedIngredientCount": 0,
                "image": "y",
            }
        ]

    recipe_service.get_recipes_by_pantry.side_effect = recipes_by_pantry
    recipe_service.get_recipe_details.return_value = {
        "id": 101,
        "servings": 2,
        "extendedIngredients": [
            {"name": "chicken breast", "amount": 1.0, "unit": "lb"},
        ],
    }
    recipe_service.scale_recipe.side_effect = lambda d, _s: d

    gen = create_pool_generator(pool_store, depletion, recipe_service, meal_plan_service)
    rc = MagicMock()
    rc.table.return_value.select.return_value.eq.return_value.gt.return_value.execute.return_value = MagicMock(
        data=[]
    )
    gen._client = MagicMock(return_value=rc)

    pool_store.add_suggestions.return_value = 5

    gen.generate_pool("hh", "user", "onboarding", ["dinner"])

    assert len(av_seen) >= 2
    assert "chicken breast" in av_seen[0]
    assert "chicken breast" not in av_seen[1]
    pool_store.clear_unused.assert_called_once()


def test_generate_pool_sparse_pantry_uses_staple_fallback(
    pool_store, depletion, recipe_service, meal_plan_service
):
    """<3 ingredients for breakfast/lunch uses suggest_staple_meals."""
    sp = MagicMock()
    sp.supabase = MagicMock()
    sp.supabase.get_household_members.return_value = [{"user_id": "u1"}]
    sp.start_generation.return_value = {"generation_id": "g1", "already_running": False}
    sp.get_swiped_recipe_ids.return_value = set()
    sp.add_suggestions.return_value = 1

    d = MagicMock()
    d.snapshot_pantry.return_value = {
        "a": {
            "id": "a",
            "base_ingredient": "salt",
            "quantity": 1.0,
            "unit": "tsp",
        },
    }

    def avail(sim):
        from backend.services.depletion_engine import DepletionEngine

        return DepletionEngine(MagicMock()).available_ingredient_names(sim)

    d.available_ingredient_names.side_effect = avail
    from backend.services.depletion_engine import DepletionEngine

    real_de = DepletionEngine(MagicMock())
    d.deplete_from_extended_ingredients.side_effect = real_de.deplete_from_extended_ingredients

    gen = create_pool_generator(sp, d, recipe_service, meal_plan_service)
    rc = MagicMock()
    rc.table.return_value.select.return_value.eq.return_value.gt.return_value.execute.return_value = MagicMock(
        data=[]
    )
    gen._client = MagicMock(return_value=rc)

    gen.generate_pool("hh", "user", "onboarding", ["breakfast"])

    meal_plan_service.suggest_staple_meals.assert_called()
    recipe_service.get_recipes_by_pantry.assert_not_called()


def test_generate_pool_does_not_decrement_real_pantry(
    pool_store, recipe_service, meal_plan_service
):
    pantry = MagicMock()
    pantry._get_pantry_items.return_value = [
        {
            "id": "x",
            "base_ingredient": "rice",
            "quantity": 1.0,
            "unit": "cup",
        }
    ]
    from backend.services.depletion_engine import DepletionEngine

    real_de = DepletionEngine(pantry)
    gen = create_pool_generator(pool_store, real_de, recipe_service, meal_plan_service)
    rc = MagicMock()
    rc.table.return_value.select.return_value.eq.return_value.gt.return_value.execute.return_value = MagicMock(
        data=[]
    )
    gen._client = MagicMock(return_value=rc)

    recipe_service.get_recipes_by_pantry.return_value = [
        {
            "id": 303,
            "title": "Rice bowl",
            "usedIngredientCount": 1,
            "missedIngredientCount": 0,
        }
    ]
    recipe_service.get_recipe_details.return_value = {
        "id": 303,
        "servings": 1,
        "extendedIngredients": [{"name": "rice", "amount": 0.5, "unit": "cup"}],
    }

    gen.generate_pool("hh", "user", "low_watermark", ["dinner"])

    pantry._get_pantry_items.assert_called()
    assert not pantry.update_item.called
    assert not pantry.add_to_pantry.called


def test_generate_pool_excludes_swiped_recipe_ids(
    pool_store, depletion, recipe_service, meal_plan_service
):
    pool_store.get_swiped_recipe_ids.return_value = {"55"}
    recipe_service.get_recipes_by_pantry.return_value = [
        {
            "id": 55,
            "title": "Swiped",
            "usedIngredientCount": 1,
            "missedIngredientCount": 0,
        },
        {
            "id": 66,
            "title": "Ok",
            "usedIngredientCount": 1,
            "missedIngredientCount": 0,
        },
    ]
    recipe_service.get_recipe_details.return_value = {
        "id": 66,
        "servings": 1,
        "extendedIngredients": [{"name": "pasta", "amount": 1, "unit": "lb"}],
    }

    gen = create_pool_generator(pool_store, depletion, recipe_service, meal_plan_service)
    rc = MagicMock()
    rc.table.return_value.select.return_value.eq.return_value.gt.return_value.execute.return_value = MagicMock(
        data=[]
    )
    gen._client = MagicMock(return_value=rc)
    pool_store.add_suggestions.return_value = 1

    gen.generate_pool("hh", "user", "manual_refresh", ["dinner"])

    args, kwargs = pool_store.add_suggestions.call_args
    rows = args[3]
    # rows are accumulated from all steps; filter should drop 55
    for r in rows:
        assert str(r["recipe_id"]) != "55"


def test_pool_generator_never_invokes_cook_event_pipeline():
    """SUG-019: pool generation must not touch real cook / pantry decrement paths."""
    root = Path(__file__).resolve().parents[2]
    src = (root / "backend" / "services" / "pool_generator.py").read_text(encoding="utf-8")
    assert "process_cook_event" not in src
    assert "pantry/cook" not in src


def test_generate_pool_partial_after_first_success_does_not_clear_pool(
    pool_store, depletion, recipe_service, meal_plan_service
):
    pool_store.add_suggestions.return_value = 3
    calls = {"n": 0}

    def by_pantry(*a, **k):
        calls["n"] += 1
        if calls["n"] == 1:
            return [
                {
                    "id": 1,
                    "title": "A",
                    "usedIngredientCount": 1,
                    "missedIngredientCount": 0,
                }
            ]
        raise AIServiceException("quota")

    recipe_service.get_recipes_by_pantry.side_effect = by_pantry
    recipe_service.get_recipe_details.return_value = {
        "id": 1,
        "servings": 1,
        "extendedIngredients": [{"name": "pasta", "amount": 1, "unit": "lb"}],
    }

    gen = create_pool_generator(pool_store, depletion, recipe_service, meal_plan_service)
    rc = MagicMock()
    rc.table.return_value.select.return_value.eq.return_value.gt.return_value.execute.return_value = MagicMock(
        data=[]
    )
    gen._client = MagicMock(return_value=rc)

    out = gen.generate_pool("hh", "user", "receipt_scan", ["dinner"])
    assert out["status"] == "partial"
    pool_store.clear_unused.assert_not_called()
    pool_store.add_suggestions.assert_not_called()
