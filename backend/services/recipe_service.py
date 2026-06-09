"""Recipe service for integrating with Spoonacular API"""

import time
from typing import Dict, List, Optional
import requests
from backend.services.pantry_service import PantryService
from backend.services.recipe_meal_filter import spoonacular_type_for_meal
from backend.config import Config
from backend.utils.exceptions import (
    AIServiceException,
    RecipeQuotaException,
    ValidationException,
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

    def __init__(self, pantry_service: PantryService, config: Config):
        """
        Initialize RecipeService

        Args:
            pantry_service: Pantry service instance
            config: Configuration object with Spoonacular API settings
        """
        self.pantry_service = pantry_service
        self.config = config
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

            # Call Spoonacular API
            ingredients_str = ",".join(ingredients)
            url = f"{self.base_url}/recipes/findByIngredients"

            params = {
                "apiKey": self.api_key,
                "ingredients": ingredients_str,
                "number": max(1, min(100, int(number))),  # API allows up to 100
                "ranking": int(ranking),
                "ignorePantry": bool(ignore_pantry),
            }

            logger.info(f"Calling Spoonacular API with {len(ingredients)} ingredients")
            response = requests.get(url, params=params, timeout=self.timeout)
            response.raise_for_status()

            recipes = response.json()

            # Transform recipes to include only needed fields
            transformed_recipes = [
                self._transform_find_by_ingredients_recipe(recipe) for recipe in recipes
            ]

            # Cache the results
            self._cache[cache_key] = (transformed_recipes, time.time())

            logger.info(f"Retrieved {len(transformed_recipes)} recipes from Spoonacular")
            return transformed_recipes

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

        try:
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
            transformed = [self._transform_complex_search_recipe(r) for r in results]
            self._complex_cache[cache_key] = (transformed, time.time())
            logger.info("complexSearch returned %d recipes", len(transformed))
            return transformed
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

    def get_recipe_details(self, recipe_id: int) -> Dict:
        """
        Get full recipe details including instructions

        Args:
            recipe_id: Spoonacular recipe ID

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

        try:
            url = f"{self.base_url}/recipes/{recipe_id}/information"

            params = {
                "apiKey": self.api_key,
                "includeNutrition": False,
            }

            logger.info(f"Fetching recipe details for ID {recipe_id}")
            response = requests.get(url, params=params, timeout=self.timeout)
            response.raise_for_status()

            recipe = response.json()

            # Transform to include only needed fields
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


def create_recipe_service(pantry_service: PantryService, config: Config) -> RecipeService:
    """
    Factory function to create RecipeService

    Args:
        pantry_service: Pantry service instance
        config: Configuration object

    Returns:
        Initialized RecipeService instance
    """
    return RecipeService(pantry_service, config)
