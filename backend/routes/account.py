"""Account management API routes."""

from flask import Blueprint, current_app, jsonify

from backend.utils.auth import get_user_id_from_request
from backend.utils.exceptions import DatabaseException
from backend.utils.logger import get_logger

logger = get_logger(__name__)

account_bp = Blueprint("account", __name__)


def get_account_deletion_service():
    return current_app.config.get("ACCOUNT_DELETION_SERVICE")


@account_bp.route("/account", methods=["DELETE"])
def delete_account():
    """
    Permanently delete the authenticated user's account and data.

    Returns:
        200: { "deleted": true, "household": "none"|"deleted"|"left"|"promoted" }
        401: missing user
        503: deletion service unavailable
        500: deletion failed (safe to retry)
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401

    service = get_account_deletion_service()
    if not service:
        return jsonify({"error": "Account deletion service not available"}), 503

    try:
        result = service.delete_account(user_id)
        logger.info(
            f"Account deleted for user {user_id}, household={result.get('household')}"
        )
        return jsonify(result), 200
    except DatabaseException as e:
        logger.error(f"Account deletion failed for {user_id}: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Unexpected account deletion error for {user_id}: {e}")
        return jsonify({"error": "Account deletion failed"}), 500
