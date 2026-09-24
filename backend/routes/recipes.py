"""Recipe API routes"""

import re

from flask import Blueprint, request, current_app, jsonify
from backend.utils.logger import get_logger
from backend.utils.auth import get_user_id_from_request
from backend.services.staple_catalog import get_staple_recipe, is_known_staple_id
from backend.utils.exceptions import (
    ValidationException,
    AIServiceException,
    RecipeQuotaException,
)

_SPOONACULAR_ID_RE = re.compile(r"[0-9]{1,16}")

RECIPE_QUOTA_MESSAGE = "Daily recipe quota reached, try again later."
RECIPE_BUDGET_MESSAGE = "Recipe lookup limit reached for now. Try again in a bit."
RECIPE_USER_CAP_MESSAGE = (
    "You've used your recipe lookups for today. Try again tomorrow."
)
RECIPE_LEDGER_UNAVAILABLE_MESSAGE = "Recipe service temporarily unavailable."

logger = get_logger(__name__)


def _recipe_ai_service_response(e: AIServiceException):
    from backend.services.spoonacular_ledger import (
        is_ledger_unavailable_error,
        is_user_cap_error,
    )

    msg = str(e)
    if is_user_cap_error(msg):
        return jsonify({"error": RECIPE_USER_CAP_MESSAGE, "code": "recipe_user_cap"}), 429
    if is_ledger_unavailable_error(msg):
        return jsonify({"error": RECIPE_LEDGER_UNAVAILABLE_MESSAGE}), 503
    logger.error(f"API service error: {e}")
    return jsonify({"error": str(e)}), 500

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
    except RecipeQuotaException as e:
        logger.error(f"Recipe quota exceeded getting recipes: {e}")
        return jsonify({"error": RECIPE_QUOTA_MESSAGE, "code": "recipe_quota"}), 429
    except AIServiceException as e:
        return _recipe_ai_service_response(e)
    except Exception as e:
        logger.error(f"Error getting recipes: {e}")
        return jsonify({"error": str(e)}), 500


@recipes_bp.route("/recipes/<recipe_id>", methods=["GET"])
def get_recipe_details(recipe_id):
    """
    Get full recipe details including instructions.

    Path params:
        - recipe_id: Staple catalog id (staple_*) or Spoonacular numeric id
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401

    if not recipe_id or len(recipe_id) > 64:
        return jsonify({"error": "Resource not found"}), 404

    if is_known_staple_id(recipe_id):
        recipe = get_staple_recipe(recipe_id)
        if recipe is None:
            return jsonify({"error": "Resource not found"}), 404
        return jsonify(recipe)

    if not _SPOONACULAR_ID_RE.fullmatch(recipe_id):
        return jsonify({"error": "Resource not found"}), 404

    service = get_recipe_service()
    if not service:
        return jsonify({"error": "Recipe service not available"}), 503

    try:
        recipe = service.get_recipe_details(
            int(recipe_id), user_id=user_id, caller="recipe_open"
        )
        return jsonify(recipe)
    except ValidationException as e:
        logger.error(f"Validation error getting recipe details: {e}")
        return jsonify({"error": str(e)}), 400
    except RecipeQuotaException as e:
        logger.error(f"Recipe quota exceeded getting recipe details: {e}")
        return jsonify({"error": RECIPE_QUOTA_MESSAGE, "code": "recipe_quota"}), 429
    except AIServiceException as e:
        return _recipe_ai_service_response(e)
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
    except RecipeQuotaException as e:
        logger.error(f"Recipe quota exceeded getting suggestions: {e}")
        return jsonify({"error": RECIPE_QUOTA_MESSAGE, "code": "recipe_quota"}), 429
    except AIServiceException as e:
        return _recipe_ai_service_response(e)
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
    except RecipeQuotaException as e:
        return jsonify({"error": RECIPE_QUOTA_MESSAGE, "code": "recipe_quota"}), 429
    except AIServiceException as e:
        return _recipe_ai_service_response(e)
    except Exception as e:
        logger.error(f"Error recording dismiss: {e}")
        return jsonify({"error": str(e)}), 500
