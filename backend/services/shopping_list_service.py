"""Shopping list service for generating and managing shopping lists from meal plans"""

from typing import Dict, List, Optional
from datetime import date
from backend.services.supabase_service import SupabaseService
from backend.utils.exceptions import DatabaseException, ValidationException
from backend.utils.logger import get_logger

logger = get_logger(__name__)


class ShoppingListService:
    """Service for managing shopping lists generated from meal plans"""
    
    def __init__(self, supabase: SupabaseService):
        """
        Initialize ShoppingListService
        
        Args:
            supabase: Supabase service instance
        """
        self.supabase = supabase
    
    async def generate_from_meal_plan(
        self, household_id: str, start_date: date, end_date: date
    ) -> Dict:
        """
        Generate shopping list from meal plan by comparing required ingredients with pantry
        
        Args:
            household_id: Household ID
            start_date: Start date of meal plan range
            end_date: End date of meal plan range
        
        Returns:
            Dictionary with shopping list summary
        """
        if start_date > end_date:
            raise ValidationException("start_date must be on or before end_date")
        try:
            # Get all meal plans in date range
            client = self.supabase.admin_client if self.supabase.admin_client else self.supabase.client
            meal_plans_response = (
                client.table("meal_plan")
                .select("*")
                .eq("household_id", household_id)
                .gte("meal_date", start_date.isoformat())
                .lte("meal_date", end_date.isoformat())
                .execute()
            )
            
            meal_plans = meal_plans_response.data if meal_plans_response.data else []
            
            if not meal_plans:
                logger.info(f"No meal plans found for household {household_id} in date range")
                return {
                    "items": [],
                    "total_items": 0,
                    "household_id": household_id
                }
            
            # Aggregate all ingredients from meal plans
            required_ingredients = {}  # {ingredient_name: {total_amount, unit, recipes: []}}
            
            for meal in meal_plans:
                ingredients_reserved = meal.get("ingredients_reserved")
                if not ingredients_reserved:
                    continue
                
                recipe_name = meal.get("recipe_name", "Unknown Recipe")
                
                # ingredients_reserved is JSONB array of ingredient dicts
                if isinstance(ingredients_reserved, list):
                    for ing in ingredients_reserved:
                        ing_name = ing.get("name", "").lower().strip()
                        ing_amount = ing.get("amount", 0)
                        ing_unit = ing.get("unit", "")
                        
                        if not ing_name:
                            continue
                        
                        key = f"{ing_name}_{ing_unit}"
                        if key not in required_ingredients:
                            required_ingredients[key] = {
                                "name": ing_name,
                                "total_amount": 0,
                                "unit": ing_unit,
                                "recipes": []
                            }
                        
                        required_ingredients[key]["total_amount"] += ing_amount
                        if recipe_name not in required_ingredients[key]["recipes"]:
                            required_ingredients[key]["recipes"].append(recipe_name)
            
            # Get current pantry items
            pantry_response = (
                client.table("pantry_items")
                .select("*")
                .eq("household_id", household_id)
                .gt("quantity", 0)
                .execute()
            )
            
            pantry_items = pantry_response.data if pantry_response.data else []
            
            # Create pantry lookup: {normalized_name_unit: quantity}
            pantry_lookup = {}
            for item in pantry_items:
                normalized_name = item.get("normalized_name", "").lower().strip()
                unit = item.get("unit", "")
                quantity = float(item.get("quantity", 0))
                key = f"{normalized_name}_{unit}"
                if key in pantry_lookup:
                    pantry_lookup[key] += quantity
                else:
                    pantry_lookup[key] = quantity
            
            # Calculate missing ingredients
            shopping_items = []
            for key, req_data in required_ingredients.items():
                pantry_quantity = pantry_lookup.get(key, 0)
                needed_amount = req_data["total_amount"] - pantry_quantity
                
                if needed_amount > 0:
                    # Need to buy this ingredient
                    shopping_items.append({
                        "ingredient_name": req_data["name"],
                        "quantity": round(needed_amount, 2),
                        "unit": req_data["unit"],
                        "needed_for_recipe": ", ".join(req_data["recipes"][:3])  # Limit to 3 recipes
                    })
            
            # Clear existing shopping list for this household
            client.table("shopping_list").delete().eq("household_id", household_id).execute()
            
            # Insert new shopping list items
            if shopping_items:
                items_to_insert = [
                    {
                        "household_id": household_id,
                        "ingredient_name": item["ingredient_name"],
                        "quantity": item["quantity"],
                        "unit": item["unit"],
                        "needed_for_recipe": item["needed_for_recipe"],
                        "is_purchased": False
                    }
                    for item in shopping_items
                ]
                
                client.table("shopping_list").insert(items_to_insert).execute()
            
            logger.info(
                f"Generated shopping list for household {household_id}: "
                f"{len(shopping_items)} items needed"
            )
            
            return {
                "items": shopping_items,
                "total_items": len(shopping_items),
                "household_id": household_id
            }
            
        except Exception as e:
            logger.error(f"Failed to generate shopping list: {e}")
            raise DatabaseException(f"Failed to generate shopping list: {e}")
    
    async def mark_purchased(self, item_id: str) -> Dict:
        """
        Mark shopping list item as purchased
        
        Args:
            item_id: Shopping list item ID
        
        Returns:
            Updated shopping list item
        """
        try:
            from datetime import datetime
            
            client = self.supabase.admin_client if self.supabase.admin_client else self.supabase.client
            response = (
                client.table("shopping_list")
                .update({
                    "is_purchased": True,
                    "purchased_at": datetime.utcnow().isoformat()
                })
                .eq("id", item_id)
                .execute()
            )
            
            if not response.data:
                raise ValidationException(f"Shopping list item {item_id} not found")
            
            logger.info(f"Marked shopping list item {item_id} as purchased")
            return response.data[0]
            
        except Exception as e:
            logger.error(f"Failed to mark item as purchased: {e}")
            raise DatabaseException(f"Failed to mark item as purchased: {e}")
    
    async def get_shopping_list(
        self, household_id: str, include_purchased: bool = False
    ) -> List[Dict]:
        """
        Get shopping list for household
        
        Args:
            household_id: Household ID
            include_purchased: Whether to include purchased items
        
        Returns:
            List of shopping list items
        """
        try:
            client = self.supabase.admin_client if self.supabase.admin_client else self.supabase.client
            query = (
                client.table("shopping_list")
                .select("*")
                .eq("household_id", household_id)
                .order("created_at", desc=False)
            )
            
            if not include_purchased:
                query = query.eq("is_purchased", False)
            
            response = query.execute()
            
            items = response.data if response.data else []
            logger.info(f"Retrieved {len(items)} shopping list items for household {household_id}")
            return items
            
        except Exception as e:
            logger.error(f"Failed to get shopping list: {e}")
            raise DatabaseException(f"Failed to get shopping list: {e}")


def create_shopping_list_service(supabase: SupabaseService) -> ShoppingListService:
    """
    Factory function to create ShoppingListService
    
    Args:
        supabase: Supabase service instance
    
    Returns:
        Initialized ShoppingListService instance
    """
    return ShoppingListService(supabase)
