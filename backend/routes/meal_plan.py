"""Meal planning API routes"""

import asyncio
from datetime import date
from flask import Blueprint, request, current_app, jsonify
from backend.utils.logger import get_logger
from backend.utils.auth import get_user_id_from_request
from backend.utils.exceptions import (
    ValidationException,
    DatabaseException,
)

logger = get_logger(__name__)

meal_plan_bp = Blueprint("meal_plan", __name__)


@meal_plan_bp.before_request
def _gate_meal_planner():
    if not current_app.config.get("FEATURE_MEAL_PLANNER"):
        return jsonify({"error": "Not found"}), 404


def get_meal_plan_service():
    """Get meal plan service from app config"""
    return current_app.config.get("MEAL_PLAN_SERVICE")


def get_shopping_list_service():
    """Get shopping list service from app config"""
    return current_app.config.get("SHOPPING_LIST_SERVICE")


def run_async(coro):
    """Run an async coroutine synchronously"""
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


@meal_plan_bp.route("/meal-plan/wizard/start", methods=["POST"])
def start_wizard():
    """
    Start meal planning wizard session
    
    Request body:
        - meal_slots: {breakfast: bool, lunch: bool, dinner: bool}
        - start_date: Start date (YYYY-MM-DD)
        - household_id: Optional household ID
    
    Returns:
        Session ID, household member count, session pantry snapshot
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401
    
    service = get_meal_plan_service()
    if not service:
        return jsonify({"error": "Meal plan service not available"}), 503
    
    data = request.get_json() or {}
    meal_slots = data.get("meal_slots", {"breakfast": False, "lunch": False, "dinner": True})
    start_date_str = data.get("start_date")
    household_id = data.get("household_id")
    
    if not start_date_str:
        return jsonify({"error": "start_date is required"}), 400
    
    try:
        start_date = date.fromisoformat(start_date_str)
        
        # Get household_id if not provided
        if not household_id:
            from backend.services.household_service import HouseholdService
            household_service = current_app.config.get("HOUSEHOLD_SERVICE")
            if household_service:
                household_id = household_service.get_household_id(user_id)
        
        if not household_id:
            return jsonify({"error": "Household ID required"}), 400
        
        result = run_async(service.start_wizard(user_id, household_id, meal_slots, start_date))
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": f"Invalid date format: {e}"}), 400
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except DatabaseException as e:
        logger.error(f"Database error starting wizard: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error starting wizard: {e}", exc_info=True)
        return jsonify({"error": f"Failed to start wizard: {str(e)}"}), 500


@meal_plan_bp.route("/meal-plan/wizard/<session_id>/suggestions", methods=["GET"])
def get_suggestions(session_id):
    """
    Get recipe suggestions for wizard session
    
    Query params:
        - meal_type: breakfast, lunch, or dinner
        - threshold: Match threshold (0.0-1.0, default 0.9)
    
    Returns:
        List of recipe suggestions
    """
    service = get_meal_plan_service()
    if not service:
        return jsonify({"error": "Meal plan service not available"}), 503
    
    meal_type = request.args.get("meal_type", "dinner")
    threshold = float(request.args.get("threshold", 0.9))
    
    try:
        recipes = run_async(service.get_recipe_suggestions(session_id, meal_type, threshold))
        return jsonify({"recipes": recipes})
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except DatabaseException as e:
        logger.error(f"Database error getting suggestions: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error getting suggestions: {e}")
        return jsonify({"error": str(e)}), 500


@meal_plan_bp.route("/meal-plan/wizard/<session_id>/accept", methods=["POST"])
def accept_recipe(session_id):
    """
    Accept a recipe and add to meal plan
    
    Request body:
        - recipe_id: Recipe ID (Spoonacular ID or staple meal ID)
        - meal_date: Date (YYYY-MM-DD)
        - meal_type: breakfast, lunch, or dinner
    
    Returns:
        Meal plan entry and updated session pantry
    """
    service = get_meal_plan_service()
    if not service:
        return jsonify({"error": "Meal plan service not available"}), 503
    
    data = request.get_json() or {}
    recipe_id = data.get("recipe_id")
    meal_date_str = data.get("meal_date")
    meal_type = data.get("meal_type", "dinner")
    
    if not recipe_id or not meal_date_str:
        return jsonify({"error": "recipe_id and meal_date are required"}), 400
    
    try:
        meal_date = date.fromisoformat(meal_date_str)
        result = run_async(service.accept_recipe(session_id, recipe_id, meal_date, meal_type))
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": f"Invalid date format: {e}"}), 400
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except DatabaseException as e:
        logger.error(f"Database error accepting recipe: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error accepting recipe: {e}")
        return jsonify({"error": str(e)}), 500


@meal_plan_bp.route("/meal-plan/wizard/<session_id>/soft-reject", methods=["POST"])
def soft_reject_recipe(session_id):
    """
    Soft reject a recipe (slot-only exclusion - "not tonight")
    
    Request body:
        - recipe_id: Recipe ID (Spoonacular ID or staple meal ID)
    
    Returns:
        Success message
    """
    service = get_meal_plan_service()
    if not service:
        return jsonify({"error": "Meal plan service not available"}), 503
    
    data = request.get_json() or {}
    recipe_id = data.get("recipe_id")
    
    if not recipe_id:
        return jsonify({"error": "recipe_id is required"}), 400
    
    try:
        run_async(service.soft_reject_recipe(session_id, recipe_id))
        return jsonify({"message": "Recipe rejected for this slot"})
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except DatabaseException as e:
        logger.error(f"Database error rejecting recipe: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error rejecting recipe: {e}")
        return jsonify({"error": str(e)}), 500


@meal_plan_bp.route("/meal-plan/wizard/<session_id>/ban", methods=["POST"])
def ban_recipe(session_id):
    """
    Ban a recipe for 6 months (hard reject - "absolutely not")
    
    Request body:
        - recipe_id: Recipe ID (Spoonacular ID or staple meal ID)
        - recipe_name: Recipe name for display
    
    Returns:
        Success message
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401
    
    service = get_meal_plan_service()
    if not service:
        return jsonify({"error": "Meal plan service not available"}), 503
    
    data = request.get_json() or {}
    recipe_id = data.get("recipe_id")
    recipe_name = data.get("recipe_name", "Recipe")
    
    if not recipe_id:
        return jsonify({"error": "recipe_id is required"}), 400
    
    try:
        run_async(service.ban_recipe(session_id, recipe_id, recipe_name, user_id))
        return jsonify({"message": "Recipe banned for 6 months"})
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except DatabaseException as e:
        logger.error(f"Database error banning recipe: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error banning recipe: {e}")
        return jsonify({"error": str(e)}), 500


@meal_plan_bp.route("/meal-plan/wizard/<session_id>/ban/<recipe_id>", methods=["DELETE"])
def unban_recipe(session_id, recipe_id):
    """
    Unban a recipe (undo ban)
    
    Returns:
        Success message
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401
    
    service = get_meal_plan_service()
    if not service:
        return jsonify({"error": "Meal plan service not available"}), 503
    
    try:
        run_async(service.unban_recipe(session_id, recipe_id, user_id))
        return jsonify({"message": "Ban removed"})
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except DatabaseException as e:
        logger.error(f"Database error unbanning recipe: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error unbanning recipe: {e}")
        return jsonify({"error": str(e)}), 500


@meal_plan_bp.route("/meal-plan/wizard/<session_id>/mark-leftover", methods=["POST"])
def mark_leftover(session_id):
    """
    Manually mark a meal as making leftovers
    
    Request body:
        - meal_id: Meal plan entry ID
        - leftover_date: Date for leftover meal (YYYY-MM-DD)
    
    Returns:
        Leftover meal plan entry
    """
    service = get_meal_plan_service()
    if not service:
        return jsonify({"error": "Meal plan service not available"}), 503
    
    data = request.get_json() or {}
    meal_id = data.get("meal_id")
    leftover_date_str = data.get("leftover_date")
    
    if not meal_id or not leftover_date_str:
        return jsonify({"error": "meal_id and leftover_date are required"}), 400
    
    try:
        leftover_date = date.fromisoformat(leftover_date_str)
        result = run_async(service.manually_mark_leftover(session_id, meal_id, leftover_date))
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": f"Invalid date format: {e}"}), 400
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except DatabaseException as e:
        logger.error(f"Database error marking leftover: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error marking leftover: {e}")
        return jsonify({"error": str(e)}), 500


@meal_plan_bp.route("/meal-plan/wizard/<session_id>/complete", methods=["POST"])
def complete_wizard(session_id):
    """
    Complete wizard and generate shopping list
    
    Returns:
        Summary and shopping list
    """
    service = get_meal_plan_service()
    if not service:
        return jsonify({"error": "Meal plan service not available"}), 503
    
    try:
        result = run_async(service.complete_wizard(session_id))
        return jsonify(result)
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except DatabaseException as e:
        logger.error(f"Database error completing wizard: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error completing wizard: {e}")
        return jsonify({"error": str(e)}), 500


@meal_plan_bp.route("/meal-plan", methods=["GET"])
def get_meal_plan():
    """
    Get meal plan for date range
    
    Query params:
        - start_date: Start date (YYYY-MM-DD)
        - end_date: End date (YYYY-MM-DD)
        - household_id: Optional household ID
    
    Returns:
        List of meal plan entries
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401
    
    service = get_meal_plan_service()
    if not service:
        return jsonify({"error": "Meal plan service not available"}), 503
    
    start_date_str = request.args.get("start_date")
    end_date_str = request.args.get("end_date")
    household_id = request.args.get("household_id")
    
    if not start_date_str or not end_date_str:
        return jsonify({"error": "start_date and end_date are required"}), 400
    
    try:
        start_date = date.fromisoformat(start_date_str)
        end_date = date.fromisoformat(end_date_str)
        
        # Get household_id if not provided
        if not household_id:
            household_service = current_app.config.get("HOUSEHOLD_SERVICE")
            if household_service:
                household_id = household_service.get_household_id(user_id)
        
        if not household_id:
            return jsonify({"error": "Household ID required"}), 400
        
        meals = run_async(service.get_meal_plan(household_id, start_date, end_date))
        return jsonify({"meals": meals})
    except ValueError as e:
        return jsonify({"error": f"Invalid date format: {e}"}), 400
    except DatabaseException as e:
        logger.error(f"Database error getting meal plan: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error getting meal plan: {e}")
        return jsonify({"error": str(e)}), 500


@meal_plan_bp.route("/meal-plan/<meal_id>", methods=["PATCH"])
def update_meal(meal_id):
    """
    Update meal plan entry
    
    Request body:
        - recipe_id: Optional recipe ID
        - servings: Optional servings count
        - is_leftover: Optional leftover flag
    
    Returns:
        Updated meal plan entry
    """
    service = get_meal_plan_service()
    if not service:
        return jsonify({"error": "Meal plan service not available"}), 503
    
    data = request.get_json() or {}
    
    try:
        result = run_async(service.update_meal(meal_id, data))
        return jsonify(result)
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except DatabaseException as e:
        logger.error(f"Database error updating meal: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error updating meal: {e}")
        return jsonify({"error": str(e)}), 500


@meal_plan_bp.route("/meal-plan/<meal_id>", methods=["DELETE"])
def delete_meal(meal_id):
    """
    Delete meal from plan
    
    Returns:
        204 No Content
    """
    service = get_meal_plan_service()
    if not service:
        return jsonify({"error": "Meal plan service not available"}), 503
    
    try:
        run_async(service.delete_meal(meal_id))
        return "", 204
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except DatabaseException as e:
        logger.error(f"Database error deleting meal: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error deleting meal: {e}")
        return jsonify({"error": str(e)}), 500


@meal_plan_bp.route("/meal-plan/<meal_id_1>/swap/<meal_id_2>", methods=["POST"])
def swap_meals(meal_id_1, meal_id_2):
    """
    Swap two meals in the calendar
    
    Returns:
        Success message
    """
    service = get_meal_plan_service()
    if not service:
        return jsonify({"error": "Meal plan service not available"}), 503
    
    try:
        run_async(service.swap_meals(meal_id_1, meal_id_2))
        return jsonify({"message": "Meals swapped successfully"})
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except DatabaseException as e:
        logger.error(f"Database error swapping meals: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error swapping meals: {e}")
        return jsonify({"error": str(e)}), 500


@meal_plan_bp.route("/shopping-list", methods=["GET"])
def get_shopping_list():
    """
    Get shopping list for household
    
    Query params:
        - include_purchased: Include purchased items (default: false)
        - household_id: Optional household ID
    
    Returns:
        List of shopping list items
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401
    
    service = get_shopping_list_service()
    if not service:
        return jsonify({"error": "Shopping list service not available"}), 503
    
    include_purchased = request.args.get("include_purchased", "false").lower() == "true"
    household_id = request.args.get("household_id")
    
    try:
        # Get household_id if not provided
        if not household_id:
            household_service = current_app.config.get("HOUSEHOLD_SERVICE")
            if household_service:
                household_id = household_service.get_household_id(user_id)
        
        if not household_id:
            return jsonify({"error": "Household ID required"}), 400
        
        items = run_async(service.get_shopping_list(household_id, include_purchased))
        return jsonify({"items": items})
    except DatabaseException as e:
        logger.error(f"Database error getting shopping list: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error getting shopping list: {e}")
        return jsonify({"error": str(e)}), 500


@meal_plan_bp.route("/shopping-list/<item_id>/purchased", methods=["POST"])
def mark_purchased(item_id):
    """
    Mark shopping list item as purchased
    
    Returns:
        Updated shopping list item
    """
    service = get_shopping_list_service()
    if not service:
        return jsonify({"error": "Shopping list service not available"}), 503
    
    try:
        result = run_async(service.mark_purchased(item_id))
        return jsonify(result)
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except DatabaseException as e:
        logger.error(f"Database error marking purchased: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error marking purchased: {e}")
        return jsonify({"error": str(e)}), 500
