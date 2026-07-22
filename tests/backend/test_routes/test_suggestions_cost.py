"""Route-level tests for GET /suggestions fallback and error surfaces (02a)."""

from unittest.mock import MagicMock

import pytest

from backend.utils.exceptions import AIServiceException, RecipeQuotaException


@pytest.fixture
def suggestion_service():
    return MagicMock()


@pytest.fixture
def app_with_suggestions(app, suggestion_service):
    app.config["SUGGESTION_SERVICE"] = suggestion_service
    return app


@pytest.fixture
def client_suggestions(app_with_suggestions):
    return app_with_suggestions.test_client()


def test_route_suggestions_200_on_pool_first_payload(client_suggestions, suggestion_service):
    suggestion_service.get_recipe_suggestions.return_value = {
        "use_soon_shelf": [],
        "cook_tonight": [{"id": "1", "title": "Pool"}],
        "probably_have": [],
        "check_first": [],
    }
    res = client_suggestions.get(
        "/api/suggestions?household_id=hh-1",
        headers={"X-User-Id": "user-1"},
    )
    assert res.status_code == 200
    data = res.get_json()
    assert "cook_tonight" in data
    assert len(data["cook_tonight"]) == 1


def test_route_suggestions_200_when_service_returns_stale_fallback(
    client_suggestions, suggestion_service
):
    suggestion_service.get_recipe_suggestions.return_value = {
        "use_soon_shelf": [],
        "cook_tonight": [],
        "probably_have": [],
        "check_first": [],
    }
    res = client_suggestions.get(
        "/api/suggestions",
        headers={"X-User-Id": "user-1"},
    )
    assert res.status_code == 200
    assert res.get_json()["cook_tonight"] == []


def test_route_suggestions_429_when_quota_reraised(client_suggestions, suggestion_service):
    suggestion_service.get_recipe_suggestions.side_effect = RecipeQuotaException(
        "Spoonacular API daily quota exceeded"
    )
    res = client_suggestions.get(
        "/api/suggestions",
        headers={"X-User-Id": "user-1"},
    )
    assert res.status_code == 429
    data = res.get_json()
    assert data["code"] == "recipe_quota"


def test_route_suggestions_500_when_ai_reraised(client_suggestions, suggestion_service):
    suggestion_service.get_recipe_suggestions.side_effect = AIServiceException(
        "Spoonacular call budget exceeded for this period"
    )
    res = client_suggestions.get(
        "/api/suggestions",
        headers={"X-User-Id": "user-1"},
    )
    assert res.status_code == 500


def test_route_suggestions_503_when_service_missing(app):
    app.config.pop("SUGGESTION_SERVICE", None)
    res = app.test_client().get(
        "/api/suggestions",
        headers={"X-User-Id": "user-1"},
    )
    assert res.status_code == 503
