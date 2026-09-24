"""Tests for cleanup_non_grocery_pantry script."""

from datetime import date
from unittest.mock import MagicMock, patch

import pytest

from scripts.cleanup_non_grocery_pantry import (
    _pantry_row_matches,
    apply_soft_deletes,
    main,
)


class TestPantryRowMatches:
    def test_household_category_on_row(self):
        row = {"normalized_name": "detergent", "category": "household", "base_ingredient": "detergent"}
        assert _pantry_row_matches(row) is True

    def test_grocery_milk(self):
        row = {"normalized_name": "milk", "category": "dairy", "base_ingredient": "milk"}
        assert _pantry_row_matches(row) is False

    def test_colgate_by_name(self):
        row = {"normalized_name": "colgate", "category": "grocery", "base_ingredient": "colgate"}
        assert _pantry_row_matches(row) is True


class TestCleanupScriptMain:
    @patch("scripts.cleanup_non_grocery_pantry.apply_soft_deletes")
    @patch("scripts.cleanup_non_grocery_pantry.fetch_live_pantry_rows")
    @patch("scripts.cleanup_non_grocery_pantry.SupabaseService")
    @patch("scripts.cleanup_non_grocery_pantry.Config")
    def test_dry_run_no_rpc(
        self,
        mock_config,
        mock_supabase_cls,
        mock_fetch,
        mock_apply,
    ):
        mock_supabase_cls.return_value.admin_client = MagicMock()
        mock_fetch.return_value = [
            {
                "id": "p1",
                "user_id": "u1",
                "normalized_name": "gasoline",
                "base_ingredient": "gasoline",
                "category": "fuel",
            }
        ]
        with patch("sys.argv", ["cleanup_non_grocery_pantry.py"]):
            assert main() == 0
        mock_apply.assert_not_called()

    @patch("scripts.cleanup_non_grocery_pantry.apply_soft_deletes")
    @patch("scripts.cleanup_non_grocery_pantry.fetch_live_pantry_rows")
    @patch("scripts.cleanup_non_grocery_pantry.SupabaseService")
    @patch("scripts.cleanup_non_grocery_pantry.Config")
    def test_apply_calls_soft_delete(
        self,
        mock_config,
        mock_supabase_cls,
        mock_fetch,
        mock_apply,
    ):
        mock_supabase_cls.return_value.admin_client = MagicMock()
        row = {
            "id": "p1",
            "user_id": "u1",
            "normalized_name": "colgate",
            "base_ingredient": "colgate",
            "category": "grocery",
            "depletion_class": "STAPLE",
            "purchase_date": "2025-01-01",
            "put_back_count": 0,
        }
        mock_fetch.return_value = [row]
        with patch("sys.argv", ["cleanup_non_grocery_pantry.py", "--apply"]):
            assert main() == 0
        mock_apply.assert_called_once()
        args = mock_apply.call_args[0]
        assert args[1] == [row]
        assert args[2] == date.today()


class TestApplySoftDeletes:
    @patch("scripts.cleanup_non_grocery_pantry._rpc_soft_delete_pantry_item")
    def test_never_had_reason(self, mock_rpc):
        admin = MagicMock()
        row = {
            "id": "p1",
            "user_id": "u1",
            "normalized_name": "tide",
            "base_ingredient": "tide",
            "depletion_class": "STAPLE",
            "purchase_date": None,
            "put_back_count": 0,
        }
        apply_soft_deletes(admin, [row], date(2025, 6, 1))
        mock_rpc.assert_called_once()
        assert mock_rpc.call_args.kwargs["reason"] == "NEVER_HAD"
