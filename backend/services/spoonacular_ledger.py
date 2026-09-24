"""Spoonacular per-user usage ledger (service-role table only)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

import requests

from backend.utils.exceptions import AIServiceException
from backend.utils.logger import get_logger

logger = get_logger(__name__)

SPOONACULAR_USER_CAP_MSG = "Spoonacular user daily point cap exceeded"
SPOONACULAR_LEDGER_UNAVAILABLE_MSG = "Spoonacular usage ledger unavailable"

_QUOTA_REQUEST_HEADER = "X-API-Quota-Request"


def estimate_points(endpoint: str, number: int = 1) -> float:
    if endpoint == "complexSearch":
        return float(1 + max(1, int(number)))
    return 1.0


def is_user_cap_error(message: str) -> bool:
    return message == SPOONACULAR_USER_CAP_MSG


def is_ledger_unavailable_error(message: str) -> bool:
    return message == SPOONACULAR_LEDGER_UNAVAILABLE_MSG


def parse_quota_request_header(response: Optional[requests.Response]) -> Optional[float]:
    if response is None:
        return None
    raw = response.headers.get(_QUOTA_REQUEST_HEADER)
    if raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


class SpoonacularLedger:
    """Reserve and reconcile Spoonacular points against a daily per-user cap."""

    def __init__(self, admin_client: Any, daily_point_cap: int):
        self._admin = admin_client
        self._cap = daily_point_cap

    @property
    def cap_enabled(self) -> bool:
        return self._cap > 0

    def _utc_day_start_iso(self) -> str:
        now = datetime.now(timezone.utc)
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        return start.isoformat()

    def _sum_spent_today(self, user_id: str) -> float:
        try:
            resp = (
                self._admin.table("spoonacular_usage")
                .select("points")
                .eq("user_id", user_id)
                .gte("created_at", self._utc_day_start_iso())
                .execute()
            )
        except Exception as e:
            logger.warning("spoonacular_usage sum failed: %s", e)
            raise AIServiceException(SPOONACULAR_LEDGER_UNAVAILABLE_MSG) from e
        rows = resp.data or []
        return sum(float(r.get("points") or 0) for r in rows)

    def reserve_before_call(
        self,
        user_id: Optional[str],
        caller: str,
        endpoint: str,
        estimate: float,
    ) -> Optional[str]:
        """
        When cap is on: ensure ledger available, check cap, insert reservation.
        Returns reservation row id, or None when cap is disabled.
        """
        if not self.cap_enabled:
            return None
        if not self._admin:
            raise AIServiceException(SPOONACULAR_LEDGER_UNAVAILABLE_MSG)
        if not user_id:
            raise AIServiceException(SPOONACULAR_LEDGER_UNAVAILABLE_MSG)

        spent = self._sum_spent_today(user_id)
        if spent + estimate > self._cap:
            raise AIServiceException(SPOONACULAR_USER_CAP_MSG)

        try:
            ins = (
                self._admin.table("spoonacular_usage")
                .insert(
                    {
                        "user_id": user_id,
                        "caller": caller,
                        "endpoint": endpoint,
                        "points": estimate,
                    }
                )
                .execute()
            )
        except Exception as e:
            logger.warning("spoonacular_usage reserve failed: %s", e)
            raise AIServiceException(SPOONACULAR_LEDGER_UNAVAILABLE_MSG) from e
        if not ins.data:
            raise AIServiceException(SPOONACULAR_LEDGER_UNAVAILABLE_MSG)
        return str(ins.data[0]["id"])

    def reconcile_after_call(
        self,
        reservation_id: Optional[str],
        estimate: float,
        response: Optional[requests.Response],
    ) -> None:
        if reservation_id:
            actual = parse_quota_request_header(response)
            if actual is None:
                return
            if actual > estimate:
                logger.warning(
                    "Spoonacular points %s exceeded estimate %s for row %s",
                    actual,
                    estimate,
                    reservation_id,
                )
            try:
                self._admin.table("spoonacular_usage").update(
                    {"points": actual}
                ).eq("id", reservation_id).execute()
            except Exception as e:
                logger.warning("spoonacular_usage reconcile failed: %s", e)

    def record_after_call_cap_off(
        self,
        user_id: Optional[str],
        caller: str,
        endpoint: str,
        estimate: float,
        response: Optional[requests.Response],
    ) -> None:
        """Cap disabled: insert one row after the call (best effort)."""
        if self.cap_enabled or not self._admin:
            return
        points = parse_quota_request_header(response)
        if points is None:
            points = estimate
        row: Dict[str, Any] = {
            "caller": caller,
            "endpoint": endpoint,
            "points": points,
        }
        if user_id:
            row["user_id"] = user_id
        try:
            self._admin.table("spoonacular_usage").insert(row).execute()
        except Exception as e:
            logger.warning("spoonacular_usage insert failed: %s", e)
