"""Dev-only API routes (guarded by Flask debug mode)."""

import json
import re
import time
from collections import defaultdict
from copy import deepcopy
from datetime import date, datetime, time as dt_time, timezone

from flask import Blueprint, current_app, jsonify, request
from pathlib import Path

from backend.utils.auth import get_user_id_from_request
from backend.utils.exceptions import DatabaseException, ValidationException
from backend.utils.logger import get_logger

logger = get_logger(__name__)

dev_bp = Blueprint("dev", __name__)

# backend/routes -> backend -> project root
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_FIXTURES_DIR = _PROJECT_ROOT / "data" / "fixtures"

_DEV_LOG_MAX_BODY_BYTES = 4096
_DEV_LOG_RATE_LIMIT_PER_MINUTE = 240
_dev_log_hits: dict[str, list[float]] = defaultdict(list)
_CONTROL_CHAR_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _dev_log_is_enabled() -> bool:
    return bool(current_app.debug or current_app.config.get("DEV_LOG_ENABLED"))


def _dev_log_client_ip() -> str:
    """Prefer Fly-set client IP; do not trust client-supplied X-Forwarded-For for rate limits."""
    fly_ip = request.headers.get("Fly-Client-IP")
    if fly_ip:
        return fly_ip.strip()
    if request.remote_addr:
        return request.remote_addr
    return "unknown"


def _dev_log_rate_limited(ip: str) -> bool:
    now = time.time()
    window = [t for t in _dev_log_hits[ip] if now - t < 60]
    if len(window) >= _DEV_LOG_RATE_LIMIT_PER_MINUTE:
        _dev_log_hits[ip] = window
        return True
    window.append(now)
    _dev_log_hits[ip] = window
    return False


def _strip_control_chars(text: str) -> str:
    return _CONTROL_CHAR_RE.sub("", text)


def reset_dev_log_rate_limit_for_tests() -> None:
    """Clear in-process rate-limit state (tests only)."""
    _dev_log_hits.clear()


def get_supabase_service():
    return current_app.config.get("SUPABASE_SERVICE")


def freshen_mock_receipt_dates(receipts, *, today=None):
    """Rewrite fixture purchase dates to `today` so depletion scores as in-stock.

    JSON fixtures keep historical `order_date`s for shape tests. The DEV load
    path must not ingest those as purchase_date or PERISHABLE/CONSUMABLE rows
    land in LIKELY GONE.
    """
    if not isinstance(receipts, list):
        return receipts
    anchor = today or date.today()
    iso_date = anchor.isoformat()
    iso_dt = (
        datetime.combine(anchor, dt_time(12, 0), tzinfo=timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )
    out = deepcopy(receipts)
    for rec in out:
        if not isinstance(rec, dict):
            continue
        rec["order_date"] = iso_date
        if "date" in rec:
            prev = rec.get("date")
            if isinstance(prev, str) and "T" in prev:
                rec["date"] = iso_dt
            else:
                rec["date"] = iso_date
    return out


@dev_bp.route("/dev/log", methods=["POST", "GET", "OPTIONS"])
def dev_log():
    """Receive log messages from native WebViews (iOS InAppBrowser) that can't reach os_log.

    Available when Flask debug mode is on, or when DEV_LOG_ENABLED is set (temporary prod window).

    Tolerates three transports so iOS WKWebView quirks can't silence us:
      - POST application/json body: {tag, msg}
      - POST text/plain body: "TAG|MSG" or just "MSG"
      - GET ?tag=...&msg=...  (last-ditch, no body, no preflight)
    """
    if not _dev_log_is_enabled():
        return jsonify({"error": "Only available in dev mode"}), 403

    if request.method == "OPTIONS":
        return ("", 204)

    if request.method != "GET":
        raw_bytes = request.get_data()
        if len(raw_bytes) > _DEV_LOG_MAX_BODY_BYTES:
            return jsonify({"error": "Request body too large"}), 413

    ip = _dev_log_client_ip()
    if _dev_log_rate_limited(ip):
        return jsonify({"error": "Rate limit exceeded"}), 429

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
        tag = _strip_control_chars(str(tag))[:64]
        msg = _strip_control_chars(str(msg))
        if len(msg) > 4000:
            msg = msg[:4000] + "…"
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
            safeway_recs = freshen_mock_receipt_dates(
                _load_fixture_list("safeway_receipts.json")
            )
            r = _store_and_process_fetched_receipts(user_id, "safeway", safeway_recs)
            total_stored += r.get("receipts_stored", 0)
            total_items += r.get("items_added_to_pantry", 0)
            all_receipt_ids.extend(r.get("receipt_ids", []))
            all_errors.extend(r.get("errors", []))

        if provider in ("costco", "all"):
            costco_recs = freshen_mock_receipt_dates(
                _load_fixture_list("costco_receipts.json")
            )
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


def _require_household(supabase, user_id: str):
    household = supabase.get_user_household(user_id)
    if not household or not household.get("id"):
        return None, (jsonify({"error": "Household required for cook-loop sandbox"}), 400)
    return str(household["id"]), None


def _get_cook_loop_sandbox_service():
    from backend.services.cook_loop_sandbox_service import (  # noqa: PLC0415
        create_cook_loop_sandbox_service,
    )
    from backend.routes.pantry import get_pantry_service  # noqa: PLC0415

    supabase = get_supabase_service()
    pantry = get_pantry_service()
    pool_store = current_app.config.get("POOL_STORE_SERVICE")
    if not supabase or not pantry or not pool_store:
        return None
    return create_cook_loop_sandbox_service(supabase, pantry, pool_store)


@dev_bp.route("/dev/cook-loop/reset", methods=["POST"])
def cook_loop_reset():
    """Seed DEV pantry + pool card from cook_loop_sandbox.json (debug only)."""
    if not current_app.debug:
        return jsonify({"error": "Only available in dev mode"}), 403

    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401

    supabase = get_supabase_service()
    if not supabase:
        return jsonify({"error": "Database service not available"}), 503

    household_id, err = _require_household(supabase, user_id)
    if err:
        return err

    svc = _get_cook_loop_sandbox_service()
    if not svc:
        return jsonify({"error": "Cook-loop sandbox service not available"}), 503

    from backend.routes.pantry import run_async  # noqa: PLC0415

    try:
        report = run_async(svc.reset(user_id, household_id))
        return jsonify(report), 200
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except DatabaseException as e:
        logger.error(f"Database error resetting cook-loop sandbox: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error resetting cook-loop sandbox: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@dev_bp.route("/dev/cook-loop/run", methods=["POST"])
def cook_loop_run():
    """Reset, cook server-side, and return graded report (debug only)."""
    if not current_app.debug:
        return jsonify({"error": "Only available in dev mode"}), 403

    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401

    supabase = get_supabase_service()
    if not supabase:
        return jsonify({"error": "Database service not available"}), 503

    household_id, err = _require_household(supabase, user_id)
    if err:
        return err

    svc = _get_cook_loop_sandbox_service()
    if not svc:
        return jsonify({"error": "Cook-loop sandbox service not available"}), 503

    from backend.routes.pantry import run_async  # noqa: PLC0415

    try:
        report = run_async(svc.run_async(user_id, household_id))
        return jsonify(report), 200
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except DatabaseException as e:
        logger.error(f"Database error running cook-loop sandbox: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error running cook-loop sandbox: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@dev_bp.route("/dev/cook-loop/report", methods=["GET"])
def cook_loop_report():
    """Grade current household state vs cook_loop_sandbox fixture (debug only)."""
    if not current_app.debug:
        return jsonify({"error": "Only available in dev mode"}), 403

    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401

    supabase = get_supabase_service()
    if not supabase:
        return jsonify({"error": "Database service not available"}), 503

    household_id, err = _require_household(supabase, user_id)
    if err:
        return err

    svc = _get_cook_loop_sandbox_service()
    if not svc:
        return jsonify({"error": "Cook-loop sandbox service not available"}), 503

    try:
        report = svc.grade(user_id, household_id, mode="observe")
        svc._log_report(report)
        return jsonify(report), 200
    except Exception as e:
        logger.error(f"Error grading cook-loop sandbox: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500
