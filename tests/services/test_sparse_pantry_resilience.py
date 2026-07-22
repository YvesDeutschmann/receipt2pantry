"""02b — Sparse pantry resilience: adaptive thresholds, meta, missed_count, never-empty."""

import ast
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from backend.services.pool_generator import PoolGenerator
from backend.services.suggestion_service import (
    SuggestionService,
    _confidence_threshold_for_pantry_size,
    _empty_suggestion_tiers,
    _pool_grouped_to_suggestion_result,
)
from backend.utils.exceptions import AIServiceException
from tests.services.conftest import TEST_DATE, make_pantry_item


REPO_ROOT = Path(__file__).resolve().parents[2]
SUGGESTION_SERVICE_PATH = REPO_ROOT / "backend/services/suggestion_service.py"


@pytest.fixture
def pool_store():
    ps = MagicMock()
    ps.supabase = MagicMock()
    ps.supabase.get_household_members.return_value = [{"user_id": "u1"}]
    ps.start_generation.return_value = {
        "generation_id": "gen-1",
        "already_running": False,
    }
    ps.get_swiped_recipe_ids.return_value = set()
    ps.add_suggestions.return_value = 2
    return ps


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
                "usedIngredientCount": 1,
                "missedIngredientCount": 0,
            }
        ]

    ms.suggest_staple_meals = MagicMock(side_effect=_staple_return)
    return ms


def _pool_row(*, recipe_id="99", score=0.92, name="Pool Recipe"):
    return {
        "recipe_id": recipe_id,
        "recipe_name": name,
        "recipe_image": None,
        "match_score": score,
        "meal_type": "dinner",
    }


def _patch_compute(monkeypatch, confidence: float = 0.80):
    monkeypatch.setattr(
        "backend.services.suggestion_service.compute_confidence",
        lambda *a, **k: confidence,
    )
    monkeypatch.setattr(
        "backend.services.suggestion_service.get_calibrated_days_supply",
        lambda *a, **k: 45,
    )
    monkeypatch.setattr(
        "backend.services.suggestion_service.get_engagement_multiplier",
        lambda *a, **k: 1.0,
    )


def _make_pantry_items(n: int, *, base_prefix: str = "item") -> list:
    return [
        make_pantry_item(
            base_ingredient=f"{base_prefix}{i}",
            id=f"p{i}",
            depletion_class="CONSUMABLE",
            purchase_date=TEST_DATE.isoformat(),
        )
        for i in range(n)
    ]


def _classifications_for(pantry: list) -> dict:
    return {
        (p.get("base_ingredient") or "").strip().lower(): {
            "item_name": p.get("base_ingredient"),
            "default_days_supply": 45,
            "is_soft_required": False,
        }
        for p in pantry
        if p.get("base_ingredient")
    }


def _suggestion_svc(
    monkeypatch,
    pantry,
    *,
    confidence=0.80,
    pool_store=None,
    recipe_service=None,
):
    _patch_compute(monkeypatch, confidence)
    supabase = MagicMock()
    supabase.get_user_preferences.return_value = None
    supabase.get_item_classifications_by_names.return_value = _classifications_for(
        pantry
    )
    supabase.get_ingredient_signal_counts.return_value = {}
    pantry_service = MagicMock()
    pantry_service._get_household_id_for_user.return_value = "hh"
    pantry_service._get_pantry_items.return_value = pantry
    if recipe_service is None:
        recipe_service = MagicMock()
        recipe_service.get_recipes_by_pantry.return_value = []
    return SuggestionService(
        supabase,
        pantry_service,
        recipe_service,
        MagicMock(),
        pool_store=pool_store,
    )


# --- Group A: threshold ---


@pytest.mark.parametrize(
    "count,expected",
    [
        (0, 0.0),
        (2, 0.0),
        (3, 0.20),
        (9, 0.20),
        (10, 0.50),
        (50, 0.50),
    ],
    ids=[
        "THRESHOLD_ZERO_ITEMS",
        "THRESHOLD_TWO_ITEMS",
        "THRESHOLD_THREE_ITEMS",
        "THRESHOLD_NINE_ITEMS",
        "THRESHOLD_TEN_ITEMS",
        "THRESHOLD_LARGE_PANTRY",
    ],
)
def test_confidence_threshold_for_pantry_size(count, expected):
    assert _confidence_threshold_for_pantry_size(count) == expected


# --- Group B: fallback ladder + meta ---


def test_empty_pantry_returns_empty_all_tiers(monkeypatch):
    svc = _suggestion_svc(monkeypatch, [])
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 0}
    svc.pool_store = pool_store
    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    assert out["cook_tonight"] == []
    assert out["probably_have"] == []
    assert out["check_first"] == []
    assert out["use_soon_shelf"] == []
    assert out["meta"]["pantry_item_count"] == 0


def test_empty_pantry_does_not_call_spoonacular(monkeypatch):
    recipe_service = MagicMock()
    svc = _suggestion_svc(monkeypatch, [], recipe_service=recipe_service)
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 0}
    svc.pool_store = pool_store
    svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    recipe_service.get_recipes_by_pantry.assert_not_called()


def test_three_staples_uses_relaxed_threshold(monkeypatch):
    pantry = _make_pantry_items(3)
    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.return_value = []
    svc = _suggestion_svc(
        monkeypatch, pantry, confidence=0.25, recipe_service=recipe_service
    )
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 0}
    svc.pool_store = pool_store
    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    recipe_service.get_recipes_by_pantry.assert_called_once()
    assert out["meta"]["threshold_used"] == 0.20


def test_small_pantry_conf_below_normal_but_above_relaxed_included(monkeypatch):
    pantry = _make_pantry_items(5)
    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.return_value = []
    svc = _suggestion_svc(
        monkeypatch, pantry, confidence=0.30, recipe_service=recipe_service
    )
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 0}
    svc.pool_store = pool_store
    svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    recipe_service.get_recipes_by_pantry.assert_called_once()


def test_last_resort_triggered_when_high_conf_filter_empty(monkeypatch):
    pantry = _make_pantry_items(12)
    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.return_value = []
    svc = _suggestion_svc(
        monkeypatch, pantry, confidence=0.35, recipe_service=recipe_service
    )
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 0}
    svc.pool_store = pool_store
    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    recipe_service.get_recipes_by_pantry.assert_called_once()
    args = recipe_service.get_recipes_by_pantry.call_args
    ingredients = args.kwargs.get("available_ingredients") or args[1][2]
    assert len(ingredients) == 12
    assert out["meta"]["fallback_mode"] is True


def test_last_resort_not_triggered_when_items_pass_threshold(monkeypatch):
    pantry = _make_pantry_items(12)
    confidences = {f"p{i}": (0.60 if i < 5 else 0.35) for i in range(12)}

    def fake_compute(pantry_item, *a, **k):
        return confidences.get(str(pantry_item.get("id")), 0.35)

    monkeypatch.setattr(
        "backend.services.suggestion_service.compute_confidence", fake_compute
    )
    monkeypatch.setattr(
        "backend.services.suggestion_service.get_calibrated_days_supply",
        lambda *a, **k: 45,
    )
    monkeypatch.setattr(
        "backend.services.suggestion_service.get_engagement_multiplier",
        lambda *a, **k: 1.0,
    )
    supabase = MagicMock()
    supabase.get_user_preferences.return_value = None
    supabase.get_item_classifications_by_names.return_value = _classifications_for(
        pantry
    )
    supabase.get_ingredient_signal_counts.return_value = {}
    pantry_service = MagicMock()
    pantry_service._get_household_id_for_user.return_value = "hh"
    pantry_service._get_pantry_items.return_value = pantry
    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.return_value = []
    svc = SuggestionService(
        supabase, pantry_service, recipe_service, MagicMock(), pool_store=None
    )
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 0}
    svc.pool_store = pool_store
    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    args = recipe_service.get_recipes_by_pantry.call_args
    ingredients = args.kwargs.get("available_ingredients") or args[1][2]
    assert len(ingredients) == 5
    assert out["meta"]["fallback_mode"] is False


def test_never_empty_with_pool_when_spoonacular_returns_nothing(monkeypatch):
    pantry = _make_pantry_items(3, base_prefix="staple")
    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.return_value = []
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 0}
    pool_store.get_pool_grouped_by_meal.side_effect = lambda hh, status="unused": (
        {"breakfast": [], "lunch": [], "dinner": [_pool_row()]}
        if status == "unused"
        else {"breakfast": [], "lunch": [], "dinner": []}
    )
    svc = _suggestion_svc(
        monkeypatch, pantry, confidence=0.25, recipe_service=recipe_service
    )
    svc.pool_store = pool_store
    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    assert len(out["cook_tonight"]) == 1
    assert out["meta"]["fallback_mode"] is True


def test_never_empty_uses_swiped_pool_as_last_resort(monkeypatch):
    pantry = _make_pantry_items(3)
    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.return_value = []
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 0}

    def grouped(hh, status="unused"):
        if status == "unused":
            return {"breakfast": [], "lunch": [], "dinner": []}
        return {
            "breakfast": [],
            "lunch": [],
            "dinner": [_pool_row(recipe_id="sw1", score=0.75)],
        }

    pool_store.get_pool_grouped_by_meal.side_effect = grouped
    svc = _suggestion_svc(
        monkeypatch, pantry, confidence=0.25, recipe_service=recipe_service
    )
    svc.pool_store = pool_store
    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    assert len(out["probably_have"]) == 1
    assert out["meta"]["fallback_mode"] is True
    assert pool_store.get_pool_grouped_by_meal.call_count >= 2


def test_blank_base_ingredients_tries_pool_before_empty(monkeypatch):
    pantry = [
        make_pantry_item(
            base_ingredient="",
            id="p1",
            depletion_class="CONSUMABLE",
            purchase_date=TEST_DATE.isoformat(),
        ),
    ]
    recipe_service = MagicMock()
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 0}
    pool_store.get_pool_grouped_by_meal.side_effect = lambda hh, status="unused": (
        {"breakfast": [], "lunch": [], "dinner": []}
        if status == "unused"
        else {
            "breakfast": [],
            "lunch": [],
            "dinner": [_pool_row(recipe_id="sw2")],
        }
    )
    svc = _suggestion_svc(monkeypatch, pantry, recipe_service=recipe_service)
    svc.pool_store = pool_store
    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    recipe_service.get_recipes_by_pantry.assert_not_called()
    assert len(out["cook_tonight"]) == 1
    assert out["meta"]["fallback_mode"] is True


def test_empty_result_acceptable_when_pantry_is_empty(monkeypatch):
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 0}
    svc = _suggestion_svc(monkeypatch, [], pool_store=pool_store)
    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    assert out["cook_tonight"] == []
    assert "meta" in out


def test_meta_always_present(monkeypatch):
    pantry = _make_pantry_items(3)
    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.return_value = [
        {"id": 1, "title": "T", "image": "", "missedIngredientCount": 0}
    ]
    recipe_service.get_recipe_details.return_value = {
        "id": 1,
        "title": "T",
        "extendedIngredients": [{"name": "item0", "aisle": "Meat"}],
    }
    svc = _suggestion_svc(
        monkeypatch, pantry, confidence=0.25, recipe_service=recipe_service
    )
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 0}
    svc.pool_store = pool_store
    normal = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    assert "meta" in normal

    pool_store.get_pool_depth.return_value = {"breakfast": 1, "lunch": 0, "dinner": 0}
    pool_store.get_pool_grouped_by_meal.return_value = {
        "breakfast": [_pool_row()],
        "lunch": [],
        "dinner": [],
    }
    pool_first = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    assert "meta" in pool_first

    empty_svc = _suggestion_svc(monkeypatch, [], pool_store=pool_store)
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 0}
    empty = empty_svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    assert "meta" in empty


def test_meta_fallback_false_for_large_pantry(monkeypatch):
    pantry = _make_pantry_items(10)
    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.return_value = []
    svc = _suggestion_svc(
        monkeypatch, pantry, confidence=0.80, recipe_service=recipe_service
    )
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 0}
    svc.pool_store = pool_store
    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    assert out["meta"]["fallback_mode"] is False
    assert out["meta"]["threshold_used"] == 0.50


def test_meta_pool_first_uses_active_pantry_count(monkeypatch):
    active = _make_pantry_items(2)
    deleted = make_pantry_item(
        base_ingredient="deleted",
        id="del",
        depletion_class="CONSUMABLE",
        purchase_date=TEST_DATE.isoformat(),
    )
    deleted["deleted_at"] = "2020-01-01T00:00:00Z"
    pantry = active + [deleted]
    svc = _suggestion_svc(monkeypatch, pantry)
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 1, "lunch": 0, "dinner": 0}
    pool_store.get_pool_grouped_by_meal.return_value = {
        "breakfast": [_pool_row()],
        "lunch": [],
        "dinner": [],
    }
    svc.pool_store = pool_store
    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    assert out["meta"]["pantry_item_count"] == 2


def test_meta_backfilled_on_cache_hit_without_meta(monkeypatch):
    pantry = _make_pantry_items(1, base_prefix="chicken breast")
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
    pantry_service = MagicMock()
    pantry_service._get_household_id_for_user.return_value = "hh"
    pantry_service._get_pantry_items.return_value = pantry
    recipe_service = MagicMock()
    svc = SuggestionService(
        supabase, pantry_service, recipe_service, MagicMock(), pool_store=None
    )
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 0}
    svc.pool_store = pool_store
    stale_payload = _empty_suggestion_tiers()
    svc._result_cache["user-1:hh:fake"] = (stale_payload, 1000.0)
    clock = iter([2000.0, 2000.0])

    def now():
        return next(clock)

    with patch.object(
        svc, "_build_suggestion_cache_key", return_value="fake"
    ):
        out = svc.get_recipe_suggestions(
            "user-1", "hh", today=TEST_DATE, now=now
        )
    assert "meta" in out


def test_exception_path_tries_swiped_before_reraise(monkeypatch):
    pantry = _make_pantry_items(3)
    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.side_effect = AIServiceException("budget")
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 0}
    pool_store.get_pool_grouped_by_meal.side_effect = lambda hh, status="unused": (
        {"breakfast": [], "lunch": [], "dinner": []}
        if status == "unused"
        else {
            "breakfast": [],
            "lunch": [],
            "dinner": [_pool_row(recipe_id="ex1")],
        }
    )
    svc = _suggestion_svc(
        monkeypatch, pantry, confidence=0.25, recipe_service=recipe_service
    )
    svc.pool_store = pool_store
    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    assert "meta" in out
    assert len(out["cook_tonight"]) == 1


def test_exception_path_reraises_when_no_pool(monkeypatch):
    pantry = _make_pantry_items(3)
    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.side_effect = AIServiceException("budget")
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 0}
    pool_store.get_pool_grouped_by_meal.return_value = {
        "breakfast": [],
        "lunch": [],
        "dinner": [],
    }
    svc = _suggestion_svc(
        monkeypatch, pantry, confidence=0.25, recipe_service=recipe_service
    )
    svc.pool_store = pool_store
    with pytest.raises(AIServiceException):
        svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)


def test_sparse_log_has_no_pii(monkeypatch):
    pantry = _make_pantry_items(3)
    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.return_value = []
    pool_store = MagicMock()
    pool_store.get_pool_depth.return_value = {"breakfast": 0, "lunch": 0, "dinner": 0}
    pool_store.get_pool_grouped_by_meal.return_value = {
        "breakfast": [],
        "lunch": [],
        "dinner": [],
    }
    svc = _suggestion_svc(
        monkeypatch, pantry, confidence=0.25, recipe_service=recipe_service
    )
    svc.pool_store = pool_store
    messages: list[str] = []
    with patch(
        "backend.services.suggestion_service.logger.warning",
        side_effect=lambda msg, *a, **k: messages.append(str(msg)),
    ):
        svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    sparse_logs = [m for m in messages if "sparse_pantry_no_results" in m]
    assert len(sparse_logs) == 1
    payload = json.loads(sparse_logs[0])
    assert payload["event"] == "sparse_pantry_no_results"
    assert "user-1" not in sparse_logs[0]
    assert "item0" not in sparse_logs[0]


# --- Group C: missed_count ---


@pytest.fixture
def suggestion_svc_for_score(monkeypatch):
    _patch_compute(monkeypatch)
    supabase = MagicMock()
    pantry_service = MagicMock()
    recipe_service = MagicMock()
    return SuggestionService(
        supabase, pantry_service, recipe_service, MagicMock()
    )


def test_missed_count_all_present(suggestion_svc_for_score):
    pantry = [
        make_pantry_item(base_ingredient="chicken breast", id="p1"),
    ]
    recipe = {
        "id": 1,
        "title": "Chicken",
        "extendedIngredients": [{"name": "chicken breast", "aisle": "Meat"}],
    }
    out = suggestion_svc_for_score.score_recipe(
        recipe,
        pantry,
        {"depletion_multiplier": 1.0},
        [],
        {},
        {},
        today=TEST_DATE,
        confidence_override_by_base={"chicken breast": 0.90},
    )
    assert out["missed_count"] == 0


def test_missed_count_one_missing_primary(suggestion_svc_for_score, monkeypatch):
    monkeypatch.setattr(
        "backend.services.suggestion_service.get_tier", lambda _x: "check_first"
    )
    pantry = [
        make_pantry_item(base_ingredient="chicken breast", id="p1"),
    ]
    recipe = {
        "id": 1,
        "title": "Mix",
        "extendedIngredients": [
            {"name": "chicken breast", "aisle": "Meat"},
            {"name": "broccoli", "aisle": "Produce"},
        ],
    }
    out = suggestion_svc_for_score.score_recipe(
        recipe,
        pantry,
        {"depletion_multiplier": 1.0},
        [],
        {},
        {},
        today=TEST_DATE,
        confidence_override_by_base={"chicken breast": 0.90},
    )
    assert out["missed_count"] == 1


def test_missed_count_excludes_soft_required_missing(suggestion_svc_for_score):
    pantry = [
        make_pantry_item(base_ingredient="chicken breast", id="p1"),
    ]
    cls = {
        "chicken breast": {"default_days_supply": 45, "is_soft_required": False},
    }
    recipe = {
        "id": 1,
        "title": "Spiced",
        "extendedIngredients": [
            {"name": "chicken breast", "aisle": "Meat"},
            {"name": "paprika", "aisle": "Spices and Seasonings"},
        ],
    }
    out = suggestion_svc_for_score.score_recipe(
        recipe,
        pantry,
        {"depletion_multiplier": 1.0},
        [],
        {},
        cls,
        today=TEST_DATE,
        confidence_override_by_base={"chicken breast": 0.90},
    )
    assert out["missed_count"] == 0


def test_missed_count_present_on_every_tier(suggestion_svc_for_score):
    pantry = [make_pantry_item(base_ingredient="flour", id="p1")]
    cls = {"flour": {"default_days_supply": 45, "is_soft_required": False}}
    bases = [
        (0.90, "cook_tonight"),
        (0.60, "probably_have"),
        (0.25, "check_first"),
    ]
    for conf, expected_tier in bases:
        recipe = {
            "id": 1,
            "title": "Bread",
            "extendedIngredients": [{"name": "flour", "aisle": "Baking"}],
        }
        out = suggestion_svc_for_score.score_recipe(
            recipe,
            pantry,
            {"depletion_multiplier": 1.0},
            [],
            {},
            cls,
            today=TEST_DATE,
            confidence_override_by_base={"flour": conf},
        )
        assert out["tier"] == expected_tier
        assert "missed_count" in out


def test_missed_count_absent_or_zero_on_suppressed(suggestion_svc_for_score):
    recipe = {
        "id": 1,
        "title": "Low",
        "extendedIngredients": [{"name": "truffle", "aisle": "Gourmet"}],
    }
    out = suggestion_svc_for_score.score_recipe(
        recipe,
        [],
        {"depletion_multiplier": 1.0},
        [],
        {},
        {},
        today=TEST_DATE,
    )
    assert out["tier"] == "suppressed"
    assert "missed_count" not in out


# --- Group D: pool generator dinner ---


def _generator_with_bans_mock(pool_store, depletion, recipe_service, meal_plan_service):
    from backend.services.pool_generator import PoolGenerator

    gen = PoolGenerator(pool_store, depletion, recipe_service, meal_plan_service)
    gen._get_banned_and_swiped = MagicMock(return_value=(set(), set(), set()))
    return gen


def test_pool_generator_dinner_sparse_calls_staple_meals(
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
    d.deplete_from_extended_ingredients.side_effect = (
        real_de.deplete_from_extended_ingredients
    )
    gen = _generator_with_bans_mock(pool_store, d, recipe_service, meal_plan_service)
    gen.generate_pool("hh", "user", "onboarding", ["dinner"])
    meal_plan_service.suggest_staple_meals.assert_called()
    recipe_service.search_recipes_complex.assert_not_called()


def test_pool_generator_dinner_no_candidates_after_threshold_step_calls_staple_meals(
    pool_store, recipe_service, meal_plan_service
):
    d = MagicMock()
    d.snapshot_pantry.return_value = {
        "a": {"id": "a", "base_ingredient": "salt", "quantity": 1.0, "unit": "tsp"},
        "b": {"id": "b", "base_ingredient": "pepper", "quantity": 1.0, "unit": "tsp"},
        "c": {"id": "c", "base_ingredient": "oil", "quantity": 1.0, "unit": "cup"},
    }

    def avail(sim):
        from backend.services.depletion_engine import DepletionEngine

        return DepletionEngine(MagicMock()).available_ingredient_names(sim)

    d.available_ingredient_names.side_effect = avail
    from backend.services.depletion_engine import DepletionEngine

    real_de = DepletionEngine(MagicMock())
    d.deplete_from_extended_ingredients.side_effect = (
        real_de.deplete_from_extended_ingredients
    )
    recipe_service.search_recipes_complex.return_value = []
    gen = _generator_with_bans_mock(pool_store, d, recipe_service, meal_plan_service)
    gen.generate_pool("hh", "user", "x", ["dinner"])
    meal_plan_service.suggest_staple_meals.assert_called()


def test_pool_generator_lunch_sparse_still_calls_staple_meals(
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
    d.deplete_from_extended_ingredients.side_effect = (
        real_de.deplete_from_extended_ingredients
    )
    gen = _generator_with_bans_mock(pool_store, d, recipe_service, meal_plan_service)
    gen.generate_pool("hh", "user", "onboarding", ["lunch"])
    meal_plan_service.suggest_staple_meals.assert_called()


def test_pool_generator_breakfast_sparse_still_calls_staple_meals(
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
    d.deplete_from_extended_ingredients.side_effect = (
        real_de.deplete_from_extended_ingredients
    )
    gen = _generator_with_bans_mock(pool_store, d, recipe_service, meal_plan_service)
    gen.generate_pool("hh", "user", "onboarding", ["breakfast"])
    meal_plan_service.suggest_staple_meals.assert_called()


# --- Group F: static checks ---


def test_static_no_hardcoded_confidence_050_filter():
    text = SUGGESTION_SERVICE_PATH.read_text()
    assert "c >= 0.50" not in text


def test_static_dinner_in_both_sparse_guards():
    source = SUGGESTION_SERVICE_PATH.parent / "pool_generator.py"
    tree = ast.parse(source.read_text())
    dinner_guards = 0
    for node in ast.walk(tree):
        if isinstance(node, ast.Compare):
            for op in node.ops:
                if isinstance(op, ast.In):
                    if isinstance(node.left, ast.Name) and node.left.id == "meal_type":
                        for comp in node.comparators:
                            if isinstance(comp, ast.Tuple):
                                elts = [
                                    e.value
                                    for e in comp.elts
                                    if isinstance(e, ast.Constant)
                                ]
                                if "dinner" in elts:
                                    dinner_guards += 1
    assert dinner_guards >= 2


def test_static_swiped_fallback_does_not_mutate_status():
    text = SUGGESTION_SERVICE_PATH.read_text()
    assert 'status="swiped"' in text
    assert "mark_swiped" not in text
    assert "status = \"unused\"" not in text
