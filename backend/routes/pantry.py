"""Pantry management API routes"""

import asyncio
from flask import Blueprint, request, current_app, jsonify
from backend.utils.logger import get_logger
from backend.utils.auth import get_user_id_from_request
from backend.utils.exceptions import (
    ValidationException,
    DatabaseException,
)

logger = get_logger(__name__)

pantry_bp = Blueprint("pantry", __name__)


def get_pantry_service():
    """Get pantry service from app config"""
    return current_app.config.get("PANTRY_SERVICE")


def get_supabase_service():
    """Get supabase service from app config"""
    return current_app.config.get("SUPABASE_SERVICE")


def run_async(coro):
    """Run an async coroutine synchronously"""
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


@pantry_bp.route("/pantry", methods=["GET"])
def get_pantry():
    """
    Get the current user's pantry summary
    
    Query params:
        - household_id: Optional household ID (defaults to user's household)
    
    Returns:
        Pantry summary with items grouped by base ingredient
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401
    
    service = get_pantry_service()
    if not service:
        return jsonify({"error": "Pantry service not available"}), 503
    
    household_id = request.args.get("household_id")
    
    try:
        summary = run_async(service.get_pantry_summary(user_id, household_id))
        return jsonify(summary)
    except DatabaseException as e:
        logger.error(f"Database error getting pantry: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error getting pantry: {e}")
        return jsonify({"error": str(e)}), 500


@pantry_bp.route("/pantry/reset", methods=["DELETE"])
def reset_pantry():
    """
    Delete all pantry items for the current user.
    Optionally scoped to a household via query param.
    Used for testing re-import workflows.
    
    Query params:
        - household_id: Optional household ID to scope deletion
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401
    
    supabase = get_supabase_service()
    if not supabase:
        return jsonify({"error": "Database service not available"}), 503
    
    household_id = request.args.get("household_id")
    
    try:
        supabase.reset_pantry(user_id, household_id)
        return jsonify({"message": "Pantry reset"}), 200
    except DatabaseException as e:
        logger.error(f"Database error resetting pantry: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error resetting pantry: {e}")
        return jsonify({"error": str(e)}), 500


@pantry_bp.route("/pantry/items", methods=["POST"])
def add_pantry_item():
    """
    Add or update a pantry item manually
    
    Request body:
        - name: Product name (required)
        - base_ingredient: Base ingredient name (required)
        - variant: Variant description (optional)
        - quantity: Amount (required)
        - unit: Unit of measurement (required)
        - category: Product category (optional)
    
    Returns:
        Created/updated pantry item ID
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401
    
    service = get_pantry_service()
    if not service:
        return jsonify({"error": "Pantry service not available"}), 503
    
    data = request.get_json() or {}
    
    # Validate required fields
    required_fields = ["base_ingredient", "quantity", "unit"]
    missing_fields = [f for f in required_fields if not data.get(f)]
    if missing_fields:
        return jsonify({"error": f"Missing required fields: {missing_fields}"}), 400
    
    try:
        quantity = float(data["quantity"])
    except (ValueError, TypeError):
        return jsonify({"error": "Quantity must be a number"}), 400
    
    # Build normalized item structure
    normalized_item = {
        "base_ingredient": data["base_ingredient"],
        "variant": data.get("variant"),
        "normalized_name": data.get("name") or f"{data['base_ingredient']} ({data.get('variant', 'default')})",
        "product_type": data.get("product_type"),
        "category": data.get("category"),
        "tags": data.get("tags", [])
    }
    
    household_id = data.get("household_id")
    
    try:
        item_id = run_async(service.add_to_pantry(
            user_id=user_id,
            normalized_item=normalized_item,
            quantity=quantity,
            unit=data["unit"],
            receipt_id=data.get("receipt_id"),  # None for manual entries
            household_id=household_id
        ))
        return jsonify({"item_id": item_id, "message": "Item added to pantry"}), 201
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except DatabaseException as e:
        logger.error(f"Database error adding pantry item: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error adding pantry item: {e}")
        return jsonify({"error": str(e)}), 500


@pantry_bp.route("/pantry/items/<item_id>", methods=["PUT"])
def update_pantry_item(item_id):
    """
    Update a pantry item's quantity
    
    Path params:
        - item_id: Pantry item ID
    
    Request body:
        - quantity: New quantity (required)
    
    Returns:
        Success message
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401
    
    supabase = get_supabase_service()
    if not supabase:
        return jsonify({"error": "Database service not available"}), 503
    
    data = request.get_json() or {}
    
    if "quantity" not in data:
        return jsonify({"error": "Quantity is required"}), 400
    
    try:
        quantity = float(data["quantity"])
        if quantity < 0:
            return jsonify({"error": "Quantity cannot be negative"}), 400
    except (ValueError, TypeError):
        return jsonify({"error": "Quantity must be a number"}), 400
    
    try:
        supabase.update_pantry_quantity(item_id, quantity)
        return jsonify({"message": "Pantry item updated", "quantity": quantity})
    except DatabaseException as e:
        logger.error(f"Database error updating pantry item: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error updating pantry item: {e}")
        return jsonify({"error": str(e)}), 500


@pantry_bp.route("/pantry/items/<item_id>", methods=["DELETE"])
def delete_pantry_item(item_id):
    """
    Delete a pantry item
    
    Path params:
        - item_id: Pantry item ID
    
    Returns:
        Success message
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401
    
    supabase = get_supabase_service()
    if not supabase:
        return jsonify({"error": "Database service not available"}), 503
    
    try:
        supabase.delete_pantry_item(item_id)
        return jsonify({"message": "Pantry item deleted"})
    except DatabaseException as e:
        logger.error(f"Database error deleting pantry item: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error deleting pantry item: {e}")
        return jsonify({"error": str(e)}), 500


@pantry_bp.route("/pantry/consume", methods=["POST"])
def consume_ingredients():
    """
    Consume ingredients when cooking a recipe
    
    Request body:
        - recipe_id: Recipe ID (required)
        - recipe_name: Recipe name (required)
        - servings: Number of servings (required)
        - ingredients: List of ingredients with name, amount, unit (required)
    
    Returns:
        Consumption results with warnings
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401
    
    service = get_pantry_service()
    if not service:
        return jsonify({"error": "Pantry service not available"}), 503
    
    data = request.get_json() or {}
    
    # Validate required fields
    required_fields = ["recipe_id", "recipe_name", "servings", "ingredients"]
    missing_fields = [f for f in required_fields if f not in data]
    if missing_fields:
        return jsonify({"error": f"Missing required fields: {missing_fields}"}), 400
    
    if not isinstance(data["ingredients"], list):
        return jsonify({"error": "Ingredients must be a list"}), 400
    
    try:
        servings = int(data["servings"])
        if servings < 1:
            return jsonify({"error": "Servings must be at least 1"}), 400
    except (ValueError, TypeError):
        return jsonify({"error": "Servings must be a number"}), 400
    
    # Validate ingredients structure
    for i, ing in enumerate(data["ingredients"]):
        if not isinstance(ing, dict):
            return jsonify({"error": f"Ingredient {i} must be an object"}), 400
        if "name" not in ing or "amount" not in ing:
            return jsonify({"error": f"Ingredient {i} missing name or amount"}), 400
    
    household_id = data.get("household_id")
    
    try:
        result = run_async(service.consume_ingredients(
            user_id=user_id,
            recipe_id=data["recipe_id"],
            recipe_name=data["recipe_name"],
            servings=servings,
            ingredients=data["ingredients"],
            household_id=household_id
        ))
        return jsonify(result)
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except DatabaseException as e:
        logger.error(f"Database error consuming ingredients: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error consuming ingredients: {e}")
        return jsonify({"error": str(e)}), 500


@pantry_bp.route("/pantry/check-recipe", methods=["POST"])
def check_recipe_availability():
    """
    Check if ingredients are available for a recipe
    
    Request body:
        - ingredients: List of required ingredients with name, amount, unit (required)
    
    Returns:
        Availability analysis with can_make flag and substitution options
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401
    
    service = get_pantry_service()
    if not service:
        return jsonify({"error": "Pantry service not available"}), 503
    
    data = request.get_json() or {}
    
    if "ingredients" not in data:
        return jsonify({"error": "Ingredients list is required"}), 400
    
    if not isinstance(data["ingredients"], list):
        return jsonify({"error": "Ingredients must be a list"}), 400
    
    # Validate ingredients structure
    for i, ing in enumerate(data["ingredients"]):
        if not isinstance(ing, dict):
            return jsonify({"error": f"Ingredient {i} must be an object"}), 400
        if "name" not in ing or "amount" not in ing:
            return jsonify({"error": f"Ingredient {i} missing name or amount"}), 400
    
    household_id = data.get("household_id")
    
    try:
        result = run_async(service.check_ingredient_availability(
            user_id=user_id,
            required_ingredients=data["ingredients"],
            household_id=household_id
        ))
        return jsonify(result)
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except DatabaseException as e:
        logger.error(f"Database error checking recipe: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error checking recipe: {e}")
        return jsonify({"error": str(e)}), 500
