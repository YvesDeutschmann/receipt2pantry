"""Meal planning service for wizard-based meal plan creation"""

from typing import Dict, List, Optional
from datetime import date, datetime, timedelta
from backend.services.supabase_service import SupabaseService
from backend.services.pantry_service import PantryService
from backend.services.recipe_service import RecipeService
from backend.services.household_service import HouseholdService
from backend.utils.exceptions import DatabaseException, ValidationException
from backend.utils.logger import get_logger

logger = get_logger(__name__)


class MealPlanService:
    """Service for managing meal planning wizard and meal plans"""
    
    def __init__(
        self,
        supabase_service: SupabaseService,
        pantry_service: PantryService,
        recipe_service: RecipeService,
        household_service: HouseholdService
    ):
        """
        Initialize MealPlanService
        
        Args:
            supabase_service: Supabase service instance
            pantry_service: Pantry service instance
            recipe_service: Recipe service instance
            household_service: Household service instance
        """
        self.supabase = supabase_service
        self.pantry_service = pantry_service
        self.recipe_service = recipe_service
        self.household_service = household_service
    
    async def start_wizard(
        self, user_id: str, household_id: str, meal_slots: Dict, start_date: date
    ) -> Dict:
        """
        Start meal planning wizard session
        
        Args:
            user_id: User ID
            household_id: Household ID
            meal_slots: Dictionary with breakfast, lunch, dinner booleans
            start_date: Start date for meal plan
        
        Returns:
            Dictionary with session_id, household_member_count, session_pantry
        """
        try:
            # Check for existing active session
            client = self.supabase.admin_client if self.supabase.admin_client else self.supabase.client
            existing_response = (
                client.table("meal_plan_wizard_session")
                .select("*")
                .eq("household_id", household_id)
                .gt("expires_at", datetime.utcnow().isoformat())
                .execute()
            )
            
            if existing_response.data:
                # Delete existing session
                client.table("meal_plan_wizard_session").delete().eq(
                    "id", existing_response.data[0]["id"]
                ).execute()
            
            # Get household member count
            members = self.supabase.get_household_members(household_id)
            member_count = len(members) if members else 1
            
            # Clone pantry to session_pantry
            pantry_items = self.pantry_service._get_pantry_items(user_id, household_id)
            session_pantry = {}
            
            for item in pantry_items:
                item_id = item.get("id")
                quantity = float(item.get("quantity", 0))
                if quantity > 0:
                    session_pantry[item_id] = {
                        "id": item_id,
                        "name": item.get("normalized_name", ""),
                        "base_ingredient": item.get("base_ingredient", ""),
                        "quantity": quantity,
                        "unit": item.get("unit", ""),
                        "variant": item.get("variant")
                    }
            
            # Create wizard session
            expires_at = datetime.utcnow() + timedelta(hours=2)
            session_data = {
                "household_id": household_id,
                "user_id": user_id,
                "session_pantry": session_pantry,
                "meal_slots": meal_slots,
                "current_slot": 0,
                "rejected_recipes": [],
                "accepted_recipes": [],
                "expires_at": expires_at.isoformat()
            }
            
            response = (
                client.table("meal_plan_wizard_session")
                .insert(session_data)
                .execute()
            )
            
            if not response.data:
                raise DatabaseException("Failed to create wizard session")
            
            session_id = response.data[0]["id"]
            
            logger.info(
                f"Started meal planning wizard session {session_id} for household {household_id}"
            )
            
            return {
                "session_id": session_id,
                "household_member_count": member_count,
                "session_pantry": session_pantry,
                "start_date": start_date.isoformat()
            }
            
        except Exception as e:
            logger.error(f"Failed to start wizard: {e}", exc_info=True)
            # Include original error message for debugging
            error_msg = str(e)
            if "accepted_recipes" in error_msg.lower() or "column" in error_msg.lower():
                raise DatabaseException(
                    f"Database schema error: {error_msg}. "
                    "Please ensure migration 012_recipe_bans.sql has been applied."
                )
            raise DatabaseException(f"Failed to start wizard: {error_msg}")
    
    async def get_recipe_suggestions(
        self, session_id: str, meal_type: str, threshold: float = 0.9
    ) -> List[Dict]:
        """
        Get recipe suggestions for current session pantry
        
        Args:
            session_id: Wizard session ID
            meal_type: Meal type (breakfast, lunch, dinner)
            threshold: Match threshold (0.0-1.0)
        
        Returns:
            List of recipe dictionaries
        """
        try:
            # Get session
            client = self.supabase.admin_client if self.supabase.admin_client else self.supabase.client
            session_response = (
                client.table("meal_plan_wizard_session")
                .select("*")
                .eq("id", session_id)
                .execute()
            )
            
            if not session_response.data:
                raise ValidationException("Wizard session not found or expired")
            
            session = session_response.data[0]
            
            # Check expiration
            expires_at = datetime.fromisoformat(session["expires_at"].replace("Z", "+00:00"))
            if expires_at < datetime.utcnow().replace(tzinfo=expires_at.tzinfo):
                raise ValidationException("Wizard session expired")
            
            session_pantry = session.get("session_pantry", {})
            rejected_recipes = session.get("rejected_recipes", [])
            accepted_recipes = session.get("accepted_recipes", [])
            
            # Get banned recipes for this user
            user_id = session["user_id"]
            banned_response = (
                client.table("recipe_bans")
                .select("recipe_id")
                .eq("user_id", user_id)
                .gt("expires_at", datetime.utcnow().isoformat())
                .execute()
            )
            banned_recipe_ids = [str(b["recipe_id"]) for b in (banned_response.data or [])]
            
            # Extract available ingredients
            available_ingredients = []
            for item_id, item_data in session_pantry.items():
                quantity = item_data.get("quantity", 0)
                if quantity > 0:
                    base_ingredient = item_data.get("base_ingredient", "")
                    if base_ingredient:
                        available_ingredients.append(base_ingredient.lower().strip())
            
            if not available_ingredients:
                # Try staple meals for breakfast/lunch
                if meal_type in ["breakfast", "lunch"]:
                    return await self.suggest_staple_meals(session_pantry, meal_type)
                return []
            
            # Get recipes from Spoonacular
            household_id = session["household_id"]
            recipes = self.recipe_service.get_recipes_by_pantry(
                household_id, user_id, available_ingredients
            )
            
            # Filter by threshold (calculate match percentage) and exclude rejected/accepted/banned recipes
            filtered_recipes = []
            rejected_ids = [str(r) for r in rejected_recipes]  # Normalize to strings for comparison
            accepted_ids = [str(r) for r in accepted_recipes]  # Normalize to strings for comparison
            
            for recipe in recipes:
                recipe_id = str(recipe.get("id", ""))
                is_staple = recipe.get("is_staple", False) or recipe_id.startswith("staple_")
                
                # Skip soft-rejected recipes (slot-only exclusion)
                if recipe_id in rejected_ids:
                    continue
                
                # Skip banned recipes (6-month exclusion)
                if recipe_id in banned_recipe_ids:
                    continue
                
                # Skip accepted recipes (week exclusion), but allow staples to repeat
                if recipe_id in accepted_ids and not is_staple:
                    continue
                
                used_count = recipe.get("usedIngredientCount", 0)
                missed_count = recipe.get("missedIngredientCount", 0)
                total_ingredients = used_count + missed_count
                
                if total_ingredients == 0:
                    continue
                
                match_percentage = used_count / total_ingredients
                
                if match_percentage >= threshold:
                    recipe["match_percentage"] = match_percentage
                    filtered_recipes.append(recipe)
            
            # Sort by match percentage (descending)
            filtered_recipes.sort(key=lambda x: x.get("match_percentage", 0), reverse=True)
            
            # If no matches at threshold, try lower thresholds
            if not filtered_recipes and threshold > 0.7:
                return await self.get_recipe_suggestions(session_id, meal_type, threshold - 0.1)
            
            # If still no matches and breakfast/lunch, suggest staples
            if not filtered_recipes and meal_type in ["breakfast", "lunch"]:
                return await self.suggest_staple_meals(session_pantry, meal_type)
            
            return filtered_recipes[:10]  # Return top 10
            
        except ValidationException:
            raise
        except Exception as e:
            logger.error(f"Failed to get recipe suggestions: {e}")
            raise DatabaseException(f"Failed to get recipe suggestions: {e}")
    
    async def suggest_staple_meals(
        self, session_pantry: Dict, meal_type: str
    ) -> List[Dict]:
        """
        Suggest staple meals based on common pantry items
        
        Args:
            session_pantry: Session pantry dictionary
            meal_type: Meal type (breakfast, lunch)
        
        Returns:
            List of staple meal dictionaries
        """
        staple_meals = []
        
        # Detect common ingredients
        has_eggs = False
        has_bread = False
        has_peanut_butter = False
        has_milk = False
        has_cereal = False
        has_cheese = False
        
        for item_data in session_pantry.values():
            base_ingredient = item_data.get("base_ingredient", "").lower()
            quantity = item_data.get("quantity", 0)
            
            if quantity > 0:
                if "egg" in base_ingredient:
                    has_eggs = True
                if "bread" in base_ingredient:
                    has_bread = True
                if "peanut butter" in base_ingredient or "peanutbutter" in base_ingredient:
                    has_peanut_butter = True
                if "milk" in base_ingredient:
                    has_milk = True
                if "cereal" in base_ingredient:
                    has_cereal = True
                if "cheese" in base_ingredient:
                    has_cheese = True
        
        if meal_type == "breakfast":
            if has_eggs:
                staple_meals.append({
                    "id": "staple_omelette",
                    "title": "Omelette",
                    "image": None,
                    "match_percentage": 1.0,
                    "usedIngredientCount": 1,
                    "missedIngredientCount": 0,
                    "is_staple": True
                })
                staple_meals.append({
                    "id": "staple_scrambled_eggs",
                    "title": "Scrambled Eggs",
                    "image": None,
                    "match_percentage": 1.0,
                    "usedIngredientCount": 1,
                    "missedIngredientCount": 0,
                    "is_staple": True
                })
            
            if has_milk and has_cereal:
                staple_meals.append({
                    "id": "staple_cereal",
                    "title": "Cereal with Milk",
                    "image": None,
                    "match_percentage": 1.0,
                    "usedIngredientCount": 2,
                    "missedIngredientCount": 0,
                    "is_staple": True
                })
        
        elif meal_type == "lunch":
            if has_bread and has_peanut_butter:
                staple_meals.append({
                    "id": "staple_pbj",
                    "title": "Peanut Butter & Jelly Sandwich",
                    "image": None,
                    "match_percentage": 1.0,
                    "usedIngredientCount": 2,
                    "missedIngredientCount": 0,
                    "is_staple": True
                })
            
            if has_bread and has_cheese:
                staple_meals.append({
                    "id": "staple_grilled_cheese",
                    "title": "Grilled Cheese Sandwich",
                    "image": None,
                    "match_percentage": 1.0,
                    "usedIngredientCount": 2,
                    "missedIngredientCount": 0,
                    "is_staple": True
                })
            
            if has_bread:
                staple_meals.append({
                    "id": "staple_toast",
                    "title": "Toast",
                    "image": None,
                    "match_percentage": 1.0,
                    "usedIngredientCount": 1,
                    "missedIngredientCount": 0,
                    "is_staple": True
                })
        
        return staple_meals
    
    async def soft_reject_recipe(self, session_id: str, recipe_id: str) -> None:
        """
        Record a soft-rejected recipe ID (slot-only exclusion)
        
        Args:
            session_id: Wizard session ID
            recipe_id: Recipe ID (Spoonacular ID or staple meal ID)
        """
        try:
            # Normalize recipe_id to string
            recipe_id = str(recipe_id)
            
            # Get session
            client = self.supabase.admin_client if self.supabase.admin_client else self.supabase.client
            session_response = (
                client.table("meal_plan_wizard_session")
                .select("*")
                .eq("id", session_id)
                .execute()
            )
            
            if not session_response.data:
                raise ValidationException("Wizard session not found or expired")
            
            session = session_response.data[0]
            rejected_recipes = session.get("rejected_recipes", [])
            
            # Add recipe_id if not already rejected
            if recipe_id not in rejected_recipes:
                rejected_recipes.append(recipe_id)
                
                # Update session
                client.table("meal_plan_wizard_session").update({
                    "rejected_recipes": rejected_recipes
                }).eq("id", session_id).execute()
                
                logger.info(
                    f"Rejected recipe {recipe_id} in session {session_id} "
                    f"(total rejected: {len(rejected_recipes)})"
                )
            
        except ValidationException:
            raise
        except Exception as e:
            logger.error(f"Failed to reject recipe: {e}")
            raise DatabaseException(f"Failed to reject recipe: {e}")
    
    async def ban_recipe(self, session_id: str, recipe_id: str, recipe_name: str, user_id: str) -> None:
        """
        Ban a recipe for 6 months (hard reject)
        
        Args:
            session_id: Wizard session ID
            recipe_id: Recipe ID (Spoonacular ID or staple meal ID)
            recipe_name: Recipe name for display
            user_id: User ID
        """
        try:
            # Normalize recipe_id to string
            recipe_id = str(recipe_id)
            
            # Get session to verify it exists
            client = self.supabase.admin_client if self.supabase.admin_client else self.supabase.client
            session_response = (
                client.table("meal_plan_wizard_session")
                .select("*")
                .eq("id", session_id)
                .execute()
            )
            
            if not session_response.data:
                raise ValidationException("Wizard session not found or expired")
            
            # Check if already banned
            ban_response = (
                client.table("recipe_bans")
                .select("*")
                .eq("user_id", user_id)
                .eq("recipe_id", recipe_id)
                .execute()
            )
            
            if ban_response.data:
                # Already banned, update expires_at to extend ban
                expires_at = datetime.utcnow() + timedelta(days=180)  # 6 months
                client.table("recipe_bans").update({
                    "expires_at": expires_at.isoformat(),
                    "banned_at": datetime.utcnow().isoformat()
                }).eq("user_id", user_id).eq("recipe_id", recipe_id).execute()
            else:
                # Create new ban
                expires_at = datetime.utcnow() + timedelta(days=180)  # 6 months
                ban_data = {
                    "user_id": user_id,
                    "recipe_id": recipe_id,
                    "recipe_name": recipe_name,
                    "banned_at": datetime.utcnow().isoformat(),
                    "expires_at": expires_at.isoformat()
                }
                client.table("recipe_bans").insert(ban_data).execute()
            
            logger.info(
                f"Banned recipe {recipe_id} ({recipe_name}) for user {user_id} "
                f"until {expires_at.isoformat()}"
            )
            
        except ValidationException:
            raise
        except Exception as e:
            logger.error(f"Failed to ban recipe: {e}")
            raise DatabaseException(f"Failed to ban recipe: {e}")
    
    async def unban_recipe(self, session_id: str, recipe_id: str, user_id: str) -> None:
        """
        Remove a recipe ban (undo)
        
        Args:
            session_id: Wizard session ID
            recipe_id: Recipe ID (Spoonacular ID or staple meal ID)
            user_id: User ID
        """
        try:
            # Normalize recipe_id to string
            recipe_id = str(recipe_id)
            
            # Get session to verify it exists
            client = self.supabase.admin_client if self.supabase.admin_client else self.supabase.client
            session_response = (
                client.table("meal_plan_wizard_session")
                .select("*")
                .eq("id", session_id)
                .execute()
            )
            
            if not session_response.data:
                raise ValidationException("Wizard session not found or expired")
            
            # Delete ban
            client.table("recipe_bans").delete().eq(
                "user_id", user_id
            ).eq("recipe_id", recipe_id).execute()
            
            logger.info(f"Unbanned recipe {recipe_id} for user {user_id}")
            
        except ValidationException:
            raise
        except Exception as e:
            logger.error(f"Failed to unban recipe: {e}")
            raise DatabaseException(f"Failed to unban recipe: {e}")
    
    async def accept_recipe(
        self, session_id: str, recipe_id: str, meal_date: date, meal_type: str
    ) -> Dict:
        """
        Accept a recipe and add it to meal plan
        
        Args:
            session_id: Wizard session ID
            recipe_id: Recipe ID (Spoonacular ID or staple meal ID)
            meal_date: Date for the meal
            meal_type: Meal type (breakfast, lunch, dinner)
        
        Returns:
            Dictionary with meal_plan_entry and updated_session_pantry
        """
        try:
            # Normalize recipe_id to string (handles both string and int from JSON)
            recipe_id = str(recipe_id)
            
            # Get session
            client = self.supabase.admin_client if self.supabase.admin_client else self.supabase.client
            session_response = (
                client.table("meal_plan_wizard_session")
                .select("*")
                .eq("id", session_id)
                .execute()
            )
            
            if not session_response.data:
                raise ValidationException("Wizard session not found or expired")
            
            session = session_response.data[0]
            household_id = session["household_id"]
            user_id = session["user_id"]
            session_pantry = session.get("session_pantry", {})
            accepted_recipes = session.get("accepted_recipes", [])
            
            # Get household member count for scaling
            members = self.supabase.get_household_members(household_id)
            member_count = len(members) if members else 1
            
            # Get recipe details (if not staple)
            recipe_name = "Unknown Recipe"
            recipe_image = None
            servings = member_count
            ingredients_reserved = []
            
            if recipe_id.startswith("staple_"):
                # Staple meal - create simple entry
                recipe_name = recipe_id.replace("staple_", "").replace("_", " ").title()
                if recipe_id == "staple_pbj":
                    recipe_name = "Peanut Butter & Jelly Sandwich"
                elif recipe_id == "staple_grilled_cheese":
                    recipe_name = "Grilled Cheese Sandwich"
                elif recipe_id == "staple_scrambled_eggs":
                    recipe_name = "Scrambled Eggs"
                elif recipe_id == "staple_cereal":
                    recipe_name = "Cereal with Milk"
                
                # For staples, don't deduct ingredients (they're too simple)
                ingredients_reserved = []
            else:
                # Get recipe from Spoonacular
                recipe_details = self.recipe_service.get_recipe_details(int(recipe_id))
                recipe_name = recipe_details.get("title", recipe_name)
                recipe_image = recipe_details.get("image")
                original_servings = recipe_details.get("servings", member_count)
                
                # Scale recipe to household size
                if original_servings != member_count:
                    recipe_details = self.recipe_service.scale_recipe(
                        recipe_details, member_count
                    )
                servings = recipe_details.get("servings", member_count)
                
                # Extract ingredients for deduction
                extended_ingredients = recipe_details.get("extendedIngredients", [])
                ingredients_reserved = []
                
                for ing in extended_ingredients:
                    ing_name = ing.get("name", "").lower().strip()
                    ing_amount = ing.get("amount", 0)
                    ing_unit = ing.get("unit", "")
                    
                    ingredients_reserved.append({
                        "name": ing_name,
                        "amount": ing_amount,
                        "unit": ing_unit
                    })
                    
                    # Deduct from session_pantry
                    for item_id, item_data in list(session_pantry.items()):
                        base_ingredient = item_data.get("base_ingredient", "").lower().strip()
                        unit = item_data.get("unit", "")
                        quantity = item_data.get("quantity", 0)
                        
                        # Match ingredient (simple matching)
                        if base_ingredient in ing_name or ing_name in base_ingredient:
                            if unit == ing_unit or (not unit and not ing_unit):
                                # Deduct quantity
                                new_quantity = max(0, quantity - ing_amount)
                                session_pantry[item_id]["quantity"] = new_quantity
                                
                                if new_quantity == 0:
                                    # Remove from session pantry
                                    del session_pantry[item_id]
                                break
            
            # Create meal plan entry
            meal_plan_data = {
                "household_id": household_id,
                "user_id": user_id,
                "meal_date": meal_date.isoformat(),
                "meal_type": meal_type,
                "recipe_id": recipe_id if not recipe_id.startswith("staple_") else None,
                "recipe_name": recipe_name,
                "recipe_image": recipe_image,
                "servings": servings,
                "is_leftover": False,
                "ingredients_reserved": ingredients_reserved
            }
            
            meal_plan_response = (
                client.table("meal_plan")
                .insert(meal_plan_data)
                .execute()
            )
            
            if not meal_plan_response.data:
                raise DatabaseException("Failed to create meal plan entry")
            
            meal_plan_entry = meal_plan_response.data[0]
            
            # Auto-create leftover entry if dinner
            leftover_entry = None
            if meal_type == "dinner":
                next_day = meal_date + timedelta(days=1)
                leftover_data = {
                    "household_id": household_id,
                    "user_id": user_id,
                    "meal_date": next_day.isoformat(),
                    "meal_type": "lunch",
                    "recipe_id": None,
                    "recipe_name": f"Leftovers from {recipe_name}",
                    "recipe_image": recipe_image,
                    "servings": servings,
                    "is_leftover": True,
                    "leftover_from_id": meal_plan_entry["id"],
                    "manually_marked_leftover": False,
                    "ingredients_reserved": []
                }
                
                leftover_response = (
                    client.table("meal_plan")
                    .insert(leftover_data)
                    .execute()
                )
                
                if leftover_response.data:
                    leftover_entry = leftover_response.data[0]
            
            # Add recipe to accepted_recipes (exclude from future suggestions for the week)
            if recipe_id not in accepted_recipes:
                accepted_recipes.append(recipe_id)
            
            # Update session pantry and accepted recipes
            client.table("meal_plan_wizard_session").update({
                "session_pantry": session_pantry,
                "accepted_recipes": accepted_recipes
            }).eq("id", session_id).execute()
            
            logger.info(
                f"Accepted recipe {recipe_id} for {meal_type} on {meal_date} "
                f"(session: {session_id})"
            )
            
            return {
                "meal_plan_entry": meal_plan_entry,
                "leftover_entry": leftover_entry,
                "updated_session_pantry": session_pantry
            }
            
        except ValidationException:
            raise
        except Exception as e:
            logger.error(f"Failed to accept recipe: {e}")
            raise DatabaseException(f"Failed to accept recipe: {e}")
    
    async def manually_mark_leftover(
        self, session_id: str, meal_id: str, leftover_date: date
    ) -> Dict:
        """
        Manually mark a meal as making leftovers
        
        Args:
            session_id: Wizard session ID
            meal_id: Meal plan entry ID
            leftover_date: Date for leftover meal
        
        Returns:
            Leftover meal plan entry
        """
        try:
            client = self.supabase.admin_client if self.supabase.admin_client else self.supabase.client
            
            # Get original meal
            meal_response = (
                client.table("meal_plan")
                .select("*")
                .eq("id", meal_id)
                .execute()
            )
            
            if not meal_response.data:
                raise ValidationException("Meal not found")
            
            meal = meal_response.data[0]
            
            # Create leftover entry
            leftover_data = {
                "household_id": meal["household_id"],
                "user_id": meal["user_id"],
                "meal_date": leftover_date.isoformat(),
                "meal_type": "lunch",
                "recipe_id": meal.get("recipe_id"),
                "recipe_name": f"Leftovers from {meal['recipe_name']}",
                "recipe_image": meal.get("recipe_image"),
                "servings": meal.get("servings"),
                "is_leftover": True,
                "leftover_from_id": meal_id,
                "manually_marked_leftover": True,
                "ingredients_reserved": []
            }
            
            leftover_response = (
                client.table("meal_plan")
                .insert(leftover_data)
                .execute()
            )
            
            if not leftover_response.data:
                raise DatabaseException("Failed to create leftover entry")
            
            # Update original meal
            client.table("meal_plan").update({
                "manually_marked_leftover": True
            }).eq("id", meal_id).execute()
            
            return leftover_response.data[0]
            
        except ValidationException:
            raise
        except Exception as e:
            logger.error(f"Failed to mark leftover: {e}")
            raise DatabaseException(f"Failed to mark leftover: {e}")
    
    async def complete_wizard(self, session_id: str) -> Dict:
        """
        Complete wizard and generate shopping list
        
        Args:
            session_id: Wizard session ID
        
        Returns:
            Dictionary with summary and shopping list
        """
        try:
            from backend.services.shopping_list_service import ShoppingListService
            
            # Get session
            client = self.supabase.admin_client if self.supabase.admin_client else self.supabase.client
            session_response = (
                client.table("meal_plan_wizard_session")
                .select("*")
                .eq("id", session_id)
                .execute()
            )
            
            if not session_response.data:
                raise ValidationException("Wizard session not found")
            
            session = session_response.data[0]
            household_id = session["household_id"]
            
            # Get meal plans created in this session (last 2 hours)
            two_hours_ago = (datetime.utcnow() - timedelta(hours=2)).isoformat()
            meals_response = (
                client.table("meal_plan")
                .select("*")
                .eq("household_id", household_id)
                .gte("created_at", two_hours_ago)
                .execute()
            )
            
            meals = meals_response.data if meals_response.data else []
            
            # Generate shopping list
            shopping_list_service = ShoppingListService(self.supabase)
            
            # Get date range from meals
            if meals:
                dates = [datetime.fromisoformat(m["meal_date"]).date() for m in meals]
                start_date = min(dates)
                end_date = max(dates)
            else:
                start_date = date.today()
                end_date = date.today() + timedelta(days=6)
            
            shopping_list_result = await shopping_list_service.generate_from_meal_plan(
                household_id, start_date, end_date
            )
            
            # Delete wizard session
            client.table("meal_plan_wizard_session").delete().eq("id", session_id).execute()
            
            logger.info(
                f"Completed wizard session {session_id}: "
                f"{len(meals)} meals planned, {shopping_list_result['total_items']} shopping items"
            )
            
            return {
                "summary": {
                    "meals_planned": len(meals),
                    "shopping_list_items": shopping_list_result["total_items"]
                },
                "shopping_list": shopping_list_result["items"]
            }
            
        except ValidationException:
            raise
        except Exception as e:
            logger.error(f"Failed to complete wizard: {e}")
            raise DatabaseException(f"Failed to complete wizard: {e}")
    
    async def get_meal_plan(
        self, household_id: str, start_date: date, end_date: date
    ) -> List[Dict]:
        """
        Get meal plan for date range
        
        Args:
            household_id: Household ID
            start_date: Start date
            end_date: End date
        
        Returns:
            List of meal plan entries
        """
        try:
            client = self.supabase.admin_client if self.supabase.admin_client else self.supabase.client
            response = (
                client.table("meal_plan")
                .select("*")
                .eq("household_id", household_id)
                .gte("meal_date", start_date.isoformat())
                .lte("meal_date", end_date.isoformat())
                .order("meal_date", desc=False)
                .order("meal_type", desc=False)
                .execute()
            )
            
            return response.data if response.data else []
            
        except Exception as e:
            logger.error(f"Failed to get meal plan: {e}")
            raise DatabaseException(f"Failed to get meal plan: {e}")
    
    async def update_meal(self, meal_id: str, updates: Dict) -> Dict:
        """
        Update meal plan entry
        
        Args:
            meal_id: Meal plan entry ID
            updates: Dictionary of fields to update
        
        Returns:
            Updated meal plan entry
        """
        try:
            client = self.supabase.admin_client if self.supabase.admin_client else self.supabase.client
            response = (
                client.table("meal_plan")
                .update(updates)
                .eq("id", meal_id)
                .execute()
            )
            
            if not response.data:
                raise ValidationException("Meal not found")
            
            return response.data[0]
            
        except ValidationException:
            raise
        except Exception as e:
            logger.error(f"Failed to update meal: {e}")
            raise DatabaseException(f"Failed to update meal: {e}")
    
    async def delete_meal(self, meal_id: str) -> None:
        """
        Delete meal from plan
        
        Args:
            meal_id: Meal plan entry ID
        """
        try:
            from backend.services.shopping_list_service import ShoppingListService
            
            # Get meal to find household and date range
            client = self.supabase.admin_client if self.supabase.admin_client else self.supabase.client
            meal_response = (
                client.table("meal_plan")
                .select("*")
                .eq("id", meal_id)
                .execute()
            )
            
            if not meal_response.data:
                raise ValidationException("Meal not found")
            
            meal = meal_response.data[0]
            household_id = meal["household_id"]
            meal_date = datetime.fromisoformat(meal["meal_date"]).date()
            
            # Delete meal
            client.table("meal_plan").delete().eq("id", meal_id).execute()
            
            # Regenerate shopping list
            shopping_list_service = ShoppingListService(self.supabase)
            await shopping_list_service.generate_from_meal_plan(
                household_id, meal_date, meal_date + timedelta(days=6)
            )
            
            logger.info(f"Deleted meal {meal_id}")
            
        except ValidationException:
            raise
        except Exception as e:
            logger.error(f"Failed to delete meal: {e}")
            raise DatabaseException(f"Failed to delete meal: {e}")
    
    async def swap_meals(self, meal_id_1: str, meal_id_2: str) -> None:
        """
        Swap two meals in the calendar
        
        Args:
            meal_id_1: First meal ID
            meal_id_2: Second meal ID
        """
        try:
            client = self.supabase.admin_client if self.supabase.admin_client else self.supabase.client
            
            # Get both meals
            meal1_response = (
                client.table("meal_plan")
                .select("*")
                .eq("id", meal_id_1)
                .execute()
            )
            
            meal2_response = (
                client.table("meal_plan")
                .select("*")
                .eq("id", meal_id_2)
                .execute()
            )
            
            if not meal1_response.data or not meal2_response.data:
                raise ValidationException("One or both meals not found")
            
            meal1 = meal1_response.data[0]
            meal2 = meal2_response.data[0]
            
            # Swap dates and meal types
            temp_date = meal1["meal_date"]
            temp_type = meal1["meal_type"]
            
            client.table("meal_plan").update({
                "meal_date": meal2["meal_date"],
                "meal_type": meal2["meal_type"]
            }).eq("id", meal_id_1).execute()
            
            client.table("meal_plan").update({
                "meal_date": temp_date,
                "meal_type": temp_type
            }).eq("id", meal_id_2).execute()
            
            logger.info(f"Swapped meals {meal_id_1} and {meal_id_2}")
            
        except ValidationException:
            raise
        except Exception as e:
            logger.error(f"Failed to swap meals: {e}")
            raise DatabaseException(f"Failed to swap meals: {e}")


def create_meal_plan_service(
    supabase_service: SupabaseService,
    pantry_service: PantryService,
    recipe_service: RecipeService,
    household_service: HouseholdService
) -> MealPlanService:
    """
    Factory function to create MealPlanService
    
    Args:
        supabase_service: Supabase service instance
        pantry_service: Pantry service instance
        recipe_service: Recipe service instance
        household_service: Household service instance
    
    Returns:
        Initialized MealPlanService instance
    """
    return MealPlanService(
        supabase_service, pantry_service, recipe_service, household_service
    )
