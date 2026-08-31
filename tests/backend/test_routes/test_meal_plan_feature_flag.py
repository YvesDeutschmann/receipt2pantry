"""Tests for meal planner feature flag gate."""

import json


def test_meal_plan_routes_return_404_when_flag_off(client):
    """Meal plan API is hidden when FEATURE_MEAL_PLANNER is disabled."""
    client.application.config["FEATURE_MEAL_PLANNER"] = False

    response = client.get("/api/meal-plan?user_id=u1&start_date=2026-01-01&end_date=2026-01-07")
    assert response.status_code == 404
    data = json.loads(response.data)
    assert data["error"] == "Not found"


def test_shopping_list_routes_return_404_when_flag_off(client):
    """Shopping list API is hidden when FEATURE_MEAL_PLANNER is disabled."""
    client.application.config["FEATURE_MEAL_PLANNER"] = False

    response = client.get("/api/shopping-list?user_id=u1")
    assert response.status_code == 404
    data = json.loads(response.data)
    assert data["error"] == "Not found"


def test_meal_plan_routes_reach_handler_when_flag_on(client):
    """When enabled, routes proceed to handlers (503 if service unavailable)."""
    client.application.config["FEATURE_MEAL_PLANNER"] = True
    client.application.config["MEAL_PLAN_SERVICE"] = None

    response = client.get("/api/meal-plan?user_id=u1&start_date=2026-01-01&end_date=2026-01-07")
    assert response.status_code == 503
    data = json.loads(response.data)
    assert "not available" in data["error"].lower()


def test_shopping_list_routes_reach_handler_when_flag_on(client):
    """When enabled, shopping list routes proceed to handlers."""
    client.application.config["FEATURE_MEAL_PLANNER"] = True
    client.application.config["SHOPPING_LIST_SERVICE"] = None

    response = client.get("/api/shopping-list?user_id=u1")
    assert response.status_code == 503
    data = json.loads(response.data)
    assert "not available" in data["error"].lower()
