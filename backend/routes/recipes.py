"""Recipe API routes"""

from flask import Blueprint, request, current_app, jsonify
from backend.utils.logger import get_logger
from backend.utils.exceptions import (
    ValidationException,
    AIServiceException,
)

logger = get_logger(__name__)

recipes_bp = Blueprint("recipes", __name__)


def get_recipe_service():
    """Get recipe service from app config"""
    return current_app.config.get("RECIPE_SERVICE")


def get_user_id_from_request():
    """
    Extract user ID from request.
    In production, this would come from JWT token validation.
    For now, we'll accept it from headers or query params.
    """
    # Try header first (standard auth flow)
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        # Try query param (for testing)
        user_id = request.args.get("user_id")
    if not user_id:
        # Try request body
        data = request.get_json(silent=True) or {}
        user_id = data.get("user_id")
    
    return user_id


@recipes_bp.route("/recipes", methods=["GET"])
def get_recipes():
    """
    Get recipe suggestions based on user's pantry
    
    Query params:
        - household_id: Optional household ID (defaults to user's household)
    
    Returns:
        List of recipe suggestions with id, title, image, missedIngredientCount
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401
    
    service = get_recipe_service()
    if not service:
        return jsonify({"error": "Recipe service not available"}), 503
    
    household_id = request.args.get("household_id")
    
    try:
        recipes = service.get_recipes_by_pantry(household_id, user_id)
        return jsonify({"recipes": recipes})
    except ValidationException as e:
        logger.error(f"Validation error getting recipes: {e}")
        return jsonify({"error": str(e)}), 400
    except AIServiceException as e:
        logger.error(f"API service error getting recipes: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error getting recipes: {e}")
        return jsonify({"error": str(e)}), 500


@recipes_bp.route("/recipes/<int:recipe_id>", methods=["GET"])
def get_recipe_details(recipe_id):
    """
    Get full recipe details including instructions
    
    Path params:
        - recipe_id: Spoonacular recipe ID
    
    Returns:
        Full recipe details with instructions
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401
    
    service = get_recipe_service()
    if not service:
        return jsonify({"error": "Recipe service not available"}), 503
    
    try:
        recipe = service.get_recipe_details(recipe_id)
        return jsonify(recipe)
    except ValidationException as e:
        logger.error(f"Validation error getting recipe details: {e}")
        return jsonify({"error": str(e)}), 400
    except AIServiceException as e:
        logger.error(f"API service error getting recipe details: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error getting recipe details: {e}")
        return jsonify({"error": str(e)}), 500
