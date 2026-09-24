"""Per-user AI usage ledger (OpenAI + Gemini) backed by ai_processing_log."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, Optional

from backend.utils.ai_call_context import get_ai_call_context
from backend.utils.exceptions import AIServiceException
from backend.utils.logger import get_logger
from backend.utils.request_context import get_request_id

logger = get_logger(__name__)

AI_USER_CAP_MSG = "AI user daily usage cap exceeded"
AI_LEDGER_UNAVAILABLE_MSG = "AI usage ledger unavailable"

# Pre-estimate floors (USD) — conservative caps, not token guesses.
CHAT_CALL_FLOOR_USD = Decimal("0.001")

_TRANSCRIBE_BYTE_BUCKETS = (
    (100_000, Decimal("0.002")),
    (500_000, Decimal("0.006")),
    (2_000_000, Decimal("0.015")),
)
_TRANSCRIBE_MAX_FLOOR_USD = Decimal("0.030")

# Price per token (USD) for known models: input / output
_MODEL_PRICE_PER_TOKEN: Dict[str, Dict[str, Decimal]] = {
    "gpt-4o-mini": {
        "input": Decimal("0.15") / Decimal(1_000_000),
        "output": Decimal("0.60") / Decimal(1_000_000),
    },
    "gemini-1.5-flash": {
        "input": Decimal("0.075") / Decimal(1_000_000),
        "output": Decimal("0.30") / Decimal(1_000_000),
    },
    "gemini-2.0-flash": {
        "input": Decimal("0.10") / Decimal(1_000_000),
        "output": Decimal("0.40") / Decimal(1_000_000),
    },
}

_ERROR_CODE_MAX_LEN = 32


def pre_estimate_usd(operation: str, audio_bytes: Optional[int] = None) -> Decimal:
    if operation == "transcribe":
        size = audio_bytes or 0
        for limit, floor in _TRANSCRIBE_BYTE_BUCKETS:
            if size <= limit:
                return floor
        return _TRANSCRIBE_MAX_FLOOR_USD
    return CHAT_CALL_FLOOR_USD


def audio_bytes_bucket(audio_bytes: Optional[int]) -> Optional[str]:
    if audio_bytes is None:
        return None
    size = audio_bytes
    for limit, _ in _TRANSCRIBE_BYTE_BUCKETS:
        if size <= limit:
            return f"le_{limit}"
    return "gt_2000000"


def estimate_token_cost_usd(
    model: str, input_tokens: int, output_tokens: int
) -> Optional[Decimal]:
    rates = _MODEL_PRICE_PER_TOKEN.get(model)
    if not rates:
        return None
    return (
        Decimal(input_tokens) * rates["input"]
        + Decimal(output_tokens) * rates["output"]
    )


def stable_error_code(exc: BaseException) -> str:
    from backend.utils.exceptions import AIRateLimitException
    from openai import APIConnectionError, APIError, RateLimitError

    if isinstance(exc, AIRateLimitException) or isinstance(exc, RateLimitError):
        return "rate_limit"
    if isinstance(exc, APIConnectionError):
        return "connection"
    if isinstance(exc, APIError):
        return "api_error"
    msg = str(exc).lower()
    if "json" in msg or "invalid" in msg:
        return "bad_response"
    return "api_error"


@dataclass
class AiCallReservation:
    row_id: Optional[str]
    pre_estimate: Decimal
    cap_enabled: bool


class AiUsageLedger:
    """Reserve-then-reconcile writes to ai_processing_log."""

    def __init__(
        self,
        admin_client: Any,
        daily_usd_cap: float,
        key_label: str,
        environment: str,
    ):
        self._admin = admin_client
        self._cap = float(daily_usd_cap)
        self._key_label = key_label or "default"
        self._environment = environment or "development"

    @property
    def cap_enabled(self) -> bool:
        return self._cap > 0

    def _utc_day_start_iso(self) -> str:
        now = datetime.now(timezone.utc)
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        return start.isoformat()

    def _sum_spent_today(self, user_id: str) -> Decimal:
        try:
            resp = (
                self._admin.table("ai_processing_log")
                .select("estimated_cost")
                .eq("user_id", user_id)
                .gte("created_at", self._utc_day_start_iso())
                .execute()
            )
        except Exception as e:
            logger.warning("ai_processing_log sum failed: %s", e)
            raise AIServiceException(AI_LEDGER_UNAVAILABLE_MSG) from e
        total = Decimal("0")
        for row in resp.data or []:
            raw = row.get("estimated_cost")
            if raw is not None:
                total += Decimal(str(raw))
        return total

    def _context_fields(
        self, operation: str, items_processed: Optional[int]
    ) -> Dict[str, Any]:
        ctx = get_ai_call_context()
        user_id = ctx.user_id if ctx else None
        household_id = ctx.household_id if ctx else None
        receipt_id = ctx.receipt_id if ctx else None
        op = operation or (ctx.operation if ctx else None) or "unknown"
        return {
            "user_id": user_id,
            "household_id": household_id,
            "receipt_id": receipt_id,
            "operation": op,
            "items_processed": items_processed,
            "request_id": get_request_id(),
            "key_label": self._key_label,
            "environment": self._environment,
        }

    def _insert_row(self, payload: Dict[str, Any], cap_on: bool) -> str:
        try:
            ins = self._admin.table("ai_processing_log").insert(payload).execute()
        except Exception as e:
            logger.warning("ai_processing_log insert failed: %s", e)
            if cap_on:
                raise AIServiceException(AI_LEDGER_UNAVAILABLE_MSG) from e
            raise
        if not ins.data:
            if cap_on:
                raise AIServiceException(AI_LEDGER_UNAVAILABLE_MSG)
            raise AIServiceException("ai_processing_log insert returned no data")
        return str(ins.data[0]["id"])

    def _insert_with_fk_fallback(
        self, payload: Dict[str, Any], cap_on: bool
    ) -> Optional[str]:
        try:
            return self._insert_row(payload, cap_on)
        except AIServiceException:
            if cap_on:
                raise
        except Exception:
            if cap_on:
                raise AIServiceException(AI_LEDGER_UNAVAILABLE_MSG)
        if cap_on:
            raise AIServiceException(AI_LEDGER_UNAVAILABLE_MSG)
        fallback = dict(payload)
        fallback["user_id"] = None
        fallback["receipt_id"] = None
        fallback["household_id"] = None
        try:
            return self._insert_row(fallback, False)
        except Exception as e:
            logger.warning("ai_processing_log insert fallback failed: %s", e)
            return None

    def begin_call(
        self,
        operation: str,
        provider: str,
        model: str,
        items_processed: Optional[int] = None,
        audio_bytes: Optional[int] = None,
    ) -> AiCallReservation:
        fields = self._context_fields(operation, items_processed)
        pre = pre_estimate_usd(operation, audio_bytes)
        user_id = fields["user_id"]

        if not self.cap_enabled:
            return AiCallReservation(row_id=None, pre_estimate=pre, cap_enabled=False)

        if not self._admin:
            raise AIServiceException(AI_LEDGER_UNAVAILABLE_MSG)
        if not user_id:
            raise AIServiceException(AI_USER_CAP_MSG)

        spent = self._sum_spent_today(user_id)
        if spent + pre > Decimal(str(self._cap)):
            raise AIServiceException(AI_USER_CAP_MSG)

        total_tokens = 0
        payload = {
            "operation": fields["operation"],
            "model": model,
            "provider": provider,
            "input_tokens": 0,
            "output_tokens": 0,
            "total_tokens": total_tokens,
            "estimated_cost": float(pre),
            "duration_ms": None,
            "success": False,
            "error_message": None,
            "user_id": user_id,
            "household_id": fields["household_id"],
            "receipt_id": fields["receipt_id"],
            "items_processed": fields["items_processed"],
            "key_label": fields["key_label"],
            "environment": fields["environment"],
            "request_id": fields["request_id"],
            "request_metadata": None,
            "response_metadata": {"attempts": 1},
        }
        row_id = self._insert_with_fk_fallback(payload, True)
        if not row_id:
            raise AIServiceException(AI_LEDGER_UNAVAILABLE_MSG)
        return AiCallReservation(row_id=row_id, pre_estimate=pre, cap_enabled=True)

    def record_attempt(self, reservation: AiCallReservation) -> None:
        if not reservation.cap_enabled or not reservation.row_id or not self._admin:
            return
        try:
            resp = (
                self._admin.table("ai_processing_log")
                .select("response_metadata")
                .eq("id", reservation.row_id)
                .execute()
            )
            meta = {}
            if resp.data:
                meta = resp.data[0].get("response_metadata") or {}
            attempts = int(meta.get("attempts") or 1) + 1
            self._admin.table("ai_processing_log").update(
                {"response_metadata": {"attempts": attempts}}
            ).eq("id", reservation.row_id).execute()
        except Exception as e:
            logger.warning("ai_processing_log attempt increment failed: %s", e)

    def reconcile_success(
        self,
        reservation: AiCallReservation,
        provider: str,
        model: str,
        operation: str,
        duration_ms: int,
        input_tokens: Optional[int],
        output_tokens: Optional[int],
        items_processed: Optional[int] = None,
        audio_bytes: Optional[int] = None,
    ) -> None:
        inp = input_tokens or 0
        out = output_tokens or 0
        total = inp + out
        token_cost = estimate_token_cost_usd(model, inp, out)
        floor = pre_estimate_usd(operation, audio_bytes)
        if token_cost is not None:
            cost = token_cost
            if cost < floor:
                cost = floor
        else:
            logger.warning("Unknown model %s for cost estimate; using floor", model)
            cost = floor

        if token_cost is not None and token_cost > reservation.pre_estimate:
            logger.warning(
                "AI cost %s exceeded pre-estimate %s for row %s",
                token_cost,
                reservation.pre_estimate,
                reservation.row_id,
            )

        meta: Dict[str, Any] = {}
        bucket = audio_bytes_bucket(audio_bytes)
        if bucket:
            meta["audio_bytes_bucket"] = bucket

        if reservation.cap_enabled and reservation.row_id:
            update = {
                "success": True,
                "input_tokens": inp,
                "output_tokens": out,
                "total_tokens": total,
                "estimated_cost": float(cost),
                "duration_ms": duration_ms,
                "error_message": None,
                "items_processed": items_processed,
            }
            if meta:
                update["response_metadata"] = meta
            try:
                self._admin.table("ai_processing_log").update(update).eq(
                    "id", reservation.row_id
                ).execute()
            except Exception as e:
                logger.warning("ai_processing_log reconcile success failed: %s", e)
            return

        if not self._admin:
            return
        fields = self._context_fields(operation, items_processed)
        payload = {
            "operation": fields["operation"],
            "model": model,
            "provider": provider,
            "input_tokens": inp,
            "output_tokens": out,
            "total_tokens": total,
            "estimated_cost": float(cost),
            "duration_ms": duration_ms,
            "success": True,
            "error_message": None,
            "user_id": fields["user_id"],
            "household_id": fields["household_id"],
            "receipt_id": fields["receipt_id"],
            "items_processed": fields["items_processed"],
            "key_label": fields["key_label"],
            "environment": fields["environment"],
            "request_id": fields["request_id"],
            "request_metadata": None,
            "response_metadata": meta or None,
        }
        try:
            self._insert_with_fk_fallback(payload, False)
        except Exception as e:
            logger.warning("ai_processing_log cap-off insert failed: %s", e)

    def reconcile_failure(
        self,
        reservation: AiCallReservation,
        error_code: str,
        before_http_response: bool,
        provider: str,
        model: str,
        operation: str,
        duration_ms: Optional[int] = None,
        items_processed: Optional[int] = None,
        audio_bytes: Optional[int] = None,
    ) -> None:
        code = (error_code or "api_error")[:_ERROR_CODE_MAX_LEN]
        cost = Decimal("0") if before_http_response else reservation.pre_estimate

        if reservation.cap_enabled and reservation.row_id:
            try:
                self._admin.table("ai_processing_log").update(
                    {
                        "success": False,
                        "estimated_cost": float(cost),
                        "error_message": code,
                        "duration_ms": duration_ms,
                        "items_processed": items_processed,
                    }
                ).eq("id", reservation.row_id).execute()
            except Exception as e:
                logger.warning("ai_processing_log reconcile failure failed: %s", e)
            return

        if not self._admin or not reservation.cap_enabled:
            if reservation.cap_enabled:
                return
            fields = self._context_fields(operation, items_processed)
            payload = {
                "operation": fields["operation"],
                "model": model,
                "provider": provider,
                "success": False,
                "estimated_cost": float(cost) if cost else float(pre_estimate_usd(operation, audio_bytes)),
                "error_message": code,
                "duration_ms": duration_ms,
                "user_id": fields["user_id"],
                "household_id": fields["household_id"],
                "receipt_id": fields["receipt_id"],
                "items_processed": fields["items_processed"],
                "key_label": fields["key_label"],
                "environment": fields["environment"],
                "request_id": fields["request_id"],
            }
            try:
                self._insert_with_fk_fallback(payload, False)
            except Exception as e:
                logger.warning("ai_processing_log cap-off failure insert failed: %s", e)
