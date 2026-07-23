"""Tests for GET /pantry/ingredient-substitutions."""

import json

import pytest
from unittest.mock import Mock

from backend.utils.exceptions import DatabaseException


class TestIngredientSubstitutionsRoute:
    @pytest.fixture
    def mock_pantry_service(self):
        service = Mock()
        service.get_acceptable_substitutes = Mock()
        return service

    @pytest.fixture
    def app_with_services(self, app, mock_pantry_service):
        app.config["PANTRY_SERVICE"] = mock_pantry_service
        return app

    @pytest.fixture
    def client_with_services(self, app_with_services):
        return app_with_services.test_client()

    def test_route_requires_auth(self, client_with_services):
        response = client_with_services.get(
            "/api/pantry/ingredient-substitutions?ingredient=butter"
        )

        assert response.status_code == 401
        data = json.loads(response.data)
        assert "error" in data

    def test_route_requires_ingredient_param(self, client_with_services):
        response = client_with_services.get(
            "/api/pantry/ingredient-substitutions",
            headers={"X-User-Id": "user-456"},
        )

        assert response.status_code == 400
        data = json.loads(response.data)
        assert "error" in data

    def test_route_blank_ingredient_returns_400(self, client_with_services):
        response = client_with_services.get(
            "/api/pantry/ingredient-substitutions?ingredient=",
            headers={"X-User-Id": "user-456"},
        )

        assert response.status_code == 400
        data = json.loads(response.data)
        assert "error" in data

    def test_route_returns_substitute_list(
        self, client_with_services, mock_pantry_service
    ):
        mock_pantry_service.get_acceptable_substitutes.return_value = [
            {
                "substitute": "margarine",
                "substitution_type": "ingredient",
                "ratio": 1.0,
                "notes": "Works well for most baking",
                "confidence": 0.85,
            }
        ]

        response = client_with_services.get(
            "/api/pantry/ingredient-substitutions?ingredient=butter",
            headers={"X-User-Id": "user-456"},
        )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["ingredient"] == "butter"
        assert len(data["substitutes"]) == 1
        assert data["substitutes"][0]["substitute"] == "margarine"
        mock_pantry_service.get_acceptable_substitutes.assert_called_once_with("butter")

    def test_route_returns_empty_substitutes_gracefully(
        self, client_with_services, mock_pantry_service
    ):
        mock_pantry_service.get_acceptable_substitutes.return_value = []

        response = client_with_services.get(
            "/api/pantry/ingredient-substitutions?ingredient=saffron",
            headers={"X-User-Id": "user-456"},
        )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data == {"ingredient": "saffron", "substitutes": []}

    def test_route_database_error_returns_500(
        self, client_with_services, mock_pantry_service
    ):
        mock_pantry_service.get_acceptable_substitutes.side_effect = DatabaseException(
            "db down"
        )

        response = client_with_services.get(
            "/api/pantry/ingredient-substitutions?ingredient=butter",
            headers={"X-User-Id": "user-456"},
        )

        assert response.status_code == 500
        data = json.loads(response.data)
        assert "error" in data
