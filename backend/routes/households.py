"""Household management API routes"""

from flask import Blueprint, request, current_app, jsonify
from backend.utils.logger import get_logger
from backend.utils.exceptions import (
    ValidationException,
    AuthorizationException,
    DatabaseException,
)

logger = get_logger(__name__)

households_bp = Blueprint("households", __name__)


def get_household_service():
    """Get household service from app config"""
    return current_app.config.get("HOUSEHOLD_SERVICE")


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


@households_bp.route("/households", methods=["GET"])
def get_household():
    """
    Get the current user's household
    
    Returns:
        Household details with role, or null if not in a household
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401
    
    service = get_household_service()
    if not service:
        return jsonify({"error": "Household service not available"}), 503
    
    try:
        household = service.get_household(user_id)
        return jsonify({"household": household})
    except Exception as e:
        logger.error(f"Error getting household: {e}")
        return jsonify({"error": str(e)}), 500


@households_bp.route("/households", methods=["POST"])
def create_household():
    """
    Create a new household
    
    Request body:
        - name: Household name (required)
    
    Returns:
        Created household with join code
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401
    
    service = get_household_service()
    if not service:
        return jsonify({"error": "Household service not available"}), 503
    
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    
    if not name:
        return jsonify({"error": "Household name is required"}), 400
    
    try:
        household = service.create_household(user_id, name)
        return jsonify({"household": household}), 201
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"Error creating household: {e}")
        return jsonify({"error": str(e)}), 500


@households_bp.route("/households/join", methods=["POST"])
def join_household():
    """
    Join a household using a join code
    
    Request body:
        - join_code: 6-character join code (required)
    
    Returns:
        Joined household details
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401
    
    service = get_household_service()
    if not service:
        return jsonify({"error": "Household service not available"}), 503
    
    data = request.get_json() or {}
    join_code = data.get("join_code", "").strip()
    
    if not join_code:
        return jsonify({"error": "Join code is required"}), 400
    
    try:
        household = service.join_household(user_id, join_code)
        return jsonify({"household": household})
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"Error joining household: {e}")
        return jsonify({"error": str(e)}), 500


@households_bp.route("/households/leave", methods=["POST"])
def leave_household():
    """
    Leave the current household
    
    Returns:
        Success message
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401
    
    service = get_household_service()
    if not service:
        return jsonify({"error": "Household service not available"}), 503
    
    try:
        service.leave_household(user_id)
        return jsonify({"message": "Successfully left household"})
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except AuthorizationException as e:
        return jsonify({"error": str(e)}), 403
    except Exception as e:
        logger.error(f"Error leaving household: {e}")
        return jsonify({"error": str(e)}), 500


@households_bp.route("/households/members", methods=["GET"])
def get_members():
    """
    Get all members of the current household
    
    Returns:
        List of household members
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401
    
    service = get_household_service()
    if not service:
        return jsonify({"error": "Household service not available"}), 503
    
    try:
        members = service.get_members(user_id)
        return jsonify({"members": members})
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"Error getting members: {e}")
        return jsonify({"error": str(e)}), 500


@households_bp.route("/households/members/<member_user_id>", methods=["DELETE"])
def remove_member(member_user_id):
    """
    Remove a member from the household (owner only)
    
    Path params:
        - member_user_id: User ID of member to remove
    
    Returns:
        Success message
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401
    
    service = get_household_service()
    if not service:
        return jsonify({"error": "Household service not available"}), 503
    
    try:
        service.remove_member(user_id, member_user_id)
        return jsonify({"message": "Member removed successfully"})
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except AuthorizationException as e:
        return jsonify({"error": str(e)}), 403
    except Exception as e:
        logger.error(f"Error removing member: {e}")
        return jsonify({"error": str(e)}), 500


@households_bp.route("/households/code", methods=["POST"])
def regenerate_code():
    """
    Regenerate the household join code (owner only)
    
    Returns:
        New join code
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401
    
    service = get_household_service()
    if not service:
        return jsonify({"error": "Household service not available"}), 503
    
    try:
        new_code = service.regenerate_join_code(user_id)
        return jsonify({"join_code": new_code})
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except AuthorizationException as e:
        return jsonify({"error": str(e)}), 403
    except Exception as e:
        logger.error(f"Error regenerating code: {e}")
        return jsonify({"error": str(e)}), 500


@households_bp.route("/households/name", methods=["PUT"])
def update_name():
    """
    Update the household name (owner only)
    
    Request body:
        - name: New household name
    
    Returns:
        Updated household details
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401
    
    service = get_household_service()
    if not service:
        return jsonify({"error": "Household service not available"}), 503
    
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    
    if not name:
        return jsonify({"error": "Household name is required"}), 400
    
    try:
        household = service.update_household_name(user_id, name)
        return jsonify({"household": household})
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except AuthorizationException as e:
        return jsonify({"error": str(e)}), 403
    except Exception as e:
        logger.error(f"Error updating name: {e}")
        return jsonify({"error": str(e)}), 500
