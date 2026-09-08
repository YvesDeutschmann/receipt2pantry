"""Tests for `SupabaseService` — PostgREST chains mocked via `PostgrestClientStub`."""

import pytest

from backend.services.supabase_service import SupabaseService
from backend.utils.exceptions import DatabaseException
from tests.conftest import (
    PostgrestClientStub,
    chain_calls_eq,
    install_supabase_service_with_clients,
    latest_chain_using_table,
)


def _no_ilike_in_client(stub: PostgrestClientStub) -> bool:
    for chain in stub.chains:
        for step in chain:
            if step[0] == "ilike":
                return False
    return True


def test_supabase_service_initialization():
    """Test Supabase service can be initialized"""
    with pytest.raises(DatabaseException):
        SupabaseService("invalid-url", "invalid-key")


def test_supabase_service_with_mock(mocker):
    """Test Supabase service with mocked client"""
    anon = PostgrestClientStub()
    service = install_supabase_service_with_clients(mocker, anon, admin=None)

    assert service.client is anon
    assert service.admin_client is None


def test_get_user_receipts_with_mock(mocker):
    """Test getting user receipts"""
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.set_default_response_data(
        [
            {"id": "1", "order_id": "12345A6", "total_amount": 50.00},
            {"id": "2", "order_id": "67890B2", "total_amount": 75.50},
        ]
    )
    service = install_supabase_service_with_clients(mocker, anon, admin)

    receipts = service.get_user_receipts("user-123")

    assert len(receipts) == 2
    assert receipts[0]["order_id"] == "12345A6"
    assert receipts[1]["order_id"] == "67890B2"
    assert chain_calls_eq(admin.chains, "user_id", "user-123")
    assert len(anon.chains) == 0


def test_upsert_pantry_item_household_conflict_target(mocker):
    """upsert_pantry_item calls upsert_pantry_item RPC via service-role client."""
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.set_default_response_data("pantry-1")
    service = install_supabase_service_with_clients(mocker, anon, admin)

    item_data = {
        "user_id": "user-1",
        "household_id": "hh-1",
        "base_ingredient": "butter",
        "variant": "salted",
        "unit": "lb",
        "normalized_name": "butter (salted)",
    }
    result = service.upsert_pantry_item(item_data)

    assert result == "pantry-1"
    rpc_steps = [
        step for chain in admin.chains for step in chain if step[0] == "rpc"
    ]
    assert rpc_steps[0][1][0] == "upsert_pantry_item"
    assert rpc_steps[0][1][1] == {"p_item": item_data}
    assert len(anon.chains) == 0


def test_upsert_pantry_item_null_household_conflict_target(mocker):
    """upsert_pantry_item RPC handles legacy null-household rows."""
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.set_default_response_data("pantry-2")
    service = install_supabase_service_with_clients(mocker, anon, admin)

    item_data = {
        "user_id": "user-1",
        "household_id": None,
        "base_ingredient": "flour",
        "variant": None,
        "unit": "cup",
        "normalized_name": "flour",
    }
    result = service.upsert_pantry_item(item_data)

    assert result == "pantry-2"
    rpc_steps = [
        step for chain in admin.chains for step in chain if step[0] == "rpc"
    ]
    assert rpc_steps[0][1][0] == "upsert_pantry_item"
    assert rpc_steps[0][1][1] == {"p_item": item_data}


def test_upsert_pantry_item_requires_service_role(mocker):
    """upsert_pantry_item fails fast without SUPABASE_SERVICE_ROLE_KEY."""
    anon = PostgrestClientStub()
    service = install_supabase_service_with_clients(mocker, anon, admin=None)

    with pytest.raises(DatabaseException, match="SUPABASE_SERVICE_ROLE_KEY"):
        service.upsert_pantry_item(
            {
                "user_id": "user-1",
                "base_ingredient": "salt",
                "normalized_name": "salt",
            }
        )


def test_upsert_pantry_item_forwards_depletion_fields(mocker):
    """upsert_pantry_item RPC receives depletion_class and purchase_date in p_item."""
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.set_default_response_data("pantry-1")
    service = install_supabase_service_with_clients(mocker, anon, admin)

    item_data = {
        "user_id": "user-1",
        "household_id": "hh-1",
        "base_ingredient": "spinach",
        "normalized_name": "spinach",
        "depletion_class": "PERISHABLE",
        "purchase_date": "2026-04-10T00:00:00+00:00",
    }
    service.upsert_pantry_item(item_data)

    rpc_steps = [
        step for chain in admin.chains for step in chain if step[0] == "rpc"
    ]
    assert rpc_steps[0][1][1]["p_item"]["depletion_class"] == "PERISHABLE"
    assert rpc_steps[0][1][1]["p_item"]["purchase_date"] == "2026-04-10T00:00:00+00:00"


def test_upsert_pantry_item_unwraps_list_rpc_payload(mocker):
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.set_default_response_data(["pantry-1"])
    service = install_supabase_service_with_clients(mocker, anon, admin)

    result = service.upsert_pantry_item(
        {
            "user_id": "user-1",
            "household_id": "hh-1",
            "base_ingredient": "salt",
            "normalized_name": "salt",
        }
    )
    assert result == "pantry-1"


def _chain_has_filter(ch, method: str, column: str) -> bool:
    return any(
        step[0] == method and step[1] and step[1][0] == column for step in ch
    )


def test_get_user_pantry_filters_deleted_at_null(mocker):
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.set_default_response_data([])
    service = install_supabase_service_with_clients(mocker, anon, admin)

    service.get_user_pantry("uid-100")

    ch = latest_chain_using_table(admin.chains, "pantry_items")
    assert ch is not None
    assert _chain_has_filter(ch, "is_", "deleted_at")
    assert _chain_has_filter(ch, "gt", "quantity")


def test_get_household_pantry_filters_deleted_at_null(mocker):
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.set_default_response_data([])
    service = install_supabase_service_with_clients(mocker, anon, admin)

    service.get_household_pantry("hh-1")

    ch = latest_chain_using_table(admin.chains, "pantry_items")
    assert ch is not None
    assert _chain_has_filter(ch, "is_", "deleted_at")
    assert _chain_has_filter(ch, "gt", "quantity")


def test_get_user_pantry_include_deleted_omits_deleted_filter(mocker):
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.set_default_response_data([])
    service = install_supabase_service_with_clients(mocker, anon, admin)

    service.get_user_pantry("uid-100", include_deleted=True)

    ch = latest_chain_using_table(admin.chains, "pantry_items")
    assert ch is not None
    assert not _chain_has_filter(ch, "is_", "deleted_at")
    assert not _chain_has_filter(ch, "gt", "quantity")


def test_get_household_pantry_include_deleted_omits_deleted_and_quantity_filters(
    mocker,
):
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.set_default_response_data([])
    service = install_supabase_service_with_clients(mocker, anon, admin)

    service.get_household_pantry("hh-1", include_deleted=True)

    ch = latest_chain_using_table(admin.chains, "pantry_items")
    assert ch is not None
    assert not _chain_has_filter(ch, "is_", "deleted_at")
    assert not _chain_has_filter(ch, "gt", "quantity")


def test_get_receipt_returns_first_row(mocker):
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.set_default_response_data(
        [{"id": "receipt-99", "order_date": "2025-01-15"}]
    )
    service = install_supabase_service_with_clients(mocker, anon, admin)

    row = service.get_receipt("receipt-99")

    assert row["order_date"] == "2025-01-15"
    assert chain_calls_eq(admin.chains, "id", "receipt-99")
    assert len(anon.chains) == 0


def test_get_receipt_returns_none_when_empty(mocker):
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.set_default_response_data([])
    service = install_supabase_service_with_clients(mocker, anon, admin)

    assert service.get_receipt("missing") is None


# --- Group A — client selection ---


def test_get_household_pantry_uses_admin_client_when_available(mocker):
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.set_default_response_data([{"id": "p1"}])
    service = install_supabase_service_with_clients(mocker, anon, admin)

    out = service.get_household_pantry("hh-9")

    assert out == [{"id": "p1"}]
    assert len(admin.chains) >= 1
    assert len(anon.chains) == 0
    assert chain_calls_eq(admin.chains, "household_id", "hh-9")


def test_get_household_pantry_falls_back_to_anon_client_when_admin_none(mocker):
    anon = PostgrestClientStub()
    anon.set_default_response_data([])
    service = install_supabase_service_with_clients(mocker, anon, admin=None)

    out = service.get_household_pantry("hh-1")

    assert out == []
    assert chain_calls_eq(anon.chains, "household_id", "hh-1")


def test_partial_update_pantry_row_always_uses_admin_client(mocker):
    """When service role is configured, partial pantry field updates go through admin."""
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    service = install_supabase_service_with_clients(mocker, anon, admin)

    service.update_pantry_item_fields("item-1", {"quantity": 2.0})

    assert len(admin.chains) >= 1
    assert len(anon.chains) == 0
    update_steps = [step for chain in admin.chains for step in chain if step[0] == "update"]
    assert update_steps[0][1][0] == {"quantity": 2.0}


def test_update_pantry_item_fields_falls_back_to_anon_when_admin_missing(mocker):
    anon = PostgrestClientStub()
    service = install_supabase_service_with_clients(mocker, anon, admin=None)

    service.update_pantry_item_fields("item-x", {"note": "x"})

    assert len(anon.chains) >= 1
    assert chain_calls_eq(anon.chains, "id", "item-x")


# --- Group B — query shape ---


def test_get_user_household_filters_by_user_id_eq(mocker):
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.queue_response(
        [
            {
                "households": {
                    "id": "h1",
                    "name": "Home",
                    "join_code": "AB12",
                    "created_by": "u1",
                    "created_at": "2024-01-01",
                    "size": 2,
                    "dietary_restrictions": [],
                    "suggestion_meal_slots": None,
                },
                "role": "owner",
                "joined_at": "2024-01-02",
            }
        ]
    )
    service = install_supabase_service_with_clients(mocker, anon, admin)

    row = service.get_user_household("user-z")

    assert row is not None
    assert row["id"] == "h1"
    assert chain_calls_eq(admin.chains, "user_id", "user-z")
    assert _no_ilike_in_client(admin)


def test_get_receipt_items_filters_by_receipt_id_eq(mocker):
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.set_default_response_data([{"id": "ri-1", "receipt_id": "r9"}])
    service = install_supabase_service_with_clients(mocker, anon, admin)

    items = service.get_receipt_items("receipt-99")

    assert items[0]["id"] == "ri-1"
    assert chain_calls_eq(admin.chains, "receipt_id", "receipt-99")


def test_get_active_canonical_ingredient_normalizes_name_lowercase(mocker):
    """`get_canonical_ingredient_by_base` lowercases/strips before `.eq('base_ingredient', ...)`."""
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.set_default_response_data(
        [{"base_ingredient": "tomato", "display_name": "Tomato", "category": "veg"}]
    )
    service = install_supabase_service_with_clients(mocker, anon, admin)

    row = service.get_canonical_ingredient_by_base("  ToMaTo  ")

    assert row["display_name"] == "Tomato"
    ch = latest_chain_using_table(admin.chains, "canonical_ingredients")
    assert ch is not None
    assert chain_calls_eq([ch], "base_ingredient", "tomato")


# --- Group C — empty / malformed responses ---


def test_get_user_household_returns_none_when_response_data_empty(mocker):
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.set_default_response_data([])
    service = install_supabase_service_with_clients(mocker, anon, admin)

    assert service.get_user_household("no-member") is None


def test_get_household_members_returns_empty_list_when_response_data_none(mocker):
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.set_default_response_data(None)
    service = install_supabase_service_with_clients(mocker, anon, admin)

    assert service.get_household_members("hh") == []


def test_get_product_mapping_returns_none_on_empty(mocker):
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.set_default_response_data([])
    service = install_supabase_service_with_clients(mocker, anon, admin)

    assert service.get_product_mapping("unknown") is None


# --- Group D — uniqueness / join codes ---


def test_is_join_code_unique_returns_true_on_empty_data(mocker):
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.set_default_response_data([])
    service = install_supabase_service_with_clients(mocker, anon, admin)

    assert service.is_join_code_unique("abc12") is True


def test_is_join_code_unique_returns_false_when_any_row_present(mocker):
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.set_default_response_data([{"id": "h1"}])
    service = install_supabase_service_with_clients(mocker, anon, admin)

    assert service.is_join_code_unique("abc12") is False


# --- Additional coverage (high-traffic methods / admin preference) ---


def test_get_user_pantry_uses_admin_when_available(mocker):
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.set_default_response_data([])
    service = install_supabase_service_with_clients(mocker, anon, admin)

    service.get_user_pantry("u77")

    assert len(admin.chains) >= 1
    assert len(anon.chains) == 0


def test_get_user_pantry_filters_by_user_id_eq(mocker):
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.set_default_response_data([])
    service = install_supabase_service_with_clients(mocker, anon, admin)

    service.get_user_pantry("uid-100")

    assert chain_calls_eq(admin.chains, "user_id", "uid-100")


def test_get_receipt_items_uses_admin_when_available(mocker):
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.set_default_response_data([])
    service = install_supabase_service_with_clients(mocker, anon, admin)

    service.get_receipt_items("r1")

    assert len(admin.chains) >= 1
    assert len(anon.chains) == 0


def test_get_product_mapping_filters_by_raw_name_eq(mocker):
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.set_default_response_data([{"id": "m1", "raw_name": "x"}])
    service = install_supabase_service_with_clients(mocker, anon, admin)

    service.get_product_mapping("Milk 1qt")

    assert chain_calls_eq(admin.chains, "raw_name", "Milk 1qt")


def test_get_user_household_uses_admin_when_available(mocker):
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.set_default_response_data([])
    service = install_supabase_service_with_clients(mocker, anon, admin)

    service.get_user_household("u1")

    assert len(admin.chains) >= 1
    assert len(anon.chains) == 0


def test_get_household_members_uses_admin_when_available(mocker):
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.set_default_response_data([])
    service = install_supabase_service_with_clients(mocker, anon, admin)

    service.get_household_members("hh2")

    assert len(admin.chains) >= 1
    assert len(anon.chains) == 0


def test_get_canonical_ingredient_by_base_uses_admin_when_available(mocker):
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.set_default_response_data([])
    service = install_supabase_service_with_clients(mocker, anon, admin)

    service.get_canonical_ingredient_by_base("salt")

    assert len(admin.chains) >= 1
    assert len(anon.chains) == 0


def test_get_canonical_ingredient_by_base_returns_none_for_empty_name(mocker):
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    service = install_supabase_service_with_clients(mocker, anon, admin)

    assert service.get_canonical_ingredient_by_base("   ") is None
    assert len(admin.chains) == 0


def test_is_join_code_unique_applies_uppercase_eq(mocker):
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    admin.set_default_response_data([])
    service = install_supabase_service_with_clients(mocker, anon, admin)

    service.is_join_code_unique("abz99")

    assert chain_calls_eq(admin.chains, "join_code", "ABZ99")


def test_reset_household_pantry_deletes_live_rows_only(mocker):
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    service = install_supabase_service_with_clients(mocker, anon, admin)

    service.reset_household_pantry("hh-live")

    ch = latest_chain_using_table(admin.chains, "pantry_items")
    assert ch is not None
    assert chain_calls_eq([ch], "household_id", "hh-live")
    assert any(
        step[0] == "is_" and step[1][:2] == ("deleted_at", "null") for step in ch
    )
    assert any(step[0] == "delete" for step in ch)
    assert len(anon.chains) == 0


def test_delete_recipe_cooking_log_scopes_household_and_recipe(mocker):
    anon = PostgrestClientStub()
    admin = PostgrestClientStub()
    service = install_supabase_service_with_clients(mocker, anon, admin)

    service.delete_recipe_cooking_log("hh-live", "dev_cook_loop")

    ch = latest_chain_using_table(admin.chains, "cooking_log")
    assert ch is not None
    assert chain_calls_eq([ch], "household_id", "hh-live")
    assert chain_calls_eq([ch], "recipe_id", "dev_cook_loop")
    assert any(step[0] == "delete" for step in ch)
    assert len(anon.chains) == 0

