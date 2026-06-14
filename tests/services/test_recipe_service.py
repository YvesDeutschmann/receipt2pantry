"""Tests for RecipeService (Spoonacular integration, cache, scaling)."""

import pytest
import requests
from unittest.mock import MagicMock, Mock, patch

from backend.services.recipe_service import RecipeService
from backend.utils.exceptions import RecipeQuotaException, ValidationException


def _make_config(
    *,
    api_key="test-spoon-key",
    base_url="https://api.spoonacular.test",
    timeout=30,
):
    cfg = Mock()
    cfg.SPOONACULAR_API_KEY = api_key
    cfg.SPOONACULAR_BASE_URL = base_url
    cfg.SPOONACULAR_TIMEOUT = timeout
    return cfg


def _recipe_list_payload():
    return [
        {
            "id": 1,
            "title": "Test Soup",
            "image": "img.jpg",
            "missedIngredientCount": 0,
            "usedIngredientCount": 2,
            "likes": 1,
            "missedIngredients": [],
        }
    ]


def _ok_find_response(payload):
    resp = MagicMock()
    resp.raise_for_status = Mock()
    resp.json.return_value = payload
    return resp


def _http_error(status_code: int):
    err = requests.exceptions.HTTPError()
    err.response = Mock(status_code=status_code)
    return err


@patch("backend.services.recipe_service.requests.get")
def test_findByIngredients_second_call_within_ttl_hits_cache(mock_get):
    mock_get.return_value = _ok_find_response(_recipe_list_payload())
    pantry = Mock()
    svc = RecipeService(pantry, _make_config())

    a = svc.get_recipes_by_pantry(
        "hh1", "u1", available_ingredients=["egg", "milk"], number=5
    )
    b = svc.get_recipes_by_pantry(
        "hh1", "u1", available_ingredients=["egg", "milk"], number=5
    )

    assert a == b
    assert mock_get.call_count == 1


@patch("backend.services.recipe_service.requests.get")
def test_cache_key_is_order_independent(mock_get):
    mock_get.return_value = _ok_find_response(_recipe_list_payload())
    pantry = Mock()
    svc = RecipeService(pantry, _make_config())

    svc.get_recipes_by_pantry(
        "hh1", "u1", available_ingredients=["a", "b"], number=5
    )
    svc.get_recipes_by_pantry(
        "hh1", "u1", available_ingredients=["b", "a"], number=5
    )

    assert mock_get.call_count == 1


@patch("backend.services.recipe_service.requests.get")
def test_cache_expires_after_ttl_seconds(mock_get):
    mock_get.return_value = _ok_find_response(_recipe_list_payload())
    pantry = Mock()
    svc = RecipeService(pantry, _make_config())

    # Patching time.time on the imported `time` module affects stdlib logging too
    # (same module object); silence this service's logger so only cache paths call time().
    times = [0.0, 1.0, 3.0, 3.0]
    with patch.multiple(
        "backend.services.recipe_service.logger",
        info=Mock(),
        error=Mock(),
        warning=Mock(),
    ), patch(
        "backend.services.recipe_service.time.time",
        side_effect=times,
    ):
        svc.get_recipes_by_pantry(
            "hh1",
            "u1",
            available_ingredients=["salt"],
            number=3,
            cache_ttl_seconds=2,
        )
        svc.get_recipes_by_pantry(
            "hh1",
            "u1",
            available_ingredients=["salt"],
            number=3,
            cache_ttl_seconds=2,
        )
        svc.get_recipes_by_pantry(
            "hh1",
            "u1",
            available_ingredients=["salt"],
            number=3,
            cache_ttl_seconds=2,
        )

    assert mock_get.call_count == 2


@patch("backend.services.recipe_service.requests.get")
def test_details_cache_keyed_by_recipe_id_int(mock_get):
    detail = {
        "id": 42,
        "title": "Cached Detail",
        "summary": "",
        "image": None,
        "readyInMinutes": 10,
        "servings": 2,
        "instructions": "",
        "extendedIngredients": [],
        "analyzedInstructions": [],
        "sourceUrl": None,
        "spoonacularSourceUrl": None,
        "dishTypes": ["main course", "dinner"],
        "cuisines": ["italian"],
    }
    mock_get.return_value = _ok_find_response(detail)
    pantry = Mock()
    svc = RecipeService(pantry, _make_config())

    with patch("backend.services.recipe_service.time.time", return_value=100.0):
        a = svc.get_recipe_details(42)
        b = svc.get_recipe_details(42)

    assert a == b
    assert a["id"] == 42
    assert a["dishTypes"] == ["main course", "dinner"]
    assert a["cuisines"] == ["italian"]
    assert mock_get.call_count == 1

    svc.get_recipe_details(99)
    assert mock_get.call_count == 2
    assert 42 in svc._details_cache
    assert 99 in svc._details_cache


@patch("backend.services.recipe_service.requests.get")
def test_get_recipes_by_pantry_uses_config_timeout(mock_get):
    mock_get.return_value = _ok_find_response(_recipe_list_payload())
    pantry = Mock()
    timeout = 77
    svc = RecipeService(pantry, _make_config(timeout=timeout))

    svc.get_recipes_by_pantry(
        None, "u1", available_ingredients=["flour"], number=5
    )

    mock_get.assert_called_once()
    _args, kwargs = mock_get.call_args
    assert kwargs.get("timeout") == timeout


def test_missing_api_key_raises_validation_exception():
    pantry = Mock()
    svc = RecipeService(pantry, _make_config(api_key=None))

    with pytest.raises(ValidationException, match="Spoonacular API key not configured"):
        svc.get_recipes_by_pantry(
            "hh", "u1", available_ingredients=["x"], number=5
        )


@patch("backend.services.recipe_service.requests.get")
def test_402_response_mapped_to_recipe_quota_exception(mock_get):
    resp = MagicMock()
    resp.raise_for_status.side_effect = _http_error(402)
    mock_get.return_value = resp
    pantry = Mock()
    svc = RecipeService(pantry, _make_config())

    with pytest.raises(RecipeQuotaException, match="quota exceeded"):
        svc.get_recipes_by_pantry(
            "hh", "u1", available_ingredients=["flour"], number=5
        )


@patch("backend.services.recipe_service.requests.get")
def test_429_response_mapped_to_recipe_quota_exception(mock_get):
    resp = MagicMock()
    resp.raise_for_status.side_effect = _http_error(429)
    mock_get.return_value = resp
    pantry = Mock()
    svc = RecipeService(pantry, _make_config())

    with pytest.raises(RecipeQuotaException, match="rate limit exceeded"):
        svc.get_recipes_by_pantry(
            "hh", "u1", available_ingredients=["flour"], number=5
        )


def test_scale_recipe_doubles_amounts_for_double_members():
    pantry = Mock()
    svc = RecipeService(pantry, _make_config())

    base = {
        "id": 1,
        "servings": 4,
        "extendedIngredients": [
            {"name": "flour", "amount": 2.0},
            {"name": "salt", "amount": 1},
        ],
    }

    doubled = svc.scale_recipe(base, 8)
    assert doubled["servings"] == 8
    assert doubled["extendedIngredients"][0]["amount"] == pytest.approx(4.0)
    assert doubled["extendedIngredients"][1]["amount"] == pytest.approx(2.0)

    half = svc.scale_recipe(base, 2)
    assert half["servings"] == 2
    assert half["extendedIngredients"][0]["amount"] == pytest.approx(1.0)

    one_half = svc.scale_recipe(base, 6)
    assert one_half["servings"] == 6
    assert one_half["extendedIngredients"][0]["amount"] == pytest.approx(3.0)


def test_scale_recipe_handles_missing_original_servings():
    pantry = Mock()
    svc = RecipeService(pantry, _make_config())

    details = {
        "id": 2,
        "extendedIngredients": [{"name": "sugar", "amount": 1.0}],
    }
    scaled = svc.scale_recipe(details, 4)

    assert "servings" not in details
    assert scaled["servings"] == 4
    assert scaled["extendedIngredients"][0]["amount"] == pytest.approx(4.0)


def test_scale_recipe_rejects_zero_member_count():
    """Current behavior: target_servings <= 0 is clamped to 1 (not raised)."""
    pantry = Mock()
    svc = RecipeService(pantry, _make_config())

    details = {
        "id": 3,
        "servings": 4,
        "extendedIngredients": [{"name": "butter", "amount": 8.0}],
    }

    scaled_zero = svc.scale_recipe(details, 0)
    assert scaled_zero["servings"] == 1
    assert scaled_zero["extendedIngredients"][0]["amount"] == pytest.approx(2.0)

    scaled_neg = svc.scale_recipe(details, -3)
    assert scaled_neg["servings"] == 1
    assert scaled_neg["extendedIngredients"][0]["amount"] == pytest.approx(2.0)


@patch("backend.services.recipe_service.requests.get")
def test_search_recipes_complex_uses_meal_type_and_parses_results(mock_get):
    mock_get.return_value = _ok_find_response(
        {
            "results": [
                {
                    "id": 99,
                    "title": "Grilled Chicken",
                    "image": "chicken.jpg",
                    "dishTypes": ["main course", "dinner"],
                    "cuisines": ["american"],
                    "extendedIngredients": [{"name": "chicken", "amount": 1}],
                    "usedIngredients": [{"name": "chicken"}],
                    "missedIngredients": [],
                    "unusedIngredients": [],
                }
            ]
        }
    )
    pantry = Mock()
    svc = RecipeService(pantry, _make_config())

    out = svc.search_recipes_complex(
        "hh1", "u1", ["chicken", "rice"], "dinner", number=5
    )

    assert len(out) == 1
    assert out[0]["id"] == 99
    assert out[0]["dishTypes"] == ["main course", "dinner"]
    assert out[0]["extendedIngredients"]
    mock_get.assert_called_once()
    _url, kwargs = mock_get.call_args
    params = kwargs["params"]
    assert params["type"] == "main course"
    assert params["sort"] == "max-used-ingredients"
    assert params["fillIngredients"] is True
    assert params["addRecipeInformation"] is True
    assert "chicken" in params["includeIngredients"]


@patch("backend.services.recipe_service.requests.get")
def test_search_recipes_complex_cache_hit(mock_get):
    mock_get.return_value = _ok_find_response({"results": []})
    pantry = Mock()
    svc = RecipeService(pantry, _make_config())

    svc.search_recipes_complex("hh", "u1", ["egg"], "breakfast", number=3)
    svc.search_recipes_complex("hh", "u1", ["egg"], "breakfast", number=3)

    assert mock_get.call_count == 1
