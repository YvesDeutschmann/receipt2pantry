"""02a — Suggestion cost budgeting, telemetry, pool-first, and fallback ladder."""

import ast
import json
import time
from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

import pytest
import requests

from backend.app import wire_suggestion_pool_store
from backend.config import Config
from backend.services.recipe_service import RecipeService
from backend.services.suggestion_service import (
    SuggestionService,
    _pool_fallback_suggestion_result,
    _pool_grouped_to_suggestion_result,
    create_suggestion_service,
)
from backend.utils.exceptions import AIServiceException, RecipeQuotaException
from tests.services.conftest import TEST_DATE, make_pantry_item


# --- Group A: Config ---


def test_config_budget_defaults():
    assert Config.SPOONACULAR_CALL_BUDGET == 500
    assert Config.SPOONACULAR_CALL_BUDGET_PERIOD_SECONDS == 3600


def test_config_budget_env_override(monkeypatch):
    import importlib

    import backend.config as config_module

    monkeypatch.setenv("SPOONACULAR_CALL_BUDGET", "42")
    monkeypatch.setenv("SPOONACULAR_CALL_BUDGET_PERIOD_SECONDS", "120")
    importlib.reload(config_module)
    assert config_module.Config.SPOONACULAR_CALL_BUDGET == 42
    assert config_module.Config.SPOONACULAR_CALL_BUDGET_PERIOD_SECONDS == 120
    monkeypatch.delenv("SPOONACULAR_CALL_BUDGET", raising=False)
    monkeypatch.delenv("SPOONACULAR_CALL_BUDGET_PERIOD_SECONDS", raising=False)
    importlib.reload(config_module)


# --- Group B: RecipeService ---


def _recipe_config(**overrides):
    cfg = Mock()
    cfg.SPOONACULAR_API_KEY = overrides.get("api_key", "test-spoon-key")
    cfg.SPOONACULAR_BASE_URL = overrides.get("base_url", "https://api.spoonacular.test")
    cfg.SPOONACULAR_TIMEOUT = 30
    cfg.SPOONACULAR_CALL_BUDGET = overrides.get("budget", 500)
    cfg.SPOONACULAR_CALL_BUDGET_PERIOD_SECONDS = overrides.get("period_s", 3600)
    return cfg


def _find_payload():
    return [
        {
            "id": 1,
            "title": "Soup",
            "image": "img.jpg",
            "missedIngredientCount": 0,
            "usedIngredientCount": 1,
            "likes": 0,
            "missedIngredients": [],
        }
    ]


def _ok_response(payload):
    resp = MagicMock()
    resp.raise_for_status = Mock()
    resp.json.return_value = payload
    return resp


def _details_payload(rid=1):
    return {
        "id": rid,
        "title": "Soup",
        "summary": "",
        "image": "img.jpg",
        "readyInMinutes": 20,
        "servings": 2,
        "instructions": "",
        "extendedIngredients": [],
        "analyzedInstructions": [],
        "sourceUrl": "",
        "spoonacularSourceUrl": "",
        "dishTypes": [],
        "cuisines": [],
    }


def test_recipe_call_budget_not_exceeded_allows_request():
    svc = RecipeService(Mock(), _recipe_config())
    assert svc.is_budget_exceeded(now=1000.0) is False


def test_recipe_call_budget_exceeded_returns_true():
    svc = RecipeService(Mock(), _recipe_config(budget=500))
    svc._period_call_count = 500
    svc._period_start = 1000.0
    assert svc.is_budget_exceeded(now=1000.0) is True


def test_recipe_budget_boundary_count_equals_budget():
    svc = RecipeService(Mock(), _recipe_config(budget=10))
    svc._period_call_count = 10
    svc._period_start = 1000.0
    assert svc.is_budget_exceeded(now=1000.0) is True


def test_recipe_new_period_resets_counter():
    svc = RecipeService(Mock(), _recipe_config(budget=500, period_s=3600))
    svc._period_call_count = 500
    svc._period_start = 1000.0
    assert svc.is_budget_exceeded(now=1000.0 + 3600 + 1) is False
    assert svc._period_call_count == 0


def test_recipe_period_does_not_reset_within_window():
    svc = RecipeService(Mock(), _recipe_config(budget=500, period_s=3600))
    svc._period_call_count = 500
    svc._period_start = 1000.0
    assert svc.is_budget_exceeded(now=1000.0 + 3599) is True


def test_recipe_record_external_call_increments_counters():
    svc = RecipeService(Mock(), _recipe_config())
    svc._record_external_call("findByIngredients", now=1000.0)
    svc._record_external_call("findByIngredients", now=1000.0)
    assert svc._call_count == 2
    assert svc._period_call_count == 2


@patch("backend.services.recipe_service.logger")
def test_recipe_record_external_call_emits_log_line(mock_logger):
    svc = RecipeService(Mock(), _recipe_config(budget=500))
    svc._record_external_call("findByIngredients", now=1000.0)
    mock_logger.info.assert_called_once()
    raw = mock_logger.info.call_args[0][0]
    payload = json.loads(raw)
    assert payload["event"] == "spoonacular_external_call"
    assert payload["endpoint"] == "findByIngredients"
    assert "test-spoon-key" not in raw
    assert "user" not in raw.lower()


@patch("backend.services.recipe_service.logger")
def test_recipe_record_sets_over_budget_true_when_past_limit(mock_logger):
    svc = RecipeService(Mock(), _recipe_config(budget=1))
    svc._record_external_call("findByIngredients", now=1000.0)
    svc._record_external_call("findByIngredients", now=1000.0)
    payload = json.loads(mock_logger.info.call_args_list[-1][0][0])
    assert payload["over_budget"] is True


@patch("backend.services.recipe_service.requests.get")
def test_recipe_get_recipes_cache_hit_no_external_call(mock_get):
    svc = RecipeService(Mock(), _recipe_config())
    key = svc._get_cache_key("hh", "u1", ["egg"], 5, 2, False)
    svc._cache[key] = (_find_payload(), 1000.0)
    with patch("backend.services.recipe_service.time.time", return_value=1000.0):
        svc.get_recipes_by_pantry("hh", "u1", available_ingredients=["egg"], number=5)
    mock_get.assert_not_called()
    assert svc._call_count == 0


@patch("backend.services.recipe_service.requests.get")
def test_recipe_get_recipes_cache_miss_records_call(mock_get):
    mock_get.return_value = _ok_response(_find_payload())
    svc = RecipeService(Mock(), _recipe_config())
    svc.get_recipes_by_pantry("hh", "u1", available_ingredients=["egg"], number=5)
    mock_get.assert_called_once()
    assert svc._call_count == 1
    assert "findByIngredients" in mock_get.call_args[0][0]


@patch("backend.services.recipe_service.requests.get")
def test_recipe_get_recipes_budget_exceeded_raises(mock_get):
    svc = RecipeService(Mock(), _recipe_config(budget=500))
    svc._period_call_count = 500
    svc._period_start = time.time()
    with pytest.raises(AIServiceException, match="budget exceeded"):
        svc.get_recipes_by_pantry("hh", "u1", available_ingredients=["egg"], number=5)
    mock_get.assert_not_called()


@patch("backend.services.recipe_service.requests.get")
def test_recipe_get_details_cache_hit_no_external_call(mock_get):
    svc = RecipeService(Mock(), _recipe_config())
    svc._details_cache[1] = (_details_payload(), 1000.0)
    with patch("backend.services.recipe_service.time.time", return_value=1000.0):
        svc.get_recipe_details(1)
    mock_get.assert_not_called()
    assert svc._call_count == 0


@patch("backend.services.recipe_service.requests.get")
def test_recipe_get_details_cache_miss_records_call(mock_get):
    mock_get.return_value = _ok_response(_details_payload())
    svc = RecipeService(Mock(), _recipe_config())
    svc.get_recipe_details(1)
    assert svc._call_count == 1
    assert "/information" in mock_get.call_args[0][0]


@patch("backend.services.recipe_service.requests.get")
def test_recipe_get_details_budget_exceeded_raises(mock_get):
    svc = RecipeService(Mock(), _recipe_config(budget=500))
    svc._period_call_count = 500
    svc._period_start = time.time()
    with pytest.raises(AIServiceException, match="budget exceeded"):
        svc.get_recipe_details(1)
    mock_get.assert_not_called()


@patch("backend.services.recipe_service.requests.get")
def test_recipe_no_duplicate_live_calls_within_ttl(mock_get):
    mock_get.return_value = _ok_response(_find_payload())
    svc = RecipeService(Mock(), _recipe_config())
    svc.get_recipes_by_pantry("hh", "u1", available_ingredients=["egg"], number=5)
    svc.get_recipes_by_pantry("hh", "u1", available_ingredients=["egg"], number=5)
    assert mock_get.call_count == 1
    assert svc._call_count == 1


def test_recipe_get_call_stats_returns_expected_shape():
    svc = RecipeService(Mock(), _recipe_config(budget=500))
    svc._record_external_call("findByIngredients", now=1000.0)
    svc._record_external_call("recipeInformation", now=1000.0)
    stats = svc.get_call_stats(now=1000.0)
    assert stats["period_calls"] == 2
    assert stats["budget_remaining"] == 498
    assert stats["budget"] == 500
    assert stats["budget_period_seconds"] == 3600


def test_recipe_get_call_stats_resets_stale_period():
    svc = RecipeService(Mock(), _recipe_config(budget=500, period_s=3600))
    svc._record_external_call("findByIngredients", now=1000.0)
    stats = svc.get_call_stats(now=1000.0 + 3601)
    assert stats["period_calls"] == 0


@patch("backend.services.recipe_service.requests.get")
def test_recipe_complex_search_not_counted(mock_get):
    mock_get.return_value = _ok_response({"results": []})
    svc = RecipeService(Mock(), _recipe_config())
    svc.search_recipes_complex("hh", "u1", ["egg"], "dinner", number=5)
    assert svc._call_count == 0


@patch("backend.services.recipe_service.requests.get")
def test_recipe_budget_check_before_get_order(mock_get):
    svc = RecipeService(Mock(), _recipe_config(budget=1))
    svc._record_external_call("findByIngredients", now=time.time())
    with pytest.raises(AIServiceException):
        svc.get_recipes_by_pantry("hh", "u1", available_ingredients=["egg"], number=5)
    mock_get.assert_not_called()


# --- Group C: pool grouped + SuggestionService ---


def _pool_row(*, recipe_id="99", score=0.92, meal="dinner", name="Test"):
    return {
        "recipe_id": recipe_id,
        "recipe_name": name,
        "recipe_image": "img.jpg",
        "match_score": score,
        "meal_type": meal,
    }


def test_pool_grouped_to_result_tier_cook_tonight():
    out = _pool_grouped_to_suggestion_result(
        {"breakfast": [], "lunch": [], "dinner": [_pool_row(score=0.92)]}
    )
    assert len(out["cook_tonight"]) == 1


def test_pool_grouped_to_result_tier_probably_have():
    out = _pool_grouped_to_suggestion_result(
        {"breakfast": [], "lunch": [], "dinner": [_pool_row(score=0.75)]}
    )
    assert len(out["probably_have"]) == 1


def test_pool_grouped_to_result_tier_check_first():
    out = _pool_grouped_to_suggestion_result(
        {"breakfast": [], "lunch": [], "dinner": [_pool_row(score=0.65)]}
    )
    assert len(out["check_first"]) == 1


def test_pool_grouped_to_result_boundary_090():
    out = _pool_grouped_to_suggestion_result(
        {"breakfast": [], "lunch": [], "dinner": [_pool_row(score=0.90)]}
    )
    assert out["cook_tonight"][0]["tier"] == "cook_tonight"


def test_pool_grouped_to_result_boundary_070():
    out = _pool_grouped_to_suggestion_result(
        {"breakfast": [], "lunch": [], "dinner": [_pool_row(score=0.70)]}
    )
    assert out["probably_have"][0]["tier"] == "probably_have"


def test_pool_grouped_to_result_none_score_defaults_to_zero():
    row = _pool_row(score=None)
    row["match_score"] = None
    out = _pool_grouped_to_suggestion_result(
        {"breakfast": [], "lunch": [], "dinner": [row]}
    )
    assert out["check_first"][0]["score"] == 0.0


def test_pool_grouped_to_result_decimal_score():
    row = _pool_row(score=Decimal("0.91"))
    out = _pool_grouped_to_suggestion_result(
        {"breakfast": [], "lunch": [], "dinner": [row]}
    )
    assert out["cook_tonight"][0]["score"] == pytest.approx(0.91)


def test_pool_grouped_to_result_skips_null_recipe_id():
    row = _pool_row(recipe_id=None)
    row["recipe_id"] = None
    out = _pool_grouped_to_suggestion_result(
        {"breakfast": [], "lunch": [], "dinner": [row]}
    )
    assert out["cook_tonight"] == []
    assert out["probably_have"] == []
    assert out["check_first"] == []


def test_pool_grouped_to_result_flattens_meal_buckets():
    out = _pool_grouped_to_suggestion_result(
        {
            "breakfast": [_pool_row(recipe_id="1", score=0.95)],
            "lunch": [],
            "dinner": [_pool_row(recipe_id="2", score=0.80)],
        }
    )
    assert len(out["cook_tonight"]) == 1
    assert len(out["probably_have"]) == 1


def test_pool_grouped_to_result_sorts_by_score_desc():
    out = _pool_grouped_to_suggestion_result(
        {
            "breakfast": [],
            "lunch": [],
            "dinner": [
                _pool_row(recipe_id="1", score=0.91),
                _pool_row(recipe_id="2", score=0.99),
            ],
        }
    )
    scores = [r["score"] for r in out["cook_tonight"]]
    assert scores == sorted(scores, reverse=True)


def test_pool_grouped_to_result_always_has_empty_use_soon():
    out = _pool_grouped_to_suggestion_result(
        {"breakfast": [], "lunch": [], "dinner": []}
    )
    assert "use_soon_shelf" in out
    assert out["use_soon_shelf"] == []


def test_pool_grouped_to_result_card_shape():
    out = _pool_grouped_to_suggestion_result(
        {"breakfast": [], "lunch": [], "dinner": [_pool_row()]}
    )
    card = out["cook_tonight"][0]
    assert {
        "id",
        "title",
        "image",
        "tier",
        "ingredient_flags",
        "score",
        "trigger_ingredient",
        "readyInMinutes",
        "pantry_highlights",
        "meal_type",
        "pool_suggestion_id",
    }.issubset(set(card.keys()))
    assert card["ingredient_flags"] == []
    assert card["trigger_ingredient"] is None
    assert isinstance(card["id"], str)
    assert card["meal_type"] == "dinner"


def _patch_suggestion_compute(monkeypatch):
    monkeypatch.setattr(
        "backend.services.suggestion_service.compute_confidence", lambda *a, **k: 0.80
    )
    monkeypatch.setattr(
        "backend.services.suggestion_service.get_calibrated_days_supply",
        lambda *a, **k: 45,
    )
    monkeypatch.setattr(
        "backend.services.suggestion_service.get_engagement_multiplier",
        lambda *a, **k: 1.0,
    )


def _suggestion_pantry_setup():
    supabase = MagicMock()
    supabase.get_user_preferences.return_value = None
    supabase.get_item_classifications_by_names.return_value = {
        "chicken breast": {
            "item_name": "chicken breast",
            "default_days_supply": 45,
            "is_soft_required": False,
        }
    }
    supabase.get_ingredient_signal_counts.return_value = {}
    pantry = [
        make_pantry_item(
            base_ingredient="chicken breast",
            id="p1",
            depletion_class="CONSUMABLE",
            purchase_date=TEST_DATE.isoformat(),
        ),
    ]
    pantry_service = MagicMock()
    pantry_service._get_household_id_for_user.return_value = "hh"
    pantry_service._get_pantry_items.return_value = pantry
    return supabase, pantry_service, pantry


def test_suggestion_pool_first_skips_spoonacular(monkeypatch):
    _patch_suggestion_compute(monkeypatch)
    supabase, pantry_service, _ = _suggestion_pantry_setup()
    recipe_service = MagicMock()
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {
        "breakfast": 3,
        "lunch": 2,
        "dinner": 5,
    }
    pool_store.get_pool_grouped_by_meal.return_value = {
        "breakfast": [],
        "lunch": [],
        "dinner": [_pool_row(score=0.92)],
    }
    svc = SuggestionService(
        supabase, pantry_service, recipe_service, MagicMock(), pool_store=pool_store
    )
    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    recipe_service.get_recipes_by_pantry.assert_not_called()
    recipe_service.get_recipe_details.assert_not_called()
    pantry_service._get_pantry_items.assert_called()
    assert len(out["cook_tonight"]) == 1
    assert "meta" in out


def test_pool_use_soon_promotes_matching_card_without_spoonacular(monkeypatch):
    _patch_suggestion_compute(monkeypatch)
    supabase, pantry_service, _ = _suggestion_pantry_setup()
    pantry_service._get_pantry_items.return_value = [
        make_pantry_item(
            base_ingredient="spinach",
            id="p-spin",
            use_soon=True,
            use_soon_expires="2026-04-12",
        )
    ]
    recipe_service = MagicMock()
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {
        "breakfast": 0,
        "lunch": 0,
        "dinner": 1,
    }
    pool_store.get_pool_grouped_by_meal.return_value = {
        "breakfast": [],
        "lunch": [],
        "dinner": [
            {
                **_pool_row(recipe_id="77", score=0.92, name="Spinach Pasta"),
                "recipe_data": {"extendedIngredients": [{"name": "spinach"}]},
            }
        ],
    }
    svc = SuggestionService(
        supabase, pantry_service, recipe_service, MagicMock(), pool_store=pool_store
    )
    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    recipe_service.get_recipes_by_pantry.assert_not_called()
    recipe_service.get_recipe_details.assert_not_called()
    assert len(out["use_soon_shelf"]) == 1
    assert out["use_soon_shelf"][0]["id"] == "77"
    assert out["use_soon_shelf"][0]["tier"] == "use_soon"
    assert len(out["cook_tonight"]) == 1


def test_suggestion_pool_first_skips_result_cache(monkeypatch):
    _patch_suggestion_compute(monkeypatch)
    supabase, pantry_service, _ = _suggestion_pantry_setup()
    recipe_service = MagicMock()
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 1, "lunch": 0, "dinner": 0}
    pool_store.get_pool_grouped_by_meal.return_value = {
        "breakfast": [_pool_row(recipe_id="1", score=0.95)],
        "lunch": [],
        "dinner": [],
    }
    svc = SuggestionService(
        supabase, pantry_service, recipe_service, MagicMock(), pool_store=pool_store
    )
    svc._result_cache["should-not-be-used"] = ({"stale": True}, 9999.0)
    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    recipe_service.get_recipes_by_pantry.assert_not_called()
    assert "stale" not in str(out)


def test_suggestion_pool_empty_falls_through_to_spoonacular(monkeypatch):
    _patch_suggestion_compute(monkeypatch)
    supabase, pantry_service, _ = _suggestion_pantry_setup()
    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.return_value = []
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 0}
    svc = SuggestionService(
        supabase, pantry_service, recipe_service, MagicMock(), pool_store=pool_store
    )
    svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    recipe_service.get_recipes_by_pantry.assert_called_once()


def test_suggestion_pool_depth_without_convertible_cards_falls_through(monkeypatch):
    _patch_suggestion_compute(monkeypatch)
    supabase, pantry_service, _ = _suggestion_pantry_setup()
    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.return_value = []
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 1, "lunch": 0, "dinner": 0}
    pool_store.get_pool_grouped_by_meal.return_value = {
        "breakfast": [{"recipe_id": None, "match_score": 0.95}],
        "lunch": [],
        "dinner": [],
    }
    svc = SuggestionService(
        supabase, pantry_service, recipe_service, MagicMock(), pool_store=pool_store
    )
    svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    recipe_service.get_recipes_by_pantry.assert_called_once()


def test_suggestion_no_pool_store_falls_through_to_spoonacular(monkeypatch):
    _patch_suggestion_compute(monkeypatch)
    supabase, pantry_service, _ = _suggestion_pantry_setup()
    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.return_value = []
    svc = SuggestionService(supabase, pantry_service, recipe_service, MagicMock())
    svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    recipe_service.get_recipes_by_pantry.assert_called_once()


def test_suggestion_no_household_skips_pool_depth(monkeypatch):
    _patch_suggestion_compute(monkeypatch)
    supabase, pantry_service, _ = _suggestion_pantry_setup()
    pantry_service._get_household_id_for_user.return_value = None
    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.return_value = []
    pool_store = MagicMock()
    svc = SuggestionService(
        supabase, pantry_service, recipe_service, MagicMock(), pool_store=pool_store
    )
    svc.get_recipe_suggestions("user-1", None, today=TEST_DATE)
    pool_store.get_pool_depth.assert_not_called()


def test_suggestion_budget_exhaustion_falls_back_to_stale_cache(monkeypatch):
    _patch_suggestion_compute(monkeypatch)
    supabase, pantry_service, pantry = _suggestion_pantry_setup()
    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.side_effect = AIServiceException("budget")
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 0}
    svc = SuggestionService(
        supabase, pantry_service, recipe_service, MagicMock(), pool_store=pool_store
    )
    stale_payload = {
        "use_soon_shelf": [],
        "cook_tonight": [{"id": "1", "title": "Stale"}],
        "probably_have": [],
        "check_first": [],
    }
    ck = svc._build_suggestion_cache_key(
        "user-1", "hh", pantry, ["chicken breast"], {"depletion_multiplier": 1.0}
    )
    svc._result_cache[f"user-1:hh:{ck}"] = (stale_payload, 1000.0)
    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    assert out == stale_payload
    pool_store.get_pool_grouped_by_meal.assert_not_called()


def test_suggestion_budget_exhaustion_empty_stale_still_used(monkeypatch):
    _patch_suggestion_compute(monkeypatch)
    supabase, pantry_service, pantry = _suggestion_pantry_setup()
    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.side_effect = AIServiceException("budget")
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 0}
    svc = SuggestionService(
        supabase, pantry_service, recipe_service, MagicMock(), pool_store=pool_store
    )
    empty = {
        "use_soon_shelf": [],
        "cook_tonight": [],
        "probably_have": [],
        "check_first": [],
    }
    ck = svc._build_suggestion_cache_key(
        "user-1", "hh", pantry, ["chicken breast"], {"depletion_multiplier": 1.0}
    )
    svc._result_cache[f"user-1:hh:{ck}"] = (empty, 1000.0)
    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    assert out == empty
    pool_store.get_pool_grouped_by_meal.assert_not_called()


def test_suggestion_budget_exhaustion_falls_back_to_pool(monkeypatch):
    _patch_suggestion_compute(monkeypatch)
    supabase, pantry_service, _ = _suggestion_pantry_setup()
    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.side_effect = AIServiceException("budget")
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 0}
    pool_store.get_pool_grouped_by_meal.return_value = {
        "breakfast": [],
        "lunch": [],
        "dinner": [_pool_row(score=0.92)],
    }
    svc = SuggestionService(
        supabase, pantry_service, recipe_service, MagicMock(), pool_store=pool_store
    )
    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    assert len(out["cook_tonight"]) == 1


def test_suggestion_budget_exhaustion_reraises_when_no_fallback(monkeypatch):
    _patch_suggestion_compute(monkeypatch)
    supabase, pantry_service, _ = _suggestion_pantry_setup()
    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.side_effect = AIServiceException("budget")
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 0}
    pool_store.get_pool_grouped_by_meal.return_value = {
        "breakfast": [],
        "lunch": [],
        "dinner": [],
    }
    svc = SuggestionService(
        supabase, pantry_service, recipe_service, MagicMock(), pool_store=pool_store
    )
    with pytest.raises(AIServiceException):
        svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)


def test_suggestion_fetch_quota_exception_uses_same_fallback(monkeypatch):
    _patch_suggestion_compute(monkeypatch)
    supabase, pantry_service, _ = _suggestion_pantry_setup()
    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.side_effect = RecipeQuotaException("quota")
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 0}
    pool_store.get_pool_grouped_by_meal.return_value = {
        "breakfast": [],
        "lunch": [],
        "dinner": [_pool_row(score=0.75)],
    }
    svc = SuggestionService(
        supabase, pantry_service, recipe_service, MagicMock(), pool_store=pool_store
    )
    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    assert len(out["probably_have"]) == 1


def test_suggestion_details_budget_exhaustion_returns_partial(monkeypatch):
    _patch_suggestion_compute(monkeypatch)
    supabase, pantry_service, _ = _suggestion_pantry_setup()
    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.return_value = [
        {"id": 1, "title": "A", "image": "", "missedIngredientCount": 0},
        {"id": 2, "title": "B", "image": "", "missedIngredientCount": 0},
    ]

    def details_side_effect(rid):
        if rid == 1:
            return {
                "id": 1,
                "title": "A",
                "extendedIngredients": [{"name": "chicken breast", "aisle": "Meat"}],
            }
        raise AIServiceException("budget")

    recipe_service.get_recipe_details.side_effect = details_side_effect
    svc = SuggestionService(supabase, pantry_service, recipe_service, MagicMock())
    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    assert len(out["cook_tonight"]) + len(out["probably_have"]) + len(out["check_first"]) == 1


def test_suggestion_details_quota_returns_partial(monkeypatch):
    _patch_suggestion_compute(monkeypatch)
    supabase, pantry_service, _ = _suggestion_pantry_setup()
    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.return_value = [
        {"id": 1, "title": "A", "image": "", "missedIngredientCount": 0},
        {"id": 2, "title": "B", "image": "", "missedIngredientCount": 0},
    ]

    def details_side_effect(rid):
        if rid == 1:
            return {
                "id": 1,
                "title": "A",
                "extendedIngredients": [{"name": "chicken breast", "aisle": "Meat"}],
            }
        raise RecipeQuotaException("quota")

    recipe_service.get_recipe_details.side_effect = details_side_effect
    svc = SuggestionService(supabase, pantry_service, recipe_service, MagicMock())
    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    assert len(out["cook_tonight"]) + len(out["probably_have"]) + len(out["check_first"]) == 1


def test_suggestion_details_generic_exception_skips_continues(monkeypatch):
    _patch_suggestion_compute(monkeypatch)
    supabase, pantry_service, _ = _suggestion_pantry_setup()
    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.return_value = [
        {"id": 1, "title": "A", "image": "", "missedIngredientCount": 0},
        {"id": 2, "title": "B", "image": "", "missedIngredientCount": 0},
    ]

    def details_side_effect(rid):
        if rid == 1:
            raise ValueError("bad recipe")
        return {
            "id": 2,
            "title": "B",
            "extendedIngredients": [{"name": "chicken breast", "aisle": "Meat"}],
        }

    recipe_service.get_recipe_details.side_effect = details_side_effect
    svc = SuggestionService(supabase, pantry_service, recipe_service, MagicMock())
    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    assert len(out["cook_tonight"]) + len(out["probably_have"]) + len(out["check_first"]) == 1


def test_suggestion_factory_passes_pool_store():
    pool = MagicMock()
    svc = create_suggestion_service(
        MagicMock(), MagicMock(), MagicMock(), MagicMock(), pool_store=pool
    )
    assert svc.pool_store is pool


def test_suggestion_factory_default_pool_none():
    svc = create_suggestion_service(
        MagicMock(), MagicMock(), MagicMock(), MagicMock()
    )
    assert svc.pool_store is None


# --- Group E: App wiring ---


def test_app_wires_pool_store_onto_suggestion_service():
    app = MagicMock()
    suggestion = MagicMock()
    pool = MagicMock()
    app.config.get.side_effect = lambda key: {
        "SUGGESTION_SERVICE": suggestion,
        "POOL_STORE_SERVICE": pool,
    }.get(key)
    wire_suggestion_pool_store(app)
    assert suggestion.pool_store is pool


# --- Group G: Static checks ---


def test_static_budget_before_every_instrumented_get():
    source = Path("backend/services/recipe_service.py").read_text()
    tree = ast.parse(source)
    instrumented_funcs = {"get_recipes_by_pantry", "get_recipe_details"}
    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef) or node.name not in instrumented_funcs:
            continue
        names_before_get: list[str] = []
        found_get = False
        for child in ast.walk(node):
            if found_get:
                continue
            if isinstance(child, ast.Call):
                if isinstance(child.func, ast.Attribute) and child.func.attr == "get":
                    if isinstance(child.func.value, ast.Name) and child.func.value.id == "requests":
                        found_get = True
                        continue
                if isinstance(child.func, ast.Attribute) and isinstance(
                    child.func.value, ast.Name
                ):
                    if child.func.value.id == "self":
                        names_before_get.append(child.func.attr)
        assert "is_budget_exceeded" in names_before_get
        assert "_record_external_call" in names_before_get


def test_static_complex_search_has_no_budget_hook():
    source = Path("backend/services/recipe_service.py").read_text()
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "search_recipes_complex":
            body_src = ast.get_source_segment(source, node) or ""
            assert "_record_external_call" not in body_src
            assert "is_budget_exceeded" not in body_src


# --- 08.1 dinner picker card DTO ---


def _enriched_pool_row(**kwargs):
    base = {
        "id": "pool-uuid-1",
        "recipe_id": "12345",
        "recipe_name": "Egg Scramble",
        "recipe_image": "https://img.test/egg.jpg",
        "match_score": 0.92,
        "meal_type": "dinner",
        "recipe_data": {
            "readyInMinutes": 25,
            "extendedIngredients": [
                {"name": "eggs"},
                {"name": "cheddar"},
            ],
        },
    }
    base.update(kwargs)
    return base


def test_POOL_CARD_INCLUDES_READYIN_HIGHLIGHTS_MEAL_AND_POOL_ID(monkeypatch):
    _patch_suggestion_compute(monkeypatch)
    supabase, pantry_service, _ = _suggestion_pantry_setup()
    pantry_service._get_pantry_items.return_value = [
        make_pantry_item(
            base_ingredient="eggs",
            id="p-eggs",
            depletion_class="CONSUMABLE",
            purchase_date=TEST_DATE.isoformat(),
        ),
        make_pantry_item(
            base_ingredient="cheddar",
            id="p-cheddar",
            depletion_class="CONSUMABLE",
            purchase_date=TEST_DATE.isoformat(),
        ),
    ]
    supabase.get_item_classifications_by_names.return_value = {
        "eggs": {"item_name": "eggs", "default_days_supply": 45, "is_soft_required": False},
        "cheddar": {
            "item_name": "cheddar",
            "default_days_supply": 45,
            "is_soft_required": False,
        },
    }
    recipe_service = MagicMock()
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 1}
    pool_store.get_pool_grouped_by_meal.return_value = {
        "breakfast": [],
        "lunch": [],
        "dinner": [_enriched_pool_row()],
    }
    svc = SuggestionService(
        supabase, pantry_service, recipe_service, MagicMock(), pool_store=pool_store
    )
    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    card = out["cook_tonight"][0]
    assert card["readyInMinutes"] == 25
    assert "eggs" in [h.lower() for h in card["pantry_highlights"]]
    assert card["meal_type"] == "dinner"
    assert card["pool_suggestion_id"] == "pool-uuid-1"


def test_POOL_MATCH_SCORE_TIER_UNCHANGED_WHEN_FLAGS_LOW(monkeypatch):
    _patch_suggestion_compute(monkeypatch)
    monkeypatch.setattr(
        "backend.services.suggestion_service.compute_confidence", lambda *a, **k: 0.40
    )
    supabase, pantry_service, _ = _suggestion_pantry_setup()
    recipe_service = MagicMock()
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 1}
    pool_store.get_pool_grouped_by_meal.return_value = {
        "breakfast": [],
        "lunch": [],
        "dinner": [_enriched_pool_row(match_score=0.92)],
    }
    svc = SuggestionService(
        supabase, pantry_service, recipe_service, MagicMock(), pool_store=pool_store
    )
    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    assert out["cook_tonight"][0]["tier"] == "cook_tonight"


def test_POOL_USE_SOON_ATTACH_STILL_RUNS(monkeypatch):
    _patch_suggestion_compute(monkeypatch)
    supabase, pantry_service, _ = _suggestion_pantry_setup()
    pantry_service._get_pantry_items.return_value = [
        make_pantry_item(
            base_ingredient="spinach",
            id="p-spin",
            use_soon=True,
            use_soon_expires="2026-04-12",
        )
    ]
    recipe_service = MagicMock()
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 1}
    pool_store.get_pool_grouped_by_meal.return_value = {
        "breakfast": [],
        "lunch": [],
        "dinner": [
            {
                **_enriched_pool_row(recipe_id="77", recipe_name="Spinach Pasta"),
                "recipe_data": {
                    "readyInMinutes": 20,
                    "extendedIngredients": [{"name": "spinach"}],
                },
            }
        ],
    }
    svc = SuggestionService(
        supabase, pantry_service, recipe_service, MagicMock(), pool_store=pool_store
    )
    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    assert len(out["use_soon_shelf"]) == 1
    assert out["use_soon_shelf"][0]["tier"] == "use_soon"
    assert out["use_soon_shelf"][0]["readyInMinutes"] == 20


def test_POOL_ENRICH_THROW_KEEPS_THIN_CARD(monkeypatch):
    _patch_suggestion_compute(monkeypatch)

    def boom(*_a, **_k):
        raise RuntimeError("enrich failed")

    monkeypatch.setattr(
        "backend.services.suggestion_service._build_pool_ingredient_flags", boom
    )
    supabase, pantry_service, _ = _suggestion_pantry_setup()
    recipe_service = MagicMock()
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 1}
    pool_store.get_pool_grouped_by_meal.return_value = {
        "breakfast": [],
        "lunch": [],
        "dinner": [_enriched_pool_row()],
    }
    svc = SuggestionService(
        supabase, pantry_service, recipe_service, MagicMock(), pool_store=pool_store
    )
    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    card = out["cook_tonight"][0]
    assert card["tier"] == "cook_tonight"
    assert card["pool_suggestion_id"] == "pool-uuid-1"
    assert card["title"] == "Egg Scramble"


def test_HIGHLIGHTS_OMITTED_WHEN_NO_PANTRY_MATCH(monkeypatch):
    _patch_suggestion_compute(monkeypatch)
    supabase, pantry_service, _ = _suggestion_pantry_setup()
    pantry_service._get_pantry_items.return_value = [
        make_pantry_item(
            base_ingredient="unrelated item",
            id="p-x",
            depletion_class="CONSUMABLE",
            purchase_date=TEST_DATE.isoformat(),
        )
    ]
    recipe_service = MagicMock()
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 1}
    pool_store.get_pool_grouped_by_meal.return_value = {
        "breakfast": [],
        "lunch": [],
        "dinner": [_enriched_pool_row()],
    }
    svc = SuggestionService(
        supabase, pantry_service, recipe_service, MagicMock(), pool_store=pool_store
    )
    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    assert out["cook_tonight"][0]["pantry_highlights"] == []


def test_POOL_FALLBACK_PATH_HAS_POOL_SUGGESTION_ID(monkeypatch):
    _patch_suggestion_compute(monkeypatch)
    supabase, pantry_service, pantry = _suggestion_pantry_setup()
    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.return_value = []
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 0}
    pool_store.get_pool_grouped_by_meal.side_effect = [
        {"breakfast": [], "lunch": [], "dinner": []},
        {
            "breakfast": [],
            "lunch": [],
            "dinner": [_enriched_pool_row()],
        },
    ]
    svc = SuggestionService(
        supabase, pantry_service, recipe_service, MagicMock(), pool_store=pool_store
    )
    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    assert len(out["cook_tonight"]) == 1
    assert out["cook_tonight"][0]["pool_suggestion_id"] == "pool-uuid-1"
