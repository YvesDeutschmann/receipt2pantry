"""Tests for PantryService"""

from datetime import date
from unittest.mock import AsyncMock, Mock, patch

import pytest

from backend.services.confidence_engine import compute_confidence, process_cook_event
from backend.services.pantry_service import PantryService
from backend.utils.exceptions import ValidationException
from tests.services.conftest import TEST_DATE


class TestPantryService:
    """Test cases for PantryService"""
    
    @pytest.mark.asyncio
    async def test_add_to_pantry_new_item(
        self, mock_supabase, sample_household, sample_normalized_product, test_user_id, test_receipt_id
    ):
        """Test adding a new item to pantry"""
        # Setup: user has a household; pantry is empty
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_household_pantry.return_value = []
        mock_supabase.upsert_pantry_item.return_value = 'pantry-item-1'
        
        service = PantryService(mock_supabase)
        
        # Execute
        result = await service.add_to_pantry(
            user_id=test_user_id,
            normalized_item=sample_normalized_product,
            quantity=1.0,
            unit='lb',
            receipt_id=test_receipt_id
        )
        
        # Verify
        assert result == 'pantry-item-1'
        mock_supabase.upsert_pantry_item.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_add_to_pantry_existing_item(
        self, mock_supabase, sample_household, sample_normalized_product, test_user_id, test_receipt_id
    ):
        """Test adding to existing pantry item (quantity update)"""
        # Setup: user has a household; pantry has one matching item
        existing_item = {
            'id': 'pantry-1',
            'base_ingredient': 'butter',
            'variant': 'salted',
            'unit': 'lb',
            'quantity': 1.0
        }
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_household_pantry.return_value = [existing_item]
        mock_supabase.update_pantry_quantity.return_value = None
        mock_supabase.client = Mock()
        mock_supabase.client.table.return_value.update.return_value.eq.return_value.execute.return_value = None
        
        service = PantryService(mock_supabase)
        
        # Execute
        result = await service.add_to_pantry(
            user_id=test_user_id,
            normalized_item=sample_normalized_product,
            quantity=1.0,
            unit='lb',
            receipt_id=test_receipt_id
        )
        
        # Verify
        assert result == 'pantry-1'
        mock_supabase.update_pantry_quantity.assert_called_once_with('pantry-1', 2.0)
    
    @pytest.mark.asyncio
    async def test_get_pantry_summary(self, mock_supabase, sample_household, sample_pantry_items, test_user_id):
        """Test getting pantry summary"""
        # Setup: user has a household; pantry has items
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_household_pantry.return_value = sample_pantry_items
        
        service = PantryService(mock_supabase)
        
        # Execute
        result = await service.get_pantry_summary(test_user_id)
        
        # Verify
        assert result['total_items'] == 2
        assert result['unique_ingredients'] == 2
        assert len(result['items']) == 2
        assert len(result['grouped']) == 2
    
    @pytest.mark.asyncio
    async def test_consume_ingredients(
        self, mock_supabase, sample_household, sample_pantry_items, test_user_id
    ):
        """Test consuming ingredients when recipe is cooked"""
        # Setup: user has a household; pantry has items
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_household_pantry.return_value = sample_pantry_items
        mock_supabase.update_pantry_quantity.return_value = None
        mock_supabase.log_cooking_event.return_value = 'log-1'
        
        service = PantryService(mock_supabase)
        
        ingredients = [
            {'name': 'butter (salted)', 'amount': 0.5, 'unit': 'lb'}
        ]
        
        # Execute
        result = await service.consume_ingredients(
            user_id=test_user_id,
            recipe_id='recipe-1',
            recipe_name='Test Recipe',
            servings=4,
            ingredients=ingredients
        )
        
        # Verify
        assert result['log_id'] == 'log-1'
        assert len(result['consumed']) == 1
        assert result['consumed'][0]['ingredient'] == 'butter (salted)'
        assert result['consumed'][0]['remaining'] == 0.5
        mock_supabase.update_pantry_quantity.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_check_ingredient_availability(
        self, mock_supabase, sample_household, sample_pantry_items, test_user_id
    ):
        """Test checking ingredient availability"""
        # Setup: user has a household; pantry has items
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_household_pantry.return_value = sample_pantry_items
        mock_supabase.get_substitutions_for_ingredient.return_value = []
        
        service = PantryService(mock_supabase)
        
        required = [
            {'name': 'butter (salted)', 'amount': 0.5, 'unit': 'lb'},
            {'name': 'flour', 'amount': 2.0, 'unit': 'cup'}
        ]
        
        # Execute
        result = await service.check_ingredient_availability(
            user_id=test_user_id,
            required_ingredients=required
        )
        
        # Verify
        assert result['can_make'] == False  # Missing flour
        assert len(result['available']) == 1
        assert len(result['missing']) == 1
        assert result['missing'][0]['ingredient'] == 'flour'

    @pytest.mark.asyncio
    async def test_get_pantry_summary_no_household_uses_user_pantry(
        self, mock_supabase, sample_pantry_items, test_user_id
    ):
        """When user has no household, service uses get_user_pantry (legacy fallback)."""
        mock_supabase.get_user_household.return_value = None
        mock_supabase.get_user_pantry.return_value = sample_pantry_items

        service = PantryService(mock_supabase)
        result = await service.get_pantry_summary(test_user_id)

        mock_supabase.get_user_household.assert_called_once_with(test_user_id)
        mock_supabase.get_user_pantry.assert_called_once_with(test_user_id)
        assert result['total_items'] == 2
        assert result['household_id'] is None

    @pytest.mark.asyncio
    async def test_add_to_pantry_no_household_uses_user_pantry(
        self, mock_supabase, sample_normalized_product, test_user_id, test_receipt_id
    ):
        """When user has no household, add_to_pantry uses user-scoped pantry."""
        mock_supabase.get_user_household.return_value = None
        mock_supabase.get_user_pantry.return_value = []
        mock_supabase.upsert_pantry_item.return_value = 'pantry-item-1'

        service = PantryService(mock_supabase)
        result = await service.add_to_pantry(
            user_id=test_user_id,
            normalized_item=sample_normalized_product,
            quantity=1.0,
            unit='lb',
            receipt_id=test_receipt_id,
        )

        mock_supabase.get_user_household.assert_called_once_with(test_user_id)
        mock_supabase.get_user_pantry.assert_called_once_with(
            test_user_id, include_deleted=True
        )
        assert result == 'pantry-item-1'

    # --- Group A: add_to_pantry merge semantics ---

    @pytest.mark.asyncio
    async def test_add_to_pantry_merges_into_existing_row_on_exact_match(
        self, mock_supabase, sample_household, test_user_id, test_receipt_id
    ):
        existing_item = {
            "id": "pantry-1",
            "base_ingredient": "butter",
            "variant": "salted",
            "unit": "lb",
            "quantity": 2.0,
        }
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_household_pantry.return_value = [existing_item]
        mock_supabase.update_pantry_quantity.return_value = None
        mock_supabase.client = Mock()
        mock_supabase.client.table.return_value.update.return_value.eq.return_value.execute.return_value = (
            None
        )
        mock_supabase.admin_client.table.return_value.update.return_value.eq.return_value.execute.return_value = (
            None
        )
        ref = date(2026, 1, 15)
        normalized = {
            "base_ingredient": "butter",
            "variant": "salted",
            "normalized_name": "butter (salted)",
        }
        service = PantryService(mock_supabase)
        result = await service.add_to_pantry(
            user_id=test_user_id,
            normalized_item=normalized,
            quantity=1.5,
            unit="lb",
            receipt_id=test_receipt_id,
            reference_date=ref,
        )
        assert result == "pantry-1"
        mock_supabase.update_pantry_quantity.assert_called_once_with("pantry-1", 3.5)
        upd = mock_supabase.admin_client.table.return_value.update.call_args[0][0]
        assert upd["added_at"].startswith("2026-01-15")
        mock_supabase.upsert_pantry_item.assert_not_called()
        mock_supabase.update_pantry_item_fields.assert_not_called()

    @pytest.mark.asyncio
    async def test_add_to_pantry_live_merge_does_not_rewrite_depletion(
        self, mock_supabase, sample_household, test_user_id, test_receipt_id
    ):
        existing_item = {
            "id": "pantry-1",
            "base_ingredient": "butter",
            "variant": "salted",
            "unit": "lb",
            "quantity": 2.0,
            "depletion_class": "STAPLE",
            "quantity_remaining": None,
        }
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_household_pantry.return_value = [existing_item]
        mock_supabase.update_pantry_quantity.return_value = None
        mock_supabase.admin_client.table.return_value.update.return_value.eq.return_value.execute.return_value = (
            None
        )
        normalized = {
            "base_ingredient": "butter",
            "variant": "salted",
            "normalized_name": "butter (salted)",
        }
        service = PantryService(mock_supabase)
        await service.add_to_pantry(
            user_id=test_user_id,
            normalized_item=normalized,
            quantity=1.5,
            unit="lb",
            receipt_id=test_receipt_id,
        )
        mock_supabase.update_pantry_quantity.assert_called_once_with("pantry-1", 3.5)
        upd = mock_supabase.admin_client.table.return_value.update.call_args[0][0]
        assert "depletion_class" not in upd
        assert "quantity_remaining" not in upd

    @pytest.mark.asyncio
    async def test_add_to_pantry_creates_new_row_on_unit_mismatch(
        self, mock_supabase, sample_household, test_user_id, test_receipt_id
    ):
        existing_item = {
            "id": "pantry-1",
            "base_ingredient": "flour",
            "variant": None,
            "unit": "lb",
            "quantity": 1.0,
        }
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_household_pantry.return_value = [existing_item]
        mock_supabase.upsert_pantry_item.return_value = "pantry-new"
        normalized = {
            "base_ingredient": "flour",
            "variant": None,
            "normalized_name": "flour",
        }
        service = PantryService(mock_supabase)
        result = await service.add_to_pantry(
            user_id=test_user_id,
            normalized_item=normalized,
            quantity=500.0,
            unit="g",
            receipt_id=test_receipt_id,
        )
        assert result == "pantry-new"
        mock_supabase.upsert_pantry_item.assert_called_once()
        mock_supabase.update_pantry_quantity.assert_not_called()

    @pytest.mark.asyncio
    async def test_add_to_pantry_creates_new_row_on_variant_mismatch(
        self, mock_supabase, sample_household, test_user_id, test_receipt_id
    ):
        existing_item = {
            "id": "pantry-1",
            "base_ingredient": "butter",
            "variant": "salted",
            "unit": "lb",
            "quantity": 1.0,
        }
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_household_pantry.return_value = [existing_item]
        mock_supabase.upsert_pantry_item.return_value = "pantry-unsalted"
        normalized = {
            "base_ingredient": "butter",
            "variant": "unsalted",
            "normalized_name": "butter (unsalted)",
        }
        service = PantryService(mock_supabase)
        result = await service.add_to_pantry(
            user_id=test_user_id,
            normalized_item=normalized,
            quantity=1.0,
            unit="lb",
            receipt_id=test_receipt_id,
        )
        assert result == "pantry-unsalted"
        mock_supabase.update_pantry_quantity.assert_not_called()

    @pytest.mark.asyncio
    async def test_add_to_pantry_never_merges_by_substring(
        self, mock_supabase, sample_household, test_user_id, test_receipt_id
    ):
        existing_item = {
            "id": "pantry-rice-vinegar",
            "base_ingredient": "rice vinegar",
            "variant": None,
            "unit": "bottle",
            "quantity": 1.0,
        }
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_household_pantry.return_value = [existing_item]
        mock_supabase.upsert_pantry_item.return_value = "pantry-rice"
        normalized = {
            "base_ingredient": "rice",
            "variant": None,
            "normalized_name": "rice",
        }
        service = PantryService(mock_supabase)
        result = await service.add_to_pantry(
            user_id=test_user_id,
            normalized_item=normalized,
            quantity=2.0,
            unit="lb",
            receipt_id=test_receipt_id,
        )
        assert result == "pantry-rice"
        mock_supabase.update_pantry_quantity.assert_not_called()

    # --- Group B: scope resolution ---

    def test_get_pantry_items_uses_household_scope_when_household_id_present(
        self, mock_supabase, sample_pantry_items, test_user_id, test_household_id
    ):
        mock_supabase.get_household_pantry.return_value = sample_pantry_items
        service = PantryService(mock_supabase)
        out = service._get_pantry_items(
            test_user_id, test_household_id, today=date(2026, 1, 15)
        )
        assert out == sample_pantry_items
        mock_supabase.get_household_pantry.assert_called_once_with(test_household_id)
        mock_supabase.get_user_pantry.assert_not_called()

    def test_get_pantry_items_falls_back_to_user_scope_when_household_id_none(
        self, mock_supabase, sample_pantry_items, test_user_id
    ):
        mock_supabase.get_user_pantry.return_value = sample_pantry_items
        service = PantryService(mock_supabase)
        out = service._get_pantry_items(
            test_user_id, None, today=date(2026, 1, 15)
        )
        assert out == sample_pantry_items
        mock_supabase.get_user_pantry.assert_called_once_with(test_user_id)
        mock_supabase.get_household_pantry.assert_not_called()

    def test_get_household_id_returns_none_when_user_has_no_household(
        self, mock_supabase, test_user_id
    ):
        mock_supabase.get_user_household.return_value = None
        service = PantryService(mock_supabase)
        assert (
            service._get_household_id_for_user(test_user_id, today=date(2026, 1, 15))
            is None
        )

    # --- Group C: quantity updates ---

    def test_update_quantity_accepts_zero_and_persists_zero(self, mock_supabase):
        mock_supabase.update_pantry_quantity.return_value = None
        service = PantryService(mock_supabase)
        service.update_quantity("item-1", 0.0, today=date(2026, 1, 15))
        mock_supabase.update_pantry_quantity.assert_called_once_with("item-1", 0.0)

    def test_update_quantity_rejects_negative_with_validation_exception(
        self, mock_supabase
    ):
        service = PantryService(mock_supabase)
        with pytest.raises(ValidationException, match="negative"):
            service.update_quantity("item-1", -1.0)

    # --- Group D: soft-delete / restore ---

    def test_soft_delete_uses_provided_today_for_deleted_at_stamp(
        self, mock_supabase, test_user_id
    ):
        mock_supabase.get_pantry_item_by_id.return_value = {
            "id": "p1",
            "user_id": test_user_id,
            "household_id": "hh",
            "base_ingredient": "milk",
            "depletion_class": "STAPLE",
            "put_back_count": 0,
        }
        mock_supabase.get_user_household.return_value = {"id": "hh"}
        with patch(
            "backend.services.pantry_service._rpc_soft_delete_pantry_item"
        ) as rpc:
            PantryService(mock_supabase).soft_delete(
                test_user_id, "p1", today=date(2026, 1, 15)
            )
            rpc.assert_called_once()
            assert rpc.call_args[1]["today"] == date(2026, 1, 15)

    def test_restore_reinserts_row_with_original_unit_and_variant(self, mock_supabase, test_user_id):
        refreshed = {
            "id": "p1",
            "unit": "lb",
            "variant": "salted",
            "base_ingredient": "butter",
        }
        with patch(
            "backend.services.pantry_service.process_put_back",
            return_value=(refreshed, None),
        ):
            item = PantryService(mock_supabase).restore_from_depletion_history(
                test_user_id, "dh-1", today=date(2026, 1, 15)
            )
        assert item["unit"] == "lb"
        assert item["variant"] == "salted"

    # --- Group E: staples ---

    @pytest.mark.asyncio
    async def test_confirm_staples_batches_all_selected_items_in_single_call(
        self, mock_supabase, sample_household, test_user_id
    ):
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_staples_template_rows.return_value = [
            {"base_ingredient": "Salt", "display_name": "Salt", "category": "Other"},
            {
                "base_ingredient": "pepper",
                "display_name": "Black pepper",
                "category": "Other",
            },
        ]
        service = PantryService(mock_supabase)
        with patch.object(
            PantryService,
            "batch_add_or_merge_items",
            new_callable=AsyncMock,
            return_value={"inserted": 2, "merged": 0, "household_id": sample_household["id"]},
        ) as batch_mock:
            with patch.object(
                PantryService,
                "apply_staple_receipt_enrichment",
                new_callable=AsyncMock,
                return_value=0,
            ):
                await service.confirm_staples_batch(
                    test_user_id,
                    ["salt", "pepper"],
                    normalizer=None,
                    today=date(2026, 1, 15),
                )
            batch_mock.assert_awaited_once()
            canonical = batch_mock.await_args[0][2]
            assert len(canonical) == 2
            bases = {c["base_ingredient"] for c in canonical}
            assert bases == {"Salt", "pepper"}
            assert batch_mock.await_args.kwargs.get("today") == date(2026, 1, 15)

    @pytest.mark.asyncio
    async def test_confirm_staples_is_idempotent_when_called_twice_with_same_list(
        self, mock_supabase, sample_household, test_user_id
    ):
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_staples_template_rows.return_value = [
            {"base_ingredient": "Salt", "display_name": "Salt", "category": "Other"},
        ]
        mock_supabase.upsert_pantry_item.return_value = "new-id"
        mock_supabase.update_pantry_item_fields.return_value = None
        mock_supabase.get_household_pantry.side_effect = [
            [],
            [{"id": "i1", "base_ingredient": "Salt", "variant": None, "unit": ""}],
        ]
        service = PantryService(mock_supabase)
        with patch.object(
            PantryService,
            "apply_staple_receipt_enrichment",
            new_callable=AsyncMock,
            return_value=0,
        ):
            r1 = await service.confirm_staples_batch(
                test_user_id, ["salt"], normalizer=None, today=date(2026, 1, 15)
            )
            r2 = await service.confirm_staples_batch(
                test_user_id, ["salt"], normalizer=None, today=date(2026, 1, 15)
            )
        assert r1["added"] == 1
        assert r2["already_existed"] == 1
        assert r2["added"] == 0


class TestPantryTrustStep1:
    """Pantry Trust Step 1 — depletion fields, resurrect, scoring guards."""

    @pytest.mark.asyncio
    async def test_batch_insert_writes_depletion_fields_perishable(
        self, mock_supabase, sample_household, test_user_id
    ):
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_household_pantry.return_value = []
        mock_supabase.upsert_pantry_item.return_value = "new-id"
        mock_supabase.get_item_classifications_by_names.return_value = {
            "spinach": {
                "item_name": "spinach",
                "depletion_class": "PERISHABLE",
                "shelf_life_days": 5,
            }
        }
        service = PantryService(mock_supabase)
        await service.batch_add_or_merge_items(
            test_user_id,
            sample_household["id"],
            [{"base_ingredient": "spinach", "normalized_name": "spinach"}],
            "quick_add",
            today=TEST_DATE,
        )
        payload = mock_supabase.upsert_pantry_item.call_args[0][0]
        assert payload["depletion_class"] == "PERISHABLE"
        assert payload["purchase_date"] == TEST_DATE.isoformat()
        assert payload["available_until"] == "2026-04-15"

    @pytest.mark.asyncio
    async def test_batch_insert_unit_item_writes_quantity_purchased_only(
        self, mock_supabase, sample_household, test_user_id
    ):
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_household_pantry.return_value = []
        mock_supabase.upsert_pantry_item.return_value = "new-id"
        mock_supabase.get_item_classifications_by_names.return_value = {
            "eggs": {"item_name": "eggs", "depletion_class": "UNIT_ITEM"},
        }
        service = PantryService(mock_supabase)
        await service.batch_add_or_merge_items(
            test_user_id,
            sample_household["id"],
            [{"base_ingredient": "eggs", "normalized_name": "eggs"}],
            "quick_add",
            today=TEST_DATE,
        )
        payload = mock_supabase.upsert_pantry_item.call_args[0][0]
        assert payload["quantity_purchased"] == 1.0
        assert "quantity_remaining" not in payload

    @pytest.mark.asyncio
    async def test_get_pantry_excludes_soft_deleted(
        self, mock_supabase, sample_household, test_user_id
    ):
        live = {"id": "live", "base_ingredient": "salt", "quantity": 1}
        dead = {
            "id": "dead",
            "base_ingredient": "pepper",
            "quantity": 1,
            "deleted_at": "2026-01-01T00:00:00",
        }
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_household_pantry.return_value = [live, dead]
        service = PantryService(mock_supabase)
        summary = await service.get_pantry_summary(test_user_id)
        assert len(summary["items"]) == 1
        assert summary["items"][0]["id"] == "live"
        mock_supabase.get_household_pantry.assert_called_once_with(
            sample_household["id"]
        )
        assert dead["id"] not in {i["id"] for i in summary["items"]}

    @pytest.mark.asyncio
    async def test_resurrect_on_batch_add_after_soft_delete(
        self, mock_supabase, sample_household, test_user_id
    ):
        dead_row = {
            "id": "dead-1",
            "base_ingredient": "pasta",
            "variant": None,
            "unit": "",
            "quantity": 0,
            "deleted_at": "2026-01-01T00:00:00",
        }
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_household_pantry.return_value = [dead_row]
        mock_supabase.update_pantry_item_fields.return_value = None
        service = PantryService(mock_supabase)
        result = await service.batch_add_or_merge_items(
            test_user_id,
            sample_household["id"],
            [{"base_ingredient": "pasta", "normalized_name": "pasta"}],
            "quick_add",
            today=TEST_DATE,
        )
        assert result["merged"] == 1
        assert result["inserted"] == 0
        mock_supabase.upsert_pantry_item.assert_not_called()
        updates = mock_supabase.update_pantry_item_fields.call_args[0][1]
        assert updates["deleted_at"] is None
        assert updates["purchase_date"] == TEST_DATE.isoformat()
        assert updates["quantity"] == 1
        assert updates["quantity_remaining"] is None
        assert updates["hard_expire_date"] is None
        assert "depletion_class" not in updates

    @pytest.mark.asyncio
    async def test_C1_unit_item_first_cook_does_not_wipe(
        self, mock_supabase, sample_household, test_user_id, test_receipt_id
    ):
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_household_pantry.return_value = []
        mock_supabase.upsert_pantry_item.return_value = "unit-item-1"
        mock_supabase.get_item_classifications_by_names.return_value = {
            "eggs": {"item_name": "eggs", "depletion_class": "UNIT_ITEM"},
        }
        service = PantryService(mock_supabase)
        await service.add_to_pantry(
            user_id=test_user_id,
            normalized_item={
                "base_ingredient": "eggs",
                "variant": None,
                "normalized_name": "eggs",
            },
            quantity=2.0,
            unit="count",
            receipt_id=test_receipt_id,
            reference_date=TEST_DATE,
        )
        payload = mock_supabase.upsert_pantry_item.call_args[0][0]
        assert payload["quantity_purchased"] == 2.0
        assert "quantity_remaining" not in payload

        pantry_row = {
            "id": "unit-item-1",
            "user_id": test_user_id,
            "base_ingredient": "eggs",
            "depletion_class": "UNIT_ITEM",
            "quantity_purchased": 2.0,
            "quantity_remaining": None,
        }
        client = Mock()
        client.admin_client = None
        client.client = None
        sel_chain = Mock()
        sel_chain.eq.return_value = sel_chain
        sel_chain.is_.return_value = sel_chain
        sel_chain.execute.return_value = Mock(data=[pantry_row])
        upd_chain = Mock()
        upd_chain.eq.return_value = upd_chain
        upd_chain.execute.return_value = Mock(data=[])
        pt = Mock()
        pt.select.return_value = sel_chain
        pt.update.return_value = upd_chain
        log = Mock()
        log.insert.return_value = log
        log.execute.return_value = Mock(data=[{"id": "log1"}])

        def tbl(name):
            if name == "pantry_items":
                return pt
            if name == "cooking_log":
                return log
            return Mock()

        client.table.side_effect = tbl

        with patch(
            "backend.services.confidence_engine._rpc_soft_delete_pantry_item"
        ) as soft_delete:
            process_cook_event(
                client,
                test_user_id,
                "recipe-1",
                1,
                [{"name": "eggs", "amount": 1, "is_primary": True}],
                today=TEST_DATE,
            )
            soft_delete.assert_not_called()

        update_payload = pt.update.call_args[0][0]
        assert update_payload["quantity_remaining"] == 1.0

    @pytest.mark.asyncio
    async def test_C3_fresh_unit_item_scores_0_90(
        self, mock_supabase, sample_household, test_user_id, test_receipt_id
    ):
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_household_pantry.return_value = []
        mock_supabase.upsert_pantry_item.return_value = "unit-item-1"
        mock_supabase.get_item_classifications_by_names.return_value = {
            "eggs": {"item_name": "eggs", "depletion_class": "UNIT_ITEM"},
        }
        service = PantryService(mock_supabase)
        await service.add_to_pantry(
            user_id=test_user_id,
            normalized_item={
                "base_ingredient": "eggs",
                "variant": None,
                "normalized_name": "eggs",
            },
            quantity=2.0,
            unit="count",
            receipt_id=test_receipt_id,
            reference_date=TEST_DATE,
        )
        payload = mock_supabase.upsert_pantry_item.call_args[0][0]
        score = compute_confidence(
            payload,
            {"depletion_multiplier": 1.0},
            {"depletion_class": "UNIT_ITEM"},
            today=TEST_DATE,
        )
        assert score == 0.90

    @pytest.mark.asyncio
    async def test_add_to_pantry_resurrect_refreshes_unit_item_purchase(
        self, mock_supabase, sample_household, test_user_id, test_receipt_id
    ):
        dead = {
            "id": "eggs-1",
            "base_ingredient": "eggs",
            "variant": None,
            "unit": "count",
            "quantity": 0,
            "deleted_at": "2026-04-01T00:00:00",
            "depletion_class": "UNIT_ITEM",
            "quantity_purchased": 2,
            "quantity_remaining": 1,
        }
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_household_pantry.return_value = [dead]
        mock_supabase.update_pantry_item_fields.return_value = None
        service = PantryService(mock_supabase)
        result = await service.add_to_pantry(
            user_id=test_user_id,
            normalized_item={
                "base_ingredient": "eggs",
                "variant": None,
                "normalized_name": "eggs",
            },
            quantity=2.0,
            unit="count",
            receipt_id=test_receipt_id,
            reference_date=TEST_DATE,
        )
        assert result == "eggs-1"
        mock_supabase.upsert_pantry_item.assert_not_called()
        updates = mock_supabase.update_pantry_item_fields.call_args[0][1]
        assert updates["deleted_at"] is None
        assert updates["quantity"] == 3.0
        assert updates["quantity_purchased"] == 3.0
        assert updates["quantity_remaining"] is None
        assert "depletion_class" not in updates

        pantry_row = {
            "id": "eggs-1",
            "user_id": test_user_id,
            "base_ingredient": "eggs",
            "depletion_class": "UNIT_ITEM",
            "quantity_purchased": updates["quantity_purchased"],
            "quantity_remaining": updates["quantity_remaining"],
        }
        client = Mock()
        client.admin_client = None
        client.client = None
        sel_chain = Mock()
        sel_chain.eq.return_value = sel_chain
        sel_chain.is_.return_value = sel_chain
        sel_chain.execute.return_value = Mock(data=[pantry_row])
        upd_chain = Mock()
        upd_chain.eq.return_value = upd_chain
        upd_chain.execute.return_value = Mock(data=[])
        pt = Mock()
        pt.select.return_value = sel_chain
        pt.update.return_value = upd_chain
        log = Mock()
        log.insert.return_value = log
        log.execute.return_value = Mock(data=[{"id": "log1"}])

        def tbl(name):
            if name == "pantry_items":
                return pt
            if name == "cooking_log":
                return log
            return Mock()

        client.table.side_effect = tbl
        with patch(
            "backend.services.confidence_engine._rpc_soft_delete_pantry_item"
        ) as soft_delete:
            process_cook_event(
                client,
                test_user_id,
                "recipe-1",
                1,
                [{"name": "eggs", "amount": 1, "is_primary": True}],
                today=TEST_DATE,
            )
            soft_delete.assert_not_called()
        assert pt.update.call_args[0][0]["quantity_remaining"] == 2.0

    @pytest.mark.asyncio
    async def test_add_to_pantry_resurrect_refreshes_perishable_dates(
        self, mock_supabase, sample_household, test_user_id, test_receipt_id
    ):
        dead = {
            "id": "spin-1",
            "base_ingredient": "spinach",
            "variant": None,
            "unit": "",
            "quantity": 1,
            "deleted_at": "2026-04-01T00:00:00",
            "depletion_class": "PERISHABLE",
            "available_until": "2026-03-01",
            "hard_expire_date": "2026-03-04",
        }
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_household_pantry.return_value = [dead]
        mock_supabase.update_pantry_item_fields.return_value = None
        mock_supabase.get_item_classifications_by_names.return_value = {
            "spinach": {
                "item_name": "spinach",
                "depletion_class": "PERISHABLE",
                "shelf_life_days": 5,
            }
        }
        service = PantryService(mock_supabase)
        await service.add_to_pantry(
            user_id=test_user_id,
            normalized_item={
                "base_ingredient": "spinach",
                "variant": None,
                "normalized_name": "spinach",
            },
            quantity=1.0,
            unit="",
            receipt_id=test_receipt_id,
            reference_date=TEST_DATE,
        )
        mock_supabase.upsert_pantry_item.assert_not_called()
        updates = mock_supabase.update_pantry_item_fields.call_args[0][1]
        assert updates["deleted_at"] is None
        assert updates["purchase_date"] == TEST_DATE.isoformat()
        assert updates["available_until"] == "2026-04-15"
        assert updates["hard_expire_date"] is None
        assert updates["quantity_remaining"] is None
        assert "depletion_class" not in updates

    @pytest.mark.asyncio
    async def test_depletion_fields_normalizes_class_and_rejects_unknown(
        self, mock_supabase, sample_household, test_user_id, test_receipt_id
    ):
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_household_pantry.return_value = []
        mock_supabase.upsert_pantry_item.return_value = "new-1"
        service = PantryService(mock_supabase)

        mock_supabase.get_item_classifications_by_names.return_value = {
            "spinach": {
                "item_name": "spinach",
                "depletion_class": "perishable",
                "shelf_life_days": 5,
            }
        }
        await service.add_to_pantry(
            user_id=test_user_id,
            normalized_item={
                "base_ingredient": "spinach",
                "variant": None,
                "normalized_name": "spinach",
            },
            quantity=1.0,
            unit="",
            receipt_id=test_receipt_id,
            reference_date=TEST_DATE,
        )
        perishable_payload = mock_supabase.upsert_pantry_item.call_args[0][0]
        assert perishable_payload["depletion_class"] == "PERISHABLE"
        assert perishable_payload["available_until"] == "2026-04-15"

        mock_supabase.upsert_pantry_item.reset_mock()
        mock_supabase.get_item_classifications_by_names.return_value = {
            "mystery": {"item_name": "mystery", "depletion_class": "WIDGET"},
        }
        await service.add_to_pantry(
            user_id=test_user_id,
            normalized_item={
                "base_ingredient": "mystery",
                "variant": None,
                "normalized_name": "mystery",
            },
            quantity=1.0,
            unit="",
            receipt_id=test_receipt_id,
            reference_date=TEST_DATE,
        )
        staple_payload = mock_supabase.upsert_pantry_item.call_args[0][0]
        assert staple_payload["depletion_class"] == "STAPLE"
        assert "available_until" not in staple_payload
        assert "quantity_purchased" not in staple_payload

    @pytest.mark.asyncio
    async def test_add_to_pantry_prefers_live_row_over_soft_deleted(
        self, mock_supabase, sample_household, test_user_id, test_receipt_id
    ):
        dead = {
            "id": "dead-butter",
            "base_ingredient": "butter",
            "variant": "salted",
            "unit": "lb",
            "quantity": 2.0,
            "deleted_at": "2026-01-01T00:00:00",
        }
        live = {
            "id": "live-butter",
            "base_ingredient": "butter",
            "variant": "salted",
            "unit": "lb",
            "quantity": 1.0,
        }
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_household_pantry.return_value = [dead, live]
        mock_supabase.update_pantry_quantity.return_value = None
        mock_supabase.admin_client.table.return_value.update.return_value.eq.return_value.execute.return_value = (
            None
        )
        service = PantryService(mock_supabase)
        result = await service.add_to_pantry(
            user_id=test_user_id,
            normalized_item={
                "base_ingredient": "butter",
                "variant": "salted",
                "normalized_name": "butter (salted)",
            },
            quantity=1.0,
            unit="lb",
            receipt_id=test_receipt_id,
        )
        assert result == "live-butter"
        mock_supabase.update_pantry_quantity.assert_called_once_with("live-butter", 2.0)
        mock_supabase.update_pantry_item_fields.assert_not_called()
        mock_supabase.upsert_pantry_item.assert_not_called()

    @pytest.mark.asyncio
    async def test_batch_add_prefers_live_row_over_soft_deleted(
        self, mock_supabase, sample_household, test_user_id
    ):
        dead = {
            "id": "dead-milk",
            "base_ingredient": "milk",
            "variant": "whole",
            "unit": "gallon",
            "quantity": 1,
            "deleted_at": "2026-01-01T00:00:00",
        }
        live = {
            "id": "live-milk",
            "base_ingredient": "milk",
            "variant": "2%",
            "unit": "gallon",
            "quantity": 1,
        }
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_household_pantry.return_value = [dead, live]
        service = PantryService(mock_supabase)
        result = await service.batch_add_or_merge_items(
            test_user_id,
            sample_household["id"],
            [{"base_ingredient": "milk", "normalized_name": "milk"}],
            "quick_add",
            today=TEST_DATE,
        )
        assert result["merged"] == 1
        assert result["inserted"] == 0
        mock_supabase.upsert_pantry_item.assert_not_called()
        mock_supabase.update_pantry_item_fields.assert_not_called()

