"""AI usage ledger and call context tests."""

from decimal import Decimal
from unittest.mock import MagicMock

import pytest

from backend.services.ai_usage_ledger import (
    AI_LEDGER_UNAVAILABLE_MSG,
    AI_USER_CAP_MSG,
    AiUsageLedger,
    estimate_token_cost_usd,
    pre_estimate_usd,
    stable_error_code,
)
from backend.utils.ai_call_context import (
    get_ai_call_context,
    merge_ai_call_context,
    reset_ai_call_context,
)
from backend.utils.exceptions import AIServiceException


def _admin_mock(sum_cost=0.0, insert_id="log-1"):
    admin = MagicMock()
    sum_chain = MagicMock()
    sum_chain.execute.return_value = MagicMock(
        data=[{"estimated_cost": sum_cost}] if sum_cost else []
    )
    admin.table.return_value.select.return_value.eq.return_value.gte.return_value = (
        sum_chain
    )
    ins_chain = MagicMock()
    ins_chain.execute.return_value = MagicMock(data=[{"id": insert_id}])
    admin.table.return_value.insert.return_value = ins_chain
    upd_chain = MagicMock()
    admin.table.return_value.update.return_value.eq.return_value = upd_chain
    return admin


def test_pre_estimate_and_token_cost():
    assert pre_estimate_usd("normalize_batch") == Decimal("0.001")
    assert pre_estimate_usd("transcribe", 50_000) == Decimal("0.002")
    cost = estimate_token_cost_usd("gpt-4o-mini", 1000, 500)
    assert cost is not None
    assert cost > 0


def test_reserve_refuses_when_over_cap():
    admin = _admin_mock(sum_cost=1.0)
    ledger = AiUsageLedger(admin, 1.0, "default", "test")
    token, _ = merge_ai_call_context(user_id="user-1")
    try:
        with pytest.raises(AIServiceException, match=AI_USER_CAP_MSG):
            ledger.begin_call("normalize_batch", "openai", "gpt-4o-mini")
    finally:
        reset_ai_call_context(token)


def test_reserve_requires_user_when_cap_on():
    admin = _admin_mock()
    ledger = AiUsageLedger(admin, 1.0, "default", "test")
    with pytest.raises(AIServiceException, match=AI_USER_CAP_MSG):
        ledger.begin_call("normalize_batch", "openai", "gpt-4o-mini")


def test_cap_off_skips_reserve():
    admin = _admin_mock()
    ledger = AiUsageLedger(admin, 0, "default", "test")
    res = ledger.begin_call("normalize_batch", "openai", "gpt-4o-mini")
    assert res.row_id is None
    assert res.cap_enabled is False
    admin.table.return_value.insert.assert_not_called()


def test_reconcile_connection_failure_zeros_cost():
    admin = _admin_mock(insert_id="row-1")
    ledger = AiUsageLedger(admin, 1.0, "default", "test")
    token, _ = merge_ai_call_context(user_id="u1")
    try:
        res = ledger.begin_call("normalize_batch", "openai", "gpt-4o-mini")
        ledger.reconcile_failure(
            res,
            "connection",
            True,
            "openai",
            "gpt-4o-mini",
            "normalize_batch",
            duration_ms=10,
        )
    finally:
        reset_ai_call_context(token)
    admin.table.return_value.update.assert_called()
    payload = admin.table.return_value.update.call_args[0][0]
    assert payload["estimated_cost"] == 0.0
    assert payload["error_message"] == "connection"


def test_context_reset_after_exception():
    token, _ = merge_ai_call_context(user_id="u1")
    try:
        raise ValueError("boom")
    except ValueError:
        pass
    finally:
        reset_ai_call_context(token)
    assert get_ai_call_context() is None


def test_stable_error_code_no_prompt_leak():
    assert stable_error_code(Exception("secret product name")) == "api_error"


def test_reserve_requires_admin_when_cap_on():
    ledger = AiUsageLedger(None, 1.0, "default", "test")
    token, _ = merge_ai_call_context(user_id="u1")
    try:
        with pytest.raises(AIServiceException, match=AI_LEDGER_UNAVAILABLE_MSG):
            ledger.begin_call("normalize_batch", "openai", "gpt-4o-mini")
    finally:
        reset_ai_call_context(token)
