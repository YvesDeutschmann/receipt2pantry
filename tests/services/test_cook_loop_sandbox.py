"""Unit tests for DEV cook-loop sandbox service."""

from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.services.cook_loop_sandbox_service import (
    DEV_RECIPE_ID,
    build_cook_bom_from_extended_ingredients,
    load_cook_loop_fixture,
)
from backend.services.cook_loop_sandbox_service import CookLoopSandboxService


def test_build_cook_bom_matches_fixture_names():
    fixture = load_cook_loop_fixture()
    ext = fixture["pool_card"]["extendedIngredients"]
    bom = build_cook_bom_from_extended_ingredients(ext)
    names = [i["name"] for i in bom]
    assert names == ["pasta", "tomatoes", "olive oil", "rice vinegar"]
    assert all(i["amount"] == 1 and i["unit"] == "serving" for i in bom)


def test_build_cook_bom_dedupes_names():
    ext = [{"name": "Pasta"}, {"name": "pasta"}]
    bom = build_cook_bom_from_extended_ingredients(ext)
    assert len(bom) == 1
    assert bom[0]["name"] == "Pasta"


@pytest.fixture
def sandbox_svc():
    supabase = MagicMock()
    pantry = MagicMock()
    pool = MagicMock()
    return CookLoopSandboxService(supabase, pantry, pool)


def test_grade_passes_after_successful_cook(sandbox_svc):
    sandbox_svc.supabase.get_household_pantry.return_value = [
        {
            "base_ingredient": "pasta",
            "quantity_remaining": 1,
            "quantity_purchased": 2,
            "deleted_at": None,
        },
        {
            "base_ingredient": "white rice",
            "quantity_remaining": None,
            "quantity_purchased": 2,
            "deleted_at": None,
        },
    ]
    sandbox_svc.pool_store.get_pool_row_by_recipe_id.return_value = {
        "status": "swiped",
        "recipe_id": DEV_RECIPE_ID,
    }
    log_client = MagicMock()
    chain = MagicMock()
    chain.execute.return_value = MagicMock(
        data=[
            {
                "recipe_id": DEV_RECIPE_ID,
                "ingredients_used": [
                    {"base_ingredient": "pasta"},
                    {"base_ingredient": "tomatoes"},
                    {"base_ingredient": "olive oil"},
                ],
            }
        ]
    )
    chain.limit.return_value = chain
    chain.order.return_value = chain
    chain.eq.return_value = chain
    log_client.table.return_value.select.return_value = chain
    sandbox_svc.supabase.admin_client = log_client

    touched = [
        {"base_ingredient": "pasta", "depletion_class": "UNIT_ITEM"},
        {"base_ingredient": "tomatoes", "depletion_class": "PERISHABLE"},
        {"base_ingredient": "olive oil", "depletion_class": "CONSUMABLE"},
    ]
    report = sandbox_svc.grade(
        "u1", "hh1", mode="run", cook_touched=touched, recipe_id=DEV_RECIPE_ID
    )
    assert report["ok"] is True
    assert report["mode"] == "run"


def test_grade_fails_when_rice_touched(sandbox_svc):
    sandbox_svc.supabase.get_household_pantry.return_value = [
        {
            "base_ingredient": "pasta",
            "quantity_remaining": 1,
            "deleted_at": None,
        },
        {
            "base_ingredient": "white rice",
            "quantity_remaining": None,
            "quantity_purchased": 2,
            "deleted_at": None,
        },
    ]
    sandbox_svc.pool_store.get_pool_row_by_recipe_id.return_value = {
        "status": "swiped",
    }
    log_client = MagicMock()
    log_client.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[{"recipe_id": DEV_RECIPE_ID, "ingredients_used": []}]
    )
    sandbox_svc.supabase.admin_client = log_client

    touched = [
        {"base_ingredient": "pasta"},
        {"base_ingredient": "tomatoes"},
        {"base_ingredient": "olive oil"},
        {"base_ingredient": "white rice"},
    ]
    report = sandbox_svc.grade(
        "u1", "hh1", mode="run", cook_touched=touched, recipe_id=DEV_RECIPE_ID
    )
    assert report["ok"] is False
    failed = [c["id"] for c in report["checks"] if not c["ok"]]
    assert "not_touched_white_rice" in failed


@pytest.mark.asyncio
async def test_reset_aborts_on_depletion_class_mismatch(sandbox_svc):
    sandbox_svc.supabase.reset_household_pantry = MagicMock()
    sandbox_svc.pool_store.delete_by_recipe_id = MagicMock()
    sandbox_svc.pantry.add_to_pantry = AsyncMock(return_value="id-1")
    sandbox_svc.supabase.get_household_pantry.return_value = [
        {
            "base_ingredient": "pasta",
            "depletion_class": "STAPLE",
            "quantity": 2,
        }
    ]
    from backend.utils.exceptions import ValidationException

    with pytest.raises(ValidationException, match="depletion_class"):
        await sandbox_svc.reset("u1", "hh1", today=date(2026, 4, 10))


@pytest.mark.asyncio
async def test_run_async_invokes_cook_and_swipe(sandbox_svc):
    sandbox_svc.supabase.reset_household_pantry = MagicMock()
    sandbox_svc.pool_store.delete_by_recipe_id = MagicMock()
    sandbox_svc.pool_store.insert_pool_row.return_value = "pool-1"
    sandbox_svc.pantry.add_to_pantry = AsyncMock(return_value="pantry-1")

    live_rows = []
    for base, cls, qty, rem in [
        ("pasta", "UNIT_ITEM", 2, 1),
        ("tomatoes", "PERISHABLE", 1, None),
        ("olive oil", "CONSUMABLE", 1, None),
        ("white rice", "UNIT_ITEM", 2, None),
    ]:
        live_rows.append(
            {
                "base_ingredient": base,
                "depletion_class": cls,
                "quantity": qty,
                "quantity_purchased": qty if cls == "UNIT_ITEM" else None,
                "quantity_remaining": rem,
                "deleted_at": None,
            }
        )
    sandbox_svc.supabase.get_household_pantry.return_value = live_rows
    sandbox_svc.pool_store.get_pool_row_by_recipe_id.return_value = {
        "status": "swiped",
    }
    log_client = MagicMock()
    chain = MagicMock()
    chain.execute.return_value = MagicMock(
        data=[
            {
                "recipe_id": DEV_RECIPE_ID,
                "ingredients_used": [
                    {"base_ingredient": "pasta"},
                    {"base_ingredient": "tomatoes"},
                    {"base_ingredient": "olive oil"},
                ],
            }
        ]
    )
    chain.limit.return_value = chain
    chain.order.return_value = chain
    chain.eq.return_value = chain
    log_client.table.return_value.select.return_value = chain
    sandbox_svc.supabase.admin_client = log_client

    touched = [
        {"base_ingredient": "pasta"},
        {"base_ingredient": "tomatoes"},
        {"base_ingredient": "olive oil"},
    ]
    with patch(
        "backend.services.cook_loop_sandbox_service.process_cook_event",
        return_value=touched,
    ) as cook_mock:
        report = await sandbox_svc.run_async("u1", "hh1", today=date(2026, 4, 10))
    cook_mock.assert_called_once()
    sandbox_svc.pool_store.update_status.assert_called_with("pool-1", "hh1", "swiped")
    assert report["mode"] == "run"
    assert report["pool_suggestion_id"] == "pool-1"
