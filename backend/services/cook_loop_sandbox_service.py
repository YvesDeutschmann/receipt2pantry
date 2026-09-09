"""DEV cook-loop sandbox: paired pantry + pool card seeding and machine grading."""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.services.confidence_engine import process_cook_event
from backend.services.pantry_service import PantryService
from backend.services.pool_store_service import PoolStoreService
from backend.services.supabase_service import SupabaseService
from backend.utils.exceptions import DatabaseException, ValidationException
from backend.utils.logger import get_logger

logger = get_logger(__name__)

COOK_BOM_MAX = 30
DEV_RECIPE_ID = "dev_cook_loop"
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_FIXTURE_PATH = _PROJECT_ROOT / "data" / "fixtures" / "cook_loop_sandbox.json"


def load_cook_loop_fixture() -> Dict[str, Any]:
    with open(_FIXTURE_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError("cook_loop_sandbox.json must be a JSON object")
    return data


def build_cook_bom_from_extended_ingredients(
    extended_ingredients: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Mirror frontend buildCookIngredients: unique trimmed names, amount 1, unit serving.
    """
    seen: set[str] = set()
    result: List[Dict[str, Any]] = []
    for ing in extended_ingredients or []:
        if not isinstance(ing, dict):
            continue
        name = str(ing.get("name") or "").strip()
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        if len(result) >= COOK_BOM_MAX:
            break
        result.append({"name": name, "amount": 1, "unit": "serving"})
    return result


def _check(
    checks: List[Dict[str, Any]], check_id: str, ok: bool, expected: Any, actual: Any
) -> None:
    checks.append(
        {
            "id": check_id,
            "ok": ok,
            "expected": expected,
            "actual": actual,
        }
    )


def _pantry_by_base(pantry: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for row in pantry:
        base = (row.get("base_ingredient") or "").strip().lower()
        if base and base not in out:
            out[base] = row
    return out


def _bases_from_touched(touched: List[Dict[str, Any]]) -> List[str]:
    return sorted(
        {
            (t.get("base_ingredient") or "").strip().lower()
            for t in touched
            if (t.get("base_ingredient") or "").strip()
        }
    )


def _latest_cooking_log(
    client: Any, user_id: str, household_id: str, recipe_id: str
) -> Optional[Dict[str, Any]]:
    q = (
        client.table("cooking_log")
        .select("*")
        .eq("recipe_id", recipe_id)
        .order("cooked_at", desc=True)
        .limit(1)
    )
    if household_id:
        q = q.eq("household_id", household_id)
    else:
        q = q.eq("user_id", user_id)
    res = q.execute()
    rows = res.data if res.data else []
    return rows[0] if rows else None


class CookLoopSandboxService:
    def __init__(
        self,
        supabase: SupabaseService,
        pantry: PantryService,
        pool_store: PoolStoreService,
    ):
        self.supabase = supabase
        self.pantry = pantry
        self.pool_store = pool_store

    def _client(self):
        return self.supabase.admin_client or self.supabase.client

    async def reset(
        self, user_id: str, household_id: str, *, today: Optional[date] = None
    ) -> Dict[str, Any]:
        fixture = load_cook_loop_fixture()
        recipe_id = str(fixture.get("recipe_id") or DEV_RECIPE_ID)
        anchor = today or date.today()

        self.supabase.reset_household_pantry(household_id)
        self.pool_store.delete_by_recipe_id(household_id, recipe_id)

        pantry_item_ids: Dict[str, str] = {}
        seed_checks: List[Dict[str, Any]] = []

        for row in fixture.get("pantry") or []:
            base = (row.get("base_ingredient") or "").strip()
            if not base:
                continue
            qty = float(row.get("quantity") or 1)
            unit = str(row.get("unit") or "count")
            expected_class = str(row.get("expected_depletion_class") or "").upper()
            normalized = {
                "base_ingredient": base,
                "variant": None,
                "normalized_name": base,
                "product_type": None,
                "category": None,
                "tags": [],
            }
            item_id = await self.pantry.add_to_pantry(
                user_id,
                normalized,
                qty,
                unit,
                receipt_id=None,
                household_id=household_id,
                reference_date=anchor,
            )
            pantry_item_ids[base] = str(item_id)

        live = self.supabase.get_household_pantry(household_id)
        by_base = _pantry_by_base(live)

        for row in fixture.get("pantry") or []:
            base = (row.get("base_ingredient") or "").strip()
            expected_class = str(row.get("expected_depletion_class") or "").upper()
            expected_qty = float(row.get("quantity") or 1)
            actual = by_base.get(base.lower())
            if not actual:
                raise ValidationException(
                    f"Seed failed: pantry row missing for {base}"
                )
            actual_class = str(actual.get("depletion_class") or "").upper()
            if actual_class != expected_class:
                raise ValidationException(
                    f"Seed failed: {base} depletion_class {actual_class} != {expected_class}"
                )
            actual_qty = float(actual.get("quantity") or 0)
            if actual_qty != expected_qty:
                raise ValidationException(
                    f"Seed failed: {base} quantity {actual_qty} != {expected_qty}"
                )
            _check(
                seed_checks,
                f"seed_class_{base.replace(' ', '_')}",
                actual_class == expected_class,
                expected_class,
                actual_class,
            )

        pool_card = fixture.get("pool_card") or {}
        ext = pool_card.get("extendedIngredients") or []
        recipe_data = {
            "title": pool_card.get("title") or "[DEV] Cook-loop pasta",
            "servings": pool_card.get("servings") or 4,
            "extendedIngredients": ext,
        }
        pool_suggestion_id = self.pool_store.insert_pool_row(
            household_id,
            user_id,
            meal_type=str(pool_card.get("meal_type") or "dinner"),
            recipe_id=recipe_id,
            recipe_name=recipe_data["title"],
            recipe_data=recipe_data,
            match_score=float(pool_card.get("match_score") or 0.9999),
        )

        report = self.grade(
            user_id,
            household_id,
            mode="seed",
            cook_touched=None,
            extra_checks=seed_checks,
            recipe_id=recipe_id,
        )
        report["pantry_item_ids"] = pantry_item_ids
        report["pool_suggestion_id"] = pool_suggestion_id
        report["seed_checks"] = seed_checks
        self._log_report(report)
        return report

    def cook(
        self,
        user_id: str,
        household_id: str,
        pool_suggestion_id: Optional[str],
        *,
        today: Optional[date] = None,
    ) -> Dict[str, Any]:
        """Apply fixture BOM via process_cook_event and swipe the DEV pool row."""
        anchor = today or date.today()
        fixture = load_cook_loop_fixture()
        recipe_id = str(fixture.get("recipe_id") or DEV_RECIPE_ID)
        pool_card = fixture.get("pool_card") or {}
        ext = pool_card.get("extendedIngredients") or []
        ingredients = build_cook_bom_from_extended_ingredients(ext)
        servings = int(pool_card.get("servings") or 4)
        title = str(pool_card.get("title") or "[DEV] Cook-loop pasta")

        client = self._client()
        touched = process_cook_event(
            client,
            user_id,
            recipe_id,
            servings,
            ingredients,
            today=anchor,
            recipe_name=title,
            household_id=household_id,
        )
        if pool_suggestion_id:
            self.pool_store.update_status(
                str(pool_suggestion_id), household_id, "swiped"
            )

        report = self.grade(
            user_id,
            household_id,
            mode="run",
            cook_touched=touched,
            recipe_id=recipe_id,
        )
        report["pool_suggestion_id"] = pool_suggestion_id
        self._log_report(report)
        return report

    async def run_async(
        self,
        user_id: str,
        household_id: str,
        *,
        today: Optional[date] = None,
    ) -> Dict[str, Any]:
        anchor = today or date.today()
        reset_report = await self.reset(user_id, household_id, today=anchor)
        return self.cook(
            user_id,
            household_id,
            reset_report.get("pool_suggestion_id"),
            today=anchor,
        )

    def grade(
        self,
        user_id: str,
        household_id: str,
        *,
        mode: str = "observe",
        cook_touched: Optional[List[Dict[str, Any]]] = None,
        extra_checks: Optional[List[Dict[str, Any]]] = None,
        recipe_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        fixture = load_cook_loop_fixture()
        rid = recipe_id or str(fixture.get("recipe_id") or DEV_RECIPE_ID)
        expect = fixture.get("expect") or {}
        checks: List[Dict[str, Any]] = list(extra_checks or [])

        pantry = self.supabase.get_household_pantry(household_id)
        by_base = _pantry_by_base(pantry)

        if mode in ("run", "observe") and cook_touched is None:
            log_row = _latest_cooking_log(
                self._client(), user_id, household_id, rid
            )
            if log_row:
                raw = log_row.get("ingredients_used") or []
                if isinstance(raw, list):
                    cook_touched = [
                        {
                            "pantry_item_id": i.get("pantry_item_id"),
                            "base_ingredient": i.get("base_ingredient"),
                            "depletion_class": i.get("depletion_class"),
                        }
                        for i in raw
                        if isinstance(i, dict)
                    ]

        touched_bases = _bases_from_touched(cook_touched or [])
        expected_touched = sorted(
            (b.strip().lower() for b in (expect.get("touched_bases") or []))
        )
        if mode in ("run", "observe"):
            _check(
                checks,
                "touched_bases",
                touched_bases == expected_touched,
                expected_touched,
                touched_bases,
            )

            not_touched = [
                b.strip().lower() for b in (expect.get("not_touched_bases") or [])
            ]
            for base in not_touched:
                hit = base in touched_bases
                _check(
                    checks,
                    f"not_touched_{base.replace(' ', '_')}",
                    not hit,
                    f"{base} absent from touched",
                    touched_bases,
                )

            pasta = by_base.get("pasta")
            expected_rem = expect.get("pasta_quantity_remaining")
            if expected_rem is not None and pasta:
                actual_rem = pasta.get("quantity_remaining")
                if actual_rem is None and mode == "seed":
                    actual_rem = pasta.get("quantity_purchased")
                rem_ok = pasta.get("deleted_at") is None
                if actual_rem is None:
                    rem_ok = False
                else:
                    rem_ok = rem_ok and float(actual_rem) == float(expected_rem)
                _check(
                    checks,
                    "pasta_quantity_remaining",
                    rem_ok,
                    expected_rem,
                    actual_rem,
                )

            for base in not_touched:
                row = by_base.get(base)
                if not row:
                    continue
                rem = row.get("quantity_remaining")
                purchased = row.get("quantity_purchased")
                unchanged = row.get("deleted_at") is None and (
                    rem is None
                    or (
                        purchased is not None
                        and float(rem) == float(purchased)
                    )
                )
                _check(
                    checks,
                    f"{base.replace(' ', '_')}_unchanged",
                    unchanged,
                    "live with full remaining",
                    {
                        "deleted_at": row.get("deleted_at"),
                        "quantity_remaining": rem,
                    },
                )

            pool_row = self.pool_store.get_pool_row_by_recipe_id(household_id, rid)
            expected_status = expect.get("pool_status")
            if expected_status and mode in ("run", "observe"):
                actual_status = (pool_row or {}).get("status")
                _check(
                    checks,
                    "pool_status",
                    actual_status == expected_status,
                    expected_status,
                    actual_status,
                )

            log_row = _latest_cooking_log(
                self._client(), user_id, household_id, rid
            )
            _check(
                checks,
                "cooking_log_exists",
                log_row is not None,
                True,
                log_row is not None,
            )
            if log_row and expected_touched:
                log_bases = _bases_from_touched(
                    log_row.get("ingredients_used") or []
                )
                _check(
                    checks,
                    "cooking_log_bases",
                    log_bases == expected_touched,
                    expected_touched,
                    log_bases,
                )

        ok = all(c.get("ok") for c in checks) if checks else True
        return {
            "ok": ok,
            "recipe_id": rid,
            "mode": mode,
            "checks": checks,
            "cook": {"touched": cook_touched or []} if cook_touched else None,
            "logged_at": datetime.now(timezone.utc).isoformat(),
        }

    @staticmethod
    def _log_report(report: Dict[str, Any]) -> None:
        failed = [c["id"] for c in report.get("checks") or [] if not c.get("ok")]
        logger.info(
            "[cook_loop_qa] ok=%s mode=%s failed=%s",
            report.get("ok"),
            report.get("mode"),
            ",".join(failed) if failed else "none",
        )
        logger.info("[cook_loop_qa] %s", json.dumps(report, default=str))


def create_cook_loop_sandbox_service(
    supabase: SupabaseService,
    pantry: PantryService,
    pool_store: PoolStoreService,
) -> CookLoopSandboxService:
    return CookLoopSandboxService(supabase, pantry, pool_store)
