"""Recipe service for integrating with Spoonacular API"""

import json
import time
from typing import Any, Dict, List, Optional
import requests
from backend.services.pantry_service import PantryService
from backend.services.recipe_meal_filter import spoonacular_type_for_meal
from backend.config import Config
from backend.utils.exceptions import (
    AIServiceException,
    RecipeQuotaException,
    ValidationException,
)
from backend.services.spoonacular_ledger import (
    SpoonacularLedger,
    estimate_points,
)
from backend.utils.logger import get_logger

logger = get_logger(__name__)


def _raise_for_spoonacular_http(e: requests.exceptions.HTTPError, context: str) -> None:
    status = e.response.status_code if e.response is not None else None
    if status == 401:
        raise ValidationException("Invalid Spoonacular API key") from e
    if status in (402, 429):
        msg = (
            "Spoonacular API rate limit exceeded"
            if status == 429
            else "Spoonacular API daily quota exceeded"
        )
        raise RecipeQuotaException(msg) from e
    raise AIServiceException(f"Spoonacular API error ({context}): {e}") from e


class RecipeService:
    """Service for fetching recipes from Spoonacular API based on pantry items"""

    def __init__(
        self,
        pantry_service: PantryService,
        config: Config,
        admin_client: Optional[Any] = None,
    ):
        """
        Initialize RecipeService

        Args:
            pantry_service: Pantry service instance
            config: Configuration object with Spoonacular API settings
            admin_client: Supabase service-role client for usage ledger (optional)
        """
        self.pantry_service = pantry_service
        self.config = config
        self._ledger: Optional[SpoonacularLedger] = None
        if admin_client is not None:
            self._ledger = SpoonacularLedger(
                admin_client, config.SPOONACULAR_USER_DAILY_POINT_CAP
            )
        elif config.SPOONACULAR_USER_DAILY_POINT_CAP > 0:
            self._ledger = SpoonacularLedger(None, config.SPOONACULAR_USER_DAILY_POINT_CAP)
        self.api_key = config.SPOONACULAR_API_KEY
        self.base_url = config.SPOONACULAR_BASE_URL
        self.timeout = config.SPOONACULAR_TIMEOUT

        # In-memory cache: {cache_key: (recipes, timestamp)}
        self._cache: Dict[str, tuple] = {}
        self._cache_ttl = 3600  # 1 hour in seconds (default for findByIngredients)
        # Recipe information cache (Phase 3 suggestion scoring)
        self._details_cache: Dict[int, tuple] = {}
        self._details_cache_ttl = 3600  # 1 hour in seconds
        # complexSearch cache
        self._complex_cache: Dict[str, tuple] = {}
        self._call_count: int = 0
        self._period_call_count: int = 0
        self._period_start: float = 0.0
        self._call_budget: int = config.SPOONACULAR_CALL_BUDGET
        self._call_budget_period_s: int = config.SPOONACULAR_CALL_BUDGET_PERIOD_SECONDS

    def _reset_period_if_elapsed(self, now: Optional[float] = None) -> None:
        now = now if now is not None else time.time()
        if self._period_start == 0.0 or (now - self._period_start) >= self._call_budget_period_s:
            self._period_call_count = 0
            self._period_start = now

    def is_budget_exceeded(self, now: Optional[float] = None) -> bool:
        self._reset_period_if_elapsed(now)
        return self._period_call_count >= self._call_budget

    def _record_external_call(self, endpoint: str, now: Optional[float] = None) -> None:
        self._reset_period_if_elapsed(now)
        self._call_count += 1
        self._period_call_count += 1
        payload = {
            "event": "spoonacular_external_call",
            "endpoint": endpoint,
            "period_count": self._period_call_count,
            "total_count": self._call_count,
            "budget": self._call_budget,
            "over_budget": self._period_call_count > self._call_budget,
        }
        logger.info(json.dumps(payload))

    def _begin_external_call(
        self,
        user_id: Optional[str],
        caller: str,
        endpoint: str,
        number: int = 1,
    ) -> tuple[Optional[str], float]:
        estimate = estimate_points(endpoint, number)
        if not self._ledger:
            return None, estimate
        reservation_id = self._ledger.reserve_before_call(
            user_id, caller, endpoint, estimate
        )
        return reservation_id, estimate

    def _finish_external_call(
        self,
        reservation_id: Optional[str],
        estimate: float,
        response: Optional[requests.Response],
        user_id: Optional[str],
        caller: str,
        endpoint: str,
    ) -> None:
        if not self._ledger:
            return
        if reservation_id:
            self._ledger.reconcile_after_call(reservation_id, estimate, response)
        else:
            self._ledger.record_after_call_cap_off(
                user_id, caller, endpoint, estimate, response
            )

    def get_call_stats(self, now: Optional[float] = None) -> Dict[str, Any]:
        self._reset_period_if_elapsed(now)
        return {
            "period_calls": self._period_call_count,
            "total_calls": self._call_count,
            "budget": self._call_budget,
            "budget_period_seconds": self._call_budget_period_s,
            "period_start_epoch": self._period_start,
            "budget_remaining": max(0, self._call_budget - self._period_call_count),
        }

    def _get_cache_key(
        self,
        household_id: Optional[str],
        user_id: str,
        ingredients: List[str],
        number: int = 20,
        ranking: int = 2,
        ignore_pantry: bool = False,
        meal_type: Optional[str] = None,
    ) -> str:
        """
        Generate cache key from household/user ID and ingredients

        Args:
            household_id: Household ID (if available)
            user_id: User ID
            ingredients: List of ingredient names
            number: Max recipes requested from API (affects cache entry)
            ranking: Spoonacular ranking (1=maximize used ingredients, 2=minimize missing)
            ignore_pantry: Spoonacular ignorePantry flag
            meal_type: Optional meal slot for complexSearch cache partition

        Returns:
            Cache key string
        """
        identifier = household_id or user_id
        ingredients_str = ",".join(sorted(ingredients))
        mt = meal_type or ""
        return (
            f"{identifier}:{number}:r{ranking}:ip{int(ignore_pantry)}:mt{mt}:"
            f"{hash(ingredients_str)}"
        )

    def _is_cache_valid(self, cache_entry: tuple, ttl_seconds: Optional[int] = None) -> bool:
        """
        Check if cache entry is still valid

        Args:
            cache_entry: Tuple of (recipes, timestamp)
            ttl_seconds: Override TTL (default: self._cache_ttl)

        Returns:
            True if cache is valid, False otherwise
        """
        if not cache_entry:
            return False
        recipes, timestamp = cache_entry
        age = time.time() - timestamp
        ttl = ttl_seconds if ttl_seconds is not None else self._cache_ttl
        return age < ttl

    def _get_ingredients_from_pantry(
        self, household_id: Optional[str], user_id: str
    ) -> List[str]:
        """
        Get unique base ingredients from pantry

        Args:
            household_id: Household ID (optional)
            user_id: User ID

        Returns:
            List of unique base ingredient names
        """
        try:
            # Get pantry items using the pantry service's internal method
            items = self.pantry_service._get_pantry_items(user_id, household_id)

            # Extract unique base_ingredient values
            base_ingredients = set()
            for item in items:
                base_ingredient = item.get("base_ingredient")
                if base_ingredient:
                    # Normalize ingredient name (lowercase, strip whitespace)
                    normalized = base_ingredient.strip().lower()
                    if normalized:
                        base_ingredients.add(normalized)

            return sorted(list(base_ingredients))
        except Exception as e:
            logger.error(f"Failed to get ingredients from pantry: {e}")
            raise ValidationException(f"Failed to get pantry ingredients: {e}")

    @staticmethod
    def _transform_find_by_ingredients_recipe(recipe: Dict) -> Dict:
        return {
            "id": recipe.get("id"),
            "title": recipe.get("title"),
            "image": recipe.get("image"),
            "missedIngredientCount": recipe.get("missedIngredientCount", 0),
            "usedIngredientCount": recipe.get("usedIngredientCount", 0),
            "likes": recipe.get("likes", 0),
            "missedIngredients": recipe.get("missedIngredients") or [],
        }

    @staticmethod
    def _count_ingredients_from_complex(recipe: Dict) -> tuple:
        """Derive used/missed counts from complexSearch fillIngredients payload."""
        used = recipe.get("usedIngredients") or []
        missed = recipe.get("missedIngredients") or []
        unused = recipe.get("unusedIngredients") or []
        used_n = len(used)
        missed_n = len(missed)
        if used_n == 0 and missed_n == 0:
            extended = recipe.get("extendedIngredients") or []
            if extended:
                used_n = len(extended)
                missed_n = 0
        return used_n, missed_n, used, missed, unused

    def _transform_complex_search_recipe(self, recipe: Dict) -> Dict:
        used_n, missed_n, used, missed, _unused = self._count_ingredients_from_complex(
            recipe
        )
        out = {
            "id": recipe.get("id"),
            "title": recipe.get("title"),
            "image": recipe.get("image"),
            "missedIngredientCount": missed_n,
            "usedIngredientCount": used_n,
            "likes": recipe.get("likes", 0),
            "missedIngredients": missed,
            "usedIngredients": used,
            "dishTypes": recipe.get("dishTypes") or [],
            "cuisines": recipe.get("cuisines") or [],
            "extendedIngredients": recipe.get("extendedIngredients") or [],
            "servings": recipe.get("servings"),
            "readyInMinutes": recipe.get("readyInMinutes"),
            "instructions": recipe.get("instructions", ""),
            "summary": recipe.get("summary", ""),
            "analyzedInstructions": recipe.get("analyzedInstructions") or [],
            "sourceUrl": recipe.get("sourceUrl"),
            "spoonacularSourceUrl": recipe.get("spoonacularSourceUrl"),
        }
        return out

    def get_recipes_by_pantry(
        self,
        household_id: Optional[str],
        user_id: str,
        available_ingredients: Optional[List[str]] = None,
        number: int = 20,
        *,
        ranking: int = 2,
        ignore_pantry: bool = False,
        cache_ttl_seconds: Optional[int] = None,
        caller: str = "suggestion_search",
    ) -> List[Dict]:
        """
        Get recipe suggestions based on pantry items

        Args:
            household_id: Household ID (optional)
            user_id: User ID
            available_ingredients: Optional list of ingredient names (for session pantry)
            number: Max recipes to request from Spoonacular (default 20)
            ranking: 1 = maximize used ingredients (Phase 3), 2 = minimize missing
            ignore_pantry: True = do not assume staples (Phase 3)
            cache_ttl_seconds: Override cache TTL (e.g. 1800 for 30-minute Phase 3 cache)

        Returns:
            List of recipe dictionaries with id, title, image, missedIngredientCount
        """
        if not self.api_key:
            raise ValidationException("Spoonacular API key not configured")

        try:
            # Use provided ingredients or get from pantry
            if available_ingredients:
                ingredients = available_ingredients
            else:
                ingredients = self._get_ingredients_from_pantry(household_id, user_id)

            if not ingredients:
                logger.info("No ingredients found")
                return []

            # Check cache
            cache_key = self._get_cache_key(
                household_id, user_id, ingredients, number, ranking, ignore_pantry
            )
            cached_entry = self._cache.get(cache_key)
            ttl = cache_ttl_seconds if cache_ttl_seconds is not None else self._cache_ttl

            if cached_entry and self._is_cache_valid(cached_entry, ttl_seconds=ttl):
                logger.info(f"Returning cached recipes for {len(ingredients)} ingredients")
                return cached_entry[0]

            reservation_id: Optional[str] = None
            estimate = 1.0
            response: Optional[requests.Response] = None
            try:
                reservation_id, estimate = self._begin_external_call(
                    user_id, caller, "findByIngredients", number
                )
                if self.is_budget_exceeded():
                    raise AIServiceException(
                        "Spoonacular call budget exceeded for this period"
                    )
                self._record_external_call("findByIngredients")

                ingredients_str = ",".join(ingredients)
                url = f"{self.base_url}/recipes/findByIngredients"

                params = {
                    "apiKey": self.api_key,
                    "ingredients": ingredients_str,
                    "number": max(1, min(100, int(number))),
                    "ranking": int(ranking),
                    "ignorePantry": bool(ignore_pantry),
                }

                logger.info(
                    f"Calling Spoonacular API with {len(ingredients)} ingredients"
                )
                response = requests.get(url, params=params, timeout=self.timeout)
                response.raise_for_status()

                recipes = response.json()

                transformed_recipes = [
                    self._transform_find_by_ingredients_recipe(recipe)
                    for recipe in recipes
                ]

                self._cache[cache_key] = (transformed_recipes, time.time())

                logger.info(
                    f"Retrieved {len(transformed_recipes)} recipes from Spoonacular"
                )
                return transformed_recipes
            finally:
                self._finish_external_call(
                    reservation_id,
                    estimate,
                    response,
                    user_id,
                    caller,
                    "findByIngredients",
                )

        except requests.exceptions.HTTPError as e:
            logger.error(f"Spoonacular API HTTP error: {e}")
            _raise_for_spoonacular_http(e, "findByIngredients")
        except RecipeQuotaException:
            raise
        except requests.exceptions.RequestException as e:
            logger.error(f"Spoonacular API request error: {e}")
            raise AIServiceException(f"Failed to call Spoonacular API: {e}")
        except Exception as e:
            logger.error(f"Unexpected error getting recipes: {e}")
            raise AIServiceException(f"Failed to get recipes: {e}")

    def search_recipes_complex(
        self,
        household_id: Optional[str],
        user_id: str,
        ingredients: List[str],
        meal_type: str,
        number: int = 10,
        *,
        cache_ttl_seconds: Optional[int] = None,
        caller: str = "pool_generate",
    ) -> List[Dict]:
        """
        Meal-type-aware pantry search via Spoonacular complexSearch.

        Uses includeIngredients + type filter + max-used-ingredients sort with
        fillIngredients and addRecipeInformation to avoid per-recipe /information calls.
        """
        if not self.api_key:
            raise ValidationException("Spoonacular API key not configured")
        if not ingredients:
            return []

        cache_key = self._get_cache_key(
            household_id,
            user_id,
            ingredients,
            number,
            ranking=1,
            ignore_pantry=True,
            meal_type=meal_type,
        )
        ttl = cache_ttl_seconds if cache_ttl_seconds is not None else self._cache_ttl
        cached = self._complex_cache.get(cache_key)
        if cached and self._is_cache_valid(cached, ttl_seconds=ttl):
            return cached[0]

        reservation_id: Optional[str] = None
        estimate = estimate_points("complexSearch", number)
        response: Optional[requests.Response] = None
        try:
            try:
                reservation_id, estimate = self._begin_external_call(
                    user_id, caller, "complexSearch", number
                )
                if self.is_budget_exceeded():
                    raise AIServiceException(
                        "Spoonacular call budget exceeded for this period"
                    )
                self._record_external_call("complexSearch")

                url = f"{self.base_url}/recipes/complexSearch"
                params = {
                    "apiKey": self.api_key,
                    "includeIngredients": ",".join(ingredients),
                    "type": spoonacular_type_for_meal(meal_type),
                    "sort": "max-used-ingredients",
                    "sortDirection": "desc",
                    "number": max(1, min(100, int(number))),
                    "fillIngredients": True,
                    "addRecipeInformation": True,
                    "ignorePantry": True,
                }
                logger.info(
                    "complexSearch meal_type=%s ingredients=%d number=%d",
                    meal_type,
                    len(ingredients),
                    number,
                )
                response = requests.get(url, params=params, timeout=self.timeout)
                response.raise_for_status()
                data = response.json()
                results = data.get("results") or []
                transformed = [
                    self._transform_complex_search_recipe(r) for r in results
                ]
                self._complex_cache[cache_key] = (transformed, time.time())
                logger.info("complexSearch returned %d recipes", len(transformed))
                return transformed
            finally:
                self._finish_external_call(
                    reservation_id,
                    estimate,
                    response,
                    user_id,
                    caller,
                    "complexSearch",
                )
        except requests.exceptions.HTTPError as e:
            logger.error(f"Spoonacular complexSearch HTTP error: {e}")
            _raise_for_spoonacular_http(e, "complexSearch")
        except RecipeQuotaException:
            raise
        except requests.exceptions.RequestException as e:
            logger.error(f"Spoonacular complexSearch request error: {e}")
            raise AIServiceException(f"Failed to call Spoonacular API: {e}")
        except Exception as e:
            logger.error(f"Unexpected error in complexSearch: {e}")
            raise AIServiceException(f"Failed to search recipes: {e}")

    def get_recipe_details(
        self,
        recipe_id: int,
        *,
        user_id: Optional[str] = None,
        caller: str = "recipe_open",
    ) -> Dict:
        """
        Get full recipe details including instructions

        Args:
            recipe_id: Spoonacular recipe ID
            user_id: User attributed for usage ledger (required when daily cap is on)
            caller: Ledger caller label

        Returns:
            Full recipe dictionary with instructions, ingredients, etc.
        """
        if not self.api_key:
            raise ValidationException("Spoonacular API key not configured")

        cached = self._details_cache.get(recipe_id)
        if cached:
            payload, ts = cached
            if time.time() - ts < self._details_cache_ttl:
                return payload

        reservation_id: Optional[str] = None
        estimate = 1.0
        response: Optional[requests.Response] = None
        try:
            try:
                reservation_id, estimate = self._begin_external_call(
                    user_id, caller, "recipeInformation", 1
                )
                if self.is_budget_exceeded():
                    raise AIServiceException(
                        "Spoonacular call budget exceeded for this period"
                    )
                self._record_external_call("recipeInformation")

                url = f"{self.base_url}/recipes/{recipe_id}/information"

                params = {
                    "apiKey": self.api_key,
                    "includeNutrition": False,
                }

                logger.info(f"Fetching recipe details for ID {recipe_id}")
                response = requests.get(url, params=params, timeout=self.timeout)
                response.raise_for_status()

                recipe = response.json()

                out = {
                    "id": recipe.get("id"),
                    "title": recipe.get("title"),
                    "summary": recipe.get("summary", ""),
                    "image": recipe.get("image"),
                    "readyInMinutes": recipe.get("readyInMinutes"),
                    "servings": recipe.get("servings"),
                    "instructions": recipe.get("instructions", ""),
                    "extendedIngredients": recipe.get("extendedIngredients", []),
                    "analyzedInstructions": recipe.get("analyzedInstructions", []),
                    "sourceUrl": recipe.get("sourceUrl"),
                    "spoonacularSourceUrl": recipe.get("spoonacularSourceUrl"),
                    "dishTypes": recipe.get("dishTypes") or [],
                    "cuisines": recipe.get("cuisines") or [],
                }
                self._details_cache[recipe_id] = (out, time.time())
                return out
            finally:
                self._finish_external_call(
                    reservation_id,
                    estimate,
                    response,
                    user_id,
                    caller,
                    "recipeInformation",
                )

        except requests.exceptions.HTTPError as e:
            logger.error(f"Spoonacular API HTTP error: {e}")
            if e.response is not None and e.response.status_code == 404:
                raise ValidationException(f"Recipe {recipe_id} not found") from e
            _raise_for_spoonacular_http(e, "get_recipe_details")
        except RecipeQuotaException:
            raise
        except requests.exceptions.RequestException as e:
            logger.error(f"Spoonacular API request error: {e}")
            raise AIServiceException(f"Failed to call Spoonacular API: {e}")
        except Exception as e:
            logger.error(f"Unexpected error getting recipe details: {e}")
            raise AIServiceException(f"Failed to get recipe details: {e}")

    def scale_recipe(self, recipe_details: Dict, target_servings: int) -> Dict:
        """
        Scale recipe ingredients to target number of servings

        Args:
            recipe_details: Recipe dictionary with servings and extendedIngredients
            target_servings: Target number of servings

        Returns:
            Recipe dictionary with scaled ingredients and updated servings
        """
        try:
            original_servings = recipe_details.get("servings", 1)
            if original_servings <= 0:
                original_servings = 1

            if target_servings <= 0:
                target_servings = 1

            # Calculate scaling factor
            scale_factor = target_servings / original_servings

            # Create scaled copy
            scaled_recipe = recipe_details.copy()
            scaled_recipe["servings"] = target_servings

            # Scale ingredients
            if "extendedIngredients" in scaled_recipe:
                scaled_ingredients = []
                for ingredient in scaled_recipe["extendedIngredients"]:
                    scaled_ingredient = ingredient.copy()
                    # Scale amount if present
                    if "amount" in scaled_ingredient:
                        scaled_ingredient["amount"] = round(
                            scaled_ingredient["amount"] * scale_factor, 2
                        )
                    scaled_ingredients.append(scaled_ingredient)
                scaled_recipe["extendedIngredients"] = scaled_ingredients

            logger.info(
                f"Scaled recipe {recipe_details.get('id')} from {original_servings} "
                f"to {target_servings} servings (factor: {scale_factor:.2f})"
            )

            return scaled_recipe

        except Exception as e:
            logger.error(f"Failed to scale recipe: {e}")
            # Return original recipe if scaling fails
            return recipe_details


def create_recipe_service(
    pantry_service: PantryService,
    config: Config,
    admin_client: Optional[Any] = None,
) -> RecipeService:
    """
    Factory function to create RecipeService

    Args:
        pantry_service: Pantry service instance
        config: Configuration object
        admin_client: Supabase service-role client for usage ledger

    Returns:
        Initialized RecipeService instance
    """
    return RecipeService(pantry_service, config, admin_client=admin_client)
