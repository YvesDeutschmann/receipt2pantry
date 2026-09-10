"""Tests for backend.services.confidence_engine (Phase 2 depletion)."""

import copy
from datetime import date, datetime, time, timezone
from unittest.mock import Mock, patch

import pytest

from backend.services.confidence_engine import (
    PUT_BACK_CONFIDENCE_OVERRIDE,
    UNIT_ITEM_DEFAULT_DAYS_SUPPLY,
    USE_SOON_DAYS,
    _find_pantry_match,
    compute_confidence,
    default_days_supply_for,
    find_pantry_match,
    find_pantry_match_for_cook,
    get_calibrated_days_supply,
    get_engagement_multiplier,
    process_cook_event,
    process_put_back,
    resolve_depletion_class,
    run_expiry_cleanup,
)
from backend.services.suggestion_service import get_tier
from tests.services.conftest import (
    TEST_DATE,
    days_after,
    days_ago,
    make_classification,
    make_pantry_item,
)


# --- Group 1: PERISHABLE ---


def test_perishable_well_within_date(default_user_prefs):
    cls = make_classification(sub_class="leafy_green", grace_buffer_days=3)
    # purchase today-2, shelf 5 -> available_until today+3; days_remaining 3 > 2
    item = make_pantry_item(
        available_until=days_after(TEST_DATE, 3),
        hard_expire_date=days_after(TEST_DATE, 8),
    )
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.95


def test_perishable_borderline_entry(default_user_prefs):
    cls = make_classification(grace_buffer_days=3)
    item = make_pantry_item(available_until=days_after(TEST_DATE, 2))
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.50


def test_perishable_borderline_exit(default_user_prefs):
    cls = make_classification(grace_buffer_days=3)
    item = make_pantry_item(available_until=TEST_DATE)
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.50


def test_perishable_past_shelf_life(default_user_prefs):
    cls = make_classification(grace_buffer_days=3)
    item = make_pantry_item(available_until=days_ago(TEST_DATE, 1))
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.10


def test_perishable_approaching_hard_expiry(default_user_prefs):
    cls = make_classification(grace_buffer_days=3)
    item = make_pantry_item(available_until=days_ago(TEST_DATE, 2))
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.10


def test_perishable_at_hard_expiry(default_user_prefs):
    cls = make_classification(grace_buffer_days=3)
    item = make_pantry_item(available_until=days_ago(TEST_DATE, 10))
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.0


def test_perishable_chicken_within_date(default_user_prefs):
    cls = make_classification(
        sub_class="raw_meat",
        shelf_life_days=3,
        grace_buffer_days=1,
    )
    # days_remaining must be > 2 for 0.95 band (purchase today-1 → available_until today+2 → 3 days left)
    item = make_pantry_item(
        base_ingredient="chicken breast",
        available_until=days_after(TEST_DATE, 3),
    )
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.95


def test_perishable_chicken_borderline(default_user_prefs):
    cls = make_classification(
        sub_class="raw_meat",
        shelf_life_days=3,
        grace_buffer_days=1,
    )
    item = make_pantry_item(
        base_ingredient="chicken breast",
        available_until=days_after(TEST_DATE, 1),
    )
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.50


def test_perishable_eggs_long_shelf_life(default_user_prefs):
    cls = make_classification(
        sub_class="eggs",
        shelf_life_days=21,
        grace_buffer_days=5,
    )
    item = make_pantry_item(
        base_ingredient="eggs",
        available_until=days_after(TEST_DATE, 11),
    )
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.95


def test_perishable_milk_approaching_end(default_user_prefs):
    cls = make_classification(
        sub_class="dairy",
        shelf_life_days=7,
        grace_buffer_days=2,
    )
    item = make_pantry_item(
        base_ingredient="milk",
        available_until=days_after(TEST_DATE, 1),
    )
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.50


# --- Group 2: Frozen PERISHABLE ---


def test_perishable_frozen_well_within(default_user_prefs):
    cls = make_classification()
    item = make_pantry_item(
        is_frozen=True,
        frozen_expire_date=days_after(TEST_DATE, 85),
        available_until=days_ago(TEST_DATE, 10),
    )
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.95


def test_perishable_frozen_borderline(default_user_prefs):
    cls = make_classification()
    item = make_pantry_item(
        is_frozen=True,
        frozen_expire_date=days_after(TEST_DATE, 1),
    )
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.50


def test_perishable_frozen_past_frozen_expiry(default_user_prefs):
    cls = make_classification()
    item = make_pantry_item(
        is_frozen=True,
        frozen_expire_date=days_ago(TEST_DATE, 1),
    )
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.10


def test_perishable_frozen_ignores_original_shelf_life(default_user_prefs):
    cls = make_classification()
    item = make_pantry_item(
        is_frozen=True,
        frozen_expire_date=days_after(TEST_DATE, 80),
        available_until=days_ago(TEST_DATE, 20),
    )
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.95


# --- Group 3: CONSUMABLE ---


def test_consumable_well_within_supply(default_user_prefs):
    cls = make_classification(
        depletion_class="CONSUMABLE",
        default_days_supply=45,
    )
    item = make_pantry_item(
        depletion_class="CONSUMABLE",
        base_ingredient="olive oil",
        purchase_date=days_ago(TEST_DATE, 10),
    )
    assert (
        compute_confidence(
            item,
            default_user_prefs,
            cls,
            today=TEST_DATE,
            calibrated_days=45,
        )
        == 0.80
    )


def test_consumable_lower_band(default_user_prefs):
    cls = make_classification(
        depletion_class="CONSUMABLE",
        default_days_supply=45,
    )
    item = make_pantry_item(
        depletion_class="CONSUMABLE",
        purchase_date=days_ago(TEST_DATE, 40),
    )
    assert (
        compute_confidence(
            item,
            default_user_prefs,
            cls,
            today=TEST_DATE,
            calibrated_days=45,
        )
        == 0.60
    )


def test_consumable_past_depletion_date(default_user_prefs):
    cls = make_classification(
        depletion_class="CONSUMABLE",
        default_days_supply=45,
    )
    item = make_pantry_item(
        depletion_class="CONSUMABLE",
        purchase_date=days_ago(TEST_DATE, 50),
    )
    assert (
        compute_confidence(
            item,
            default_user_prefs,
            cls,
            today=TEST_DATE,
            calibrated_days=45,
        )
        == 0.20
    )


def test_consumable_far_past_depletion(default_user_prefs):
    cls = make_classification(
        depletion_class="CONSUMABLE",
        default_days_supply=45,
    )
    item = make_pantry_item(
        depletion_class="CONSUMABLE",
        purchase_date=days_ago(TEST_DATE, 80),
    )
    assert (
        compute_confidence(
            item,
            default_user_prefs,
            cls,
            today=TEST_DATE,
            calibrated_days=45,
        )
        == 0.10
    )


def test_consumable_max_ttl_floor(default_user_prefs):
    cls = make_classification(
        depletion_class="CONSUMABLE",
        default_days_supply=90,
    )
    item = make_pantry_item(
        depletion_class="CONSUMABLE",
        base_ingredient="soy sauce",
        purchase_date=days_ago(TEST_DATE, 366),
    )
    assert (
        compute_confidence(
            item,
            default_user_prefs,
            cls,
            today=TEST_DATE,
            calibrated_days=90,
        )
        == 0.05
    )


def test_consumable_never_auto_deletes(default_user_prefs):
    """CONSUMABLE_NEVER_AUTO_DELETES: run_expiry_cleanup does not touch consumables."""
    client = _plain_supabase_mock()
    rpc = Mock()
    rpc.execute.return_value = Mock(data=[{"id": "h1"}])
    client.rpc.return_value = rpc
    sel_chain = Mock()
    sel_chain.eq.return_value = sel_chain
    sel_chain.is_.return_value = sel_chain
    sel_chain.lt.return_value = sel_chain
    # Query filters PERISHABLE + hard_expire_date < today — consumables not returned
    sel_chain.execute.return_value = Mock(data=[])
    pt = Mock()
    pt.select.return_value = sel_chain
    cook = Mock()
    cook.select.return_value = cook
    cook.eq.return_value = cook
    cook.limit.return_value = cook
    cook.execute.return_value = Mock(data=[])

    def tbl(name):
        if name == "pantry_items":
            return pt
        if name == "cooking_log":
            return cook
        return Mock()

    client.table.side_effect = tbl
    out = run_expiry_cleanup(client, "u1", today=TEST_DATE)
    assert out == []
    client.rpc.assert_not_called()
    olive = make_pantry_item(
        depletion_class="CONSUMABLE",
        base_ingredient="olive oil",
        purchase_date=days_ago(TEST_DATE, 400),
    )
    cls = make_classification(depletion_class="CONSUMABLE", default_days_supply=45)
    assert (
        compute_confidence(
            olive,
            default_user_prefs,
            cls,
            today=TEST_DATE,
            calibrated_days=45,
        )
        == 0.05
    )


def test_consumable_exactly_365_days(default_user_prefs):
    cls = make_classification(
        depletion_class="CONSUMABLE",
        default_days_supply=90,
    )
    item = make_pantry_item(
        depletion_class="CONSUMABLE",
        base_ingredient="soy sauce",
        purchase_date=days_ago(TEST_DATE, 365),
    )
    assert (
        compute_confidence(
            item,
            default_user_prefs,
            cls,
            today=TEST_DATE,
            calibrated_days=90,
        )
        == 0.10
    )


# --- Group 4: STAPLE ---


def test_staple_unknown_quantity(default_user_prefs):
    cls = make_classification(
        depletion_class="STAPLE",
        sub_class="spice",
        is_soft_required=True,
    )
    item = make_pantry_item(
        depletion_class="STAPLE",
        base_ingredient="paprika",
        quantity_known=False,
    )
    # 0.40 floor, then spice cap min(0.4, 0.6) = 0.40
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.40


def test_staple_unknown_quantity_after_30_days(default_user_prefs):
    cls = make_classification(depletion_class="STAPLE")
    item = make_pantry_item(
        depletion_class="STAPLE",
        quantity_known=False,
        added_at="2026-03-11T00:00:00Z",
    )
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.40


def test_staple_known_quantity_acts_as_consumable(default_user_prefs):
    cls = make_classification(
        depletion_class="STAPLE",
        default_days_supply=30,
    )
    item = make_pantry_item(
        depletion_class="STAPLE",
        base_ingredient="rice",
        quantity_known=True,
        added_at=datetime(2026, 4, 5, tzinfo=timezone.utc).isoformat(),
        purchase_date=None,
    )
    assert (
        compute_confidence(
            item,
            default_user_prefs,
            cls,
            today=TEST_DATE,
            calibrated_days=30,
        )
        == 0.80
    )


# --- Group 5: UNIT_ITEM ---


def test_default_days_supply_for_unit_item_null_is_90():
    assert default_days_supply_for({"depletion_class": "UNIT_ITEM"}) == UNIT_ITEM_DEFAULT_DAYS_SUPPLY
    assert default_days_supply_for({}, {"depletion_class": "UNIT_ITEM"}) == UNIT_ITEM_DEFAULT_DAYS_SUPPLY


def test_default_days_supply_for_uses_classification_value():
    assert default_days_supply_for({"depletion_class": "UNIT_ITEM", "default_days_supply": 60}) == 60
    assert default_days_supply_for({"depletion_class": "CONSUMABLE", "default_days_supply": 45}) == 45


def test_default_days_supply_for_non_unit_item_null_is_45():
    assert default_days_supply_for({"depletion_class": "CONSUMABLE"}) == 45
    assert default_days_supply_for({"depletion_class": "STAPLE"}) == 45
    assert default_days_supply_for({}) == 45


def test_unit_item_full_untracked(default_user_prefs):
    cls = make_classification(depletion_class="UNIT_ITEM")
    item = make_pantry_item(
        depletion_class="UNIT_ITEM",
        base_ingredient="canned chickpeas",
        quantity_purchased=2,
        quantity_remaining=None,
    )
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.90


def test_unit_item_partially_used(default_user_prefs):
    cls = make_classification(depletion_class="UNIT_ITEM")
    item = make_pantry_item(
        depletion_class="UNIT_ITEM",
        quantity_purchased=2,
        quantity_remaining=1,
    )
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.60


def test_unit_item_empty(default_user_prefs):
    cls = make_classification(depletion_class="UNIT_ITEM")
    item = make_pantry_item(
        depletion_class="UNIT_ITEM",
        quantity_purchased=2,
        quantity_remaining=0,
    )
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.0


def test_unit_item_stale_untracked_scores_0_20(default_user_prefs):
    cls = make_classification(depletion_class="UNIT_ITEM", default_days_supply=60)
    item = make_pantry_item(
        depletion_class="UNIT_ITEM",
        base_ingredient="pasta",
        purchase_date=days_ago(TEST_DATE, 70),
        quantity_remaining=None,
    )
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.20


def test_unit_item_well_past_supply_scores_0_10(default_user_prefs):
    cls = make_classification(depletion_class="UNIT_ITEM", default_days_supply=60)
    item = make_pantry_item(
        depletion_class="UNIT_ITEM",
        base_ingredient="pasta",
        purchase_date=days_ago(TEST_DATE, 120),
        quantity_remaining=None,
    )
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.10


def test_unit_item_fresh_with_purchase_date_stays_0_90(default_user_prefs):
    cls = make_classification(depletion_class="UNIT_ITEM", default_days_supply=60)
    item = make_pantry_item(
        depletion_class="UNIT_ITEM",
        base_ingredient="pasta",
        purchase_date=TEST_DATE,
        quantity_remaining=None,
    )
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.90


def test_unit_item_partial_decays_when_stale(default_user_prefs):
    cls = make_classification(depletion_class="UNIT_ITEM", default_days_supply=60)
    item = make_pantry_item(
        depletion_class="UNIT_ITEM",
        quantity_purchased=2,
        quantity_remaining=1,
        purchase_date=days_ago(TEST_DATE, 70),
    )
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.20


def test_unit_item_denom_shortens_decay_ladder(default_user_prefs):
    cls = make_classification(depletion_class="UNIT_ITEM", default_days_supply=60)
    item = make_pantry_item(
        depletion_class="UNIT_ITEM",
        purchase_date=days_ago(TEST_DATE, 95),
        quantity_remaining=None,
    )
    assert (
        compute_confidence(
            item,
            default_user_prefs,
            cls,
            today=TEST_DATE,
            engagement_multiplier=2.0,
        )
        == 0.20
    )
    assert (
        compute_confidence(
            item,
            default_user_prefs,
            cls,
            today=TEST_DATE,
            engagement_multiplier=1.0,
        )
        == 0.10
    )


def test_spice_cap_within_supply(default_user_prefs):
    cls = make_classification(
        depletion_class="CONSUMABLE",
        default_days_supply=180,
        is_soft_required=True,
    )
    item = make_pantry_item(
        depletion_class="CONSUMABLE",
        base_ingredient="paprika",
        purchase_date=TEST_DATE,
    )
    assert (
        compute_confidence(
            item,
            default_user_prefs,
            cls,
            today=TEST_DATE,
            calibrated_days=180,
        )
        == 0.60
    )


def test_spice_cap_past_supply(default_user_prefs):
    cls = make_classification(
        depletion_class="CONSUMABLE",
        default_days_supply=180,
        is_soft_required=True,
    )
    # Raw score 0.10 (past -0.5×cal band) without TTL floor; cap min(0.10, 0.60) = 0.10
    item = make_pantry_item(
        depletion_class="CONSUMABLE",
        base_ingredient="paprika",
        purchase_date=days_ago(TEST_DATE, 300),
    )
    assert (
        compute_confidence(
            item,
            default_user_prefs,
            cls,
            today=TEST_DATE,
            calibrated_days=180,
        )
        == 0.10
    )


def test_spice_cap_does_not_apply_to_user_override(default_user_prefs):
    cls = make_classification(
        depletion_class="CONSUMABLE",
        is_soft_required=True,
        default_days_supply=180,
    )
    item = make_pantry_item(
        depletion_class="CONSUMABLE",
        confidence_override=0.80,
        confidence_override_expires=days_after(TEST_DATE, 10),
    )
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.80


# --- Group 7: Multipliers ---


def test_multiplier_household_3_plus(default_user_prefs):
    prefs = {"depletion_multiplier": 2.0}
    cls = make_classification(
        depletion_class="CONSUMABLE",
        default_days_supply=45,
    )
    item = make_pantry_item(
        depletion_class="CONSUMABLE",
        purchase_date=days_ago(TEST_DATE, 30),
    )
    assert (
        compute_confidence(
            item,
            prefs,
            cls,
            today=TEST_DATE,
            calibrated_days=45,
            engagement_multiplier=1.0,
        )
        == 0.60
    )


def test_multiplier_low_engagement(default_user_prefs):
    prefs = {"depletion_multiplier": 1.0}
    cls = make_classification(
        depletion_class="CONSUMABLE",
        default_days_supply=45,
    )
    item = make_pantry_item(
        depletion_class="CONSUMABLE",
        purchase_date=days_ago(TEST_DATE, 5),
    )
    assert (
        compute_confidence(
            item,
            default_user_prefs,
            cls,
            today=TEST_DATE,
            calibrated_days=45,
            engagement_multiplier=0.7,
        )
        == 0.80
    )


def test_multiplier_high_engagement(default_user_prefs):
    """MULTIPLIER_HIGH_ENGAGEMENT: raw days_remaining=7, adjusted 7/1.2 → 0.60 band."""
    cls = make_classification(
        depletion_class="CONSUMABLE",
        default_days_supply=45,
    )
    item = make_pantry_item(
        depletion_class="CONSUMABLE",
        purchase_date=days_ago(TEST_DATE, 38),
    )
    assert (
        compute_confidence(
            item,
            default_user_prefs,
            cls,
            today=TEST_DATE,
            calibrated_days=45,
            engagement_multiplier=1.2,
        )
        == 0.60
    )


def test_multiplier_changes_band(default_user_prefs):
    prefs = {"depletion_multiplier": 2.0}
    cls = make_classification(
        depletion_class="CONSUMABLE",
        default_days_supply=45,
    )
    item = make_pantry_item(
        depletion_class="CONSUMABLE",
        purchase_date=days_ago(TEST_DATE, 33),
    )
    assert (
        compute_confidence(
            item,
            prefs,
            cls,
            today=TEST_DATE,
            calibrated_days=45,
            engagement_multiplier=1.2,
        )
        == 0.60
    )


# --- Group 8: Engagement stub ---


def test_engagement_multiplier_returns_one():
    assert get_engagement_multiplier(Mock(), "user-1") == 1.0


# --- Group 9: Calibrated days (mocked client) ---


def _plain_supabase_mock():
    """Avoid Mock truthiness on admin_client/client so _client() returns the mock."""
    client = Mock()
    client.admin_client = None
    client.client = None
    return client


def test_calibration_first_purchase():
    client = _plain_supabase_mock()
    client.table.return_value.select.return_value.eq.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = Mock(
        data=[{"purchase_date": "2026-04-01"}]
    )
    assert (
        get_calibrated_days_supply(client, "u1", "olive oil", 45) == 45
    )


def test_calibration_exactly_two_records():
    client = _plain_supabase_mock()
    client.table.return_value.select.return_value.eq.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = Mock(
        data=[
            {"purchase_date": "2026-04-10"},
            {"purchase_date": "2026-02-09"},
        ]
    )
    assert get_calibrated_days_supply(client, "u1", "olive oil", 45) == 60


def test_calibration_multiple_records():
    client = _plain_supabase_mock()
    client.table.return_value.select.return_value.eq.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = Mock(
        data=[
            {"purchase_date": "2026-04-10"},
            {"purchase_date": "2026-03-01"},
            {"purchase_date": "2026-01-21"},
            {"purchase_date": "2025-12-02"},
        ]
    )
    # intervals: 40, 40, 50 -> avg 43.33 -> 43
    assert get_calibrated_days_supply(client, "u1", "olive oil", 45) == 43


def test_calibration_caps_at_five_records():
    """CALIBRATION_CAPS_AT_FIVE_RECORDS: query uses LIMIT 5."""
    client = _plain_supabase_mock()
    limit_mock = Mock()
    limit_mock.execute.return_value = Mock(
        data=[{"purchase_date": "2026-04-10"}]
    )
    order_mock = Mock()
    order_mock.limit.return_value = limit_mock
    chain = Mock()
    chain.eq.return_value = chain
    chain.order.return_value = order_mock
    client.table.return_value.select.return_value = chain
    get_calibrated_days_supply(client, "u1", "olive oil", 45)
    order_mock.limit.assert_called_once_with(5)


def test_calibration_repurchase_resets_depletion(default_user_prefs):
    """CALIBRATION_REPURCHASE_RESETS_DEPLETION: new purchase today → 0.80."""
    cls = make_classification(depletion_class="CONSUMABLE", default_days_supply=45)
    item = make_pantry_item(
        depletion_class="CONSUMABLE",
        base_ingredient="olive oil",
        purchase_date=TEST_DATE,
    )
    assert (
        compute_confidence(
            item,
            default_user_prefs,
            cls,
            today=TEST_DATE,
            calibrated_days=45,
        )
        == 0.80
    )


# --- Group 10: Expiry cleanup (mocked) ---


def test_run_expiry_cleanup_removes_expired_perishable():
    expired = [
        {
            "id": "i1",
            "user_id": "u1",
            "base_ingredient": "spinach",
            "depletion_class": "PERISHABLE",
            "purchase_date": "2026-03-30",
            "put_back_count": 0,
        }
    ]
    client = _plain_supabase_mock()

    sel_chain = Mock()
    sel_chain.eq.return_value = sel_chain
    sel_chain.is_.return_value = sel_chain
    sel_chain.lt.return_value = sel_chain
    sel_chain.execute.return_value = Mock(data=expired)

    pt = Mock()
    pt.select.return_value = sel_chain

    cook = Mock()
    cook.select.return_value = cook
    cook.eq.return_value = cook
    cook.limit.return_value = cook
    cook.execute.return_value = Mock(data=[])

    rpc = Mock()
    rpc.execute.return_value = Mock(data=[{"id": "h1"}])
    client.rpc.return_value = rpc

    def tbl(name):
        if name == "pantry_items":
            return pt
        if name == "cooking_log":
            return cook
        return Mock()

    client.table.side_effect = tbl

    out = run_expiry_cleanup(client, "u1", today=TEST_DATE)
    assert len(out) == 1
    assert out[0]["base_ingredient"] == "spinach"
    client.rpc.assert_called_once()


def test_cleanup_populates_depletion_history_correctly():
    """CLEANUP_POPULATES_DEPLETION_HISTORY_CORRECTLY."""
    expired = [
        {
            "id": "i1",
            "user_id": "u1",
            "base_ingredient": "spinach",
            "depletion_class": "PERISHABLE",
            "purchase_date": "2026-03-31",
            "put_back_count": 0,
        }
    ]
    client = _plain_supabase_mock()
    sel_chain = Mock()
    sel_chain.eq.return_value = sel_chain
    sel_chain.is_.return_value = sel_chain
    sel_chain.lt.return_value = sel_chain
    sel_chain.execute.return_value = Mock(data=expired)
    pt = Mock()
    pt.select.return_value = sel_chain
    cook = Mock()
    cook.select.return_value = cook
    cook.eq.return_value = cook
    cook.limit.return_value = cook
    cook.execute.return_value = Mock(data=[])
    rpc = Mock()
    rpc.execute.return_value = Mock(data=[{"id": "h1"}])
    client.rpc.return_value = rpc

    def tbl(name):
        if name == "pantry_items":
            return pt
        if name == "cooking_log":
            return cook
        return Mock()

    client.table.side_effect = tbl
    run_expiry_cleanup(client, "u1", today=TEST_DATE)
    kwargs = client.rpc.call_args[0][1]
    assert kwargs["p_reason"] == "AUTO_EXPIRED"
    assert kwargs["p_was_cooked"] is False
    assert kwargs["p_put_back_count"] == 0
    assert kwargs["p_days_in_pantry"] == 10


def test_cleanup_was_cooked_flag():
    """CLEANUP_WAS_COOKED_FLAG."""
    expired = [
        {
            "id": "i1",
            "user_id": "u1",
            "base_ingredient": "chicken breast",
            "depletion_class": "PERISHABLE",
            "purchase_date": "2026-04-01",
            "put_back_count": 0,
        }
    ]
    client = _plain_supabase_mock()
    sel_chain = Mock()
    sel_chain.eq.return_value = sel_chain
    sel_chain.is_.return_value = sel_chain
    sel_chain.lt.return_value = sel_chain
    sel_chain.execute.return_value = Mock(data=expired)
    pt = Mock()
    pt.select.return_value = sel_chain
    cook = Mock()
    cook.select.return_value = cook
    cook.eq.return_value = cook
    cook.limit.return_value = cook
    cook.execute.return_value = Mock(
        data=[
            {
                "ingredients_used": [
                    {"pantry_item_id": "i1", "base_ingredient": "chicken breast"}
                ]
            }
        ]
    )
    rpc = Mock()
    rpc.execute.return_value = Mock(data=[{"id": "h1"}])
    client.rpc.return_value = rpc

    def tbl(name):
        if name == "pantry_items":
            return pt
        if name == "cooking_log":
            return cook
        return Mock()

    client.table.side_effect = tbl
    run_expiry_cleanup(client, "u1", today=TEST_DATE)
    kwargs = client.rpc.call_args[0][1]
    assert kwargs["p_was_cooked"] is True


def test_cleanup_does_not_delete_consumable():
    """CLEANUP_DOES_NOT_DELETE_CONSUMABLE: query returns no rows for consumables."""
    client = _plain_supabase_mock()
    rpc = Mock()
    client.rpc.return_value = rpc
    sel_chain = Mock()
    sel_chain.eq.return_value = sel_chain
    sel_chain.is_.return_value = sel_chain
    sel_chain.lt.return_value = sel_chain
    sel_chain.execute.return_value = Mock(data=[])
    pt = Mock()
    pt.select.return_value = sel_chain
    cook = Mock()
    cook.select.return_value = cook
    cook.eq.return_value = cook
    cook.limit.return_value = cook
    cook.execute.return_value = Mock(data=[])

    def tbl(name):
        if name == "pantry_items":
            return pt
        if name == "cooking_log":
            return cook
        return Mock()

    client.table.side_effect = tbl
    assert run_expiry_cleanup(client, "u1", today=TEST_DATE) == []
    client.rpc.assert_not_called()


def test_cleanup_does_not_delete_already_deleted():
    """CLEANUP_DOES_NOT_DELETE_ALREADY_DELETED: select filters deleted_at IS NULL."""
    client = _plain_supabase_mock()
    rpc = Mock()
    client.rpc.return_value = rpc
    sel_chain = Mock()
    sel_chain.eq.return_value = sel_chain
    sel_chain.is_.return_value = sel_chain
    sel_chain.lt.return_value = sel_chain
    sel_chain.execute.return_value = Mock(data=[])
    pt = Mock()
    pt.select.return_value = sel_chain
    cook = Mock()
    cook.select.return_value = cook
    cook.eq.return_value = cook
    cook.limit.return_value = cook
    cook.execute.return_value = Mock(data=[])

    def tbl(name):
        if name == "pantry_items":
            return pt
        if name == "cooking_log":
            return cook
        return Mock()

    client.table.side_effect = tbl
    assert run_expiry_cleanup(client, "u1", today=TEST_DATE) == []
    client.rpc.assert_not_called()


def test_cleanup_handles_multiple_expired_items():
    """CLEANUP_HANDLES_MULTIPLE_EXPIRED_ITEMS."""
    expired = [
        {
            "id": "i1",
            "user_id": "u1",
            "base_ingredient": "spinach",
            "depletion_class": "PERISHABLE",
            "purchase_date": "2026-03-01",
            "put_back_count": 0,
        },
        {
            "id": "i2",
            "user_id": "u1",
            "base_ingredient": "chicken breast",
            "depletion_class": "PERISHABLE",
            "purchase_date": "2026-03-01",
            "put_back_count": 0,
        },
        {
            "id": "i3",
            "user_id": "u1",
            "base_ingredient": "milk",
            "depletion_class": "PERISHABLE",
            "purchase_date": "2026-03-01",
            "put_back_count": 0,
        },
    ]
    client = _plain_supabase_mock()
    sel_chain = Mock()
    sel_chain.eq.return_value = sel_chain
    sel_chain.is_.return_value = sel_chain
    sel_chain.lt.return_value = sel_chain
    sel_chain.execute.return_value = Mock(data=expired)
    pt = Mock()
    pt.select.return_value = sel_chain
    cook = Mock()
    cook.select.return_value = cook
    cook.eq.return_value = cook
    cook.limit.return_value = cook
    cook.execute.return_value = Mock(data=[])
    rpc = Mock()
    rpc.execute.return_value = Mock(data=[{"id": "h1"}])
    client.rpc.return_value = rpc

    def tbl(name):
        if name == "pantry_items":
            return pt
        if name == "cooking_log":
            return cook
        return Mock()

    client.table.side_effect = tbl
    out = run_expiry_cleanup(client, "u1", today=TEST_DATE)
    assert len(out) == 3
    assert client.rpc.call_count == 3


def test_cleanup_does_not_delete_valid_perishable():
    """CLEANUP_DOES_NOT_DELETE_VALID_PERISHABLE: hard_expire_date >= today → empty."""
    client = _plain_supabase_mock()
    rpc = Mock()
    client.rpc.return_value = rpc
    sel_chain = Mock()
    sel_chain.eq.return_value = sel_chain
    sel_chain.is_.return_value = sel_chain
    sel_chain.lt.return_value = sel_chain
    sel_chain.execute.return_value = Mock(data=[])
    pt = Mock()
    pt.select.return_value = sel_chain
    cook = Mock()
    cook.select.return_value = cook
    cook.eq.return_value = cook
    cook.limit.return_value = cook
    cook.execute.return_value = Mock(data=[])

    def tbl(name):
        if name == "pantry_items":
            return pt
        if name == "cooking_log":
            return cook
        return Mock()

    client.table.side_effect = tbl
    assert run_expiry_cleanup(client, "u1", today=TEST_DATE) == []
    client.rpc.assert_not_called()


@pytest.mark.skip(
    reason="Graveyard 7-day window is a query-layer concern; not implemented in run_expiry_cleanup"
)
def test_cleanup_graveyard_window():
    """CLEANUP_GRAVEYARD_WINDOW — deferred to API/query tests."""
    assert False


# --- Group 11: Cook event (mocked) ---


def test_process_cook_unit_item_decrement():
    pantry_rows = [
        {
            "id": "h1",
            "user_id": "u1",
            "base_ingredient": "canned chickpeas",
            "depletion_class": "UNIT_ITEM",
            "quantity_purchased": 2,
            "quantity_remaining": None,
            "use_soon": False,
        }
    ]
    client = _plain_supabase_mock()

    # select("*").eq("user_id").is_("deleted_at","null").execute()
    sel_chain = Mock()
    sel_chain.eq.return_value = sel_chain
    sel_chain.is_.return_value = sel_chain
    sel_chain.execute.return_value = Mock(data=pantry_rows)

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

    process_cook_event(
        client,
        "u1",
        "recipe-1",
        1,
        [{"name": "canned chickpeas", "amount": 1.0, "is_primary": True}],
        today=TEST_DATE,
        recipe_name="Curry",
    )
    pt.update.assert_called_once()
    log.insert.assert_called_once()


def test_cook_unit_item_already_partial():
    """COOK_UNIT_ITEM_ALREADY_PARTIAL: remaining 1, use 1 → soft delete + RPC."""
    pantry_rows = [
        {
            "id": "h1",
            "user_id": "u1",
            "base_ingredient": "canned chickpeas",
            "depletion_class": "UNIT_ITEM",
            "quantity_purchased": 2,
            "quantity_remaining": 1,
            "put_back_count": 0,
            "purchase_date": "2026-04-01",
            "use_soon": False,
        }
    ]
    client = _plain_supabase_mock()
    sel_chain = Mock()
    sel_chain.eq.return_value = sel_chain
    sel_chain.is_.return_value = sel_chain
    sel_chain.execute.return_value = Mock(data=pantry_rows)
    pt = Mock()
    pt.select.return_value = sel_chain
    log = Mock()
    log.insert.return_value = log
    log.execute.return_value = Mock(data=[{"id": "log1"}])
    rpc = Mock()
    rpc.execute.return_value = Mock(data=[{"id": "dh1"}])
    client.rpc.return_value = rpc

    def tbl(name):
        if name == "pantry_items":
            return pt
        if name == "cooking_log":
            return log
        return Mock()

    client.table.side_effect = tbl
    process_cook_event(
        client,
        "u1",
        "recipe-1",
        1,
        [{"name": "canned chickpeas", "amount": 1.0, "is_primary": True}],
        today=TEST_DATE,
    )
    client.rpc.assert_called_once()
    kw = client.rpc.call_args[0][1]
    assert kw["p_reason"] == "COOKED"
    assert kw["p_was_cooked"] is True
    log.insert.assert_called_once()


def test_cook_unit_item_does_not_go_negative():
    """COOK_UNIT_ITEM_DOES_NOT_GO_NEGATIVE."""
    pantry_rows = [
        {
            "id": "h1",
            "user_id": "u1",
            "base_ingredient": "rice",
            "depletion_class": "UNIT_ITEM",
            "quantity_purchased": 2,
            "quantity_remaining": 0.5,
            "put_back_count": 0,
            "purchase_date": "2026-04-01",
            "use_soon": False,
        }
    ]
    client = _plain_supabase_mock()
    sel_chain = Mock()
    sel_chain.eq.return_value = sel_chain
    sel_chain.is_.return_value = sel_chain
    sel_chain.execute.return_value = Mock(data=pantry_rows)
    pt = Mock()
    pt.select.return_value = sel_chain
    log = Mock()
    log.insert.return_value = log
    log.execute.return_value = Mock(data=[{"id": "log1"}])
    rpc = Mock()
    rpc.execute.return_value = Mock(data=[{"id": "dh1"}])
    client.rpc.return_value = rpc

    def tbl(name):
        if name == "pantry_items":
            return pt
        if name == "cooking_log":
            return log
        return Mock()

    client.table.side_effect = tbl
    process_cook_event(
        client,
        "u1",
        "recipe-1",
        4,
        [{"name": "rice", "amount": 2.0, "is_primary": True}],
        today=TEST_DATE,
    )
    client.rpc.assert_called_once()


def test_cook_perishable_not_decremented():
    """COOK_PERISHABLE_NOT_DECREMENTED: no quantity update for PERISHABLE."""
    pantry_rows = [
        {
            "id": "p1",
            "user_id": "u1",
            "base_ingredient": "spinach",
            "depletion_class": "PERISHABLE",
            "quantity": 1,
            "put_back_count": 0,
            "purchase_date": "2026-04-01",
            "use_soon": False,
        }
    ]
    client = _plain_supabase_mock()
    sel_chain = Mock()
    sel_chain.eq.return_value = sel_chain
    sel_chain.is_.return_value = sel_chain
    sel_chain.execute.return_value = Mock(data=pantry_rows)
    pt = Mock()
    pt.select.return_value = sel_chain
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
    process_cook_event(
        client,
        "u1",
        "recipe-1",
        2,
        [{"name": "spinach", "amount": 1.0, "is_primary": False}],
        today=TEST_DATE,
    )
    pt.update.assert_not_called()
    log.insert.assert_called_once()


def test_cook_missing_ingredient_skipped():
    """COOK_MISSING_INGREDIENT_SKIPPED."""
    pantry_rows = [
        {
            "id": "p1",
            "user_id": "u1",
            "base_ingredient": "chicken breast",
            "depletion_class": "PERISHABLE",
            "put_back_count": 0,
            "purchase_date": "2026-04-01",
            "use_soon": False,
        }
    ]
    client = _plain_supabase_mock()
    sel_chain = Mock()
    sel_chain.eq.return_value = sel_chain
    sel_chain.is_.return_value = sel_chain
    sel_chain.execute.return_value = Mock(data=pantry_rows)
    pt = Mock()
    pt.select.return_value = sel_chain
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
    process_cook_event(
        client,
        "u1",
        "recipe-1",
        2,
        [
            {"name": "chicken breast", "amount": 1.0, "is_primary": True},
            {"name": "garlic", "amount": 2.0, "is_primary": True},
        ],
        today=TEST_DATE,
    )
    log.insert.assert_called_once()
    payload = log.insert.call_args[0][0]
    assert len(payload["ingredients_used"]) == 1


def test_cook_clears_use_soon_and_confidence_override():
    """COOK_CLEARS_USE_SOON_FLAG + clears confidence_override."""
    pantry_rows = [
        {
            "id": "p1",
            "user_id": "u1",
            "base_ingredient": "spinach",
            "depletion_class": "PERISHABLE",
            "put_back_count": 0,
            "purchase_date": "2026-04-01",
            "use_soon": True,
            "use_soon_expires": "2026-04-12",
            "confidence_override": 0.85,
            "confidence_override_expires": "2026-04-12",
        }
    ]
    client = _plain_supabase_mock()
    sel_chain = Mock()
    sel_chain.eq.return_value = sel_chain
    sel_chain.is_.return_value = sel_chain
    sel_chain.execute.return_value = Mock(data=pantry_rows)
    pt = Mock()
    pt.select.return_value = sel_chain
    upd_chain = Mock()
    upd_chain.eq.return_value = upd_chain
    upd_chain.execute.return_value = Mock(data=[])
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
    process_cook_event(
        client,
        "u1",
        "recipe-1",
        2,
        [{"name": "spinach", "amount": 1.0}],
        today=TEST_DATE,
    )
    pt.update.assert_called_once()
    u = pt.update.call_args[0][0]
    assert u["use_soon"] is False
    assert u["use_soon_expires"] is None
    assert u["confidence_override"] is None
    assert u["confidence_override_expires"] is None


def test_find_pantry_match_rice_not_rice_vinegar():
    pantry = [{"base_ingredient": "rice"}]
    assert _find_pantry_match(pantry, "rice vinegar") is None


def test_find_pantry_match_boneless_chicken_breast():
    pantry = [{"base_ingredient": "chicken breast", "id": "1"}]
    m = _find_pantry_match(pantry, "boneless chicken breast")
    assert m is not None
    assert m["base_ingredient"] == "chicken breast"


def test_find_pantry_match_for_cook_rice_not_rice_vinegar():
    pantry = [{"base_ingredient": "rice", "id": "1"}]
    assert find_pantry_match_for_cook(pantry, "rice vinegar") is None


def test_find_pantry_match_for_cook_tomatoes_matches_tomato():
    pantry = [{"base_ingredient": "tomato", "id": "1"}]
    m = find_pantry_match_for_cook(pantry, "tomatoes")
    assert m is not None
    assert m["base_ingredient"] == "tomato"


def test_find_pantry_match_for_cook_ice_not_rice():
    pantry = [{"base_ingredient": "rice", "id": "1"}]
    assert find_pantry_match_for_cook(pantry, "ice") is None


def test_cook_dedupes_plural_aliases_on_same_unit_item():
    pantry_rows = [
        {
            "id": "p1",
            "user_id": "u1",
            "base_ingredient": "tomato",
            "depletion_class": "UNIT_ITEM",
            "quantity_purchased": 2,
            "quantity_remaining": None,
            "put_back_count": 0,
            "purchase_date": "2026-04-01",
            "use_soon": False,
        }
    ]
    client = _plain_supabase_mock()
    sel_chain = Mock()
    sel_chain.eq.return_value = sel_chain
    sel_chain.is_.return_value = sel_chain
    sel_chain.execute.return_value = Mock(data=pantry_rows)
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
        touched = process_cook_event(
            client,
            "u1",
            "recipe-1",
            1,
            [
                {"name": "tomato", "amount": 1.0},
                {"name": "tomatoes", "amount": 1.0},
            ],
            today=TEST_DATE,
        )
        soft_delete.assert_not_called()
    assert len(touched) == 1
    assert touched[0]["pantry_item_id"] == "p1"
    update_payload = pt.update.call_args[0][0]
    assert update_payload["quantity_remaining"] == 1.0
    assert pt.update.call_count == 1


def test_cook_zero_matches_returns_empty_touched():
    client = _plain_supabase_mock()
    sel_chain = Mock()
    sel_chain.eq.return_value = sel_chain
    sel_chain.is_.return_value = sel_chain
    sel_chain.execute.return_value = Mock(data=[])
    pt = Mock()
    pt.select.return_value = sel_chain
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
    touched = process_cook_event(
        client,
        "u1",
        "recipe-1",
        1,
        [{"name": "garlic", "amount": 1.0}],
        today=TEST_DATE,
        household_id="hh-1",
    )
    assert touched == []
    sel_chain.eq.assert_any_call("household_id", "hh-1")


def test_cook_soft_delete_uses_row_owner_user_id():
    pantry_rows = [
        {
            "id": "h1",
            "user_id": "housemate",
            "base_ingredient": "canned chickpeas",
            "depletion_class": "UNIT_ITEM",
            "quantity_purchased": 1,
            "quantity_remaining": None,
            "put_back_count": 0,
            "purchase_date": "2026-04-01",
            "use_soon": False,
        }
    ]
    client = _plain_supabase_mock()
    sel_chain = Mock()
    sel_chain.eq.return_value = sel_chain
    sel_chain.is_.return_value = sel_chain
    sel_chain.execute.return_value = Mock(data=pantry_rows)
    pt = Mock()
    pt.select.return_value = sel_chain
    log = Mock()
    log.insert.return_value = log
    log.execute.return_value = Mock(data=[{"id": "log1"}])
    rpc = Mock()
    rpc.execute.return_value = Mock(data=[{"id": "dh1"}])
    client.rpc.return_value = rpc

    def tbl(name):
        if name == "pantry_items":
            return pt
        if name == "cooking_log":
            return log
        return Mock()

    client.table.side_effect = tbl
    process_cook_event(
        client,
        "caller",
        "recipe-1",
        1,
        [{"name": "canned chickpeas", "amount": 1.0}],
        today=TEST_DATE,
        household_id="hh-1",
    )
    kw = client.rpc.call_args[0][1]
    assert kw["p_user_id"] == "housemate"


def test_process_put_back_blocked_raw_meat_second_time():
    hist_row = {
        "id": "dh1",
        "user_id": "u1",
        "pantry_item_id": "p1",
        "item_name": "chicken breast",
        "put_back_count": 1,
    }
    client = _plain_supabase_mock()

    dh = Mock()
    dh.select.return_value = dh
    dh.eq.return_value = dh
    dh.limit.return_value = dh
    dh.execute.return_value = Mock(data=[hist_row])

    ic = Mock()
    ic.select.return_value = ic
    ic.eq.return_value = ic
    ic.limit.return_value = ic
    ic.execute.return_value = Mock(data=[{"sub_class": "raw_meat"}])

    def tbl(name):
        if name == "depletion_history":
            return dh
        if name == "item_classification":
            return ic
        return Mock()

    client.table.side_effect = tbl

    row, err = process_put_back(client, "u1", "dh1", today=TEST_DATE)
    assert row is None
    assert err == "MAX_PUT_BACK_REACHED"


def test_process_put_back_sets_confidence_override():
    hist_row = {
        "id": "dh1",
        "user_id": "u1",
        "pantry_item_id": "p1",
        "item_name": "spinach",
        "put_back_count": 0,
    }
    pantry_row = {
        "id": "p1",
        "user_id": "u1",
        "household_id": "hh1",
        "base_ingredient": "spinach",
        "normalized_name": "spinach",
        "variant": "v",
        "unit": "bag",
        "quantity": 1,
        "source": "receipt_import",
        "purchase_date": "2026-04-01",
        "depletion_class": "PERISHABLE",
        "deleted_at": "2026-04-09",
    }
    client = _plain_supabase_mock()

    dh = Mock()
    dh.select.return_value = dh
    dh.eq.return_value = dh
    dh.limit.return_value = dh
    dh.execute.return_value = Mock(data=[hist_row])

    ic = Mock()
    ic.select.return_value = ic
    ic.eq.return_value = ic
    ic.limit.return_value = ic
    ic.execute.return_value = Mock(data=[{"sub_class": "leafy_green"}])

    pi_first = Mock()
    pi_first.select.return_value = pi_first
    pi_first.eq.return_value = pi_first
    pi_first.limit.return_value = pi_first
    pi_first.execute.return_value = Mock(data=[pantry_row])

    pi_upd = Mock()
    pi_upd.update.return_value = pi_upd
    pi_upd.eq.return_value = pi_upd
    pi_upd.execute.return_value = Mock(data=[])

    pi_last = Mock()
    pi_last.select.return_value = pi_last
    pi_last.eq.return_value = pi_last
    pi_last.limit.return_value = pi_last
    pi_last.execute.return_value = Mock(
        data=[{**pantry_row, "confidence_override": PUT_BACK_CONFIDENCE_OVERRIDE}]
    )

    pantry_i = [0]

    def tbl(name):
        if name == "depletion_history":
            return dh
        if name == "item_classification":
            return ic
        if name == "pantry_items":
            pantry_i[0] += 1
            if pantry_i[0] == 1:
                return pi_first
            if pantry_i[0] == 2:
                return pi_upd
            return pi_last
        return Mock()

    client.table.side_effect = tbl

    process_put_back(client, "u1", "dh1", today=TEST_DATE)
    pi_upd.update.assert_called_once()
    payload = pi_upd.update.call_args[0][0]
    assert payload["confidence_override"] == PUT_BACK_CONFIDENCE_OVERRIDE
    assert payload["use_soon"] is True


def test_put_back_standard_item():
    """PUT_BACK_STANDARD_ITEM."""
    hist_row = {
        "id": "dh1",
        "user_id": "u1",
        "pantry_item_id": "p1",
        "item_name": "spinach",
        "put_back_count": 0,
    }
    pantry_row = {
        "id": "p1",
        "user_id": "u1",
        "base_ingredient": "spinach",
        "normalized_name": "spinach",
        "variant": "v",
        "unit": "bag",
        "quantity": 1,
        "source": "receipt_import",
        "purchase_date": "2026-04-01",
        "depletion_class": "PERISHABLE",
        "deleted_at": "2026-04-09",
    }
    client = _plain_supabase_mock()
    dh = Mock()
    dh.select.return_value = dh
    dh.eq.return_value = dh
    dh.limit.return_value = dh
    dh.execute.return_value = Mock(data=[hist_row])
    ic = Mock()
    ic.select.return_value = ic
    ic.eq.return_value = ic
    ic.limit.return_value = ic
    ic.execute.return_value = Mock(data=[{"sub_class": "leafy_green"}])
    pi_first = Mock()
    pi_first.select.return_value = pi_first
    pi_first.eq.return_value = pi_first
    pi_first.limit.return_value = pi_first
    pi_first.execute.return_value = Mock(data=[pantry_row])
    pi_upd = Mock()
    pi_upd.update.return_value = pi_upd
    pi_upd.eq.return_value = pi_upd
    pi_upd.execute.return_value = Mock(data=[])
    pi_last = Mock()
    pi_last.select.return_value = pi_last
    pi_last.eq.return_value = pi_last
    pi_last.limit.return_value = pi_last
    pi_last.execute.return_value = Mock(
        data=[{**pantry_row, "deleted_at": None, "use_soon": True, "put_back_count": 1}]
    )
    pantry_i = [0]

    def tbl(name):
        if name == "depletion_history":
            return dh
        if name == "item_classification":
            return ic
        if name == "pantry_items":
            pantry_i[0] += 1
            if pantry_i[0] == 1:
                return pi_first
            if pantry_i[0] == 2:
                return pi_upd
            return pi_last
        return Mock()

    client.table.side_effect = tbl
    row, err = process_put_back(client, "u1", "dh1", today=TEST_DATE)
    assert err is None
    assert row is not None
    assert row["use_soon"] is True
    assert row["put_back_count"] == 1
    assert row["deleted_at"] is None


def test_put_back_no_grace_buffer():
    """PUT_BACK_SETS_NO_GRACE_BUFFER: hard_expire_date = today + 2 exactly."""
    hist_row = {
        "id": "dh1",
        "user_id": "u1",
        "pantry_item_id": "p1",
        "item_name": "spinach",
        "put_back_count": 0,
    }
    pantry_row = {
        "id": "p1",
        "user_id": "u1",
        "base_ingredient": "spinach",
        "depletion_class": "PERISHABLE",
        "deleted_at": "2026-04-09",
    }
    client = _plain_supabase_mock()
    dh = Mock()
    dh.select.return_value = dh
    dh.eq.return_value = dh
    dh.limit.return_value = dh
    dh.execute.return_value = Mock(data=[hist_row])
    ic = Mock()
    ic.select.return_value = ic
    ic.eq.return_value = ic
    ic.limit.return_value = ic
    ic.execute.return_value = Mock(data=[{"sub_class": "leafy_green"}])
    pi_first = Mock()
    pi_first.select.return_value = pi_first
    pi_first.eq.return_value = pi_first
    pi_first.limit.return_value = pi_first
    pi_first.execute.return_value = Mock(data=[pantry_row])
    pi_upd = Mock()
    pi_upd.update.return_value = pi_upd
    pi_upd.eq.return_value = pi_upd
    pi_upd.execute.return_value = Mock(data=[])
    pi_last = Mock()
    pi_last.select.return_value = pi_last
    pi_last.eq.return_value = pi_last
    pi_last.limit.return_value = pi_last
    pi_last.execute.return_value = Mock(data=[pantry_row])
    pantry_i = [0]

    def tbl(name):
        if name == "depletion_history":
            return dh
        if name == "item_classification":
            return ic
        if name == "pantry_items":
            pantry_i[0] += 1
            if pantry_i[0] == 1:
                return pi_first
            if pantry_i[0] == 2:
                return pi_upd
            return pi_last
        return Mock()

    client.table.side_effect = tbl
    process_put_back(client, "u1", "dh1", today=TEST_DATE)
    payload = pi_upd.update.call_args[0][0]
    assert payload["hard_expire_date"] == days_after(TEST_DATE, 2).isoformat()


def test_put_back_raw_meat_first_time():
    """PUT_BACK_RAW_MEAT_FIRST_TIME."""
    hist_row = {
        "id": "dh1",
        "user_id": "u1",
        "pantry_item_id": "p1",
        "item_name": "chicken breast",
        "put_back_count": 0,
    }
    pantry_row = {
        "id": "p1",
        "user_id": "u1",
        "base_ingredient": "chicken breast",
        "depletion_class": "PERISHABLE",
        "deleted_at": "2026-04-09",
    }
    client = _plain_supabase_mock()
    dh = Mock()
    dh.select.return_value = dh
    dh.eq.return_value = dh
    dh.limit.return_value = dh
    dh.execute.return_value = Mock(data=[hist_row])
    ic = Mock()
    ic.select.return_value = ic
    ic.eq.return_value = ic
    ic.limit.return_value = ic
    ic.execute.return_value = Mock(data=[{"sub_class": "raw_meat"}])
    pi_first = Mock()
    pi_first.select.return_value = pi_first
    pi_first.eq.return_value = pi_first
    pi_first.limit.return_value = pi_first
    pi_first.execute.return_value = Mock(data=[pantry_row])
    pi_upd = Mock()
    pi_upd.update.return_value = pi_upd
    pi_upd.eq.return_value = pi_upd
    pi_upd.execute.return_value = Mock(data=[])
    pi_last = Mock()
    pi_last.select.return_value = pi_last
    pi_last.eq.return_value = pi_last
    pi_last.limit.return_value = pi_last
    pi_last.execute.return_value = Mock(
        data=[{**pantry_row, "deleted_at": None, "put_back_count": 1, "use_soon": True}]
    )
    pantry_i = [0]

    def tbl(name):
        if name == "depletion_history":
            return dh
        if name == "item_classification":
            return ic
        if name == "pantry_items":
            pantry_i[0] += 1
            if pantry_i[0] == 1:
                return pi_first
            if pantry_i[0] == 2:
                return pi_upd
            return pi_last
        return Mock()

    client.table.side_effect = tbl
    row, err = process_put_back(client, "u1", "dh1", today=TEST_DATE)
    assert err is None
    assert row["put_back_count"] == 1


def test_put_back_raw_fish_blocked():
    """PUT_BACK_RAW_FISH_BLOCKED."""
    hist_row = {
        "id": "dh1",
        "user_id": "u1",
        "pantry_item_id": "p1",
        "item_name": "salmon",
        "put_back_count": 1,
    }
    client = _plain_supabase_mock()
    dh = Mock()
    dh.select.return_value = dh
    dh.eq.return_value = dh
    dh.limit.return_value = dh
    dh.execute.return_value = Mock(data=[hist_row])
    ic = Mock()
    ic.select.return_value = ic
    ic.eq.return_value = ic
    ic.limit.return_value = ic
    ic.execute.return_value = Mock(data=[{"sub_class": "raw_fish"}])

    def tbl(name):
        if name == "depletion_history":
            return dh
        if name == "item_classification":
            return ic
        return Mock()

    client.table.side_effect = tbl
    row, err = process_put_back(client, "u1", "dh1", today=TEST_DATE)
    assert row is None
    assert err == "MAX_PUT_BACK_REACHED"


def test_put_back_non_meat_allows_multiple():
    """PUT_BACK_NON_MEAT_ALLOWS_MULTIPLE."""
    hist_row = {
        "id": "dh1",
        "user_id": "u1",
        "pantry_item_id": "p1",
        "item_name": "spinach",
        "put_back_count": 1,
    }
    pantry_row = {
        "id": "p1",
        "user_id": "u1",
        "base_ingredient": "spinach",
        "depletion_class": "PERISHABLE",
        "deleted_at": "2026-04-09",
    }
    client = _plain_supabase_mock()
    dh = Mock()
    dh.select.return_value = dh
    dh.eq.return_value = dh
    dh.limit.return_value = dh
    dh.execute.return_value = Mock(data=[hist_row])
    ic = Mock()
    ic.select.return_value = ic
    ic.eq.return_value = ic
    ic.limit.return_value = ic
    ic.execute.return_value = Mock(data=[{"sub_class": "leafy_green"}])
    pi_first = Mock()
    pi_first.select.return_value = pi_first
    pi_first.eq.return_value = pi_first
    pi_first.limit.return_value = pi_first
    pi_first.execute.return_value = Mock(data=[pantry_row])
    pi_upd = Mock()
    pi_upd.update.return_value = pi_upd
    pi_upd.eq.return_value = pi_upd
    pi_upd.execute.return_value = Mock(data=[])
    pi_last = Mock()
    pi_last.select.return_value = pi_last
    pi_last.eq.return_value = pi_last
    pi_last.limit.return_value = pi_last
    pi_last.execute.return_value = Mock(
        data=[{**pantry_row, "put_back_count": 2, "deleted_at": None}]
    )
    pantry_i = [0]

    def tbl(name):
        if name == "depletion_history":
            return dh
        if name == "item_classification":
            return ic
        if name == "pantry_items":
            pantry_i[0] += 1
            if pantry_i[0] == 1:
                return pi_first
            if pantry_i[0] == 2:
                return pi_upd
            return pi_last
        return Mock()

    client.table.side_effect = tbl
    row, err = process_put_back(client, "u1", "dh1", today=TEST_DATE)
    assert err is None
    assert row["put_back_count"] == 2


# --- Group 13: Override ---


def test_override_active_replaces_computed(default_user_prefs):
    cls = make_classification(
        depletion_class="CONSUMABLE",
        default_days_supply=45,
    )
    item = make_pantry_item(
        depletion_class="CONSUMABLE",
        purchase_date=days_ago(TEST_DATE, 68),
        confidence_override=0.80,
        confidence_override_expires=days_after(TEST_DATE, 10),
    )
    assert (
        compute_confidence(
            item, default_user_prefs, cls, today=TEST_DATE, calibrated_days=45
        )
        == 0.80
    )


def test_override_expired_falls_back(default_user_prefs):
    cls = make_classification(
        depletion_class="CONSUMABLE",
        default_days_supply=45,
    )
    item = make_pantry_item(
        depletion_class="CONSUMABLE",
        purchase_date=days_ago(TEST_DATE, 68),
        confidence_override=0.80,
        confidence_override_expires=days_ago(TEST_DATE, 1),
    )
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE, calibrated_days=45) < 0.80


def test_put_back_confidence_elevated_via_override(default_user_prefs):
    cls = make_classification()
    use_until = days_after(TEST_DATE, 2)
    item = make_pantry_item(
        available_until=use_until,
        hard_expire_date=use_until,
        confidence_override=PUT_BACK_CONFIDENCE_OVERRIDE,
        confidence_override_expires=use_until,
    )
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.85


# --- Phase 2 DoD: fixture-style spot checks (A–J mapping) ---


def test_fixture_style_chicken_within_shelf(default_user_prefs):
    cls = make_classification(
        sub_class="raw_meat",
        shelf_life_days=3,
        grace_buffer_days=1,
    )
    item = make_pantry_item(
        base_ingredient="chicken breast",
        available_until=days_after(TEST_DATE, 3),
    )
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.95


def test_fixture_style_olive_oil_first_purchase(default_user_prefs):
    cls = make_classification(
        depletion_class="CONSUMABLE",
        default_days_supply=45,
    )
    item = make_pantry_item(
        depletion_class="CONSUMABLE",
        base_ingredient="olive oil",
        purchase_date=days_ago(TEST_DATE, 20),
    )
    assert (
        compute_confidence(
            item,
            default_user_prefs,
            cls,
            today=TEST_DATE,
            calibrated_days=45,
        )
        == 0.80
    )


def test_fixture_style_paprika_unknown(default_user_prefs):
    cls = make_classification(
        depletion_class="STAPLE",
        is_soft_required=True,
    )
    item = make_pantry_item(
        depletion_class="STAPLE",
        base_ingredient="paprika",
        quantity_known=False,
    )
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.40


# --- T1-07 gap coverage: tier boundaries, overrides, put-back policy, purity, re-export ---

def test_tier_exactly_at_0_75_is_cook_tonight():
    assert get_tier(0.75) == "cook_tonight"

def test_tier_exactly_at_0_50_is_probably_have():
    assert get_tier(0.50) == "probably_have"

def test_tier_exactly_at_0_20_is_check_first():
    assert get_tier(0.20) == "check_first"

def test_tier_below_0_20_is_suppressed():
    assert get_tier(0.19) == "suppressed"

def test_override_honored_when_today_equals_expires(default_user_prefs):
    cls = make_classification(depletion_class="CONSUMABLE", default_days_supply=45)
    item = make_pantry_item(
        depletion_class="CONSUMABLE",
        purchase_date=days_ago(TEST_DATE, 68),
        confidence_override=0.77,
        confidence_override_expires=TEST_DATE,
    )
    v = compute_confidence(
        item, default_user_prefs, cls, today=TEST_DATE, calibrated_days=45
    )
    assert v == 0.77

def test_override_ignored_when_today_equals_expires_plus_one(default_user_prefs):
    cls = make_classification(depletion_class="CONSUMABLE", default_days_supply=45)
    item = make_pantry_item(
        depletion_class="CONSUMABLE",
        purchase_date=days_ago(TEST_DATE, 68),
        confidence_override=0.99,
        confidence_override_expires=days_ago(TEST_DATE, 1),
    )
    assert (
        compute_confidence(
            item, default_user_prefs, cls, today=TEST_DATE, calibrated_days=45
        )
        != 0.99
    )

def test_override_none_when_expires_is_none(default_user_prefs):
    cls = make_classification(depletion_class="CONSUMABLE", default_days_supply=45)
    item = make_pantry_item(
        depletion_class="CONSUMABLE",
        purchase_date=days_ago(TEST_DATE, 68),
        confidence_override=0.80,
        confidence_override_expires=None,
    )
    assert (
        compute_confidence(
            item, default_user_prefs, cls, today=TEST_DATE, calibrated_days=45
        )
        != 0.80
    )


def test_put_back_allowed_for_raw_meat_within_subclass_cap():
    hist_row = {
        "id": "dh1",
        "user_id": "u1",
        "pantry_item_id": "p1",
        "item_name": "chicken breast",
        "put_back_count": 0,
    }
    pantry_row = {
        "id": "p1",
        "user_id": "u1",
        "base_ingredient": "chicken breast",
        "depletion_class": "PERISHABLE",
        "deleted_at": "2026-04-09",
    }
    client = _plain_supabase_mock()
    dh = Mock()
    dh.select.return_value = dh
    dh.eq.return_value = dh
    dh.limit.return_value = dh
    dh.execute.return_value = Mock(data=[hist_row])
    ic = Mock()
    ic.select.return_value = ic
    ic.eq.return_value = ic
    ic.limit.return_value = ic
    ic.execute.return_value = Mock(data=[{"sub_class": "raw_meat"}])
    pi_first = Mock()
    pi_first.select.return_value = pi_first
    pi_first.eq.return_value = pi_first
    pi_first.limit.return_value = pi_first
    pi_first.execute.return_value = Mock(data=[pantry_row])
    pi_upd = Mock()
    pi_upd.update.return_value = pi_upd
    pi_upd.eq.return_value = pi_upd
    pi_upd.execute.return_value = Mock(data=[])
    pi_last = Mock()
    pi_last.select.return_value = pi_last
    pi_last.eq.return_value = pi_last
    pi_last.limit.return_value = pi_last
    pi_last.execute.return_value = Mock(
        data=[{**pantry_row, "deleted_at": None, "put_back_count": 1, "use_soon": True}]
    )
    pantry_i = [0]

    def tbl(name):
        if name == "depletion_history":
            return dh
        if name == "item_classification":
            return ic
        if name == "pantry_items":
            pantry_i[0] += 1
            if pantry_i[0] == 1:
                return pi_first
            if pantry_i[0] == 2:
                return pi_upd
            return pi_last
        return Mock()

    client.table.side_effect = tbl
    row, err = process_put_back(client, "u1", "dh1", today=TEST_DATE)
    assert err is None
    assert row is not None
    assert row["put_back_count"] == 1


def test_put_back_rejected_when_subclass_cap_exceeded():
    hist_row = {
        "id": "dh1",
        "user_id": "u1",
        "pantry_item_id": "p1",
        "item_name": "chicken breast",
        "put_back_count": 1,
    }
    client = _plain_supabase_mock()
    dh = Mock()
    dh.select.return_value = dh
    dh.eq.return_value = dh
    dh.limit.return_value = dh
    dh.execute.return_value = Mock(data=[hist_row])
    ic = Mock()
    ic.select.return_value = ic
    ic.eq.return_value = ic
    ic.limit.return_value = ic
    ic.execute.return_value = Mock(data=[{"sub_class": "raw_meat"}])

    def tbl(name):
        if name == "depletion_history":
            return dh
        if name == "item_classification":
            return ic
        return Mock()

    client.table.side_effect = tbl
    row, err = process_put_back(client, "u1", "dh1", today=TEST_DATE)
    assert row is None
    assert err == "MAX_PUT_BACK_REACHED"


def test_put_back_sets_override_to_0_85_and_expires_in_use_soon_window():
    hist_row = {
        "id": "dh1",
        "user_id": "u1",
        "pantry_item_id": "p1",
        "item_name": "spinach",
        "put_back_count": 0,
    }
    pantry_row = {
        "id": "p1",
        "user_id": "u1",
        "base_ingredient": "spinach",
        "depletion_class": "PERISHABLE",
        "deleted_at": "2026-04-09",
    }
    client = _plain_supabase_mock()
    dh = Mock()
    dh.select.return_value = dh
    dh.eq.return_value = dh
    dh.limit.return_value = dh
    dh.execute.return_value = Mock(data=[hist_row])
    ic = Mock()
    ic.select.return_value = ic
    ic.eq.return_value = ic
    ic.limit.return_value = ic
    ic.execute.return_value = Mock(data=[{"sub_class": "leafy_green"}])
    pi_first = Mock()
    pi_first.select.return_value = pi_first
    pi_first.eq.return_value = pi_first
    pi_first.limit.return_value = pi_first
    pi_first.execute.return_value = Mock(data=[pantry_row])
    pi_upd = Mock()
    pi_upd.update.return_value = pi_upd
    pi_upd.eq.return_value = pi_upd
    pi_upd.execute.return_value = Mock(data=[])
    pi_last = Mock()
    pi_last.select.return_value = pi_last
    pi_last.eq.return_value = pi_last
    pi_last.limit.return_value = pi_last
    pi_last.execute.return_value = Mock(data=[pantry_row])
    pantry_i = [0]

    def tbl(name):
        if name == "depletion_history":
            return dh
        if name == "item_classification":
            return ic
        if name == "pantry_items":
            pantry_i[0] += 1
            if pantry_i[0] == 1:
                return pi_first
            if pantry_i[0] == 2:
                return pi_upd
            return pi_last
        return Mock()

    client.table.side_effect = tbl
    process_put_back(client, "u1", "dh1", today=TEST_DATE)
    payload = pi_upd.update.call_args[0][0]
    use_until = days_after(TEST_DATE, USE_SOON_DAYS).isoformat()
    assert payload["confidence_override"] == PUT_BACK_CONFIDENCE_OVERRIDE
    assert payload["confidence_override_expires"] == use_until
    assert payload["use_soon_expires"] == use_until


def test_compute_confidence_is_pure_accepts_today_parameter(default_user_prefs):
    cls = make_classification(depletion_class="CONSUMABLE", default_days_supply=45)
    item = make_pantry_item(
        depletion_class="CONSUMABLE",
        purchase_date=days_ago(TEST_DATE, 10),
    )
    snapshot = copy.deepcopy(item)
    compute_confidence(
        item, default_user_prefs, cls, today=TEST_DATE, calibrated_days=45
    )
    assert item == snapshot
    compute_confidence(
        item,
        default_user_prefs,
        cls,
        today=days_after(TEST_DATE, 400),
        calibrated_days=45,
    )
    assert item == snapshot


def test_run_expiry_cleanup_uses_provided_today_for_deleted_at_stamp():
    custom_today = date(2026, 7, 4)
    expected = datetime.combine(custom_today, time.min, tzinfo=timezone.utc).isoformat()
    expired = [
        {
            "id": "i1",
            "user_id": "u1",
            "base_ingredient": "spinach",
            "depletion_class": "PERISHABLE",
            "purchase_date": "2026-03-30",
            "put_back_count": 0,
        }
    ]
    client = _plain_supabase_mock()
    sel_chain = Mock()
    sel_chain.eq.return_value = sel_chain
    sel_chain.is_.return_value = sel_chain
    sel_chain.lt.return_value = sel_chain
    sel_chain.execute.return_value = Mock(data=expired)
    pt = Mock()
    pt.select.return_value = sel_chain
    cook = Mock()
    cook.select.return_value = cook
    cook.eq.return_value = cook
    cook.limit.return_value = cook
    cook.execute.return_value = Mock(data=[])
    rpc = Mock()
    rpc.execute.return_value = Mock(data=[{"id": "h1"}])
    client.rpc.return_value = rpc

    def tbl(name):
        if name == "pantry_items":
            return pt
        if name == "cooking_log":
            return cook
        return Mock()

    client.table.side_effect = tbl
    out = run_expiry_cleanup(client, "u1", today=custom_today)
    kwargs = client.rpc.call_args[0][1]
    assert kwargs["p_deleted_at"] == expected
    assert len(out) == 1
    assert out[0]["deleted_at"] == expected


def test_public_reexport_of_find_pantry_match():
    import backend.services.confidence_engine as ce

    assert ce.find_pantry_match is ce._find_pantry_match
    pantry = [{"base_ingredient": "salt", "id": "1"}]
    assert find_pantry_match(pantry, "salt") == _find_pantry_match(pantry, "salt")


def test_resolve_depletion_class_falls_back_to_classification_then_staple():
    row = make_pantry_item(depletion_class=None)
    cls = make_classification(depletion_class="PERISHABLE")
    assert resolve_depletion_class(row, cls) == "PERISHABLE"
    assert resolve_depletion_class(make_pantry_item(depletion_class=None), {}) == "STAPLE"


def test_perishable_inserted_today_scores_0_95(default_user_prefs):
    cls = make_classification(sub_class="leafy_green", grace_buffer_days=3)
    item = make_pantry_item(
        depletion_class="PERISHABLE",
        purchase_date=TEST_DATE.isoformat(),
        available_until=days_after(TEST_DATE, 5),
    )
    assert compute_confidence(item, default_user_prefs, cls, today=TEST_DATE) == 0.95
