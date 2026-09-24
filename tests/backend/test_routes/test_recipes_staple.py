"""GET /api/recipes/<id> staple catalog + static /staples images."""

import json
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def client_recipes(app):
    recipe_service = MagicMock()
    recipe_service.get_recipe_details.return_value = {"id": 715538, "title": "Remote"}
    app.config["RECIPE_SERVICE"] = recipe_service
    return app.test_client(), recipe_service


class TestRecipeDetailsStaple:
    def test_staple_200_no_spoonacular(self, client_recipes):
        client, svc = client_recipes
        resp = client.get(
            "/api/recipes/staple_aglio_olio",
            headers={"X-User-Id": "user-1"},
        )
        assert resp.status_code == 200
        data = json.loads(resp.data)
        assert data["title"] == "Spaghetti Aglio e Olio"
        assert data["analyzedInstructions"]
        svc.get_recipe_details.assert_not_called()

    def test_numeric_still_hits_spoonacular(self, client_recipes):
        client, svc = client_recipes
        resp = client.get(
            "/api/recipes/715538",
            headers={"X-User-Id": "user-1"},
        )
        assert resp.status_code == 200
        svc.get_recipe_details.assert_called_once()

    def test_unknown_staple_404(self, client_recipes):
        client, _ = client_recipes
        resp = client.get(
            "/api/recipes/staple_not_real",
            headers={"X-User-Id": "user-1"},
        )
        assert resp.status_code == 404

    def test_unicode_digit_404_not_500(self, client_recipes):
        client, svc = client_recipes
        resp = client.get(
            "/api/recipes/\u00b2",
            headers={"X-User-Id": "user-1"},
        )
        assert resp.status_code == 404
        svc.get_recipe_details.assert_not_called()

    def test_unauth_401(self, client_recipes):
        client, _ = client_recipes
        resp = client.get("/api/recipes/staple_omelette")
        assert resp.status_code == 401

    def test_id_too_long_404(self, client_recipes):
        client, _ = client_recipes
        resp = client.get(
            "/api/recipes/" + ("x" * 65),
            headers={"X-User-Id": "user-1"},
        )
        assert resp.status_code == 404


class TestStaplesStatic:
    def test_path_traversal_404(self, app):
        client = app.test_client()
        resp = client.get("/staples/../etc/passwd")
        assert resp.status_code == 404

    def test_missing_file_404(self, app):
        client = app.test_client()
        resp = client.get("/staples/staple_omelette.webp")
        assert resp.status_code == 404

    def test_webp_200_when_present(self, app, tmp_path):
        import backend.routes.staples_static as mod

        img_dir = tmp_path / "staples"
        img_dir.mkdir()
        (img_dir / "staple_omelette.webp").write_bytes(b"RIFF")
        with patch.object(mod, "_STATIC_DIR", img_dir):
            client = app.test_client()
            resp = client.get("/staples/staple_omelette.webp")
        assert resp.status_code == 200
        assert resp.content_type.startswith("image/webp")
