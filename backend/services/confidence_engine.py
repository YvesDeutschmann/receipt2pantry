"""
Meald depletion engine (Phase 2): confidence, calibration, expiry cleanup, cook events, put-back.

Computed confidence is never persisted (except user-initiated confidence_override fields).
"""

from __future__ import annotations

import json
from datetime import date, datetime, time, timezone
from decimal import Decimal
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional, Set, Tuple

from backend.utils.logger import get_logger

logger = get_logger(__name__)

# Put-back: user explicitly says item is still there — highest trust until window ends.
PUT_BACK_CONFIDENCE_OVERRIDE = 0.85
USE_SOON_DAYS = 2
UNIT_ITEM_DEFAULT_DAYS_SUPPLY = 90

# Meat/fish put-back limit (application-level; matches depletion docs)
MAX_PUT_BACK_SUBCLASSES = frozenset({"raw_meat", "raw_fish"})

_USE_SOON_CLEAR_FIELDS = {
    "use_soon": False,
    "use_soon_expires": None,
    "confidence_override": None,
    "confidence_override_expires": None,
}


def _deleted_at_for_day(today: date) -> datetime:
    """Deterministic soft-delete timestamp at start of `today` in UTC (testable)."""
    return datetime.combine(today, time.min, tzinfo=timezone.utc)


def _normalize_ingredients_used(raw: Any) -> Any:
    """Parse JSON string from DB/API into list/dict; leave structured values as-is."""
    if raw is None:
        return None
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return None
    return raw


def _to_date(value: Any, fallback: Optional[date] = None) -> Optional[date]:
    """Normalize DB timestamps / strings to date."""
    if value is None:
        return fallback
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        # ISO date or datetime
        if "T" in value:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
        return date.fromisoformat(value[:10])
    return fallback


def _to_float(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


def _round_confidence(score: float) -> float:
    return round(score, 2)


def _active_confidence_override(pantry_item: dict, today: date) -> Optional[float]:
    override = pantry_item.get("confidence_override")
    expires = _to_date(pantry_item.get("confidence_override_expires"))
    if override is None or expires is None:
        return None
    if expires >= today:
        return _to_float(override)
    return None


def resolve_depletion_class(pantry_item: dict, classification: dict) -> str:
    return (
        pantry_item.get("depletion_class")
        or classification.get("depletion_class")
        or "STAPLE"
    ).upper()


def default_days_supply_for(
    classification: Optional[dict] = None,
    pantry_item: Optional[dict] = None,
) -> int:
    """Classification default_days_supply, else 90 for UNIT_ITEM and 45 otherwise."""
    cls = classification or {}
    raw = cls.get("default_days_supply")
    if raw is not None:
        return int(raw)
    if resolve_depletion_class(pantry_item or {}, cls) == "UNIT_ITEM":
        return UNIT_ITEM_DEFAULT_DAYS_SUPPLY
    return 45


def compute_confidence(
    pantry_item: dict,
    user_prefs: dict,
    classification: dict,
    *,
    today: date,
    calibrated_days: Optional[int] = None,
    engagement_multiplier: float = 1.0,
) -> float:
    """
    Compute current confidence for a pantry row. Never reads/writes a stored confidence column.

    Multipliers apply to time-based classes (PERISHABLE, CONSUMABLE, STAPLE, UNIT_ITEM).
    UNIT_ITEM combines quantity event bands with a time ceiling: min(event_band, time_ceiling).
    Spice soft-required cap is applied last: min(score, 0.60).
    """
    # User-set overrides (Health Card, put-back) are not spice-capped — explicit trust wins.
    active = _active_confidence_override(pantry_item, today)
    if active is not None:
        return _round_confidence(active)

    depletion_class = resolve_depletion_class(pantry_item, classification)
    depletion_mult = float(user_prefs.get("depletion_multiplier") or 1.0)
    eng = float(engagement_multiplier or 1.0)
    denom = depletion_mult * eng
    if denom <= 0:
        denom = 1.0

    score = 0.0
    if depletion_class == "PERISHABLE":
        score = _score_perishable(pantry_item, classification, today, denom)
    elif depletion_class == "CONSUMABLE":
        score = _score_consumable(
            pantry_item, classification, today, calibrated_days, denom
        )
    elif depletion_class == "STAPLE":
        score = _score_staple(pantry_item, classification, today, calibrated_days, denom)
    elif depletion_class == "UNIT_ITEM":
        score = _score_unit_item(
            pantry_item, classification, today, calibrated_days, denom
        )
    else:
        score = 0.0

    if classification.get("is_soft_required"):
        score = min(score, 0.60)

    if depletion_class == "PERISHABLE" and score == 0.0:
        logger.warning(
            "compute_confidence returned 0.00 for PERISHABLE id=%s — possible cleanup miss",
            pantry_item.get("id"),
        )

    return _round_confidence(score)


def _score_perishable(
    pantry_item: dict,
    classification: dict,
    today: date,
    denom: float,
) -> float:
    if pantry_item.get("is_frozen"):
        ref = _to_date(pantry_item.get("frozen_expire_date"))
    else:
        ref = _to_date(pantry_item.get("available_until"))

    if ref is None:
        return 0.0

    days_remaining = (ref - today).days
    adjusted = days_remaining / denom

    grace = classification.get("grace_buffer_days")
    if grace is None:
        grace = 3
    grace = int(grace)

    if adjusted > 2:
        return 0.95
    if adjusted >= 0:
        return 0.50
    if adjusted >= -grace:
        return 0.10
    return 0.00


def _score_consumable(
    pantry_item: dict,
    classification: dict,
    today: date,
    calibrated_days: Optional[int],
    denom: float,
) -> float:
    purchase = _to_date(pantry_item.get("purchase_date"))
    if purchase is None:
        return 0.10

    days_since = (today - purchase).days
    if days_since > 365:
        return 0.05

    cal = calibrated_days
    if cal is None:
        cal = classification.get("default_days_supply")
    if cal is None:
        cal = 45
    cal = int(cal)

    estimated = date.fromordinal(purchase.toordinal() + cal)
    days_remaining = (estimated - today).days
    adjusted = days_remaining / denom

    low = cal * -0.5
    quarter = cal * 0.25

    if adjusted > quarter:
        return 0.80
    if adjusted > 0:
        return 0.60
    if adjusted > low:
        return 0.20
    return 0.10


def _score_staple(
    pantry_item: dict,
    classification: dict,
    today: date,
    calibrated_days: Optional[int],
    denom: float,
) -> float:
    if not pantry_item.get("quantity_known", True):
        return 0.40

    # Known-quantity staple: consumable path using added_at as anchor
    row = dict(pantry_item)
    anchor = _to_date(row.get("purchase_date")) or _to_date(row.get("added_at"))
    row["purchase_date"] = anchor
    return _score_consumable(row, classification, today, calibrated_days, denom)


def _unit_item_event_band(pantry_item: dict) -> float:
    remaining = pantry_item.get("quantity_remaining")
    if remaining is None:
        return 0.90
    q = _to_float(remaining)
    if q > 0:
        return 0.60
    return 0.00


def _unit_item_time_ceiling(
    pantry_item: dict,
    classification: dict,
    today: date,
    calibrated_days: Optional[int],
    denom: float,
) -> float:
    anchor = _to_date(pantry_item.get("purchase_date")) or _to_date(
        pantry_item.get("added_at")
    )
    if anchor is None:
        return 1.00

    cal = calibrated_days
    if cal is None:
        cal = default_days_supply_for(classification, pantry_item)
    cal = int(cal)

    estimated = date.fromordinal(anchor.toordinal() + cal)
    days_remaining = (estimated - today).days
    adjusted = days_remaining / denom

    low = cal * -0.5
    quarter = cal * 0.25

    if adjusted > quarter:
        return 1.00
    if adjusted > 0:
        return 0.60
    if adjusted > low:
        return 0.20
    return 0.10


def _score_unit_item(
    pantry_item: dict,
    classification: dict,
    today: date,
    calibrated_days: Optional[int],
    denom: float,
) -> float:
    event_band = _unit_item_event_band(pantry_item)
    ceiling = _unit_item_time_ceiling(
        pantry_item, classification, today, calibrated_days, denom
    )
    return min(event_band, ceiling)


def get_calibrated_days_supply(
    client: Any,
    user_id: str,
    item_name: str,
    default_days_supply: int,
) -> int:
    """
    Average days between repeat purchases (last 5 records, descending by purchase_date).
    Fewer than 2 records → default_days_supply.
    """
    c = _client(client)
    response = (
        c.table("purchase_history")
        .select("purchase_date")
        .eq("user_id", user_id)
        .eq("item_name", item_name)
        .order("purchase_date", desc=True)
        .limit(5)
        .execute()
    )
    rows: List[Dict] = response.data if response.data else []
    if len(rows) < 2:
        return int(default_days_supply)

    dates: List[date] = []
    for r in rows:
        d = _to_date(r.get("purchase_date"))
        if d:
            dates.append(d)
    if len(dates) < 2:
        return int(default_days_supply)

    intervals: List[int] = []
    for i in range(1, len(dates)):
        # rows are DESC: dates[0] newest, dates[1] older → interval = newer - older
        intervals.append((dates[i - 1] - dates[i]).days)

    if not intervals:
        return int(default_days_supply)
    return int(round(sum(intervals) / len(intervals)))


def get_engagement_multiplier(client: Any, user_id: str) -> float:
    """
    Engagement from app open frequency. TODO: wire to `app_events` when that table exists.
    """
    # TODO: SELECT count APP_OPEN last 14 days from app_events
    _ = (client, user_id)
    return 1.0


def _rpc_soft_delete_pantry_item(
    c: Any,
    *,
    user_id: str,
    pantry_item_id: str,
    item_name: str,
    depletion_class: str,
    purchase_date: Optional[date],
    today: date,
    reason: str,
    was_cooked: bool,
    put_back_count: int,
) -> None:
    """
    Single DB round-trip: soft-delete row + append depletion_history (see migration
    `soft_delete_pantry_item`).
    """
    deleted_at = _deleted_at_for_day(today)
    days_in: Optional[int] = None
    if purchase_date:
        days_in = (today - purchase_date).days
    payload: Dict[str, Any] = {
        "p_pantry_item_id": str(pantry_item_id),
        "p_user_id": str(user_id),
        "p_item_name": item_name,
        "p_depletion_class": depletion_class,
        "p_deleted_at": deleted_at.isoformat(),
        "p_reason": reason,
        "p_days_in_pantry": days_in,
        "p_was_cooked": was_cooked,
        "p_put_back_count": put_back_count,
    }
    if purchase_date is not None:
        payload["p_purchase_date"] = purchase_date.isoformat()
    else:
        payload["p_purchase_date"] = None
    c.rpc("soft_delete_pantry_item", payload).execute()


def run_expiry_cleanup(client: Any, user_id: str, *, today: date) -> List[Dict]:
    """
    Soft-delete PERISHABLE rows past hard_expire_date; append depletion_history.
    Does not delete consumables or unit items.
    """
    c = _client(client)
    expired = (
        c.table("pantry_items")
        .select("*")
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .eq("depletion_class", "PERISHABLE")
        .lt("hard_expire_date", today.isoformat())
        .execute()
    )
    items: List[Dict] = expired.data if expired.data else []
    out: List[Dict] = []

    for item in items:
        pid = item["id"]
        if item.get("deleted_at"):
            continue

        was_cooked = _was_item_cooked(c, user_id, str(pid), item.get("base_ingredient") or "")

        purchase = _to_date(item.get("purchase_date"))
        deleted_at = _deleted_at_for_day(today)
        _rpc_soft_delete_pantry_item(
            c,
            user_id=user_id,
            pantry_item_id=str(pid),
            item_name=item.get("base_ingredient") or item.get("normalized_name") or "",
            depletion_class=item.get("depletion_class") or "PERISHABLE",
            purchase_date=purchase,
            today=today,
            reason="AUTO_EXPIRED",
            was_cooked=was_cooked,
            put_back_count=int(item.get("put_back_count") or 0),
        )
        item_copy = dict(item)
        item_copy["deleted_at"] = deleted_at.isoformat()
        out.append(item_copy)

    return out


def _was_item_cooked(
    client: Any, user_id: str, pantry_item_id: str, base_ingredient: str
) -> bool:
    """True if structured cooking_log.ingredients_used references this pantry row."""
    c = _client(client)
    response = (
        c.table("cooking_log")
        .select("ingredients_used")
        .eq("user_id", user_id)
        .limit(200)
        .execute()
    )
    rows = response.data if response.data else []
    needle_name = (base_ingredient or "").strip().lower()

    def _matches_structured(ing: Any) -> bool:
        ing = _normalize_ingredients_used(ing)
        if isinstance(ing, list):
            for el in ing:
                if not isinstance(el, dict):
                    continue
                pid = el.get("pantry_item_id")
                if pid is not None and str(pid) == str(pantry_item_id):
                    return True
                b = (el.get("base_ingredient") or "").strip().lower()
                if needle_name and b == needle_name:
                    return True
        elif isinstance(ing, dict):
            pid = ing.get("pantry_item_id")
            if pid is not None and str(pid) == str(pantry_item_id):
                return True
            b = (ing.get("base_ingredient") or "").strip().lower()
            if needle_name and b == needle_name:
                return True
        return False

    for row in rows:
        if _matches_structured(row.get("ingredients_used")):
            return True
    return False


def process_cook_event(
    client: Any,
    user_id: str,
    recipe_id: str,
    servings: int,
    recipe_ingredients: List[Dict],
    *,
    today: date,
    recipe_name: str = "",
    household_id: Optional[str] = None,
) -> List[Dict]:
    """
    Apply cook event: UNIT_ITEM decrements; PERISHABLE/CONSUMABLE get cook association only.
    recipe_ingredients: Spoonacular-shaped dicts with at least name, amount; optional unit, is_primary.

    Returns the list of pantry rows touched (matched ingredients), for honest client feedback.
    """
    c = _client(client)
    query = c.table("pantry_items").select("*").is_("deleted_at", "null")
    if household_id:
        query = query.eq("household_id", household_id)
    else:
        query = query.eq("user_id", user_id)
    pantry_rows = query.execute()
    pantry_list: List[Dict] = pantry_rows.data if pantry_rows.data else []
    touched: List[Dict] = []
    touched_ids: Set[str] = set()

    for ing in recipe_ingredients:
        name = (ing.get("name") or "").strip().lower()
        if not name:
            continue
        amount = _to_float(ing.get("amount"))

        match = find_pantry_match_for_cook(pantry_list, name)
        if not match:
            continue

        pid = str(match["id"])
        if pid in touched_ids:
            continue
        touched_ids.add(pid)

        dclass = resolve_depletion_class(match, {})

        if dclass == "UNIT_ITEM":
            rem = match.get("quantity_remaining")
            purchased = _to_float(match.get("quantity_purchased"))
            if rem is None:
                rem = purchased
            else:
                rem = _to_float(rem)
            new_rem = max(0.0, rem - amount)
            if new_rem <= 0:
                _soft_delete_cooked(c, match, today=today)
            else:
                payload: Dict[str, Any] = {"quantity_remaining": new_rem}
                if match.get("use_soon"):
                    payload.update(_USE_SOON_CLEAR_FIELDS)
                c.table("pantry_items").update(payload).eq("id", pid).execute()
                match["quantity_remaining"] = new_rem
        elif match.get("use_soon"):
            c.table("pantry_items").update(_USE_SOON_CLEAR_FIELDS).eq("id", pid).execute()

        touched.append(
            {
                "pantry_item_id": pid,
                "base_ingredient": match.get("base_ingredient"),
                "depletion_class": dclass,
            }
        )

    log_data: Dict[str, Any] = {
        "user_id": user_id,
        "recipe_id": str(recipe_id),
        "recipe_name": recipe_name or f"recipe_{recipe_id}",
        "servings": servings,
        "ingredients_used": touched,
    }
    if household_id:
        log_data["household_id"] = household_id
    c.table("cooking_log").insert(log_data).execute()
    return touched


def _find_pantry_match(pantry_list: List[Dict], recipe_ingredient_name: str) -> Optional[Dict]:
    """
    Match recipe ingredient to pantry base_ingredient: exact first, then word-subset
    only when the shorter side has at least two words (avoids 'rice' -> 'rice vinegar').
    """
    n = recipe_ingredient_name.lower().strip()
    if not n:
        return None
    n_words = set(n.split())
    # Pass 1: exact (case-insensitive)
    for p in pantry_list:
        base = (p.get("base_ingredient") or "").lower().strip()
        if base == n:
            return p
    # Pass 2: all words of the shorter name contained in the longer (min 2 words on shorter)
    for p in pantry_list:
        base = (p.get("base_ingredient") or "").lower().strip()
        if not base:
            continue
        b_words = set(base.split())
        if len(b_words) <= len(n_words):
            shorter, longer = b_words, n_words
        else:
            shorter, longer = n_words, b_words
        if len(shorter) < 2:
            continue
        if shorter <= longer:
            return p
    return None


def find_pantry_match_for_cook(
    pantry_list: List[Dict], ingredient_name: str
) -> Optional[Dict]:
    """Conservative match first, then difflib ratio > 0.8 (skipped when either name < 5 chars)."""
    m = _find_pantry_match(pantry_list, ingredient_name)
    if m:
        return m
    n = (ingredient_name or "").lower().strip()
    if not n:
        return None
    best: Optional[Dict] = None
    best_score = 0.0
    for p in pantry_list:
        base = (p.get("base_ingredient") or "").lower().strip()
        if not base:
            continue
        if min(len(base), len(n)) < 5:
            continue
        ratio = SequenceMatcher(None, base, n).ratio()
        if ratio > best_score:
            best_score = ratio
            best = p
    if best is not None and best_score > 0.8:
        return best
    return None


# Public alias (suggestion_service and tests import this name on purpose).
find_pantry_match = _find_pantry_match


def _soft_delete_cooked(client: Any, item: Dict, *, today: date) -> None:
    c = _client(client)
    pid = item["id"]
    owner_id = item.get("user_id")
    if not owner_id:
        raise ValueError(f"pantry item {pid} missing user_id for soft delete")
    purchase = _to_date(item.get("purchase_date"))
    _rpc_soft_delete_pantry_item(
        c,
        user_id=str(owner_id),
        pantry_item_id=str(pid),
        item_name=item.get("base_ingredient") or "",
        depletion_class=item.get("depletion_class") or "UNIT_ITEM",
        purchase_date=purchase,
        today=today,
        reason="COOKED",
        was_cooked=True,
        put_back_count=int(item.get("put_back_count") or 0),
    )


def process_put_back(
    client: Any,
    user_id: str,
    depletion_history_id: str,
    *,
    today: date,
) -> Tuple[Optional[Dict], Optional[str]]:
    """
    Resurrect a graveyard item. Returns (updated_pantry_row_or_none, error_code_or_none).

    Uses UPDATE on the existing pantry row (same id as depletion_history.pantry_item_id) so
    unique_household_ingredient_variant is not violated by a second live row.
    """
    c = _client(client)
    hresp = (
        c.table("depletion_history")
        .select("*")
        .eq("id", depletion_history_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    rows = hresp.data if hresp.data else []
    if not rows:
        return None, "NOT_FOUND"
    hist = rows[0]

    item_name = hist.get("item_name") or ""
    cls_resp = (
        c.table("item_classification")
        .select("sub_class")
        .eq("item_name", item_name)
        .limit(1)
        .execute()
    )
    cls_rows = cls_resp.data if cls_resp.data else []
    sub_class = (cls_rows[0].get("sub_class") or "") if cls_rows else ""

    if sub_class in MAX_PUT_BACK_SUBCLASSES and int(hist.get("put_back_count") or 0) >= 1:
        return None, "MAX_PUT_BACK_REACHED"

    orig = (
        c.table("pantry_items")
        .select("*")
        .eq("id", hist["pantry_item_id"])
        .limit(1)
        .execute()
    )
    orig_rows = orig.data if orig.data else []
    if not orig_rows:
        return None, "PANTRY_ITEM_MISSING"
    old = orig_rows[0]

    use_until = date.fromordinal(today.toordinal() + USE_SOON_DAYS)
    pid = old["id"]
    updates = {
        "deleted_at": None,
        "use_soon": True,
        "use_soon_expires": use_until.isoformat(),
        "hard_expire_date": use_until.isoformat(),
        "available_until": use_until.isoformat(),
        "put_back_count": int(hist.get("put_back_count") or 0) + 1,
        "confidence_override": PUT_BACK_CONFIDENCE_OVERRIDE,
        "confidence_override_expires": use_until.isoformat(),
    }
    c.table("pantry_items").update(updates).eq("id", pid).execute()
    refreshed = (
        c.table("pantry_items").select("*").eq("id", pid).limit(1).execute()
    )
    out = refreshed.data[0] if refreshed.data else None
    return out, None


def _client(client: Any) -> Any:
    """Prefer service-role client when present; else anon client; else raw client."""
    admin = getattr(client, "admin_client", None)
    if admin:
        return admin
    anon = getattr(client, "client", None)
    if anon:
        return anon
    return client
