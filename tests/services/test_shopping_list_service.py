"""Unit tests for ShoppingListService — meal plan → shopping list diff (PostgREST stub)."""

from datetime import date

import pytest

from backend.services.shopping_list_service import ShoppingListService
from backend.utils.exceptions import ValidationException
from tests.conftest import PostgrestClientStub, chain_calls_eq, install_supabase_service_with_clients


def _service_with_stub(mocker) -> tuple[ShoppingListService, PostgrestClientStub]:
    anon = PostgrestClientStub()
    supabase = install_supabase_service_with_clients(mocker, anon, admin=None)
    return ShoppingListService(supabase), anon


def _meal_row(
    *,
    meal_date: str,
    ingredients_reserved: list,
    recipe_name: str = "Test Recipe",
) -> dict:
    return {
        "id": "meal-1",
        "household_id": "hh-test",
        "meal_date": meal_date,
        "recipe_name": recipe_name,
        "ingredients_reserved": ingredients_reserved,
    }


def _queue_generate_flow(
    stub: PostgrestClientStub,
    *,
    meal_plans: list,
    pantry_rows: list,
) -> None:
    stub.queue_response(meal_plans)
    stub.queue_response(pantry_rows)
    stub.queue_response([])  # shopping_list delete
    stub.queue_response([])  # shopping_list insert


def _assert_household_scoped_chains(stub: PostgrestClientStub, household_id: str) -> None:
    """meal_plan, pantry_items, and shopping_list operations must scope by household_id (no user_id filter)."""
    for chain in stub.chains:
        if not chain or chain[0][0] != "table":
            continue
        table = chain[0][1][0]
        if table == "meal_plan":
            assert chain_calls_eq([chain], "household_id", household_id)
        elif table == "pantry_items":
            assert chain_calls_eq([chain], "household_id", household_id)
        elif table == "shopping_list":
            if any(step[0] == "delete" for step in chain):
                assert chain_calls_eq([chain], "household_id", household_id)
            for step in chain:
                if step[0] == "insert" and step[1]:
                    rows = step[1][0]
                    assert isinstance(rows, list)
                    for row in rows:
                        assert row.get("household_id") == household_id
        if table in ("meal_plan", "pantry_items", "shopping_list"):
            assert not any(
                step[0] == "eq" and len(step[1]) >= 2 and step[1][0] == "user_id"
                for step in chain
            )


# --- Group A — diff math ---


@pytest.mark.asyncio
async def test_item_fully_in_pantry_is_excluded(mocker):
    svc, stub = _service_with_stub(mocker)
    hid = "hh-test"
    d0 = date(2025, 1, 1)
    d1 = date(2025, 1, 31)
    _queue_generate_flow(
        stub,
        meal_plans=[
            _meal_row(
                meal_date="2025-01-10",
                ingredients_reserved=[{"name": "flour", "amount": 2, "unit": "cup"}],
            )
        ],
        pantry_rows=[
            {
                "normalized_name": "flour",
                "unit": "cup",
                "quantity": 2,
                "household_id": hid,
            }
        ],
    )
    out = await svc.generate_from_meal_plan(hid, d0, d1)
    assert out["total_items"] == 0
    assert out["items"] == []


@pytest.mark.asyncio
async def test_item_partially_in_pantry_is_included_with_reduced_quantity(mocker):
    svc, stub = _service_with_stub(mocker)
    hid = "hh-test"
    d0 = date(2025, 1, 1)
    d1 = date(2025, 1, 31)
    _queue_generate_flow(
        stub,
        meal_plans=[
            _meal_row(
                meal_date="2025-01-10",
                ingredients_reserved=[{"name": "Sugar", "amount": 3, "unit": "cup"}],
            )
        ],
        pantry_rows=[
            {
                "normalized_name": "sugar",
                "unit": "cup",
                "quantity": 1,
                "household_id": hid,
            }
        ],
    )
    out = await svc.generate_from_meal_plan(hid, d0, d1)
    assert out["total_items"] == 1
    assert out["items"][0]["quantity"] == 2
    assert out["items"][0]["ingredient_name"] == "sugar"


@pytest.mark.asyncio
async def test_item_not_in_pantry_is_included_at_full_quantity(mocker):
    svc, stub = _service_with_stub(mocker)
    hid = "hh-test"
    d0 = date(2025, 1, 1)
    d1 = date(2025, 1, 31)
    _queue_generate_flow(
        stub,
        meal_plans=[
            _meal_row(
                meal_date="2025-01-10",
                ingredients_reserved=[{"name": "paprika", "amount": 5, "unit": "tsp"}],
            )
        ],
        pantry_rows=[],
    )
    out = await svc.generate_from_meal_plan(hid, d0, d1)
    assert out["total_items"] == 1
    assert out["items"][0]["quantity"] == 5
    assert out["items"][0]["ingredient_name"] == "paprika"


# --- Group B — unit awareness ---


@pytest.mark.asyncio
async def test_diff_does_not_subtract_across_mismatched_units(mocker):
    """Pantry stock in kg must not reduce a requirement expressed in cups."""
    svc, stub = _service_with_stub(mocker)
    hid = "hh-test"
    d0 = date(2025, 1, 1)
    d1 = date(2025, 1, 31)
    _queue_generate_flow(
        stub,
        meal_plans=[
            _meal_row(
                meal_date="2025-01-10",
                ingredients_reserved=[{"name": "flour", "amount": 2, "unit": "cup"}],
            )
        ],
        pantry_rows=[
            {
                "normalized_name": "flour",
                "unit": "kg",
                "quantity": 1,
                "household_id": hid,
            }
        ],
    )
    out = await svc.generate_from_meal_plan(hid, d0, d1)
    assert out["total_items"] == 1
    assert out["items"][0]["quantity"] == 2
    assert out["items"][0]["unit"] == "cup"


# --- Group C — validation ---


@pytest.mark.asyncio
async def test_reversed_date_range_raises_validation_exception(mocker):
    svc, stub = _service_with_stub(mocker)
    with pytest.raises(ValidationException, match="start_date must be on or before end_date"):
        await svc.generate_from_meal_plan(
            "hh-test",
            date(2025, 2, 1),
            date(2025, 1, 1),
        )
    assert stub.chains == []


@pytest.mark.asyncio
async def test_empty_meal_plan_returns_empty_list_without_raising(mocker):
    svc, stub = _service_with_stub(mocker)
    hid = "hh-test"
    stub.queue_response([])
    out = await svc.generate_from_meal_plan(hid, date(2025, 1, 1), date(2025, 1, 31))
    assert out == {
        "items": [],
        "total_items": 0,
        "household_id": hid,
    }
    assert len(stub.chains) == 1


# --- Group D — idempotency ---


@pytest.mark.asyncio
async def test_regeneration_yields_identical_list_with_unchanged_inputs(mocker):
    svc, stub = _service_with_stub(mocker)
    hid = "hh-test"
    d0 = date(2025, 1, 1)
    d1 = date(2025, 1, 31)

    def _enqueue_once():
        _queue_generate_flow(
            stub,
            meal_plans=[
                _meal_row(
                    meal_date="2025-01-12",
                    ingredients_reserved=[
                        {"name": "oats", "amount": 1, "unit": "cup"},
                    ],
                )
            ],
            pantry_rows=[],
        )

    _enqueue_once()
    first = await svc.generate_from_meal_plan(hid, d0, d1)
    _enqueue_once()
    second = await svc.generate_from_meal_plan(hid, d0, d1)
    assert first == second


# --- Group E — scoping ---


@pytest.mark.asyncio
async def test_queries_filter_by_household_id_only(mocker):
    svc, stub = _service_with_stub(mocker)
    hid = "scoped-household-99"
    d0 = date(2025, 1, 1)
    d1 = date(2025, 1, 31)
    _queue_generate_flow(
        stub,
        meal_plans=[
            {
                **_meal_row(
                    meal_date="2025-01-15",
                    ingredients_reserved=[{"name": "salt", "amount": 1, "unit": "tsp"}],
                ),
                "household_id": hid,
            }
        ],
        pantry_rows=[
            {
                "normalized_name": "salt",
                "unit": "tsp",
                "quantity": 0.5,
                "household_id": hid,
            }
        ],
    )
    await svc.generate_from_meal_plan(hid, d0, d1)
    _assert_household_scoped_chains(stub, hid)
