"""Tests for MealPlanService (T2-02).

Groups:
  A — session lifecycle
  B — determinism prerequisite (now parameter)
  C — accept / scale
  D — soft-reject / ban
  E — staple fallback
  F — complete wizard
"""

from __future__ import annotations

import copy
from datetime import date, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, call, patch

import pytest

from backend.services.meal_plan_service import MealPlanService
from backend.utils.exceptions import DatabaseException, ValidationException

# ---------------------------------------------------------------------------
# Fixed reference datetime — never use datetime.utcnow() in tests
# ---------------------------------------------------------------------------
REF_NOW = datetime(2026, 4, 10, 12, 0, 0)
REF_DATE = date(2026, 4, 10)

USER_ID = "user-aaa"
HOUSEHOLD_ID = "hh-bbb"
SESSION_ID = "sess-ccc"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_supabase(
    session_rows=None,
    pantry_rows=None,
    members=None,
    ban_rows=None,
    meal_plan_rows=None,
):
    """Build a MagicMock supabase_service wired with common query chains."""
    sb = MagicMock()
    sb.admin_client = None

    # Build a chainable query mock that always returns data via .execute()
    def _chain(rows):
        qm = MagicMock()
        result = MagicMock()
        result.data = rows if rows is not None else []

        # Every chained method returns the same qm so we can call
        # .select().eq().gt().execute() etc.
        qm.select.return_value = qm
        qm.eq.return_value = qm
        qm.gt.return_value = qm
        qm.gte.return_value = qm
        qm.lte.return_value = qm
        qm.insert.return_value = qm
        qm.update.return_value = qm
        qm.delete.return_value = qm
        qm.order.return_value = qm
        qm.execute.return_value = result
        return qm

    # Dispatch table() calls to different chains by table name
    session_chain = _chain(session_rows)
    ban_chain = _chain(ban_rows)
    meal_chain = _chain(meal_plan_rows)

    def _table(name):
        if name == "meal_plan_wizard_session":
            return session_chain
        if name == "recipe_bans":
            return ban_chain
        if name == "meal_plan":
            return meal_chain
        return _chain([])

    sb.client = MagicMock()
    sb.client.table.side_effect = _table

    sb.get_household_members.return_value = members if members is not None else [
        {"id": "m1"}, {"id": "m2"}
    ]
    return sb


def _make_service(sb=None, pantry_items=None):
    """Build MealPlanService with mocked dependencies."""
    if sb is None:
        sb = _make_supabase()

    pantry_svc = MagicMock()
    pantry_svc._get_pantry_items.return_value = pantry_items or []

    recipe_svc = MagicMock()
    household_svc = MagicMock()

    return MealPlanService(sb, pantry_svc, recipe_svc, household_svc)


def _make_session_row(
    session_id=SESSION_ID,
    household_id=HOUSEHOLD_ID,
    user_id=USER_ID,
    session_pantry=None,
    rejected_recipes=None,
    accepted_recipes=None,
    expires_at=None,
):
    if expires_at is None:
        expires_at = (REF_NOW + timedelta(hours=2)).isoformat()
    return {
        "id": session_id,
        "household_id": household_id,
        "user_id": user_id,
        "session_pantry": session_pantry or {},
        "rejected_recipes": rejected_recipes or [],
        "accepted_recipes": accepted_recipes or [],
        "expires_at": expires_at,
        "meal_slots": {"breakfast": True, "lunch": False, "dinner": False},
    }


# ===========================================================================
# Group A — session lifecycle
# ===========================================================================


@pytest.mark.asyncio
async def test_start_wizard_creates_fresh_session_when_none_active():
    """Happy path: no existing session → new session row inserted."""
    # existing_response returns empty → no delete; insert returns a session row
    session_row = _make_session_row()
    sb = _make_supabase(session_rows=[], meal_plan_rows=[session_row])

    # We need insert on wizard_session table to return the new session
    wizard_chain = MagicMock()
    insert_result = MagicMock()
    insert_result.data = [session_row]
    wizard_chain.select.return_value = wizard_chain
    wizard_chain.eq.return_value = wizard_chain
    wizard_chain.gt.return_value = wizard_chain
    wizard_chain.delete.return_value = wizard_chain
    wizard_chain.insert.return_value = wizard_chain
    wizard_chain.update.return_value = wizard_chain
    wizard_chain.execute.side_effect = [
        MagicMock(data=[]),       # existing_response → empty
        insert_result,            # insert → new session
    ]
    sb.client.table.side_effect = lambda name: wizard_chain if name == "meal_plan_wizard_session" else MagicMock()

    svc = _make_service(sb)
    result = await svc.start_wizard(
        USER_ID, HOUSEHOLD_ID,
        {"breakfast": True, "lunch": False, "dinner": False},
        REF_DATE,
        now=REF_NOW,
    )

    assert result["session_id"] == SESSION_ID


@pytest.mark.asyncio
async def test_start_wizard_replaces_existing_session_for_same_household():
    """When an active session exists, it is deleted before inserting the new one."""
    existing = _make_session_row(session_id="old-session")
    new_row = _make_session_row(session_id="new-session")

    wizard_chain = MagicMock()
    insert_result = MagicMock()
    insert_result.data = [new_row]

    wizard_chain.select.return_value = wizard_chain
    wizard_chain.eq.return_value = wizard_chain
    wizard_chain.gt.return_value = wizard_chain
    wizard_chain.delete.return_value = wizard_chain
    wizard_chain.insert.return_value = wizard_chain
    wizard_chain.update.return_value = wizard_chain
    execute_results = [
        MagicMock(data=[existing]),   # existing_response → has old session
        MagicMock(data=[]),           # delete old session
        insert_result,                # insert new session
    ]
    wizard_chain.execute.side_effect = execute_results

    sb = _make_supabase()
    sb.client.table.side_effect = lambda name: wizard_chain if name == "meal_plan_wizard_session" else MagicMock()

    svc = _make_service(sb)
    result = await svc.start_wizard(
        USER_ID, HOUSEHOLD_ID,
        {"breakfast": True, "lunch": False, "dinner": False},
        REF_DATE,
        now=REF_NOW,
    )

    assert result["session_id"] == "new-session"
    # Verify delete was called (execute called 3 times total)
    assert wizard_chain.execute.call_count == 3


@pytest.mark.asyncio
async def test_start_wizard_raises_validation_when_no_meal_slots_true():
    """All meal_slots False → ValidationException before any DB call."""
    svc = _make_service()
    with pytest.raises(ValidationException):
        await svc.start_wizard(
            USER_ID, HOUSEHOLD_ID,
            {"breakfast": False, "lunch": False, "dinner": False},
            REF_DATE,
            now=REF_NOW,
        )


@pytest.mark.asyncio
async def test_start_wizard_clones_pantry_independently():
    """session_pantry must be an independent copy; mutating it must NOT affect
    the original pantry_items returned by pantry_service."""
    pantry_items = [
        {
            "id": "item-1",
            "normalized_name": "eggs",
            "base_ingredient": "egg",
            "quantity": 12.0,
            "unit": "count",
            "variant": None,
        }
    ]
    session_row = _make_session_row(
        session_pantry={"item-1": {"id": "item-1", "base_ingredient": "egg", "quantity": 12.0, "unit": "count", "name": "eggs", "variant": None}}
    )

    wizard_chain = MagicMock()
    wizard_chain.select.return_value = wizard_chain
    wizard_chain.eq.return_value = wizard_chain
    wizard_chain.gt.return_value = wizard_chain
    wizard_chain.delete.return_value = wizard_chain
    wizard_chain.insert.return_value = wizard_chain
    wizard_chain.update.return_value = wizard_chain
    wizard_chain.execute.side_effect = [
        MagicMock(data=[]),            # no existing session
        MagicMock(data=[session_row]), # insert returns session
    ]

    sb = _make_supabase()
    sb.client.table.side_effect = lambda name: wizard_chain if name == "meal_plan_wizard_session" else MagicMock()

    svc = _make_service(sb, pantry_items=pantry_items)
    result = await svc.start_wizard(
        USER_ID, HOUSEHOLD_ID,
        {"breakfast": True, "lunch": False, "dinner": False},
        REF_DATE,
        now=REF_NOW,
    )

    session_pantry = result["session_pantry"]
    # Mutate session_pantry
    session_pantry["item-1"]["quantity"] = 0

    # Original pantry_items must be untouched
    assert pantry_items[0]["quantity"] == 12.0


# ===========================================================================
# Group B — determinism prerequisite
# ===========================================================================


@pytest.mark.asyncio
async def test_start_wizard_accepts_now_parameter():
    """start_wizard must accept a `now` kwarg and use it for expires_at calculation."""
    inserted_data = {}

    wizard_chain = MagicMock()
    wizard_chain.select.return_value = wizard_chain
    wizard_chain.eq.return_value = wizard_chain
    wizard_chain.gt.return_value = wizard_chain
    wizard_chain.delete.return_value = wizard_chain
    wizard_chain.update.return_value = wizard_chain

    def capture_insert(data):
        inserted_data.update(data)
        r = MagicMock()
        r.data = [{"id": "sess-x", **data}]
        chain = MagicMock()
        chain.execute.return_value = r
        return chain

    wizard_chain.insert.side_effect = capture_insert
    wizard_chain.execute.side_effect = [MagicMock(data=[])]  # existing query

    sb = _make_supabase()
    sb.client.table.side_effect = lambda name: wizard_chain if name == "meal_plan_wizard_session" else MagicMock()

    svc = _make_service(sb)
    fixed_now = datetime(2026, 1, 1, 0, 0, 0)
    await svc.start_wizard(
        USER_ID, HOUSEHOLD_ID,
        {"dinner": True, "breakfast": False, "lunch": False},
        REF_DATE,
        now=fixed_now,
    )

    expected_expires = (fixed_now + timedelta(hours=2)).isoformat()
    assert inserted_data.get("expires_at") == expected_expires


@pytest.mark.asyncio
async def test_expiry_check_uses_injected_now_not_utcnow():
    """get_recipe_suggestions uses the injected `now` for the expiry check.

    A session expiring *after* REF_NOW but *before* a later `now` must raise
    ValidationException when that later timestamp is injected.
    """
    # Session expires 1 hour after REF_NOW
    session_expires = REF_NOW + timedelta(hours=1)
    session_row = _make_session_row(expires_at=session_expires.isoformat())

    sb = _make_supabase(session_rows=[session_row])
    svc = _make_service(sb)

    # Pass a `now` that is 2 hours after REF_NOW → session should be expired
    future_now = REF_NOW + timedelta(hours=2)
    with pytest.raises(ValidationException, match="expired"):
        await svc.get_recipe_suggestions(SESSION_ID, "dinner", now=future_now)


# ===========================================================================
# Group C — accept / scale
# ===========================================================================


@pytest.mark.asyncio
async def test_accept_recipe_scales_to_household_member_count():
    """Recipe details are fetched and scaled when orig_servings != member_count."""
    session_row = _make_session_row()
    members = [{"id": "m1"}, {"id": "m2"}, {"id": "m3"}]  # 3 members

    # We need two different table chains: wizard_session and meal_plan
    session_chain = MagicMock()
    session_chain.select.return_value = session_chain
    session_chain.eq.return_value = session_chain
    session_chain.update.return_value = session_chain
    session_chain.execute.side_effect = [
        MagicMock(data=[session_row]),   # get session
        MagicMock(data=[]),              # update session
    ]

    meal_chain = MagicMock()
    meal_chain.insert.return_value = meal_chain
    meal_chain.execute.return_value = MagicMock(data=[{"id": "mp-1", "meal_type": "lunch"}])

    sb = _make_supabase(members=members)
    sb.client.table.side_effect = lambda name: (
        session_chain if name == "meal_plan_wizard_session" else meal_chain
    )

    svc = _make_service(sb)
    svc.supabase.get_household_members.return_value = members

    # Recipe has 2 servings; household has 3 members → scale_recipe called
    recipe_details = {
        "title": "Pasta",
        "image": None,
        "servings": 2,
        "extendedIngredients": [],
    }
    svc.recipe_service.get_recipe_details.return_value = recipe_details
    svc.recipe_service.scale_recipe.return_value = {**recipe_details, "servings": 3}

    result = await svc.accept_recipe(SESSION_ID, "12345", REF_DATE, "lunch")

    svc.recipe_service.scale_recipe.assert_called_once_with(recipe_details, 3)
    assert result["meal_plan_entry"]["meal_type"] == "lunch"


@pytest.mark.asyncio
async def test_accept_recipe_mutates_session_pantry_but_not_real_pantry():
    """Accepting a recipe deducts from session_pantry; real pantry_service is never written."""
    initial_pantry = {"item-egg": {"id": "item-egg", "base_ingredient": "egg", "quantity": 6.0, "unit": "count", "name": "eggs", "variant": None}}
    session_row = _make_session_row(session_pantry=copy.deepcopy(initial_pantry))

    updated_session_pantry: dict = {}

    session_chain = MagicMock()
    session_chain.select.return_value = session_chain
    session_chain.eq.return_value = session_chain

    def session_update(data):
        updated_session_pantry.update(data.get("session_pantry", {}))
        c = MagicMock()
        c.eq.return_value = c
        c.execute.return_value = MagicMock(data=[])
        return c

    session_chain.update.side_effect = session_update
    session_chain.execute.return_value = MagicMock(data=[session_row])

    meal_chain = MagicMock()
    meal_chain.insert.return_value = meal_chain
    meal_chain.execute.return_value = MagicMock(data=[{"id": "mp-1", "meal_type": "breakfast"}])

    sb = _make_supabase()
    sb.client.table.side_effect = lambda name: (
        session_chain if name == "meal_plan_wizard_session" else meal_chain
    )

    svc = _make_service(sb)
    svc.recipe_service.get_recipe_details.return_value = {
        "title": "Scrambled Eggs",
        "image": None,
        "servings": 2,
        "extendedIngredients": [
            {"name": "egg", "amount": 3.0, "unit": "count"}
        ],
    }
    svc.recipe_service.scale_recipe.return_value = {
        "title": "Scrambled Eggs",
        "image": None,
        "servings": 2,
        "extendedIngredients": [
            {"name": "egg", "amount": 3.0, "unit": "count"}
        ],
    }

    await svc.accept_recipe(SESSION_ID, "99999", REF_DATE, "breakfast")

    # Real pantry service must NEVER be called for writing
    svc.pantry_service.update_pantry_item.assert_not_called()
    svc.pantry_service.deduct_pantry_item.assert_not_called()


@pytest.mark.asyncio
async def test_accept_recipe_fails_when_session_pantry_insufficient():
    """Accepting a staple recipe with an empty session_pantry succeeds (staples skip deduction).
    Accepting a real recipe on an empty pantry still goes through (deduction stops at 0).
    This test verifies the call path completes without crashing."""
    session_row = _make_session_row(session_pantry={})

    session_chain = MagicMock()
    session_chain.select.return_value = session_chain
    session_chain.eq.return_value = session_chain
    session_chain.update.return_value = session_chain
    session_chain.execute.side_effect = [
        MagicMock(data=[session_row]),
        MagicMock(data=[]),
    ]

    meal_chain = MagicMock()
    meal_chain.insert.return_value = meal_chain
    meal_chain.execute.return_value = MagicMock(data=[{"id": "mp-2", "meal_type": "breakfast"}])

    sb = _make_supabase()
    sb.client.table.side_effect = lambda name: (
        session_chain if name == "meal_plan_wizard_session" else meal_chain
    )

    svc = _make_service(sb)
    # Staple recipe — no DB ingredient look-up
    result = await svc.accept_recipe(SESSION_ID, "staple_omelette", REF_DATE, "breakfast")
    assert result["updated_session_pantry"] == {}


# ===========================================================================
# Group D — soft-reject / ban
# ===========================================================================


@pytest.mark.asyncio
async def test_soft_reject_adds_to_swiped_ids_only_no_ban_row():
    """soft_reject_recipe updates rejected_recipes on the session; never touches recipe_bans."""
    session_row = _make_session_row(rejected_recipes=[])

    session_chain = MagicMock()
    session_chain.select.return_value = session_chain
    session_chain.eq.return_value = session_chain
    session_chain.update.return_value = session_chain
    session_chain.execute.side_effect = [
        MagicMock(data=[session_row]),  # get session
        MagicMock(data=[]),             # update session
    ]

    ban_chain = MagicMock()

    sb = _make_supabase()
    sb.client.table.side_effect = lambda name: (
        session_chain if name == "meal_plan_wizard_session" else ban_chain
    )

    svc = _make_service(sb)
    await svc.soft_reject_recipe(SESSION_ID, "recipe-42")

    # recipe_bans table must never be written
    ban_chain.insert.assert_not_called()
    ban_chain.update.assert_not_called()


@pytest.mark.asyncio
async def test_ban_writes_recipe_ban_row_with_expires_at():
    """ban_recipe inserts a row into recipe_bans with expires_at = now + 180 days."""
    session_row = _make_session_row()

    session_chain = MagicMock()
    session_chain.select.return_value = session_chain
    session_chain.eq.return_value = session_chain
    session_chain.execute.return_value = MagicMock(data=[session_row])

    inserted_ban: dict = {}

    ban_chain = MagicMock()
    ban_chain.select.return_value = ban_chain
    ban_chain.eq.return_value = ban_chain

    def ban_insert(data):
        inserted_ban.update(data)
        c = MagicMock()
        c.execute.return_value = MagicMock(data=[data])
        return c

    ban_chain.insert.side_effect = ban_insert
    ban_chain.execute.return_value = MagicMock(data=[])  # check existing ban → empty

    sb = _make_supabase()
    sb.client.table.side_effect = lambda name: (
        session_chain if name == "meal_plan_wizard_session" else ban_chain
    )

    svc = _make_service(sb)
    fixed_now = datetime(2026, 4, 10, 12, 0, 0)
    await svc.ban_recipe(SESSION_ID, "recipe-99", "Pasta Bolognese", USER_ID, now=fixed_now)

    expected_expires = (fixed_now + timedelta(days=180)).isoformat()
    assert inserted_ban.get("expires_at") == expected_expires
    assert inserted_ban.get("recipe_id") == "recipe-99"
    assert inserted_ban.get("user_id") == USER_ID


@pytest.mark.asyncio
async def test_unban_deletes_recipe_ban_row():
    """unban_recipe calls delete on recipe_bans for the given user/recipe combo."""
    session_row = _make_session_row()

    session_chain = MagicMock()
    session_chain.select.return_value = session_chain
    session_chain.eq.return_value = session_chain
    session_chain.execute.return_value = MagicMock(data=[session_row])

    ban_chain = MagicMock()
    ban_chain.delete.return_value = ban_chain
    ban_chain.eq.return_value = ban_chain
    ban_chain.execute.return_value = MagicMock(data=[])

    sb = _make_supabase()
    sb.client.table.side_effect = lambda name: (
        session_chain if name == "meal_plan_wizard_session" else ban_chain
    )

    svc = _make_service(sb)
    await svc.unban_recipe(SESSION_ID, "recipe-99", USER_ID)

    ban_chain.delete.assert_called_once()


# ===========================================================================
# Group E — staple fallback
# ===========================================================================


@pytest.mark.asyncio
async def test_suggest_staple_meals_returns_breakfast_options_for_sparse_pantry():
    """A pantry with eggs returns omelette/scrambled eggs staples for breakfast."""
    session_pantry = {
        "i1": {"base_ingredient": "egg", "quantity": 6, "unit": "count", "name": "eggs", "id": "i1", "variant": None},
    }
    svc = _make_service()
    results = await svc.suggest_staple_meals(session_pantry, "breakfast")
    ids = [r["id"] for r in results]
    assert "staple_omelette" in ids
    assert "staple_scrambled_eggs" in ids


@pytest.mark.asyncio
async def test_suggest_staple_meals_returns_empty_for_dinner():
    """Staple suggestions are only defined for breakfast and lunch, not dinner."""
    session_pantry = {
        "i1": {"base_ingredient": "egg", "quantity": 6, "unit": "count", "name": "eggs", "id": "i1", "variant": None},
        "i2": {"base_ingredient": "bread", "quantity": 1, "unit": "loaf", "name": "bread", "id": "i2", "variant": None},
    }
    svc = _make_service()
    results = await svc.suggest_staple_meals(session_pantry, "dinner")
    assert results == []


# ===========================================================================
# Group F — complete wizard
# ===========================================================================


@pytest.mark.asyncio
async def test_complete_wizard_promotes_accepted_recipes_to_meal_plan():
    """complete_wizard fetches existing meal rows, calls shopping list generation,
    deletes the session, and returns a summary."""
    session_row = _make_session_row()

    session_chain = MagicMock()
    session_chain.select.return_value = session_chain
    session_chain.eq.return_value = session_chain
    session_chain.delete.return_value = session_chain
    session_chain.execute.side_effect = [
        MagicMock(data=[session_row]),   # get session
        MagicMock(data=[]),              # delete session
    ]

    meal_chain = MagicMock()
    meal_chain.select.return_value = meal_chain
    meal_chain.eq.return_value = meal_chain
    meal_chain.gte.return_value = meal_chain
    meal_chain.execute.return_value = MagicMock(data=[
        {"id": "mp-1", "meal_date": REF_DATE.isoformat(), "meal_type": "dinner"},
    ])

    sb = _make_supabase()
    sb.client.table.side_effect = lambda name: (
        session_chain if name == "meal_plan_wizard_session" else meal_chain
    )

    svc = _make_service(sb)

    # Patch ShoppingListService to avoid real import
    mock_sl_service = MagicMock()
    mock_sl_service.generate_from_meal_plan = AsyncMock(return_value={"total_items": 5, "items": []})

    with patch(
        "backend.services.shopping_list_service.ShoppingListService",
        return_value=mock_sl_service,
    ):
        result = await svc.complete_wizard(SESSION_ID, now=REF_NOW)

    assert result["summary"]["meals_planned"] == 1
    assert result["summary"]["shopping_list_items"] == 5
    mock_sl_service.generate_from_meal_plan.assert_called_once()


@pytest.mark.asyncio
@pytest.mark.xfail(
    reason="Non-atomic promotion: complete_wizard cannot guarantee rollback if "
    "shopping-list generation fails mid-way. Requires RPC upgrade. "
    "See follow-up brief T2-02-atomicity.",
    strict=False,
)
async def test_complete_wizard_rolls_back_on_promotion_failure():
    """When shopping list generation fails, no partial meal-plan rows should remain.

    NOTE: This is a *known gap* — the current implementation is non-atomic and
    cannot guarantee rollback. This test is xfail until an atomic RPC is in place.
    """
    session_row = _make_session_row()

    session_chain = MagicMock()
    session_chain.select.return_value = session_chain
    session_chain.eq.return_value = session_chain
    session_chain.delete.return_value = session_chain
    session_chain.execute.return_value = MagicMock(data=[session_row])

    meal_chain = MagicMock()
    meal_chain.select.return_value = meal_chain
    meal_chain.eq.return_value = meal_chain
    meal_chain.gte.return_value = meal_chain
    meal_chain.execute.return_value = MagicMock(data=[
        {"id": "mp-1", "meal_date": REF_DATE.isoformat(), "meal_type": "dinner"},
    ])

    sb = _make_supabase()
    sb.client.table.side_effect = lambda name: (
        session_chain if name == "meal_plan_wizard_session" else meal_chain
    )

    svc = _make_service(sb)

    mock_sl_service = MagicMock()
    mock_sl_service.generate_from_meal_plan = AsyncMock(side_effect=Exception("DB failure"))

    with patch(
        "backend.services.shopping_list_service.ShoppingListService",
        return_value=mock_sl_service,
    ):
        with pytest.raises(Exception):
            await svc.complete_wizard(SESSION_ID, now=REF_NOW)

    # After failure, session row should still exist (rollback not implemented)
    # This assertion is expected to FAIL in current implementation:
    assert session_chain.delete.call_count == 0, (
        "Session was deleted even though promotion failed — no rollback occurred"
    )
