"""Tests for PantryService substitution read-only helpers."""

from unittest.mock import Mock

from backend.services.pantry_service import PantryService


class TestGetAcceptableSubstitutes:
    """get_acceptable_substitutes filters and shapes substitution rows."""

    def test_get_acceptable_substitutes_returns_acceptable_only(self, mock_supabase):
        mock_supabase.get_substitutions_for_ingredient.return_value = [
            {
                "id": "sub-1",
                "ingredient": "butter",
                "substitute": "margarine",
                "substitution_type": "ingredient",
                "ratio": 1.0,
                "acceptable": True,
                "notes": "Works well for most baking",
                "confidence": 0.85,
                "source": "seed",
                "verified": True,
            },
            {
                "id": "sub-2",
                "ingredient": "butter",
                "substitute": "salted butter",
                "substitution_type": "variant",
                "ratio": 1.0,
                "acceptable": False,
                "notes": "Not for baking",
                "confidence": 0.9,
                "source": "seed",
                "verified": True,
            },
        ]
        service = PantryService(mock_supabase)

        result = service.get_acceptable_substitutes("butter")

        assert len(result) == 1
        assert result[0]["substitute"] == "margarine"

    def test_get_acceptable_substitutes_exact_match_only(self, mock_supabase):
        mock_supabase.get_substitutions_for_ingredient.return_value = []
        service = PantryService(mock_supabase)

        service.get_acceptable_substitutes("Butter")

        mock_supabase.get_substitutions_for_ingredient.assert_called_once_with("Butter")

    def test_get_acceptable_substitutes_empty_when_none(self, mock_supabase):
        mock_supabase.get_substitutions_for_ingredient.return_value = []
        service = PantryService(mock_supabase)

        assert service.get_acceptable_substitutes("saffron") == []

    def test_get_acceptable_substitutes_excludes_private_fields(self, mock_supabase):
        mock_supabase.get_substitutions_for_ingredient.return_value = [
            {
                "id": "sub-1",
                "ingredient": "butter",
                "substitute": "margarine",
                "substitution_type": "ingredient",
                "ratio": 1.0,
                "acceptable": True,
                "notes": "Works well",
                "confidence": 0.85,
                "source": "seed",
                "verified": True,
            }
        ]
        service = PantryService(mock_supabase)

        result = service.get_acceptable_substitutes("butter")

        assert result == [
            {
                "substitute": "margarine",
                "substitution_type": "ingredient",
                "ratio": 1.0,
                "notes": "Works well",
                "confidence": 0.85,
            }
        ]
        assert "id" not in result[0]
        assert "source" not in result[0]
        assert "verified" not in result[0]

    def test_get_acceptable_substitutes_acceptable_none_excluded(self, mock_supabase):
        mock_supabase.get_substitutions_for_ingredient.return_value = [
            {
                "id": "sub-1",
                "ingredient": "butter",
                "substitute": "margarine",
                "substitution_type": "ingredient",
                "ratio": 1.0,
                "acceptable": None,
                "notes": None,
                "confidence": 0.5,
            }
        ]
        service = PantryService(mock_supabase)

        assert service.get_acceptable_substitutes("butter") == []
