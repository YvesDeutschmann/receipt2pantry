"""Recipe API routes"""

from flask import Blueprint, request, current_app, jsonify
from backend.utils.logger import get_logger
from backend.utils.auth import get_user_id_from_request
from backend.utils.exceptions import (
    ValidationException,
    AIServiceException,
)

logger = get_logger(__name__)

recipes_bp = Blueprint("recipes", __name__)


def get_recipe_service():
    """Get recipe service from app config"""
    return current_app.config.get("RECIPE_SERVICE")


def get_suggestion_service():
    """Phase 3: ranked recipe suggestions from pantry + depletion."""
    return current_app.config.get("SUGGESTION_SERVICE")


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


@recipes_bp.route("/suggestions", methods=["GET"])
def get_suggestions():
    """
    Phase 3: tiered recipe suggestions (use_soon_shelf, cook_tonight, probably_have, check_first).
    Query params: household_id (optional).
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401

    svc = get_suggestion_service()
    if not svc:
        return jsonify({"error": "Suggestion service not available"}), 503

    household_id = request.args.get("household_id")

    try:
        result = svc.get_recipe_suggestions(user_id, household_id)
        return jsonify(result)
    except ValidationException as e:
        logger.error(f"Validation error getting suggestions: {e}")
        return jsonify({"error": str(e)}), 400
    except AIServiceException as e:
        logger.error(f"API service error getting suggestions: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error getting suggestions: {e}")
        return jsonify({"error": str(e)}), 500


@recipes_bp.route("/suggestions/dismiss", methods=["POST"])
def dismiss_suggestion():
    """Record recipe dismiss for aspirational ingredient signal (Phase 3)."""
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401

    svc = get_suggestion_service()
    if not svc:
        return jsonify({"error": "Suggestion service not available"}), 503

    body = request.get_json(silent=True) or {}
    recipe_id = body.get("recipe_id")
    if recipe_id is None:
        return jsonify({"error": "recipe_id required"}), 400

    household_id = body.get("household_id")

    try:
        svc.on_recipe_dismiss(user_id, int(recipe_id), household_id=household_id)
        return jsonify({"ok": True})
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except AIServiceException as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error recording dismiss: {e}")
        return jsonify({"error": str(e)}), 500
