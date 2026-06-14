"""Tests for PoolGenerator."""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.services.pool_generator import create_pool_generator
from backend.utils.exceptions import AIServiceException


# --- Shared fixtures ---------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[2]
DEBUG_LOG_PATH = REPO_ROOT / "debug-ef2920.log"


@pytest.fixture(autouse=True)
def patch_agent_dbg_globally():
    """SUG: do not write debug-ef2920.log during tests (functional-core hygiene)."""
    with patch("backend.services.pool_generator._agent_dbg", lambda *a, **k: None):
        yield


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
    return MagicMock()


@pytest.fixture
def meal_plan_service():
    ms = MagicMock()

    async def _staple_return(*_a, **_k):
        return [
            {
                "id": "staple_1",
                "title": "Staple Bowl",
                "is_staple": True,
                "match_percentage": 1.0,
            }
        ]

    ms.suggest_staple_meals = AsyncMock(side_effect=_staple_return)
    return ms


def _generator_with_bans_mock(pool_store, depletion, recipe_service, meal_plan_service):
    gen = create_pool_generator(pool_store, depletion, recipe_service, meal_plan_service)
    rc = MagicMock()
    rc.table.return_value.select.return_value.eq.return_value.gt.return_value.execute.return_value = MagicMock(
        data=[]
    )
    gen._client = MagicMock(return_value=rc)
    return gen


@pytest.fixture
def generator(pool_store, depletion, recipe_service, meal_plan_service):
    return _generator_with_bans_mock(pool_store, depletion, recipe_service, meal_plan_service)


# --- Group A — mutex ---------------------------------------------------------


def test_generate_pool_short_circuits_when_already_running(
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


def test_generate_pool_calls_start_generation_before_any_db_reads(
    pool_store, depletion, recipe_service, meal_plan_service
):
    sequence = []

    def start_side(*_a, **_k):
        sequence.append("start_generation")
        return {"generation_id": "gen-1", "already_running": False}

    pool_store.start_generation.side_effect = start_side

    def swiped_side(*_a, **_k):
        sequence.append("get_swiped")
        return set()

    pool_store.get_swiped_recipe_ids.side_effect = swiped_side

    client_inst = MagicMock()
    client_inst.table.return_value.select.return_value.eq.return_value.gt.return_value.execute.return_value = (
        MagicMock(data=[])
    )

    def client_side(*_a, **_k):
        sequence.append("supabase_client")
        return client_inst

    gen = create_pool_generator(pool_store, depletion, recipe_service, meal_plan_service)
    gen._client = client_side

    recipe_service.search_recipes_complex.return_value = [
        {
            "id": 401,
            "title": "Ok",
            "usedIngredientCount": 2,
            "missedIngredientCount": 0,
        }
    ]
    recipe_service.get_recipe_details.return_value = {
        "id": 401,
        "servings": 1,
        "extendedIngredients": [{"name": "pasta", "amount": 0.5, "unit": "lb"}],
    }

    gen.generate_pool("hh", "user", "manual_refresh", ["dinner"])

    assert sequence[0] == "start_generation"
    assert sequence.index("start_generation") < sequence.index("supabase_client")


# --- Group B — status transitions --------------------------------------------


def test_generate_pool_calls_complete_generation_with_completed_on_happy_path(
    pool_store, depletion, recipe_service, meal_plan_service
):
    gen = _generator_with_bans_mock(pool_store, depletion, recipe_service, meal_plan_service)
    recipe_service.search_recipes_complex.return_value = [
        {
            "id": 501,
            "title": "A",
            "usedIngredientCount": 1,
            "missedIngredientCount": 0,
        }
    ]
    recipe_service.get_recipe_details.return_value = {
        "id": 501,
        "servings": 1,
        "extendedIngredients": [{"name": "pasta", "amount": 0.5, "unit": "lb"}],
    }
    pool_store.add_suggestions.return_value = 3

    out = gen.generate_pool("hh", "user", "onboarding", ["dinner"])

    assert out["status"] == "completed"
    complete = pool_store.complete_generation
    complete.assert_called()
    final_call = complete.call_args
    assert final_call[0][1] == "completed"
    pool_store.clear_unused.assert_called_once()


def test_generate_pool_marks_partial_on_ai_service_exception_mid_run(
    pool_store, depletion, recipe_service, meal_plan_service
):
    recipe_service.search_recipes_complex.side_effect = AIServiceException("quota")
    gen = _generator_with_bans_mock(pool_store, depletion, recipe_service, meal_plan_service)

    out = gen.generate_pool("hh", "user", "manual_refresh", ["dinner"])
    assert out["status"] == "partial"
    pool_store.complete_generation.assert_called()
    assert pool_store.complete_generation.call_args[0][1] == "partial"
    pool_store.clear_unused.assert_not_called()
    pool_store.add_suggestions.assert_not_called()


def test_generate_pool_marks_failed_on_unexpected_exception(
    pool_store, depletion, recipe_service, meal_plan_service
):
    pool_store.get_swiped_recipe_ids.side_effect = RuntimeError("store down")
    gen = _generator_with_bans_mock(pool_store, depletion, recipe_service, meal_plan_service)

    out = gen.generate_pool("hh", "user", "manual_refresh", ["dinner"])
    assert out["status"] == "failed"
    assert "store down" in (out.get("error") or "")
    pool_store.complete_generation.assert_called()
    assert pool_store.complete_generation.call_args[0][1] == "failed"
    pool_store.clear_unused.assert_not_called()


def test_clear_unused_not_called_when_status_partial(
    pool_store, depletion, recipe_service, meal_plan_service
):
    recipe_service.search_recipes_complex.side_effect = AIServiceException("quota")
    gen = _generator_with_bans_mock(pool_store, depletion, recipe_service, meal_plan_service)

    gen.generate_pool("hh", "user", "manual_refresh", ["dinner"])
    pool_store.clear_unused.assert_not_called()


def test_clear_unused_not_called_when_status_failed(
    pool_store, depletion, recipe_service, meal_plan_service
):
    depletion.snapshot_pantry.side_effect = ValueError("snap")
    gen = _generator_with_bans_mock(pool_store, depletion, recipe_service, meal_plan_service)

    gen.generate_pool("hh", "user", "manual_refresh", ["dinner"])
    pool_store.clear_unused.assert_not_called()


# --- Group C — threshold walk & staples ----------------------------------------


@patch("backend.services.pool_generator.range", return_value=[0])
def test_threshold_walks_from_point_nine_to_point_seven(
    _mock_range,
    pool_store,
    depletion,
    recipe_service,
    meal_plan_service,
):
    """Recipe match 0.7 — filter must be tried at 0.9, 0.8, 0.7 before candidates exist."""
    gen = _generator_with_bans_mock(pool_store, depletion, recipe_service, meal_plan_service)
    thresholds_seen = []
    real_filter = gen._filter_recipes

    def tracking_filter(recipes, threshold, banned, swiped, run_ids):
        thresholds_seen.append(threshold)
        return real_filter(recipes, threshold, banned, swiped, run_ids)

    gen._filter_recipes = tracking_filter  # type: ignore[method-assign]

    recipe_service.search_recipes_complex.return_value = [
        {
            "id": 601,
            "title": "Marginal",
            "usedIngredientCount": 7,
            "missedIngredientCount": 3,
            "image": "x",
        }
    ]
    recipe_service.get_recipe_details.return_value = {
        "id": 601,
        "servings": 1,
        "extendedIngredients": [{"name": "pasta", "amount": 0.1, "unit": "lb"}],
    }
    pool_store.add_suggestions.return_value = 1

    gen.generate_pool("hh", "user", "x", ["dinner"])

    assert len(thresholds_seen) >= 3
    assert thresholds_seen[0] == 0.9
    assert thresholds_seen[1] == 0.8
    assert thresholds_seen[2] == pytest.approx(0.7)


@patch("backend.services.pool_generator.range", return_value=[0])
def test_threshold_walk_stops_at_first_non_empty_set(
    _mock_range,
    pool_store,
    depletion,
    recipe_service,
    meal_plan_service,
):
    gen = _generator_with_bans_mock(pool_store, depletion, recipe_service, meal_plan_service)
    thresholds_seen = []
    real_filter = gen._filter_recipes

    def tracking_filter(recipes, threshold, banned, swiped, run_ids):
        thresholds_seen.append(threshold)
        return real_filter(recipes, threshold, banned, swiped, run_ids)

    gen._filter_recipes = tracking_filter  # type: ignore[method-assign]

    recipe_service.search_recipes_complex.return_value = [
        {
            "id": 602,
            "title": "Strong",
            "usedIngredientCount": 9,
            "missedIngredientCount": 1,
            "image": "y",
        }
    ]
    recipe_service.get_recipe_details.return_value = {
        "id": 602,
        "servings": 1,
        "extendedIngredients": [{"name": "pasta", "amount": 0.1, "unit": "lb"}],
    }

    gen.generate_pool("hh", "user", "x", ["dinner"])

    assert thresholds_seen == [0.9]


def test_sparse_pantry_triggers_staple_fallback_for_breakfast_and_lunch_only(
    pool_store, recipe_service, meal_plan_service
):
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

    gen = _generator_with_bans_mock(pool_store, d, recipe_service, meal_plan_service)
    pool_store.add_suggestions.return_value = 1

    gen.generate_pool("hh", "user", "onboarding", ["breakfast", "lunch"])

    assert meal_plan_service.suggest_staple_meals.call_count == 14
    recipe_service.search_recipes_complex.assert_not_called()


def test_dinner_never_uses_staple_fallback(pool_store, recipe_service, meal_plan_service):
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

    gen = _generator_with_bans_mock(pool_store, d, recipe_service, meal_plan_service)
    recipe_service.search_recipes_complex.return_value = []

    gen.generate_pool("hh", "user", "x", ["dinner"])

    meal_plan_service.suggest_staple_meals.assert_not_called()


def test_staple_recipe_bypasses_threshold_gate(generator):
    recipes = [
        {
            "id": "staple_x",
            "title": "Staple",
            "usedIngredientCount": 1,
            "missedIngredientCount": 99,
        }
    ]
    out = generator._filter_recipes(recipes, 0.9, set(), set(), set())
    assert len(out) == 1
    assert out[0]["match_percentage"] == 1.0


# --- Group D — filter semantics ----------------------------------------------


def test_filter_excludes_banned_recipe_ids(generator):
    recipes = [
        {
            "id": "10",
            "title": "Banned",
            "usedIngredientCount": 1,
            "missedIngredientCount": 0,
        }
    ]
    assert generator._filter_recipes(recipes, 0.5, {"10"}, set(), set()) == []


def test_filter_excludes_swiped_recipe_ids(generator):
    recipes = [
        {
            "id": "20",
            "title": "Swiped",
            "usedIngredientCount": 1,
            "missedIngredientCount": 0,
        }
    ]
    assert generator._filter_recipes(recipes, 0.5, set(), {"20"}, set()) == []


def test_filter_excludes_recipes_already_added_in_run(generator):
    recipes = [
        {
            "id": "30",
            "title": "Dup",
            "usedIngredientCount": 1,
            "missedIngredientCount": 0,
        }
    ]
    assert generator._filter_recipes(recipes, 0.5, set(), set(), {"30"}) == []


# --- Group E — depletion between steps ---------------------------------------


def test_top_candidate_depletes_simulated_pantry_before_next_step(
    pool_store, depletion, recipe_service, meal_plan_service
):
    av_seen = []

    def recipes_by_pantry(hid, uid, av, meal_type, number=5):
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

    recipe_service.search_recipes_complex.side_effect = recipes_by_pantry
    recipe_service.get_recipe_details.return_value = {
        "id": 101,
        "servings": 2,
        "extendedIngredients": [
            {"name": "chicken breast", "amount": 1.0, "unit": "lb"},
        ],
    }
    recipe_service.scale_recipe.side_effect = lambda d, _s: d

    gen = _generator_with_bans_mock(pool_store, depletion, recipe_service, meal_plan_service)
    pool_store.add_suggestions.return_value = 5

    gen.generate_pool("hh", "user", "onboarding", ["dinner"])

    assert len(av_seen) >= 2
    assert "chicken breast" in av_seen[0]
    assert "chicken breast" not in av_seen[1]
    pool_store.clear_unused.assert_called_once()


def test_depletion_failure_is_warned_and_run_continues(
    pool_store, depletion, recipe_service, meal_plan_service
):
    recipe_service.search_recipes_complex.return_value = [
        {
            "id": 701,
            "title": "First",
            "usedIngredientCount": 1,
            "missedIngredientCount": 0,
        }
    ]
    detail_calls = {"n": 0}
    ok_details = {
        "id": 701,
        "servings": 1,
        "extendedIngredients": [{"name": "pasta", "amount": 0.1, "unit": "lb"}],
    }

    def details_side(*_a, **_k):
        detail_calls["n"] += 1
        if detail_calls["n"] == 1:
            raise RuntimeError("scale fail")
        return ok_details

    recipe_service.get_recipe_details.side_effect = details_side
    gen = _generator_with_bans_mock(pool_store, depletion, recipe_service, meal_plan_service)
    pool_store.add_suggestions.return_value = 2

    with patch("backend.services.pool_generator.logger") as log_mock:
        out = gen.generate_pool("hh", "user", "x", ["dinner"])
        assert out["status"] == "completed"
        log_mock.warning.assert_called()
    pool_store.add_suggestions.assert_called()


# --- Group F — side-effects hygiene ------------------------------------------


def test_agent_dbg_patched_does_not_write_debug_file(
    pool_store, depletion, recipe_service, meal_plan_service
):
    if DEBUG_LOG_PATH.exists():
        DEBUG_LOG_PATH.unlink()

    with patch("backend.services.pool_generator._agent_dbg", lambda *a, **k: None):
        gen = _generator_with_bans_mock(pool_store, depletion, recipe_service, meal_plan_service)
        recipe_service.search_recipes_complex.return_value = [
            {
                "id": 801,
                "title": "X",
                "usedIngredientCount": 1,
                "missedIngredientCount": 0,
            }
        ]
        recipe_service.get_recipe_details.return_value = {
            "id": 801,
            "servings": 1,
            "extendedIngredients": [],
        }
        gen.generate_pool("hh", "user", "y", ["dinner"])

    assert not DEBUG_LOG_PATH.exists()


# --- Extra invariants (retained) ---------------------------------------------


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

    recipe_service.search_recipes_complex.return_value = [
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


def test_pool_generator_never_invokes_cook_event_pipeline():
    """SUG-019: pool generation must not touch real cook / pantry decrement paths."""
    root = Path(__file__).resolve().parents[2]
    src = (root / "backend" / "services" / "pool_generator.py").read_text(encoding="utf-8")
    assert "process_cook_event" not in src
    assert "pantry/cook" not in src


def test_partial_after_first_success_does_not_clear_pool(
    pool_store, depletion, recipe_service, meal_plan_service
):
    calls = {"n": 0}

    def by_pantry(*_a, **_k):
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

    recipe_service.search_recipes_complex.side_effect = by_pantry
    recipe_service.get_recipe_details.return_value = {
        "id": 1,
        "servings": 1,
        "extendedIngredients": [{"name": "pasta", "amount": 1, "unit": "lb"}],
    }

    gen = _generator_with_bans_mock(pool_store, depletion, recipe_service, meal_plan_service)

    out = gen.generate_pool("hh", "user", "receipt_scan", ["dinner"])
    assert out["status"] == "partial"
    pool_store.clear_unused.assert_not_called()
    pool_store.add_suggestions.assert_not_called()


def test_recipes_for_step_passes_meal_type_to_complex_search(
    pool_store, depletion, recipe_service, meal_plan_service
):
    gen = _generator_with_bans_mock(pool_store, depletion, recipe_service, meal_plan_service)
    recipe_service.search_recipes_complex.return_value = [
        {
            "id": 701,
            "title": "Dinner Bowl",
            "usedIngredientCount": 2,
            "missedIngredientCount": 0,
            "extendedIngredients": [{"name": "pasta", "amount": 0.5, "unit": "lb"}],
        }
    ]

    gen.generate_pool("hh", "user", "manual_refresh", ["dinner"])

    recipe_service.search_recipes_complex.assert_called()
    _args, kwargs = recipe_service.search_recipes_complex.call_args
    assert _args[3] == "dinner"
    recipe_service.get_recipe_details.assert_not_called()


def test_recipes_for_step_uses_inline_extended_ingredients_for_depletion(
    pool_store, depletion, recipe_service, meal_plan_service
):
    gen = _generator_with_bans_mock(pool_store, depletion, recipe_service, meal_plan_service)
    recipe_service.search_recipes_complex.return_value = [
        {
            "id": 801,
            "title": "Inline",
            "usedIngredientCount": 2,
            "missedIngredientCount": 0,
            "extendedIngredients": [{"name": "pasta", "amount": 0.25, "unit": "lb"}],
        }
    ]

    gen.generate_pool("hh", "user", "manual_refresh", ["dinner"])

    recipe_service.get_recipe_details.assert_not_called()
    depletion.deplete_from_extended_ingredients.assert_called()
