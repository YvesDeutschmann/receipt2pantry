"""
Phase 3: recipe suggestion ranking — tiered, scored results for UI (no UI here).
"""

from __future__ import annotations

import hashlib
import json
import time
from datetime import date
from difflib import SequenceMatcher
from typing import TYPE_CHECKING, Any, Callable, Dict, List, Optional, Tuple

from backend.config import Config
from backend.services.recipe_meal_filter import is_appropriate_for_meal, is_treat
from backend.services.confidence_engine import (
    _find_pantry_match,
    _to_date,
    compute_confidence,
    get_calibrated_days_supply,
    get_engagement_multiplier,
)
from backend.services.pantry_service import PantryService
from backend.services.recipe_service import RecipeService
from backend.services.supabase_service import SupabaseService
from backend.utils.exceptions import AIServiceException, RecipeQuotaException, ValidationException
from backend.utils.logger import get_logger

if TYPE_CHECKING:
    from backend.services.pool_store_service import PoolStoreService

logger = get_logger(__name__)

ASPIRATIONAL_DISMISS_THRESHOLD = 3
ASPIRATIONAL_CONFIDENCE_PENALTY = 0.15
SUGGESTION_CACHE_TTL_SECONDS = 30 * 60
CANDIDATE_NUMBER = 50

DEFAULT_USER_PREFS: Dict[str, Any] = {"depletion_multiplier": 1.0}


def _confidence_threshold_for_pantry_size(pantry_item_count: int) -> float:
    """
    Return the minimum confidence required to include a pantry item in the
    ingredient list sent to Spoonacular.

    Breakpoints (chosen to match onboarding staples flow):
      0–2 items  → 0.0  (any item used, even freshly added staples)
      3–9 items  → 0.20 (check_first tier and above)
      ≥ 10 items → 0.50 (probably_have tier and above — normal operation)
    """
    if pantry_item_count < 3:
        return 0.0
    if pantry_item_count < 10:
        return 0.20
    return 0.50


def _empty_suggestion_tiers() -> Dict[str, List[Dict]]:
    return {
        "use_soon_shelf": [],
        "cook_tonight": [],
        "probably_have": [],
        "check_first": [],
    }


def _attach_meta(
    result: Dict[str, Any],
    *,
    fallback_mode: bool,
    pantry_item_count: int,
    threshold_used: float,
) -> Dict[str, Any]:
    result["meta"] = {
        "fallback_mode": bool(fallback_mode),
        "pantry_item_count": pantry_item_count,
        "threshold_used": float(threshold_used),
    }
    return result


def _pool_fallback_suggestion_result(
    pool_store: "PoolStoreService",
    household_id: str,
) -> Optional[Dict[str, Any]]:
    """Try unused pool rows, then swiped (read-only)."""
    grouped = pool_store.get_pool_grouped_by_meal(household_id, status="unused")
    if any(grouped.values()):
        return _pool_grouped_to_suggestion_result(grouped)
    grouped = pool_store.get_pool_grouped_by_meal(household_id, status="swiped")
    if any(grouped.values()):
        return _pool_grouped_to_suggestion_result(grouped)
    return None


def _pool_grouped_to_suggestion_result(
    grouped: Dict[str, List[Dict]],
) -> Dict[str, List[Dict]]:
    """Convert pool rows grouped by meal into SuggestionResult-shaped tiers."""
    results: Dict[str, List[Dict]] = {
        "use_soon_shelf": [],
        "cook_tonight": [],
        "probably_have": [],
        "check_first": [],
    }
    for rows in grouped.values():
        for row in rows:
            recipe_id = row.get("recipe_id")
            if recipe_id is None:
                continue
            raw_score = row.get("match_score")
            score = float(raw_score) if raw_score is not None else 0.0
            if score >= 0.90:
                tier = "cook_tonight"
            elif score >= 0.70:
                tier = "probably_have"
            else:
                tier = "check_first"
            card = {
                "id": str(recipe_id),
                "title": row.get("recipe_name") or "",
                "image": row.get("recipe_image"),
                "tier": tier,
                "ingredient_flags": [],
                "score": score,
                "trigger_ingredient": None,
            }
            results[tier].append(card)
    for key in ("cook_tonight", "probably_have", "check_first"):
        results[key].sort(key=lambda r: float(r.get("score") or 0.0), reverse=True)
    return results


def get_tier(min_required_confidence: float) -> str:
    if min_required_confidence >= 0.75:
        return "cook_tonight"
    if min_required_confidence >= 0.50:
        return "probably_have"
    if min_required_confidence >= 0.20:
        return "check_first"
    return "suppressed"


def get_status_label(confidence: float, is_use_soon: bool) -> Optional[str]:
    if is_use_soon:
        return "check_freshness"
    if confidence >= 0.75:
        return "confirmed"
    if confidence >= 0.50:
        return "probably_have"
    if confidence >= 0.20:
        return "check_pantry"
    return None


def find_best_match(
    pantry_list: List[Dict], ingredient_name: str
) -> Optional[Dict]:
    """Exact + word-subset match (confidence_engine), then difflib ratio > 0.8."""
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
        ratio = SequenceMatcher(None, base, n).ratio()
        if ratio > best_score:
            best_score = ratio
            best = p
    if best is not None and best_score > 0.8:
        return best
    return None


def _is_spice_aisle(aisle: Optional[str]) -> bool:
    if not aisle:
        return False
    a = aisle.lower()
    return "spice" in a or "seasoning" in a or "herb" in a


def _signal_key_for_pantry_item(pantry_item: Dict) -> str:
    """Must match ingredient_signals.item_name (normalized base ingredient)."""
    return (pantry_item.get("base_ingredient") or "").strip().lower()


class SuggestionService:
    """Builds ranked SuggestionResult from pantry + Spoonacular."""

    def __init__(
        self,
        supabase: SupabaseService,
        pantry_service: PantryService,
        recipe_service: RecipeService,
        config: Config,
        pool_store: Optional["PoolStoreService"] = None,
    ):
        self.supabase = supabase
        self.pantry_service = pantry_service
        self.recipe_service = recipe_service
        self.config = config
        self.pool_store = pool_store
        self._result_cache: Dict[str, Tuple[Dict, float]] = {}

    def _client_for_db(self) -> Any:
        return self.supabase.admin_client or self.supabase.client

    def _get_household_id(self, user_id: str) -> Optional[str]:
        return self.pantry_service._get_household_id_for_user(user_id)

    def _load_active_pantry(
        self, user_id: str, household_id: Optional[str]
    ) -> List[Dict]:
        items = self.pantry_service._get_pantry_items(user_id, household_id)
        return [p for p in items if not p.get("deleted_at")]

    def invalidate_suggestion_cache(self, user_id: str, household_id: Optional[str]) -> None:
        """Clear cached SuggestionResult for a user (e.g. after dismiss)."""
        prefix = f"{user_id}:{household_id or ''}:"
        keys = [k for k in self._result_cache if k.startswith(prefix)]
        for k in keys:
            self._result_cache.pop(k, None)

    def fetch_candidate_recipes(
        self,
        user_id: str,
        household_id: Optional[str],
        ingredient_names: List[str],
    ) -> List[Dict]:
        """Spoonacular findByIngredients with Phase 3 parameters + 30m cache."""
        if not self.recipe_service:
            return []
        return self.recipe_service.get_recipes_by_pantry(
            household_id,
            user_id,
            available_ingredients=ingredient_names,
            number=CANDIDATE_NUMBER,
            ranking=1,
            ignore_pantry=True,
            cache_ttl_seconds=SUGGESTION_CACHE_TTL_SECONDS,
        )

    def _build_suggestion_cache_key(
        self,
        user_id: str,
        household_id: Optional[str],
        pantry: List[Dict],
        ingredient_list: List[str],
        user_prefs: Dict[str, Any],
    ) -> str:
        h = hashlib.sha256()
        h.update(f"{user_id}:{household_id or ''}".encode())
        for pid in sorted({str(p.get("id")) for p in pantry if p.get("id")}):
            h.update(pid.encode())
        h.update(",".join(sorted(ingredient_list)).encode())
        h.update(json.dumps(user_prefs, sort_keys=True, default=str).encode())
        return h.hexdigest()

    def get_recipe_suggestions(
        self,
        user_id: str,
        household_id: Optional[str] = None,
        *,
        today: Optional[date] = None,
        now: Optional[Callable[[], float]] = None,
    ) -> Dict[str, Any]:
        """
        Returns SuggestionResult-shaped dict:
        use_soon_shelf, cook_tonight, probably_have, check_first — each a list of recipe dicts.
        """
        if not self.recipe_service:
            raise ValidationException("Recipe service not available (Spoonacular key missing)")

        if today is None:
            today = date.today()

        clock = now or time.time

        if household_id is None:
            household_id = self._get_household_id(user_id)

        if self.pool_store is not None and household_id:
            depth = self.pool_store.get_pool_depth(household_id)
            if sum(depth.values()) > 0:
                grouped = self.pool_store.get_pool_grouped_by_meal(
                    household_id, status="unused"
                )
                result = _pool_grouped_to_suggestion_result(grouped)
                has_cards = any(
                    result[k]
                    for k in (
                        "use_soon_shelf",
                        "cook_tonight",
                        "probably_have",
                        "check_first",
                    )
                )
                if has_cards:
                    pantry_count = len(
                        self._load_active_pantry(user_id, household_id)
                    )
                    pool_threshold = _confidence_threshold_for_pantry_size(
                        pantry_count
                    )
                    return _attach_meta(
                        result,
                        fallback_mode=pool_threshold < 0.50,
                        pantry_item_count=pantry_count,
                        threshold_used=pool_threshold,
                    )

        pantry = self._load_active_pantry(user_id, household_id)
        threshold = _confidence_threshold_for_pantry_size(len(pantry))
        fallback_mode = threshold < 0.50
        prefs_row = self.supabase.get_user_preferences(user_id)
        user_prefs = dict(DEFAULT_USER_PREFS)
        if prefs_row:
            if prefs_row.get("depletion_multiplier") is not None:
                user_prefs["depletion_multiplier"] = float(
                    prefs_row["depletion_multiplier"]
                )

        client = self._client_for_db()
        engagement = get_engagement_multiplier(client, user_id)

        bases = [
            (p.get("base_ingredient") or "").strip().lower()
            for p in pantry
            if p.get("base_ingredient")
        ]
        classifications = self.supabase.get_item_classifications_by_names(bases)

        calibrated_by_base: Dict[str, int] = {}

        def calibrated_for(base: str) -> int:
            if base not in calibrated_by_base:
                cls = classifications.get(base, {})
                default = cls.get("default_days_supply")
                if default is None:
                    default = 45
                calibrated_by_base[base] = get_calibrated_days_supply(
                    client, user_id, base, int(default)
                )
            return calibrated_by_base[base]

        confidences_by_id: Dict[str, float] = {}
        for p in pantry:
            bid = str(p.get("id") or "")
            base = (p.get("base_ingredient") or "").strip().lower()
            cls = classifications.get(base, {})
            cal = calibrated_for(base) if base else 45
            confidences_by_id[bid] = compute_confidence(
                p,
                user_prefs,
                cls,
                today=today,
                calibrated_days=cal,
                engagement_multiplier=engagement,
            )

        use_soon_items: List[Dict] = []
        for p in pantry:
            if not p.get("use_soon"):
                continue
            exp = _to_date(p.get("use_soon_expires"))
            if exp is not None and exp >= today:
                use_soon_items.append(p)

        high_conf_names: List[str] = []
        for p in pantry:
            bid = str(p.get("id") or "")
            c = confidences_by_id.get(bid, 0.0)
            base = (p.get("base_ingredient") or "").strip().lower()
            if base and c >= threshold:
                high_conf_names.append(base)

        use_soon_names = [
            (_signal_key_for_pantry_item(p) or "") for p in use_soon_items
        ]
        use_soon_names = [n for n in use_soon_names if n]

        ingredient_list = sorted(set(high_conf_names + use_soon_names))

        if not ingredient_list and len(pantry) > 0:
            ingredient_list = sorted(
                {
                    (p.get("base_ingredient") or "").strip().lower()
                    for p in pantry
                    if (p.get("base_ingredient") or "").strip()
                }
            )
            fallback_mode = True

        if not ingredient_list:
            empty = _empty_suggestion_tiers()
            if len(pantry) > 0:
                if self.pool_store is not None and household_id:
                    fb = _pool_fallback_suggestion_result(
                        self.pool_store, household_id
                    )
                    if fb is not None:
                        return _attach_meta(
                            fb,
                            fallback_mode=True,
                            pantry_item_count=len(pantry),
                            threshold_used=threshold,
                        )
                return _attach_meta(
                    empty,
                    fallback_mode=True,
                    pantry_item_count=len(pantry),
                    threshold_used=threshold,
                )
            return _attach_meta(
                empty,
                fallback_mode=False,
                pantry_item_count=0,
                threshold_used=threshold,
            )

        cache_key_full = self._build_suggestion_cache_key(
            user_id, household_id, pantry, ingredient_list, user_prefs
        )
        ck = f"{user_id}:{household_id or ''}:{cache_key_full}"
        ent = self._result_cache.get(ck)
        if ent:
            payload, ts = ent
            if clock() - ts < SUGGESTION_CACHE_TTL_SECONDS:
                return _attach_meta(
                    payload,
                    fallback_mode=fallback_mode,
                    pantry_item_count=len(pantry),
                    threshold_used=threshold,
                )

        try:
            candidates = self.fetch_candidate_recipes(
                user_id, household_id, ingredient_list
            )
        except AIServiceException as exc:
            logger.warning("Spoonacular unavailable, attempting fallback: %s", exc)
            stale = self._result_cache.get(ck)
            if stale is not None:
                payload = stale[0]
                return _attach_meta(
                    payload,
                    fallback_mode=fallback_mode,
                    pantry_item_count=len(pantry),
                    threshold_used=threshold,
                )
            if self.pool_store is not None and household_id:
                fb = _pool_fallback_suggestion_result(
                    self.pool_store, household_id
                )
                if fb is not None:
                    return _attach_meta(
                        fb,
                        fallback_mode=True,
                        pantry_item_count=len(pantry),
                        threshold_used=threshold,
                    )
            raise

        signals = self.supabase.get_ingredient_signal_counts(user_id)

        results: Dict[str, List[Dict]] = {
            "use_soon_shelf": [],
            "cook_tonight": [],
            "probably_have": [],
            "check_first": [],
        }

        for summary in candidates:
            rid = summary.get("id")
            if rid is None:
                continue
            try:
                details = self.recipe_service.get_recipe_details(int(rid))
            except AIServiceException:
                break
            except Exception as e:
                logger.warning("Skipping recipe %s: %s", rid, e)
                continue

            scored = self.score_recipe(
                details,
                pantry,
                user_prefs,
                use_soon_items,
                signals,
                classifications,
                today=today,
                engagement_multiplier=engagement,
                calibrated_for_base=calibrated_for,
                meal_type=None,
            )
            tier = scored.get("tier")
            if tier == "suppressed":
                continue
            if tier == "use_soon":
                results["use_soon_shelf"].append(scored)
            elif tier == "cook_tonight":
                results["cook_tonight"].append(scored)
            elif tier == "probably_have":
                results["probably_have"].append(scored)
            elif tier == "check_first":
                results["check_first"].append(scored)

        for key in results:
            results[key].sort(key=lambda r: float(r.get("score") or 0.0), reverse=True)

        tier_keys = ("use_soon_shelf", "cook_tonight", "probably_have", "check_first")
        if all(len(results[k]) == 0 for k in tier_keys) and len(pantry) > 0:
            logger.warning(
                json.dumps(
                    {
                        "event": "sparse_pantry_no_results",
                        "pantry_item_count": len(pantry),
                        "ingredient_count": len(ingredient_list),
                        "fallback_mode": fallback_mode,
                    }
                )
            )
            if self.pool_store is not None and household_id:
                fb = _pool_fallback_suggestion_result(
                    self.pool_store, household_id
                )
                if fb is not None:
                    return _attach_meta(
                        fb,
                        fallback_mode=True,
                        pantry_item_count=len(pantry),
                        threshold_used=threshold,
                    )

        _attach_meta(
            results,
            fallback_mode=fallback_mode,
            pantry_item_count=len(pantry),
            threshold_used=threshold,
        )
        self._result_cache[ck] = (results, clock())
        return results

    def score_recipe(
        self,
        recipe: Dict,
        pantry_list: List[Dict],
        user_prefs: Dict,
        use_soon_items: List[Dict],
        signals: Dict[str, int],
        classifications: Dict[str, Dict],
        *,
        today: date,
        engagement_multiplier: float = 1.0,
        calibrated_for_base: Optional[Callable[[str], int]] = None,
        confidence_override_by_base: Optional[Dict[str, float]] = None,
        meal_type: Optional[str] = None,
    ) -> Dict:
        """
        Score one recipe. Returns a recipe card dict, or {"tier": "suppressed"} if suppressed.
        """
        dish_types = recipe.get("dishTypes") or []
        if is_treat(dish_types):
            return {"tier": "suppressed"}
        if meal_type and not is_appropriate_for_meal(dish_types, meal_type):
            return {"tier": "suppressed"}

        extended = recipe.get("extendedIngredients") or []
        if not extended:
            return {"tier": "suppressed"}
        ingredient_flags: List[Dict[str, Any]] = []

        def cal_default(base: str) -> int:
            if calibrated_for_base:
                return calibrated_for_base(base)
            cls = classifications.get(base, {})
            d = cls.get("default_days_supply")
            return int(d) if d is not None else 45

        min_required = 1.0
        required_conf_entries: List[Tuple[str, float]] = []

        use_soon_ids = {str(x.get("id")) for x in use_soon_items if x.get("id")}
        use_soon_hit: set = set()

        for ing in extended:
            raw_name = (ing.get("name") or ing.get("original") or "").strip()
            name = raw_name.lower()
            if not name:
                continue
            aisle = ing.get("aisle")

            pantry_item = find_best_match(pantry_list, name)
            base_key = (
                (pantry_item.get("base_ingredient") or "").strip().lower()
                if pantry_item
                else ""
            )
            cls_row = classifications.get(base_key, {})

            soft_by_class = bool(cls_row.get("is_soft_required"))
            soft_by_aisle = _is_spice_aisle(aisle)
            is_soft = soft_by_class or soft_by_aisle

            if pantry_item is None:
                confidence = 0.0
            elif confidence_override_by_base and base_key in confidence_override_by_base:
                confidence = confidence_override_by_base[base_key]
            else:
                confidence = compute_confidence(
                    pantry_item,
                    user_prefs,
                    cls_row,
                    today=today,
                    calibrated_days=cal_default(base_key) if base_key else None,
                    engagement_multiplier=engagement_multiplier,
                )

            is_use_soon = bool(
                pantry_item
                and str(pantry_item.get("id")) in use_soon_ids
                and pantry_item.get("use_soon")
            )
            is_primary = not is_soft

            if is_primary:
                min_required = min(min_required, confidence)
                required_conf_entries.append((raw_name or name, confidence))
                if is_use_soon and pantry_item:
                    use_soon_hit.add(str(pantry_item.get("id")))

            label = get_status_label(confidence, is_use_soon)

            ingredient_flags.append(
                {
                    "ingredient_name": raw_name or name,
                    "confidence": confidence,
                    "is_soft_required": is_soft,
                    "is_use_soon": is_use_soon,
                    "status_label": label,
                    "sub_class": cls_row.get("sub_class"),
                    "put_back_count": (
                        int(pantry_item.get("put_back_count") or 0)
                        if pantry_item
                        else 0
                    ),
                }
            )

        tier = get_tier(min_required)
        if tier == "suppressed":
            return {"tier": "suppressed"}

        n_use_soon = len(use_soon_items)
        use_soon_primary_matches = len(use_soon_hit)
        use_soon_score = 0.0
        if n_use_soon > 0:
            if use_soon_primary_matches == n_use_soon:
                use_soon_score = 2.0
            elif use_soon_primary_matches > 0:
                use_soon_score = 1.0

        penalized: List[float] = []
        for f in ingredient_flags:
            if f["is_soft_required"]:
                continue
            c = float(f["confidence"])
            pk = ""
            m = find_best_match(pantry_list, f["ingredient_name"])
            if m:
                pk = _signal_key_for_pantry_item(m)
            if pk and signals.get(pk, 0) >= ASPIRATIONAL_DISMISS_THRESHOLD:
                c = max(0.0, c - ASPIRATIONAL_CONFIDENCE_PENALTY)
            penalized.append(c)

        base_score = (
            sum(penalized) / len(penalized) if penalized else 0.0
        )
        final_score = base_score + use_soon_score

        if n_use_soon > 0 and use_soon_primary_matches > 0:
            tier = "use_soon"

        trigger_ingredient: Optional[str] = None
        if tier == "check_first" and required_conf_entries:
            trigger_ingredient = min(required_conf_entries, key=lambda x: x[1])[0]

        rid = recipe.get("id")
        missed_count = len(
            [
                f
                for f in ingredient_flags
                if f["confidence"] == 0.0
                and not f.get("is_soft_required", False)
            ]
        )
        return {
            "id": str(rid) if rid is not None else "",
            "title": recipe.get("title") or "",
            "image": recipe.get("image"),
            "tier": tier,
            "ingredient_flags": ingredient_flags,
            "score": round(final_score, 3),
            "trigger_ingredient": trigger_ingredient,
            "missed_count": missed_count,
        }

    def on_recipe_dismiss(self, user_id: str, recipe_id: int, household_id: Optional[str] = None) -> None:
        """Increment dismiss signals for matched pantry ingredients (recipe details)."""
        if household_id is None:
            household_id = self._get_household_id(user_id)
        pantry = self._load_active_pantry(user_id, household_id)
        if not self.recipe_service:
            return
        details = self.recipe_service.get_recipe_details(recipe_id)
        names: List[str] = []
        for ing in details.get("extendedIngredients") or []:
            name = (ing.get("name") or "").strip().lower()
            if not name:
                continue
            m = find_best_match(pantry, name)
            if m:
                k = _signal_key_for_pantry_item(m)
                if k:
                    names.append(k)
        if names:
            self.supabase.increment_ingredient_dismiss_counts(user_id, names)
        if self.pool_store is not None and household_id:
            self.pool_store.mark_swiped_by_recipe_id(household_id, str(recipe_id))
        self.invalidate_suggestion_cache(user_id, household_id)


def create_suggestion_service(
    supabase: SupabaseService,
    pantry_service: PantryService,
    recipe_service: RecipeService,
    config: Config,
    pool_store: Optional["PoolStoreService"] = None,
) -> SuggestionService:
    return SuggestionService(
        supabase, pantry_service, recipe_service, config, pool_store=pool_store
    )
