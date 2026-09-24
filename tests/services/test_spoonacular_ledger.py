"""Spoonacular per-user usage ledger and RecipeService integration."""

from unittest.mock import MagicMock, Mock, patch

import pytest
import requests

from backend.routes.recipes import _recipe_ai_service_response
from backend.services.recipe_service import RecipeService
from backend.services.spoonacular_ledger import (
    SPOONACULAR_LEDGER_UNAVAILABLE_MSG,
    SPOONACULAR_USER_CAP_MSG,
    SpoonacularLedger,
    estimate_points,
)
from backend.utils.exceptions import AIServiceException


def _config(cap=150, budget=500):
    cfg = Mock()
    cfg.SPOONACULAR_API_KEY = "key"
    cfg.SPOONACULAR_BASE_URL = "https://api.spoonacular.test"
    cfg.SPOONACULAR_TIMEOUT = 30
    cfg.SPOONACULAR_CALL_BUDGET = budget
    cfg.SPOONACULAR_CALL_BUDGET_PERIOD_SECONDS = 3600
    cfg.SPOONACULAR_USER_DAILY_POINT_CAP = cap
    return cfg


def _admin_mock(sum_points=0.0, insert_id="row-1"):
    admin = MagicMock()
    sum_chain = MagicMock()
    sum_chain.execute.return_value = MagicMock(data=[{"points": sum_points}])
    admin.table.return_value.select.return_value.eq.return_value.gte.return_value = (
        sum_chain
    )
    ins_chain = MagicMock()
    ins_chain.execute.return_value = MagicMock(data=[{"id": insert_id}])
    admin.table.return_value.insert.return_value = ins_chain
    upd_chain = MagicMock()
    admin.table.return_value.update.return_value.eq.return_value = upd_chain
    return admin


def test_estimate_points():
    assert estimate_points("recipeInformation") == 1.0
    assert estimate_points("complexSearch", 5) == 6.0


def test_reserve_refuses_when_over_cap():
    admin = _admin_mock(sum_points=149.0)
    ledger = SpoonacularLedger(admin, 150)
    with pytest.raises(AIServiceException, match=SPOONACULAR_USER_CAP_MSG):
        ledger.reserve_before_call("u1", "recipe_open", "recipeInformation", 2.0)


def test_reserve_requires_admin_when_cap_on():
    ledger = SpoonacularLedger(None, 150)
    with pytest.raises(AIServiceException, match=SPOONACULAR_LEDGER_UNAVAILABLE_MSG):
        ledger.reserve_before_call("u1", "recipe_open", "recipeInformation", 1.0)


@patch("backend.services.recipe_service.requests.get")
def test_cache_miss_reserves_before_get(mock_get):
    admin = _admin_mock(sum_points=0.0)
    pantry = MagicMock()
    svc = RecipeService(pantry, _config(cap=150), admin_client=admin)
    resp = MagicMock()
    resp.raise_for_status = Mock()
    resp.json.return_value = []
    resp.headers = {"X-API-Quota-Request": "1"}
    mock_get.return_value = resp

    svc.get_recipes_by_pantry(
        "hh",
        "user-1",
        available_ingredients=["egg"],
        number=5,
        caller="suggestion_search",
    )
    admin.table.return_value.insert.assert_called_once()
    mock_get.assert_called_once()


@patch("backend.services.recipe_service.requests.get")
def test_over_cap_skips_get_and_worker_record(mock_get):
    admin = _admin_mock(sum_points=150.0)
    pantry = MagicMock()
    svc = RecipeService(pantry, _config(cap=150), admin_client=admin)
    svc._period_call_count = 0

    with pytest.raises(AIServiceException, match=SPOONACULAR_USER_CAP_MSG):
        svc.get_recipe_details(1, user_id="u1", caller="recipe_open")

    mock_get.assert_not_called()
    assert svc._period_call_count == 0


@patch("backend.services.recipe_service.requests.get")
def test_cap_zero_allows_without_admin(mock_get):
    pantry = MagicMock()
    svc = RecipeService(pantry, _config(cap=0))
    resp = MagicMock()
    resp.raise_for_status = Mock()
    resp.json.return_value = {
        "id": 1,
        "title": "T",
        "summary": "",
        "image": "",
        "readyInMinutes": 1,
        "servings": 1,
        "instructions": "",
        "extendedIngredients": [],
        "analyzedInstructions": [],
        "sourceUrl": "",
        "spoonacularSourceUrl": "",
        "dishTypes": [],
        "cuisines": [],
    }
    resp.headers = {}
    mock_get.return_value = resp
    svc.get_recipe_details(1, user_id="u1", caller="recipe_open")
    mock_get.assert_called_once()


def test_recipe_route_maps_user_cap_to_429():
    from backend.app import create_app

    app = create_app()
    with app.app_context():
        resp, code = _recipe_ai_service_response(
            AIServiceException(SPOONACULAR_USER_CAP_MSG)
        )
        data = resp.get_json()
    assert code == 429
    assert data["code"] == "recipe_user_cap"


def test_recipe_route_maps_ledger_unavailable_to_503():
    from backend.app import create_app

    app = create_app()
    with app.app_context():
        resp, code = _recipe_ai_service_response(
            AIServiceException(SPOONACULAR_LEDGER_UNAVAILABLE_MSG)
        )
    assert code == 503
