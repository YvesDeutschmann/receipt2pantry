"""Dev-only API routes (guarded by Flask debug mode)."""

import json

from flask import Blueprint, current_app, jsonify, request
from flask_cors import cross_origin

from backend.utils.auth import get_user_id_from_request
from backend.utils.exceptions import DatabaseException
from backend.utils.logger import get_logger

logger = get_logger(__name__)

dev_bp = Blueprint("dev", __name__)


def get_supabase_service():
    return current_app.config.get("SUPABASE_SERVICE")


@dev_bp.route("/dev/log", methods=["POST", "GET", "OPTIONS"])
@cross_origin(origins="*", methods=["POST", "GET", "OPTIONS"], allow_headers=["Content-Type"])
def dev_log():
    """Receive log messages from native WebViews (iOS InAppBrowser) that can't reach os_log.

    @cross_origin(origins="*") overrides the global Flask-CORS allowlist so this endpoint
    accepts requests from any origin (Safeway/Okta/Albertsons SSO redirects, etc).

    Tolerates three transports so iOS WKWebView quirks can't silence us:
      - POST application/json body: {tag, msg}
      - POST text/plain body: "TAG|MSG" or just "MSG"
      - GET ?tag=...&msg=...  (last-ditch, no body, no preflight)
    """
    if request.method == "OPTIONS":
        return ("", 204)

    tag = "WebView"
    msg = ""
    try:
        if request.method == "GET":
            tag = request.args.get("tag", tag)
            msg = request.args.get("msg", "")
        else:
            raw = request.get_data(as_text=True) or ""
            parsed = None
            if raw:
                try:
                    parsed = json.loads(raw)
                except Exception:
                    parsed = None
            if isinstance(parsed, dict):
                tag = str(parsed.get("tag", tag))
                msg = str(parsed.get("msg", ""))
            elif raw:
                if "|" in raw and len(raw) < 4096:
                    head, _, rest = raw.partition("|")
                    if head and " " not in head:
                        tag = head
                        msg = rest
                    else:
                        msg = raw
                else:
                    msg = raw
        logger.info(f"[{tag}] {msg}")
    except Exception as e:
        logger.warning(f"[dev_log] failed to parse request: {e}")

    return jsonify({"ok": True}), 200


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
