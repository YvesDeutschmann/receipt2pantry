"""Recipe service for integrating with Spoonacular API"""

import time
from typing import Dict, List, Optional
import requests
from backend.services.pantry_service import PantryService
from backend.config import Config
from backend.utils.exceptions import ValidationException, AIServiceException
from backend.utils.logger import get_logger

logger = get_logger(__name__)


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
        # Cache key format: f"{household_id or user_id}:{ingredients_hash}"
        self._cache: Dict[str, tuple] = {}
        self._cache_ttl = 3600  # 1 hour in seconds
    
    def _get_cache_key(self, household_id: Optional[str], user_id: str, ingredients: List[str]) -> str:
        """
        Generate cache key from household/user ID and ingredients
        
        Args:
            household_id: Household ID (if available)
            user_id: User ID
            ingredients: List of ingredient names
        
        Returns:
            Cache key string
        """
        identifier = household_id or user_id
        ingredients_str = ",".join(sorted(ingredients))
        return f"{identifier}:{hash(ingredients_str)}"
    
    def _is_cache_valid(self, cache_entry: tuple) -> bool:
        """
        Check if cache entry is still valid
        
        Args:
            cache_entry: Tuple of (recipes, timestamp)
        
        Returns:
            True if cache is valid, False otherwise
        """
        if not cache_entry:
            return False
        recipes, timestamp = cache_entry
        age = time.time() - timestamp
        return age < self._cache_ttl
    
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
                base_ingredient = item.get('base_ingredient')
                if base_ingredient:
                    # Normalize ingredient name (lowercase, strip whitespace)
                    normalized = base_ingredient.strip().lower()
                    if normalized:
                        base_ingredients.add(normalized)
            
            return sorted(list(base_ingredients))
        except Exception as e:
            logger.error(f"Failed to get ingredients from pantry: {e}")
            raise ValidationException(f"Failed to get pantry ingredients: {e}")
    
    def get_recipes_by_pantry(
        self, household_id: Optional[str], user_id: str, available_ingredients: Optional[List[str]] = None
    ) -> List[Dict]:
        """
        Get recipe suggestions based on pantry items
        
        Args:
            household_id: Household ID (optional)
            user_id: User ID
            available_ingredients: Optional list of ingredient names (for session pantry)
        
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
            cache_key = self._get_cache_key(household_id, user_id, ingredients)
            cached_entry = self._cache.get(cache_key)
            
            if cached_entry and self._is_cache_valid(cached_entry):
                logger.info(f"Returning cached recipes for {len(ingredients)} ingredients")
                return cached_entry[0]
            
            # Call Spoonacular API
            ingredients_str = ",".join(ingredients)
            url = f"{self.base_url}/recipes/findByIngredients"
            
            params = {
                "apiKey": self.api_key,
                "ingredients": ingredients_str,
                "number": 20,  # Number of recipes to return (increased for more alternatives)
                "ranking": 2,  # Maximize used ingredients
                "ignorePantry": False  # Include pantry staples
            }
            
            logger.info(f"Calling Spoonacular API with {len(ingredients)} ingredients")
            response = requests.get(url, params=params, timeout=self.timeout)
            response.raise_for_status()
            
            recipes = response.json()
            
            # Transform recipes to include only needed fields
            transformed_recipes = []
            for recipe in recipes:
                transformed_recipes.append({
                    "id": recipe.get("id"),
                    "title": recipe.get("title"),
                    "image": recipe.get("image"),
                    "missedIngredientCount": recipe.get("missedIngredientCount", 0),
                    "usedIngredientCount": recipe.get("usedIngredientCount", 0),
                    "likes": recipe.get("likes", 0)
                })
            
            # Cache the results
            self._cache[cache_key] = (transformed_recipes, time.time())
            
            logger.info(f"Retrieved {len(transformed_recipes)} recipes from Spoonacular")
            return transformed_recipes
            
        except requests.exceptions.HTTPError as e:
            logger.error(f"Spoonacular API HTTP error: {e}")
            if e.response.status_code == 401:
                raise ValidationException("Invalid Spoonacular API key")
            elif e.response.status_code == 429:
                raise AIServiceException("Spoonacular API rate limit exceeded")
            else:
                raise AIServiceException(f"Spoonacular API error: {e}")
        except requests.exceptions.RequestException as e:
            logger.error(f"Spoonacular API request error: {e}")
            raise AIServiceException(f"Failed to call Spoonacular API: {e}")
        except Exception as e:
            logger.error(f"Unexpected error getting recipes: {e}")
            raise AIServiceException(f"Failed to get recipes: {e}")
    
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
        
        try:
            url = f"{self.base_url}/recipes/{recipe_id}/information"
            
            params = {
                "apiKey": self.api_key,
                "includeNutrition": False
            }
            
            logger.info(f"Fetching recipe details for ID {recipe_id}")
            response = requests.get(url, params=params, timeout=self.timeout)
            response.raise_for_status()
            
            recipe = response.json()
            
            # Transform to include only needed fields
            return {
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
                "spoonacularSourceUrl": recipe.get("spoonacularSourceUrl")
            }
            
        except requests.exceptions.HTTPError as e:
            logger.error(f"Spoonacular API HTTP error: {e}")
            if e.response.status_code == 404:
                raise ValidationException(f"Recipe {recipe_id} not found")
            elif e.response.status_code == 401:
                raise ValidationException("Invalid Spoonacular API key")
            elif e.response.status_code == 429:
                raise AIServiceException("Spoonacular API rate limit exceeded")
            else:
                raise AIServiceException(f"Spoonacular API error: {e}")
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
