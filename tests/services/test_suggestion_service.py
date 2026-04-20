"""Tests for Phase 3 suggestion ranking (Groups 14–16 + Phase 3 scenarios)."""

from unittest.mock import MagicMock

import pytest

from backend.services.suggestion_service import (
    ASPIRATIONAL_CONFIDENCE_PENALTY,
    ASPIRATIONAL_DISMISS_THRESHOLD,
    SUGGESTION_CACHE_TTL_SECONDS,
    SuggestionService,
    find_best_match,
    get_status_label,
    get_tier,
)
from tests.services.conftest import (
    TEST_DATE,
    days_after,
    days_ago,
    make_pantry_item,
)

# --- Group 14: get_tier ---


def test_tier_cook_tonight_boundary():
    assert get_tier(0.75) == "cook_tonight"


def test_tier_probably_have_upper_boundary():
    assert get_tier(0.74) == "probably_have"


def test_tier_probably_have_lower_boundary():
    assert get_tier(0.50) == "probably_have"


def test_tier_check_first_upper_boundary():
    assert get_tier(0.49) == "check_first"


def test_tier_check_first_lower_boundary():
    assert get_tier(0.20) == "check_first"


def test_tier_suppressed_boundary():
    assert get_tier(0.19) == "suppressed"


def test_tier_suppressed_zero():
    assert get_tier(0.0) == "suppressed"


@pytest.mark.parametrize(
    "value,expected",
    [
        (0.75, "cook_tonight"),
        (0.749, "probably_have"),
        (0.50, "probably_have"),
        (0.499, "check_first"),
        (0.20, "check_first"),
    ],
)
def test_get_tier_at_exact_thresholds(value, expected):
    assert get_tier(value) == expected


# --- Group 16: get_status_label ---


def test_label_use_soon_overrides_confidence():
    assert get_status_label(0.85, True) == "check_freshness"


def test_label_confirmed():
    assert get_status_label(0.75, False) == "confirmed"


def test_label_probably_have():
    assert get_status_label(0.60, False) == "probably_have"


def test_label_check_pantry():
    assert get_status_label(0.30, False) == "check_pantry"


def test_label_null_below_threshold():
    assert get_status_label(0.15, False) is None


@pytest.mark.parametrize("confidence", [0.85, 0.60, 0.25, 0.0])
def test_get_status_label_check_freshness_overrides_all_when_use_soon(confidence):
    assert get_status_label(confidence, True) == "check_freshness"


def test_get_status_label_returns_none_below_0_20():
    assert get_status_label(0.19, False) is None


# --- find_best_match / fuzzy ---


def test_fuzzy_exact_match():
    pantry = [make_pantry_item(base_ingredient="chicken breast")]
    assert find_best_match(pantry, "chicken breast") is pantry[0]


def test_fuzzy_partial_match():
    pantry = [make_pantry_item(base_ingredient="chicken breast")]
    assert find_best_match(pantry, "boneless chicken breast") is pantry[0]


def test_fuzzy_no_match():
    pantry = [make_pantry_item(base_ingredient="chicken breast")]
    assert find_best_match(pantry, "tofu") is None


def test_find_best_match_returns_exact_match_when_available():
    pantry = [make_pantry_item(base_ingredient="chicken breast")]
    assert find_best_match(pantry, "chicken breast") is pantry[0]


def test_find_best_match_prefers_canonical_over_substring():
    """Regression: do not pick tomato paste via substring when canonical tomato exists."""
    tomato = make_pantry_item(base_ingredient="tomato", id="t")
    paste = make_pantry_item(base_ingredient="tomato paste", id="p")
    pantry = [paste, tomato]
    assert find_best_match(pantry, "tomato") is tomato


def test_fuzzy_real_receipt_names():
    """Receipt-normalized bases vs Spoonacular-style names (see meald-depletion-tests.md)."""
    pairs = [
        ("whole milk", "whole milk"),
        ("olive oil", "olive oil"),
        ("chicken breast", "boneless chicken breast"),
        ("spinach", "spinach"),
        ("eggs", "eggs"),
        ("all-purpose flour", "all-purpose flour"),
        ("butter", "butter"),
        ("tomatoes", "tomatoes"),
        ("parmesan cheese", "parmesan cheese"),
        ("ground beef", "ground beef 93/7"),
    ]
    for base, recipe_name in pairs:
        pantry = [make_pantry_item(base_ingredient=base)]
        assert find_best_match(pantry, recipe_name) is pantry[0], (
            base,
            recipe_name,
        )


# --- Group 15: score_recipe (mocked service) ---


@pytest.fixture
def suggestion_svc():
    supabase = MagicMock()
    pantry = MagicMock()
    recipe = MagicMock()
    config = MagicMock()
    return SuggestionService(supabase, pantry, recipe, config)


def _frittata_recipe():
    return {
        "id": 1,
        "title": "Spinach Frittata",
        "extendedIngredients": [
            {"name": "chicken breast", "aisle": "Meat"},
            {"name": "spinach", "aisle": "Produce"},
            {"name": "garlic", "aisle": "Produce"},
        ],
    }


def test_score_all_high_confidence(suggestion_svc):
    pantry = [
        make_pantry_item(base_ingredient="chicken breast", id="a"),
        make_pantry_item(base_ingredient="spinach", id="b"),
        make_pantry_item(base_ingredient="garlic", id="c"),
    ]
    cls = {
        "chicken breast": {**{}, "is_soft_required": False},
        "spinach": {"is_soft_required": False},
        "garlic": {"is_soft_required": False},
    }
    out = suggestion_svc.score_recipe(
        _frittata_recipe(),
        pantry,
        {"depletion_multiplier": 1.0},
        [],
        {},
        cls,
        today=TEST_DATE,
        confidence_override_by_base={
            "chicken breast": 0.95,
            "spinach": 0.90,
            "garlic": 0.80,
        },
    )
    assert out["tier"] == "cook_tonight"
    assert abs(out["score"] - (0.95 + 0.90 + 0.80) / 3) < 0.01


def test_score_one_borderline_drops_tier(suggestion_svc):
    pantry = [
        make_pantry_item(base_ingredient="chicken breast"),
        make_pantry_item(base_ingredient="spinach"),
        make_pantry_item(base_ingredient="garlic"),
    ]
    cls = {
        "chicken breast": {"is_soft_required": False},
        "spinach": {"is_soft_required": False},
        "garlic": {"is_soft_required": False},
    }
    out = suggestion_svc.score_recipe(
        _frittata_recipe(),
        pantry,
        {"depletion_multiplier": 1.0},
        [],
        {},
        cls,
        today=TEST_DATE,
        confidence_override_by_base={
            "chicken breast": 0.95,
            "spinach": 0.55,
            "garlic": 0.80,
        },
    )
    assert out["tier"] == "probably_have"


def test_score_use_soon_all_match_boost(suggestion_svc):
    pantry = [
        make_pantry_item(base_ingredient="spinach", id="b", use_soon=True),
        make_pantry_item(base_ingredient="chicken breast", id="a", use_soon=True),
    ]
    use_soon = list(pantry)
    cls = {
        "chicken breast": {"is_soft_required": False},
        "spinach": {"is_soft_required": False},
    }
    recipe = {
        "id": 2,
        "title": "Chicken Spinach",
        "extendedIngredients": [
            {"name": "chicken breast", "aisle": "Meat"},
            {"name": "spinach", "aisle": "Produce"},
        ],
    }
    out = suggestion_svc.score_recipe(
        recipe,
        pantry,
        {"depletion_multiplier": 1.0},
        use_soon,
        {},
        cls,
        today=TEST_DATE,
        confidence_override_by_base={
            "chicken breast": 0.90,
            "spinach": 0.90,
        },
    )
    assert out["tier"] == "use_soon"
    base = (0.90 + 0.90) / 2
    assert abs(out["score"] - (base + 2.0)) < 0.01


def test_score_use_soon_partial_match_boost(suggestion_svc):
    pantry = [
        make_pantry_item(base_ingredient="spinach", id="b", use_soon=True),
        make_pantry_item(base_ingredient="chicken breast", id="a", use_soon=True),
    ]
    use_soon = list(pantry)
    cls = {
        "chicken breast": {"is_soft_required": False},
        "spinach": {"is_soft_required": False},
    }
    recipe = {
        "id": 3,
        "title": "Spinach only",
        "extendedIngredients": [
            {"name": "spinach", "aisle": "Produce"},
        ],
    }
    out = suggestion_svc.score_recipe(
        recipe,
        pantry,
        {"depletion_multiplier": 1.0},
        use_soon,
        {},
        cls,
        today=TEST_DATE,
        confidence_override_by_base={"spinach": 0.90},
    )
    assert out["tier"] == "use_soon"
    assert abs(out["score"] - (0.90 + 1.0)) < 0.01


def test_score_use_soon_as_garnish_no_boost(suggestion_svc):
    pantry = [
        make_pantry_item(base_ingredient="parsley", id="p", use_soon=True),
    ]
    use_soon = list(pantry)
    cls = {"parsley": {"is_soft_required": True}}
    recipe = {
        "id": 4,
        "title": "Soup",
        "extendedIngredients": [
            {"name": "parsley", "aisle": "Produce"},
        ],
    }
    out = suggestion_svc.score_recipe(
        recipe,
        pantry,
        {"depletion_multiplier": 1.0},
        use_soon,
        {},
        cls,
        today=TEST_DATE,
        confidence_override_by_base={"parsley": 0.95},
    )
    assert out["tier"] != "use_soon"


def test_score_missing_ingredient_suppresses(suggestion_svc):
    pantry = [
        make_pantry_item(base_ingredient="spinach"),
        make_pantry_item(base_ingredient="garlic"),
    ]
    cls = {
        "chicken breast": {"is_soft_required": False},
        "spinach": {"is_soft_required": False},
        "garlic": {"is_soft_required": False},
    }
    out = suggestion_svc.score_recipe(
        _frittata_recipe(),
        pantry,
        {"depletion_multiplier": 1.0},
        [],
        {},
        cls,
        today=TEST_DATE,
        confidence_override_by_base={
            "spinach": 0.90,
            "garlic": 0.80,
        },
    )
    assert out["tier"] == "suppressed"


def test_score_aspirational_penalty(suggestion_svc):
    pantry = [
        make_pantry_item(base_ingredient="olive oil"),
        make_pantry_item(base_ingredient="spinach"),
    ]
    cls = {
        "olive oil": {"is_soft_required": False},
        "spinach": {"is_soft_required": False},
    }
    recipe = {
        "id": 5,
        "title": "Salad",
        "extendedIngredients": [
            {"name": "olive oil", "aisle": "Oil"},
            {"name": "spinach", "aisle": "Produce"},
        ],
    }
    signals_high = {"olive oil": ASPIRATIONAL_DISMISS_THRESHOLD}
    signals_low = {"olive oil": ASPIRATIONAL_DISMISS_THRESHOLD - 1}

    out_high = suggestion_svc.score_recipe(
        recipe,
        pantry,
        {"depletion_multiplier": 1.0},
        [],
        signals_high,
        cls,
        today=TEST_DATE,
        confidence_override_by_base={"olive oil": 0.80, "spinach": 0.90},
    )
    out_low = suggestion_svc.score_recipe(
        recipe,
        pantry,
        {"depletion_multiplier": 1.0},
        [],
        signals_low,
        cls,
        today=TEST_DATE,
        confidence_override_by_base={"olive oil": 0.80, "spinach": 0.90},
    )
    assert out_high["tier"] == out_low["tier"] == "cook_tonight"
    assert abs(
        (out_low["score"] - out_high["score"]) - ASPIRATIONAL_CONFIDENCE_PENALTY / 2
    ) < 0.01


def test_score_aspirational_below_threshold_no_penalty(suggestion_svc):
    pantry = [
        make_pantry_item(base_ingredient="olive oil"),
        make_pantry_item(base_ingredient="spinach"),
    ]
    cls = {
        "olive oil": {"is_soft_required": False},
        "spinach": {"is_soft_required": False},
    }
    recipe = {
        "id": 6,
        "title": "Salad",
        "extendedIngredients": [
            {"name": "olive oil", "aisle": "Oil"},
            {"name": "spinach", "aisle": "Produce"},
        ],
    }
    out = suggestion_svc.score_recipe(
        recipe,
        pantry,
        {"depletion_multiplier": 1.0},
        [],
        {"olive oil": 2},
        cls,
        today=TEST_DATE,
        confidence_override_by_base={"olive oil": 0.80, "spinach": 0.90},
    )
    out_no = suggestion_svc.score_recipe(
        recipe,
        pantry,
        {"depletion_multiplier": 1.0},
        [],
        {},
        cls,
        today=TEST_DATE,
        confidence_override_by_base={"olive oil": 0.80, "spinach": 0.90},
    )
    assert out["score"] == out_no["score"]


def test_aspirational_penalty_applied_after_three_dismissals(suggestion_svc):
    pantry = [
        make_pantry_item(base_ingredient="olive oil"),
        make_pantry_item(base_ingredient="spinach"),
    ]
    cls = {
        "olive oil": {"is_soft_required": False},
        "spinach": {"is_soft_required": False},
    }
    recipe = {
        "id": 501,
        "title": "Salad",
        "extendedIngredients": [
            {"name": "olive oil", "aisle": "Oil"},
            {"name": "spinach", "aisle": "Produce"},
        ],
    }
    base = {"olive oil": 0.80, "spinach": 0.90}
    out_at_2 = suggestion_svc.score_recipe(
        recipe,
        pantry,
        {"depletion_multiplier": 1.0},
        [],
        {"olive oil": 2},
        cls,
        today=TEST_DATE,
        confidence_override_by_base=base,
    )
    out_at_3 = suggestion_svc.score_recipe(
        recipe,
        pantry,
        {"depletion_multiplier": 1.0},
        [],
        {"olive oil": ASPIRATIONAL_DISMISS_THRESHOLD},
        cls,
        today=TEST_DATE,
        confidence_override_by_base=base,
    )
    assert out_at_3["score"] < out_at_2["score"]


def test_aspirational_penalty_not_persisted_to_db(suggestion_svc):
    pantry = [
        make_pantry_item(base_ingredient="olive oil"),
        make_pantry_item(base_ingredient="spinach"),
    ]
    cls = {
        "olive oil": {"is_soft_required": False},
        "spinach": {"is_soft_required": False},
    }
    recipe = {
        "id": 502,
        "title": "Salad",
        "extendedIngredients": [
            {"name": "olive oil", "aisle": "Oil"},
            {"name": "spinach", "aisle": "Produce"},
        ],
    }
    suggestion_svc.supabase.reset_mock()
    suggestion_svc.score_recipe(
        recipe,
        pantry,
        {"depletion_multiplier": 1.0},
        [],
        {"olive oil": ASPIRATIONAL_DISMISS_THRESHOLD},
        cls,
        today=TEST_DATE,
        confidence_override_by_base={"olive oil": 0.80, "spinach": 0.90},
    )
    suggestion_svc.supabase.assert_not_called()


def test_aspirational_penalty_does_not_flip_tier_by_itself(suggestion_svc):
    pantry = [make_pantry_item(base_ingredient="chicken breast")]
    cls = {"chicken breast": {"is_soft_required": False}}
    recipe = {
        "id": 503,
        "title": "Chicken",
        "extendedIngredients": [
            {"name": "chicken breast", "aisle": "Meat"},
        ],
    }
    out = suggestion_svc.score_recipe(
        recipe,
        pantry,
        {"depletion_multiplier": 1.0},
        [],
        {"chicken breast": ASPIRATIONAL_DISMISS_THRESHOLD},
        cls,
        today=TEST_DATE,
        confidence_override_by_base={"chicken breast": 0.90},
    )
    assert out["tier"] == "cook_tonight"
    assert abs(out["score"] - (0.90 - ASPIRATIONAL_CONFIDENCE_PENALTY)) < 0.01


def test_spice_only_uncertainty_stays_cook_tonight(suggestion_svc):
    pantry = [
        make_pantry_item(base_ingredient="chicken breast"),
        make_pantry_item(base_ingredient="paprika"),
    ]
    cls = {
        "chicken breast": {"is_soft_required": False},
        "paprika": {"is_soft_required": True, "default_days_supply": 180},
    }
    recipe = {
        "id": 7,
        "title": "Chicken",
        "extendedIngredients": [
            {"name": "chicken breast", "aisle": "Meat"},
            {"name": "paprika", "aisle": "Spices and Seasonings"},
        ],
    }
    out = suggestion_svc.score_recipe(
        recipe,
        pantry,
        {"depletion_multiplier": 1.0},
        [],
        {},
        cls,
        today=TEST_DATE,
        confidence_override_by_base={
            "chicken breast": 0.90,
            "paprika": 0.40,
        },
    )
    assert out["tier"] == "cook_tonight"


def test_low_protein_confidence_suppressed(suggestion_svc):
    pantry = [make_pantry_item(base_ingredient="chicken breast")]
    cls = {"chicken breast": {"is_soft_required": False}}
    recipe = {
        "id": 8,
        "title": "Chicken",
        "extendedIngredients": [
            {"name": "chicken breast", "aisle": "Meat"},
        ],
    }
    out = suggestion_svc.score_recipe(
        recipe,
        pantry,
        {"depletion_multiplier": 1.0},
        [],
        {},
        cls,
        today=TEST_DATE,
        confidence_override_by_base={"chicken breast": 0.15},
    )
    assert out["tier"] == "suppressed"


def test_unknown_staple_paprika_soft_not_suppressed(suggestion_svc):
    """paprika is soft_required — does not gate tier."""
    pantry = [make_pantry_item(base_ingredient="chicken breast")]
    cls = {
        "chicken breast": {"is_soft_required": False},
        "paprika": {"is_soft_required": True},
    }
    recipe = {
        "id": 9,
        "title": "Chicken",
        "extendedIngredients": [
            {"name": "chicken breast", "aisle": "Meat"},
            {"name": "paprika", "aisle": "Spices and Seasonings"},
        ],
    }
    out = suggestion_svc.score_recipe(
        recipe,
        pantry,
        {"depletion_multiplier": 1.0},
        [],
        {},
        cls,
        today=TEST_DATE,
        confidence_override_by_base={
            "chicken breast": 0.90,
        },
    )
    assert out["tier"] == "cook_tonight"


# --- Phase 3: get_recipe_suggestions integration (mocked Spoonacular) ---


def test_get_recipe_suggestions_pipeline_mocked(monkeypatch):
    def fake_compute(*args, **kwargs):
        return 0.80

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

    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.return_value = [
        {"id": 1, "title": "Test", "image": "", "missedIngredientCount": 0}
    ]
    recipe_service.get_recipe_details.return_value = {
        "id": 1,
        "title": "Test",
        "extendedIngredients": [
            {"name": "chicken breast", "aisle": "Meat"},
        ],
    }

    config = MagicMock()
    svc = SuggestionService(supabase, pantry_service, recipe_service, config)

    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    assert "cook_tonight" in out
    recipe_service.get_recipes_by_pantry.assert_called_once()
    assert isinstance(out["cook_tonight"], list)


def test_suggestion_cache_hit_returns_identical_payload(monkeypatch):
    _patch_suggestion_pipeline_compute(monkeypatch)

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

    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.return_value = [
        {"id": 1, "title": "Test", "image": "", "missedIngredientCount": 0}
    ]
    recipe_service.get_recipe_details.return_value = {
        "id": 1,
        "title": "Test",
        "extendedIngredients": [
            {"name": "chicken breast", "aisle": "Meat"},
        ],
    }

    config = MagicMock()
    svc = SuggestionService(supabase, pantry_service, recipe_service, config)

    clock = iter([1000.0, 1000.0])

    def now():
        return next(clock)

    out1 = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE, now=now)
    out2 = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE, now=now)
    assert out1 == out2
    assert recipe_service.get_recipes_by_pantry.call_count == 1


def test_suggestion_cache_miss_when_user_prefs_change(monkeypatch):
    _patch_suggestion_pipeline_compute(monkeypatch)

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

    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.return_value = [
        {"id": 1, "title": "Test", "image": "", "missedIngredientCount": 0}
    ]
    recipe_service.get_recipe_details.return_value = {
        "id": 1,
        "title": "Test",
        "extendedIngredients": [
            {"name": "chicken breast", "aisle": "Meat"},
        ],
    }

    config = MagicMock()
    svc = SuggestionService(supabase, pantry_service, recipe_service, config)

    svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    assert recipe_service.get_recipes_by_pantry.call_count == 1

    supabase.get_user_preferences.return_value = {"depletion_multiplier": 2.0}
    svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    assert recipe_service.get_recipes_by_pantry.call_count == 2


def test_suggestion_cache_expires_after_ttl_seconds(monkeypatch):
    _patch_suggestion_pipeline_compute(monkeypatch)

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

    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.return_value = [
        {"id": 1, "title": "Test", "image": "", "missedIngredientCount": 0}
    ]
    recipe_service.get_recipe_details.return_value = {
        "id": 1,
        "title": "Test",
        "extendedIngredients": [
            {"name": "chicken breast", "aisle": "Meat"},
        ],
    }

    config = MagicMock()
    svc = SuggestionService(supabase, pantry_service, recipe_service, config)

    t0 = 1000.0
    t_expired = t0 + SUGGESTION_CACHE_TTL_SECONDS + 1.0
    clock = iter([t0, t_expired, t_expired])

    def now():
        return next(clock)

    svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE, now=now)
    svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE, now=now)
    assert recipe_service.get_recipes_by_pantry.call_count == 2


def test_confidence_engine_imports_resolved_at_import_time():
    import backend.services.suggestion_service as ssm

    assert callable(ssm._find_pantry_match)
    assert callable(ssm._to_date)


def _patch_suggestion_pipeline_compute(monkeypatch):
    def fake_compute(*args, **kwargs):
        return 0.80

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


def test_use_soon_shelf_disappears_after_expiry(monkeypatch):
    """Group 17: expired use_soon item is excluded from use_soon_items → no use_soon tier."""
    _patch_suggestion_pipeline_compute(monkeypatch)

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
            use_soon=True,
            use_soon_expires=days_ago(TEST_DATE, 1).isoformat(),
        ),
    ]
    pantry_service = MagicMock()
    pantry_service._get_household_id_for_user.return_value = "hh"
    pantry_service._get_pantry_items.return_value = pantry

    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.return_value = [
        {"id": 1, "title": "Test", "image": "", "missedIngredientCount": 0}
    ]
    recipe_service.get_recipe_details.return_value = {
        "id": 1,
        "title": "Test",
        "extendedIngredients": [
            {"name": "chicken breast", "aisle": "Meat"},
        ],
    }

    config = MagicMock()
    svc = SuggestionService(supabase, pantry_service, recipe_service, config)

    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    assert out["use_soon_shelf"] == []


def test_use_soon_shelf_empty_when_no_use_soon_items(monkeypatch):
    """Group 17: no use_soon flags → use_soon_shelf stays empty."""
    _patch_suggestion_pipeline_compute(monkeypatch)

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
            use_soon=False,
        ),
    ]
    pantry_service = MagicMock()
    pantry_service._get_household_id_for_user.return_value = "hh"
    pantry_service._get_pantry_items.return_value = pantry

    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.return_value = [
        {"id": 1, "title": "Test", "image": "", "missedIngredientCount": 0}
    ]
    recipe_service.get_recipe_details.return_value = {
        "id": 1,
        "title": "Test",
        "extendedIngredients": [
            {"name": "chicken breast", "aisle": "Meat"},
        ],
    }

    config = MagicMock()
    svc = SuggestionService(supabase, pantry_service, recipe_service, config)

    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    assert out["use_soon_shelf"] == []


def test_use_soon_shelf_populated_for_primary_ingredient(monkeypatch):
    """Group 17: active use_soon + primary match → recipe lands on use_soon_shelf."""
    _patch_suggestion_pipeline_compute(monkeypatch)

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
            use_soon=True,
            use_soon_expires=days_after(TEST_DATE, 1).isoformat(),
        ),
    ]
    pantry_service = MagicMock()
    pantry_service._get_household_id_for_user.return_value = "hh"
    pantry_service._get_pantry_items.return_value = pantry

    recipe_service = MagicMock()
    recipe_service.get_recipes_by_pantry.return_value = [
        {"id": 1, "title": "Test", "image": "", "missedIngredientCount": 0}
    ]
    recipe_service.get_recipe_details.return_value = {
        "id": 1,
        "title": "Test",
        "extendedIngredients": [
            {"name": "chicken breast", "aisle": "Meat"},
        ],
    }

    config = MagicMock()
    svc = SuggestionService(supabase, pantry_service, recipe_service, config)

    out = svc.get_recipe_suggestions("user-1", "hh", today=TEST_DATE)
    assert len(out["use_soon_shelf"]) >= 1
    assert out["use_soon_shelf"][0].get("tier") == "use_soon"


def test_use_soon_meat_disclaimer_ingredient_flag(suggestion_svc, monkeypatch):
    """Group 17: use_soon meat shows check_freshness on the matching ingredient flag."""
    def fake_compute(*args, **kwargs):
        return 0.85

    monkeypatch.setattr(
        "backend.services.suggestion_service.compute_confidence", fake_compute
    )

    pantry = [
        make_pantry_item(
            base_ingredient="chicken breast",
            id="a",
            use_soon=True,
        ),
    ]
    use_soon = list(pantry)
    cls = {"chicken breast": {"is_soft_required": False}}
    recipe = {
        "id": 10,
        "title": "Chicken",
        "extendedIngredients": [
            {"name": "chicken breast", "aisle": "Meat"},
        ],
    }
    out = suggestion_svc.score_recipe(
        recipe,
        pantry,
        {"depletion_multiplier": 1.0},
        use_soon,
        {},
        cls,
        today=TEST_DATE,
    )
    ch = next(
        f
        for f in out["ingredient_flags"]
        if "chicken" in (f["ingredient_name"] or "").lower()
    )
    assert ch["is_use_soon"] is True
    assert ch["status_label"] == "check_freshness"


def test_cache_invalidate_on_dismiss():
    supabase = MagicMock()
    pantry_service = MagicMock()
    recipe_service = MagicMock()
    config = MagicMock()
    svc = SuggestionService(supabase, pantry_service, recipe_service, config)

    pantry_service._get_household_id_for_user.return_value = "hh"
    pantry_service._get_pantry_items.return_value = [
        make_pantry_item(base_ingredient="chicken breast", id="x")
    ]
    recipe_service.get_recipe_details.return_value = {
        "id": 99,
        "extendedIngredients": [{"name": "chicken breast", "aisle": "Meat"}],
    }

    svc.on_recipe_dismiss("u1", 99, household_id="hh")
    supabase.increment_ingredient_dismiss_counts.assert_called_once()
    # cache cleared should not raise
    svc.invalidate_suggestion_cache("u1", "hh")
