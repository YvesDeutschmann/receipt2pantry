"""Generate suggestion pool with simulated pantry depletion across the planning window."""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

from backend.services.depletion_engine import DepletionEngine
from backend.services.meal_plan_service import MealPlanService
from backend.services.pool_store_service import PoolStoreService
from backend.services.recipe_service import RecipeService
from backend.utils.exceptions import AIServiceException, RecipeQuotaException
from backend.utils.logger import get_logger

logger = get_logger(__name__)

ORDERED_MEALS = ("breakfast", "lunch", "dinner")
INGREDIENT_SPARSE_THRESHOLD = 3


def meal_types_from_slots(slots: Optional[Dict[str, Any]]) -> List[str]:
    """Return selected meal types in B/L/D order (at least one required by caller)."""
    s = slots or {}
    return [m for m in ORDERED_MEALS if s.get(m)]


class PoolGenerator:
    def __init__(
        self,
        pool_store: PoolStoreService,
        depletion: DepletionEngine,
        recipe_service: RecipeService,
        meal_plan_service: MealPlanService,
    ):
        self.pool_store = pool_store
        self.depletion = depletion
        self.recipe_service = recipe_service
        self.meal_plan_service = meal_plan_service
        self.supabase = pool_store.supabase

    def _client(self):
        return self.supabase.admin_client if self.supabase.admin_client else self.supabase.client

    def _load_banned_ids(self, user_id: str) -> Set[str]:
        try:
            res = (
                self._client()
                .table("recipe_bans")
                .select("recipe_id")
                .eq("user_id", user_id)
                .gt("expires_at", datetime.now(timezone.utc).isoformat())
                .execute()
            )
            return {str(b["recipe_id"]) for b in (res.data or [])}
        except Exception as e:
            logger.warning(f"Could not load recipe bans: {e}")
            return set()

    def _filter_recipes(
        self,
        recipes: List[Dict],
        threshold: float,
        banned: Set[str],
        swiped: Set[str],
        run_ids: Set[str],
    ) -> List[Dict]:
        out = []
        for recipe in recipes:
            rid = str(recipe.get("id", ""))
            is_staple = recipe.get("is_staple", False) or rid.startswith("staple_")
            if rid in banned or rid in swiped or rid in run_ids:
                continue
            if is_staple:
                recipe = dict(recipe)
                recipe["match_percentage"] = recipe.get("match_percentage", 1.0)
                out.append(recipe)
                continue
            used = recipe.get("usedIngredientCount", 0)
            missed = recipe.get("missedIngredientCount", 0)
            total = used + missed
            if total == 0:
                continue
            match_pct = used / total
            if match_pct >= threshold:
                r2 = dict(recipe)
                r2["match_percentage"] = match_pct
                out.append(r2)
        out.sort(key=lambda x: x.get("match_percentage", 0), reverse=True)
        return out

    def _recipes_for_step(
        self,
        simulated: Dict[str, Dict],
        meal_type: str,
        household_id: str,
        user_id: str,
        banned: Set[str],
        swiped: Set[str],
        run_ids: Set[str],
    ) -> List[Dict]:
        av = self.depletion.available_ingredient_names(simulated)
        candidates: List[Dict] = []

        if len(av) < INGREDIENT_SPARSE_THRESHOLD and meal_type in ("breakfast", "lunch"):
            import asyncio

            try:
                loop = asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            staples = loop.run_until_complete(
                self.meal_plan_service.suggest_staple_meals(simulated, meal_type)
            )
            candidates = self._filter_recipes(staples, 0.0, banned, swiped, run_ids)
        elif not av:
            return []
        else:
            try:
                raw = self.recipe_service.search_recipes_complex(
                    household_id, user_id, av, meal_type, number=5
                )
            except RecipeQuotaException:
                raise
            except AIServiceException:
                raise
            except Exception as e:
                logger.error(f"findByIngredients failed: {e}")
                raise

            threshold = 0.9
            while threshold >= 0.7:
                candidates = self._filter_recipes(raw, threshold, banned, swiped, run_ids)
                if candidates:
                    break
                threshold -= 0.1
            if not candidates and meal_type in ("breakfast", "lunch"):
                import asyncio

                try:
                    loop = asyncio.get_event_loop()
                except RuntimeError:
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                candidates = loop.run_until_complete(
                    self.meal_plan_service.suggest_staple_meals(simulated, meal_type)
                )
                candidates = self._filter_recipes(candidates, 0.0, banned, swiped, run_ids)

        return candidates[:5]

    def generate_pool(
        self,
        household_id: str,
        user_id: str,
        trigger_reason: str,
        meal_types: List[str],
    ) -> Dict[str, Any]:
        start = self.pool_store.start_generation(
            household_id, user_id, trigger_reason, meal_types
        )
        gen_id = start["generation_id"]
        if start.get("already_running"):
            return {
                "generation_id": gen_id,
                "status": "already_running",
                "suggestions_generated": 0,
            }

        total_inserted = 0
        final_status = "completed"
        err_msg: Optional[str] = None
        accumulated_rows: List[Dict[str, Any]] = []

        try:
            swiped = self.pool_store.get_swiped_recipe_ids(household_id)
            banned = self._load_banned_ids(user_id)
            simulated = self.depletion.snapshot_pantry(user_id, household_id)
            # Do not clear_unused until generation completes successfully — preserves
            # existing pool on partial/failed runs (SUG-015/016).

            run_ids: Set[str] = set()

            stop_steps = False
            for _day in range(7):
                if stop_steps:
                    break
                for meal_type in meal_types:
                    try:
                        candidates = self._recipes_for_step(
                            simulated,
                            meal_type,
                            household_id,
                            user_id,
                            banned,
                            swiped,
                            run_ids,
                        )
                    except (AIServiceException, RecipeQuotaException) as e:
                        err_msg = str(e)
                        final_status = "partial"
                        stop_steps = True
                        break
                    if not candidates:
                        continue

                    rows: List[Dict[str, Any]] = []
                    for c in candidates:
                        rid = str(c.get("id", ""))
                        if not rid or rid in run_ids:
                            continue
                        recipe_data = dict(c)
                        recipe_data.setdefault("title", c.get("title"))
                        rows.append(
                            {
                                "meal_type": meal_type,
                                "recipe_id": rid,
                                "recipe_name": c.get("title", ""),
                                "recipe_image": c.get("image"),
                                "recipe_data": recipe_data,
                                "match_score": c.get("match_percentage"),
                            }
                        )

                    for r in rows:
                        run_ids.add(str(r["recipe_id"]))

                    accumulated_rows.extend(rows)

                    top = candidates[0]
                    top_id = str(top.get("id", ""))
                    if top_id.startswith("staple_"):
                        continue
                    try:
                        inline_ex = top.get("extendedIngredients")
                        if inline_ex:
                            ex = inline_ex
                        else:
                            details = self.recipe_service.get_recipe_details(
                                int(top["id"])
                            )
                            members = self.supabase.get_household_members(household_id)
                            member_count = len(members) if members else 1
                            orig = details.get("servings", member_count) or 1
                            if orig != member_count:
                                details = self.recipe_service.scale_recipe(
                                    details, member_count
                                )
                            ex = details.get("extendedIngredients") or []
                        simulated = self.depletion.deplete_from_extended_ingredients(
                            simulated, ex
                        )
                    except RecipeQuotaException:
                        raise
                    except Exception as e:
                        logger.warning(f"Depletion step skipped for recipe {top_id}: {e}")

                if stop_steps:
                    break

            if final_status == "completed":
                self.pool_store.clear_unused(household_id)
                total_inserted = self.pool_store.add_suggestions(
                    household_id, user_id, gen_id, accumulated_rows
                )

        except Exception as e:
            logger.error(f"Pool generation failed: {e}", exc_info=True)
            final_status = "failed"
            err_msg = str(e)
        finally:
            self.pool_store.complete_generation(
                gen_id,
                final_status,
                total_inserted,
                error_message=err_msg,
            )

        return {
            "generation_id": gen_id,
            "status": final_status,
            "suggestions_generated": total_inserted,
            "error": err_msg,
        }


def create_pool_generator(
    pool_store: PoolStoreService,
    depletion: DepletionEngine,
    recipe_service: RecipeService,
    meal_plan_service: MealPlanService,
) -> PoolGenerator:
    return PoolGenerator(pool_store, depletion, recipe_service, meal_plan_service)
