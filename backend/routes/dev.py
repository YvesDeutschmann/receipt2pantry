"""Dev-only API routes (guarded by Flask debug mode)."""

import json

from flask import Blueprint, current_app, jsonify, request
from flask_cors import cross_origin
from pathlib import Path

from backend.utils.auth import get_user_id_from_request
from backend.utils.exceptions import DatabaseException
from backend.utils.logger import get_logger

logger = get_logger(__name__)

dev_bp = Blueprint("dev", __name__)

# backend/routes -> backend -> project root
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_FIXTURES_DIR = _PROJECT_ROOT / "data" / "fixtures"


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


@dev_bp.route("/dev/load-mock-receipts", methods=["POST"])
def load_mock_receipts():
    """
    Load hand-authored receipt fixtures (same path as /receipts/ingest and
    /providers/costco/store-receipts) for local QA without real stores.

    Body: { "provider": "safeway" | "costco" | "all", "reset": bool }
    If reset is true, clears pantry and receipt rows for the user first.
    """
    if not current_app.debug:
        return jsonify({"error": "Only available in dev mode"}), 403

    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401

    data = request.get_json() or {}
    provider = (data.get("provider") or "all").lower()
    if provider not in ("safeway", "costco", "all"):
        return jsonify(
            {"error": "provider must be 'safeway', 'costco', or 'all'"}
        ), 400
    reset = bool(data.get("reset", False))

    supabase = get_supabase_service()
    if not supabase:
        return jsonify({"error": "Database service not available"}), 503

    try:
        if reset:
            supabase.reset_pantry(user_id)
            supabase.delete_user_receipts(user_id)

        def _load_fixture_list(filename: str) -> list:
            path = _FIXTURES_DIR / filename
            with open(path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
            if not isinstance(loaded, list):
                raise ValueError(f"Fixture {filename} must be a JSON array")
            return loaded

        # Lazy import: shares logic with /providers/costco/store-receipts
        from backend.routes.providers import (  # noqa: PLC0415
            _store_and_process_fetched_receipts,
        )

        total_stored = 0
        total_items = 0
        all_receipt_ids: list = []
        all_errors: list = []

        if provider in ("safeway", "all"):
            safeway_recs = _load_fixture_list("safeway_receipts.json")
            r = _store_and_process_fetched_receipts(user_id, "safeway", safeway_recs)
            total_stored += r.get("receipts_stored", 0)
            total_items += r.get("items_added_to_pantry", 0)
            all_receipt_ids.extend(r.get("receipt_ids", []))
            all_errors.extend(r.get("errors", []))

        if provider in ("costco", "all"):
            costco_recs = _load_fixture_list("costco_receipts.json")
            r = _store_and_process_fetched_receipts(user_id, "costco", costco_recs)
            total_stored += r.get("receipts_stored", 0)
            total_items += r.get("items_added_to_pantry", 0)
            all_receipt_ids.extend(r.get("receipt_ids", []))
            all_errors.extend(r.get("errors", []))

        return jsonify(
            {
                "status": "success",
                "provider": provider,
                "receipts_stored": total_stored,
                "receipt_ids": all_receipt_ids,
                "items_added_to_pantry": total_items,
                "errors": all_errors,
            }
        ), 200
    except FileNotFoundError as e:
        logger.error(f"Mock receipt fixtures missing: {e}")
        return jsonify({"error": f"Fixture file not found: {e}"}), 500
    except DatabaseException as e:
        logger.error(f"Database error loading mock receipts: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error loading mock receipts: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500
