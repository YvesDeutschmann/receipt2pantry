"""Dev-only API routes (guarded by Flask debug mode)."""

from flask import Blueprint, current_app, jsonify

from backend.utils.auth import get_user_id_from_request
from backend.utils.exceptions import DatabaseException
from backend.utils.logger import get_logger

logger = get_logger(__name__)

dev_bp = Blueprint("dev", __name__)


def get_supabase_service():
    return current_app.config.get("SUPABASE_SERVICE")


@dev_bp.route("/dev/reset-onboarding", methods=["DELETE"])
def reset_onboarding():
    """
    Reset local app data for onboarding QA: pantry, receipts, household,
    plus client clears user_metadata via Supabase auth.
    """
    if not current_app.debug:
        return jsonify({"error": "Only available in dev mode"}), 403

    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401

    supabase = get_supabase_service()
    if not supabase:
        return jsonify({"error": "Database service not available"}), 503

    try:
        supabase.reset_pantry(user_id)
        supabase.delete_user_receipts(user_id)

        household = supabase.get_user_household(user_id)
        if household:
            household_id = household["id"]
            role = household.get("role")
            if role == "owner":
                supabase.delete_household(household_id)
            else:
                supabase.remove_household_member(user_id)

        return jsonify({"message": "Onboarding reset"}), 200
    except DatabaseException as e:
        logger.error(f"Database error resetting onboarding: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error resetting onboarding: {e}")
        return jsonify({"error": str(e)}), 500
