"""Suggestion pool API (pre-generated recipes)."""

from typing import Optional

from flask import Blueprint, current_app, jsonify, request

from backend.services.pool_generator import meal_types_from_slots
from backend.utils.auth import get_user_id_from_request
from backend.utils.exceptions import DatabaseException, RecipeQuotaException, ValidationException
from backend.utils.logger import get_logger

logger = get_logger(__name__)

pool_bp = Blueprint("pool", __name__)


def _get_pool_store():
    return current_app.config.get("POOL_STORE_SERVICE")


def _get_pool_generator():
    return current_app.config.get("POOL_GENERATOR")


def _get_household_service():
    return current_app.config.get("HOUSEHOLD_SERVICE")


def _resolve_household_id(user_id: str, body_or_query_household_id: Optional[str]) -> str:
    hid = body_or_query_household_id
    if not hid:
        hs = _get_household_service()
        if hs:
            hid = hs.get_household_id(user_id)
    if not hid:
        raise ValidationException("Household ID required")
    hs = _get_household_service()
    if hs:
        user_h = hs.get_household_id(user_id)
        if user_h and user_h != hid:
            raise ValidationException("Household does not match signed-in user")
    return hid


@pool_bp.route("/suggestions/pool", methods=["GET"])
def get_pool():
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401
    store = _get_pool_store()
    if not store:
        return jsonify({"error": "Suggestion pool not available"}), 503
    try:
        household_id = _resolve_household_id(user_id, request.args.get("household_id"))
        grouped = store.get_pool_grouped_by_meal(household_id, status="unused")
        return jsonify({"pool": grouped, "household_id": household_id})
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"get_pool: {e}")
        return jsonify({"error": str(e)}), 500


@pool_bp.route("/suggestions/pool/depth", methods=["GET"])
def get_depth():
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401
    store = _get_pool_store()
    if not store:
        return jsonify({"error": "Suggestion pool not available"}), 503
    try:
        household_id = _resolve_household_id(user_id, request.args.get("household_id"))
        depth = store.get_pool_depth(household_id)
        return jsonify({"depth": depth, "household_id": household_id})
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"get_depth: {e}")
        return jsonify({"error": str(e)}), 500


@pool_bp.route("/suggestions/pool/<suggestion_id>/swipe", methods=["POST"])
def swipe_suggestion(suggestion_id):
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401
    store = _get_pool_store()
    if not store:
        return jsonify({"error": "Suggestion pool not available"}), 503
    try:
        household_id = _resolve_household_id(
            user_id, (request.get_json() or {}).get("household_id")
        )
        ok = store.update_status(suggestion_id, household_id, "swiped")
        if not ok:
            return jsonify({"error": "Suggestion not found"}), 404
        return jsonify({"ok": True})
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"swipe: {e}")
        return jsonify({"error": str(e)}), 500


@pool_bp.route("/suggestions/pool/generate", methods=["POST"])
def generate_pool():
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401
    gen = _get_pool_generator()
    if not gen:
        return jsonify({"error": "Pool generator not available (recipe service required)"}), 503
    data = request.get_json() or {}
    trigger_reason = data.get("trigger_reason", "manual_refresh")
    if trigger_reason not in (
        "onboarding",
        "receipt_scan",
        "manual_refresh",
        "low_watermark",
    ):
        return jsonify({"error": "Invalid trigger_reason"}), 400
    try:
        household_id = _resolve_household_id(user_id, data.get("household_id"))
        hs = _get_household_service()
        meal_types = data.get("meal_types")
        if not meal_types:
            if not hs:
                return jsonify({"error": "meal_types required when household service unavailable"}), 400
            h = hs.get_household(user_id)
            slots = (h or {}).get("suggestion_meal_slots") or {
                "breakfast": True,
                "lunch": True,
                "dinner": True,
            }
            meal_types = meal_types_from_slots(slots)
        else:
            meal_types = [
                m
                for m in meal_types
                if m in ("breakfast", "lunch", "dinner")
            ]
        if not meal_types:
            return jsonify(
                {"error": "At least one of breakfast, lunch, dinner must be selected"}
            ), 400

        result = gen.generate_pool(
            household_id,
            user_id,
            trigger_reason,
            meal_types,
        )
        return jsonify(result)
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except RecipeQuotaException as e:
        logger.error(f"generate_pool quota: {e}")
        return jsonify(
            {
                "error": "Daily recipe quota reached, try again later.",
                "code": "recipe_quota",
            }
        ), 429
    except DatabaseException as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"generate_pool: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500
