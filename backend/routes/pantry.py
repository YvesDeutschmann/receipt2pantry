"""Pantry management API routes"""

import asyncio
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Set

from flask import Blueprint, request, current_app, jsonify
from werkzeug.utils import secure_filename

from backend.utils.logger import get_logger
from backend.utils.auth import get_user_id_from_request
from backend.services.confidence_engine import (
    _rpc_soft_delete_pantry_item,
    _to_date,
    compute_confidence,
    get_calibrated_days_supply,
    get_engagement_multiplier,
    process_cook_event,
    process_put_back,
)
from backend.utils.exceptions import (
    ValidationException,
    DatabaseException,
    AIServiceException,
    AIRateLimitException,
)

logger = get_logger(__name__)

pantry_bp = Blueprint("pantry", __name__)


def get_pantry_service():
    """Get pantry service from app config"""
    return current_app.config.get("PANTRY_SERVICE")


def get_supabase_service():
    """Get supabase service from app config"""
    return current_app.config.get("SUPABASE_SERVICE")


def get_normalization_service():
    """Optional normalization service for receipt matching."""
    return current_app.config.get("NORMALIZATION_SERVICE")


def _optional_household_id_query() -> Optional[str]:
    raw = request.args.get("household_id")
    if raw is None:
        return None
    s = str(raw).strip()
    return s or None


def _optional_household_id_body(data: Optional[Dict]) -> Optional[str]:
    if not data:
        return None
    raw = data.get("household_id")
    if raw is None:
        return None
    s = str(raw).strip()
    return s or None


def _reject_household_scope_mismatch(
    supabase: Any, user_id: str, household_id: Optional[str]
):
    """
    When the client sends an explicit household_id, it must match the user's household.
    Returns (jsonify(...), status) on mismatch, or None when allowed.
    """
    if not household_id:
        return None
    hh = supabase.get_user_household(user_id)
    if not hh or str(hh.get("id")) != str(household_id):
        return jsonify({"error": "Forbidden"}), 403
    return None


def run_async(coro):
    """Run an async coroutine synchronously"""
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


def _enrich_pantry_summary_with_confidence(
    supabase: Any, user_id: str, summary: Dict[str, Any]
) -> None:
    """Mutates summary: adds confidence and depletion_class to each item (grouped variants share refs)."""
    today = date.today()
    client = supabase.admin_client or supabase.client
    engagement = get_engagement_multiplier(client, user_id)
    prefs_row = supabase.get_user_preferences(user_id)
    user_prefs = {
        "depletion_multiplier": float((prefs_row or {}).get("depletion_multiplier") or 1.0)
    }
    bases = list(
        {(it.get("base_ingredient") or "").strip().lower() for it in summary["items"]}
    )
    classifications = supabase.get_item_classifications_by_names(bases)
    for item in summary["items"]:
        base = (item.get("base_ingredient") or "").strip().lower()
        cls = classifications.get(base, {})
        default_days = cls.get("default_days_supply") or 45
        cal = get_calibrated_days_supply(client, user_id, base, int(default_days))
        item["confidence"] = compute_confidence(
            item,
            user_prefs,
            cls,
            today=today,
            calibrated_days=cal,
            engagement_multiplier=engagement,
        )
        item["depletion_class"] = (
            item.get("depletion_class") or cls.get("depletion_class") or "STAPLE"
        )


def _graveyard_normalized_name(supabase: Any, item_name: str) -> str:
    """Map depletion_history.item_name to canonical display_name when possible."""
    if not (item_name or "").strip():
        return ""
    row = supabase.get_canonical_ingredient_by_base(item_name)
    if not row or not isinstance(row, dict):
        return item_name
    dn = row.get("display_name")
    if dn is not None and str(dn).strip():
        return str(dn).strip()
    return item_name


def _health_card_cooldown_active(prefs_row: Optional[Dict], today: date) -> bool:
    if not prefs_row:
        return False
    raw = prefs_row.get("last_health_card_shown")
    last = _to_date(raw)
    if last is None:
        return False
    return (today - last).days < 7


def get_ai_service():
    return current_app.config.get("AI_SERVICE")


# Layer 3: Whisper accepts common WebView / mobile MIME types
_VOICE_AUDIO_TYPES = frozenset(
    {
        "audio/webm",
        "audio/mp4",
        "audio/mpeg",
        "audio/wav",
        "audio/x-wav",
        "audio/x-m4a",
        "audio/m4a",
        "application/octet-stream",
    }
)


def _voice_guess_mime(filename: str) -> str:
    fn = (filename or "").lower()
    if fn.endswith(".webm"):
        return "audio/webm"
    if fn.endswith((".m4a", ".mp4", ".aac")):
        return "audio/mp4"
    if fn.endswith(".wav"):
        return "audio/wav"
    if fn.endswith(".mp3"):
        return "audio/mpeg"
    return "application/octet-stream"


def _voice_resolve_canonical_row(supabase, label: str) -> Optional[Dict[str, Any]]:
    """Resolve a free-text label to one canonical row using base match then search RPC."""
    s = (label or "").strip()
    if not s:
        return None
    row = supabase.get_canonical_ingredient_by_base(s)
    if row:
        return row
    if len(s) >= 2:
        hits = supabase.search_canonical_ingredients(s, limit=1, exclude_bases=[])
        if hits:
            return {
                "base_ingredient": hits[0]["base_ingredient"],
                "display_name": hits[0]["display_name"],
                "category": hits[0].get("category"),
            }
    return None


def _voice_try_add_confirmed(
    label: str,
    by_display: Dict[str, Dict[str, Any]],
    by_base: Dict[str, Dict[str, Any]],
    supabase,
    seen: Set[str],
    confirmed: List[Dict[str, str]],
) -> bool:
    """Return True if label resolved and is now in confirmed (or duplicate skip); False if unmappable."""
    s = (label or "").strip()
    if not s:
        return True
    lo = s.lower()
    row = by_display.get(lo) or by_base.get(lo)
    if not row:
        row = _voice_resolve_canonical_row(supabase, s)
    if not row:
        return False
    bkey = str(row["base_ingredient"]).strip().lower()
    if bkey in seen:
        return True
    seen.add(bkey)
    confirmed.append(
        {
            "base_ingredient": row["base_ingredient"],
            "display_name": row["display_name"],
        }
    )
    return True


@pantry_bp.route("/pantry/staples-template", methods=["GET"])
def get_staples_template():
    """
    Layer 1 cold-start: all active staples grouped by category.
    """
    supabase = get_supabase_service()
    if not supabase:
        return jsonify({"error": "Database service not available"}), 503

    try:
        rows = supabase.get_staples_template_rows(active_only=True)
        categories: Dict[str, list] = {}
        for row in rows:
            cat = row.get("category") or "Other"
            if cat not in categories:
                categories[cat] = []
            categories[cat].append(
                {
                    "id": row.get("id"),
                    "base_ingredient": row.get("base_ingredient"),
                    "display_name": row.get("display_name"),
                    "pre_selected": bool(row.get("pre_selected")),
                }
            )
        category_list = [
            {"name": name, "items": items} for name, items in categories.items()
        ]
        pre_count = sum(1 for r in rows if r.get("pre_selected"))
        return jsonify(
            {
                "categories": category_list,
                "total_items": len(rows),
                "pre_selected_count": pre_count,
            }
        )
    except Exception as e:
        logger.error(f"Error loading staples template: {e}")
        return jsonify({"error": str(e)}), 500


@pantry_bp.route("/pantry/staples-receipt-matches", methods=["GET"])
def staples_receipt_matches():
    """
    Which template bases appear on recent household receipts (for UI badges while syncing).
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401

    supabase = get_supabase_service()
    service = get_pantry_service()
    normalizer = get_normalization_service()
    if not supabase or not service:
        return jsonify({"error": "Service not available"}), 503
    if not normalizer:
        return jsonify({"matches": [], "message": "Normalization unavailable"}), 200

    try:
        hh = supabase.get_user_household(user_id)
        household_id = hh["id"] if hh else None
        rows = supabase.get_staples_template_rows(active_only=True)
        candidate = {r["base_ingredient"].strip().lower() for r in rows}
        matches = run_async(
            service.list_staple_receipt_matches(
                user_id, household_id, candidate, normalizer
            )
        )
        return jsonify({"matches": matches})
    except Exception as e:
        logger.error(f"Error listing staple receipt matches: {e}")
        return jsonify({"error": str(e)}), 500


@pantry_bp.route("/pantry/confirm-staples", methods=["POST"])
def confirm_staples():
    """
    Batch confirm staples template selection; dedupe with existing pantry; receipt enrichment.
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401

    service = get_pantry_service()
    if not service:
        return jsonify({"error": "Pantry service not available"}), 503

    data = request.get_json() or {}
    selected = data.get("selected_items")
    if not isinstance(selected, list):
        return jsonify({"error": "selected_items must be a list of base_ingredient strings"}), 400

    normalizer = get_normalization_service()

    try:
        result = run_async(
            service.confirm_staples_batch(user_id, selected, normalizer=normalizer)
        )
        return jsonify(result), 200
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except DatabaseException as e:
        logger.error(f"Database error confirming staples: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error confirming staples: {e}")
        return jsonify({"error": str(e)}), 500


@pantry_bp.route("/pantry/search-ingredients", methods=["GET"])
def search_ingredients():
    """
    Layer 2: autocomplete canonical ingredients (q required, min 2 chars).
    Query: q, limit (default 6), exclude (comma-separated base_ingredient values).
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401

    supabase = get_supabase_service()
    if not supabase:
        return jsonify({"error": "Database service not available"}), 503

    q = (request.args.get("q") or "").strip()
    if len(q) < 2:
        return jsonify({"results": []})

    try:
        limit = int(request.args.get("limit", 6))
    except (TypeError, ValueError):
        limit = 6

    exclude_raw = request.args.get("exclude") or ""
    exclude = [x.strip().lower() for x in exclude_raw.split(",") if x.strip()]

    try:
        rows = supabase.search_canonical_ingredients(q, limit=limit, exclude_bases=exclude)
        return jsonify({"results": rows})
    except Exception as e:
        logger.error(f"Error searching ingredients: {e}")
        return jsonify({"error": str(e)}), 500


@pantry_bp.route("/pantry/quick-add", methods=["POST"])
def quick_add_pantry_item():
    """
    Layer 2: add one item by canonical base_ingredient (must exist in canonical_ingredients).
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401

    service = get_pantry_service()
    if not service:
        return jsonify({"error": "Pantry service not available"}), 503

    data = request.get_json() or {}
    raw_base = data.get("base_ingredient")
    if not isinstance(raw_base, str):
        return jsonify({"error": "base_ingredient is required"}), 400
    base = raw_base.strip()
    if not base:
        return jsonify({"error": "base_ingredient is required"}), 400

    try:
        result = run_async(service.quick_add_from_search(user_id, base))
        return jsonify(result), 200
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"Error quick-add pantry: {e}")
        return jsonify({"error": str(e)}), 500


@pantry_bp.route("/pantry/voice-transcribe", methods=["POST"])
def voice_transcribe():
    """
    Layer 3: upload audio -> Whisper transcript -> GPT extract -> validate against canonical list.
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401

    ai = get_ai_service()
    supabase = get_supabase_service()
    if not ai or not getattr(ai, "client", None):
        return jsonify({"error": "AI service not available"}), 503
    if not supabase:
        return jsonify({"error": "Database service not available"}), 503

    if "audio" not in request.files:
        return jsonify({"error": "audio file required"}), 400

    upload = request.files["audio"]
    if not upload or not upload.filename:
        return jsonify({"error": "audio file required"}), 400

    raw_bytes = upload.read()
    if not raw_bytes:
        return jsonify({"error": "empty audio"}), 400

    mime = (upload.mimetype or "").split(";")[0].strip().lower()
    safe_name = secure_filename(upload.filename) or "recording"
    if mime not in _VOICE_AUDIO_TYPES:
        mime = _voice_guess_mime(safe_name)

    try:
        transcript = ai.transcribe_audio(raw_bytes, mime, safe_name)
    except AIRateLimitException as e:
        logger.warning(f"Voice transcribe rate limited: {e}")
        return jsonify({"error": "transcription_failed", "message": str(e)}), 429
    except AIServiceException as e:
        logger.warning(f"Voice transcribe failed: {e}")
        return jsonify({"error": "transcription_failed", "message": str(e)}), 422
    except Exception as e:
        logger.error(f"Voice transcribe unexpected: {e}")
        return jsonify({"error": "transcription_failed", "message": str(e)}), 422

    try:
        canon = supabase.list_active_canonical_ingredients_compact()
        by_display: Dict[str, Dict[str, Any]] = {}
        by_base: Dict[str, Dict[str, Any]] = {}
        for e in canon:
            bi = (e.get("base_ingredient") or "").strip().lower()
            dn = (e.get("display_name") or "").strip().lower()
            if bi:
                by_base[bi] = e
            if dn:
                by_display[dn] = e

        extracted = ai.extract_ingredients_from_transcript(transcript, canon)
        seen: Set[str] = set()
        confirmed: List[Dict[str, str]] = []
        uncertain_out: List[Dict[str, Any]] = []

        for it in extracted.get("items") or []:
            if not isinstance(it, str):
                continue
            if not _voice_try_add_confirmed(
                it, by_display, by_base, supabase, seen, confirmed
            ):
                uncertain_out.append(
                    {
                        "heard": it.strip(),
                        "suggestion": it.strip(),
                        "base_ingredient": None,
                    }
                )

        for u in extracted.get("uncertain") or []:
            if not isinstance(u, dict):
                continue
            heard = (u.get("heard") or "").strip()
            sug = (u.get("suggestion") or "").strip()
            if not heard and not sug:
                continue
            row = _voice_resolve_canonical_row(supabase, sug) if sug else None
            uncertain_out.append(
                {
                    "heard": heard or sug,
                    "suggestion": row["display_name"] if row else sug,
                    "base_ingredient": (row["base_ingredient"] if row else None),
                }
            )

        return jsonify(
            {
                "confirmed": confirmed,
                "uncertain": uncertain_out,
                "transcript": transcript,
            }
        ), 200
    except AIServiceException as e:
        logger.warning(f"Voice extraction failed: {e}")
        return jsonify({"error": "extraction_failed", "message": str(e)}), 422
    except Exception as e:
        logger.error(f"Voice pipeline error: {e}")
        return jsonify({"error": str(e)}), 500


@pantry_bp.route("/pantry/voice-confirm", methods=["POST"])
def voice_confirm():
    """Layer 3: batch add voice-reviewed items (canonical base_ingredient list)."""
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401

    service = get_pantry_service()
    supabase = get_supabase_service()
    if not service or not supabase:
        return jsonify({"error": "Service not available"}), 503

    data = request.get_json() or {}
    raw_items = data.get("items")
    if not isinstance(raw_items, list):
        return jsonify({"error": "items must be a list of base_ingredient strings"}), 400

    canonical_items: List[Dict[str, Any]] = []
    skipped_invalid = 0
    seen_bases: Set[str] = set()
    for x in raw_items:
        if not x or not isinstance(x, str):
            skipped_invalid += 1
            continue
        canon = supabase.get_canonical_ingredient_by_base(x)
        if not canon:
            skipped_invalid += 1
            continue
        bkey = str(canon["base_ingredient"]).strip().lower()
        if bkey in seen_bases:
            continue
        seen_bases.add(bkey)
        canonical_items.append(
            {
                "base_ingredient": canon["base_ingredient"],
                "normalized_name": canon["display_name"],
                "category": canon.get("category"),
            }
        )

    if not canonical_items:
        return jsonify(
            {
                "added": 0,
                "already_existed": 0,
                "total": 0,
                "skipped_invalid": skipped_invalid,
            }
        ), 200

    try:
        batch_result = run_async(
            service.batch_add_or_merge_items(
                user_id,
                None,
                canonical_items,
                source="voice",
                set_template_confirmed=False,
            )
        )
        inserted = int(batch_result.get("inserted") or 0)
        merged = int(batch_result.get("merged") or 0)
        return jsonify(
            {
                "added": inserted,
                "already_existed": merged,
                "total": inserted + merged,
                "skipped_invalid": skipped_invalid,
            }
        ), 200
    except Exception as e:
        logger.error(f"Voice confirm batch error: {e}")
        return jsonify({"error": str(e)}), 500


@pantry_bp.route("/pantry/items/<item_id>/deplete", methods=["POST"])
def deplete_pantry_item(item_id):
    """Layer 2: remove pantry item (recipe correction); returns snapshot for undo."""
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401

    service = get_pantry_service()
    if not service:
        return jsonify({"error": "Pantry service not available"}), 503

    try:
        out = service.deplete_pantry_item(user_id, item_id)
        return jsonify(out), 200
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"Error depleting pantry item: {e}")
        return jsonify({"error": str(e)}), 500


@pantry_bp.route("/pantry/restore-item", methods=["POST"])
def restore_pantry_item():
    """Undo deplete: body { snapshot: { ... pantry row ... } }"""
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401

    service = get_pantry_service()
    if not service:
        return jsonify({"error": "Pantry service not available"}), 503

    data = request.get_json() or {}
    snapshot = data.get("snapshot")
    if not isinstance(snapshot, dict):
        return jsonify({"error": "snapshot object required"}), 400

    try:
        new_id = service.restore_pantry_item(user_id, snapshot)
        return jsonify({"item_id": new_id, "message": "Restored"}), 200
    except ValidationException as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"Error restoring pantry item: {e}")
        return jsonify({"error": str(e)}), 500


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
    
    household_id = _optional_household_id_query()

    supabase = get_supabase_service()
    if not supabase:
        return jsonify({"error": "Database service not available"}), 503

    mismatch = _reject_household_scope_mismatch(supabase, user_id, household_id)
    if mismatch:
        return mismatch

    try:
        summary = run_async(service.get_pantry_summary(user_id, household_id))
        _enrich_pantry_summary_with_confidence(supabase, user_id, summary)
        return jsonify(summary)
    except DatabaseException as e:
        logger.error(f"Database error getting pantry: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Error getting pantry: {e}")
        return jsonify({"error": str(e)}), 500


@pantry_bp.route("/pantry/cook", methods=["POST"])
def pantry_cook():
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401

    supabase = get_supabase_service()
    if not supabase:
        return jsonify({"error": "Database service not available"}), 503

    body = request.get_json() or {}
    mismatch = _reject_household_scope_mismatch(
        supabase, user_id, _optional_household_id_body(body)
    )
    if mismatch:
        return mismatch

    if (
        "recipe_id" not in body
        or body["recipe_id"] is None
        or str(body["recipe_id"]).strip() == ""
    ):
        return jsonify({"error": "recipe_id is required"}), 400
    if "servings" not in body:
        return jsonify({"error": "servings is required"}), 400
    try:
        servings = int(body["servings"])
    except (TypeError, ValueError):
        return jsonify({"error": "servings must be an integer"}), 400
    if servings < 1:
        return jsonify({"error": "servings must be at least 1"}), 400

    ingredients = body.get("ingredients")
    if not isinstance(ingredients, list) or len(ingredients) == 0:
        return jsonify({"error": "ingredients must be a non-empty list"}), 400
    for i, ing in enumerate(ingredients):
        if not isinstance(ing, dict):
            return jsonify({"error": f"ingredients[{i}] must be an object"}), 400
        name = ing.get("name")
        if name is None or str(name).strip() == "":
            return jsonify({"error": f"ingredients[{i}] must have a name"}), 400

    try:
        client = supabase.admin_client or supabase.client
        process_cook_event(
            client,
            user_id,
            str(body["recipe_id"]),
            servings,
            ingredients,
            today=date.today(),
            recipe_name=body.get("recipe_name", ""),
            household_id=body.get("household_id"),
        )
        return jsonify({"ok": True})
    except Exception as e:
        logger.error(f"Error processing cook event: {e}")
        return jsonify({"error": str(e)}), 500


@pantry_bp.route("/pantry/graveyard", methods=["GET"])
def pantry_graveyard():
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401

    supabase = get_supabase_service()
    if not supabase:
        return jsonify({"error": "Database service not available"}), 503

    try:
        cutoff = (date.today() - timedelta(days=7)).isoformat()
        rows = (
            supabase.admin_client.table("depletion_history")
            .select(
                "id, pantry_item_id, item_name, deleted_at, reason, put_back_count"
            )
            .eq("user_id", user_id)
            .gte("deleted_at", cutoff)
            .in_("reason", ["AUTO_EXPIRED", "USER_REMOVED"])
            .order("deleted_at", desc=True)
            .execute()
        )
        raw = rows.data if rows.data else []
        names = list({r.get("item_name") for r in raw if r.get("item_name")})
        classifications = supabase.get_item_classifications_by_names(names)
        normalized_by_name: Dict[str, str] = {
            n: _graveyard_normalized_name(supabase, n) for n in names
        }
        out: List[Dict[str, Any]] = []
        for r in raw:
            name = r.get("item_name") or ""
            sub = (classifications.get(name) or {}).get("sub_class")
            out.append(
                {
                    "depletion_history_id": str(r["id"]),
                    "pantry_item_id": str(r["pantry_item_id"]),
                    "base_ingredient": name,
                    "normalized_name": normalized_by_name.get(name, name),
                    "deleted_at": r.get("deleted_at"),
                    "reason": r.get("reason"),
                    "put_back_count": int(r.get("put_back_count") or 0),
                    "sub_class": sub,
                }
            )
        return jsonify({"items": out})
    except Exception as e:
        logger.error(f"Error loading graveyard: {e}")
        return jsonify({"error": str(e)}), 500


@pantry_bp.route("/pantry/put-back", methods=["POST"])
def pantry_put_back():
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401

    supabase = get_supabase_service()
    if not supabase:
        return jsonify({"error": "Database service not available"}), 503

    body = request.get_json() or {}
    hid = body.get("depletion_history_id")
    if not hid or not str(hid).strip():
        return jsonify({"error": "depletion_history_id is required"}), 400

    try:
        client = supabase.admin_client or supabase.client
        item, error_code = process_put_back(
            client,
            user_id,
            str(hid),
            today=date.today(),
        )
        if error_code == "MAX_PUT_BACK_REACHED":
            return jsonify({"error": "MAX_PUT_BACK_REACHED"}), 409
        if error_code:
            return jsonify({"error": error_code}), 400
        return jsonify({"ok": True, "item": item})
    except Exception as e:
        logger.error(f"Error processing put-back: {e}")
        return jsonify({"error": str(e)}), 500


@pantry_bp.route("/pantry/health-card", methods=["GET"])
def pantry_health_card():
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401

    supabase = get_supabase_service()
    service = get_pantry_service()
    if not supabase or not service:
        return jsonify({"error": "Service not available"}), 503

    household_id = _optional_household_id_query()
    today = date.today()

    mismatch = _reject_household_scope_mismatch(supabase, user_id, household_id)
    if mismatch:
        return mismatch

    try:
        prefs_row = supabase.get_user_preferences(user_id)
        if _health_card_cooldown_active(prefs_row, today):
            return jsonify({"show": False, "items": []})

        summary = run_async(service.get_pantry_summary(user_id, household_id))
        items = summary.get("items") or []

        client = supabase.admin_client or supabase.client
        engagement = get_engagement_multiplier(client, user_id)
        user_prefs = {
            "depletion_multiplier": float((prefs_row or {}).get("depletion_multiplier") or 1.0)
        }
        bases = list(
            {(it.get("base_ingredient") or "").strip().lower() for it in items}
        )
        classifications = supabase.get_item_classifications_by_names(bases)

        scored: List[Dict[str, Any]] = []
        for item in items:
            base = (item.get("base_ingredient") or "").strip().lower()
            cls = classifications.get(base, {})
            default_days = cls.get("default_days_supply") or 45
            cal = get_calibrated_days_supply(client, user_id, base, int(default_days))
            conf = compute_confidence(
                item,
                user_prefs,
                cls,
                today=today,
                calibrated_days=cal,
                engagement_multiplier=engagement,
            )
            if 0.20 <= conf <= 0.60:
                scored.append(
                    {
                        "item_id": str(item.get("id")),
                        "base_ingredient": item.get("base_ingredient") or "",
                        "normalized_name": item.get("normalized_name") or "",
                        "confidence": conf,
                        "depletion_class": (
                            item.get("depletion_class")
                            or cls.get("depletion_class")
                            or "STAPLE"
                        ),
                    }
                )

        scored.sort(key=lambda x: x["confidence"])
        limited = scored[:5]
        if not limited:
            return jsonify({"show": False, "items": []})
        return jsonify({"show": True, "items": limited})
    except Exception as e:
        logger.error(f"Error building health card: {e}")
        return jsonify({"error": str(e)}), 500


@pantry_bp.route("/pantry/health-card/dismiss", methods=["POST"])
def pantry_health_card_dismiss():
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401

    supabase = get_supabase_service()
    if not supabase:
        return jsonify({"error": "Database service not available"}), 503

    try:
        prefs = supabase.get_user_preferences(user_id)
        row: Dict[str, Any] = {
            "user_id": user_id,
            "last_health_card_shown": date.today().isoformat(),
        }
        if prefs is None:
            row["household_size"] = "TWO"
            row["depletion_multiplier"] = 1.5
        supabase.admin_client.table("user_preferences").upsert(
            row,
            on_conflict="user_id",
        ).execute()
        return jsonify({"ok": True})
    except Exception as e:
        logger.error(f"Error dismissing health card: {e}")
        return jsonify({"error": str(e)}), 500


@pantry_bp.route("/pantry/items/<item_id>/correction", methods=["POST"])
def pantry_item_correction(item_id):
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401

    supabase = get_supabase_service()
    service = get_pantry_service()
    if not supabase or not service:
        return jsonify({"error": "Service not available"}), 503

    body = request.get_json() or {}
    action = body.get("action")
    valid = frozenset({"still_have_it", "used_it_up", "never_had_it"})
    if action not in valid:
        return jsonify({"error": "action must be still_have_it, used_it_up, or never_had_it"}), 400

    item = supabase.get_pantry_item_by_id(item_id)
    if not item or item.get("deleted_at"):
        return jsonify({"error": "Item not found"}), 404
    if not service.user_can_access_pantry_item(user_id, item):
        return jsonify({"error": "Item not found"}), 404

    today = date.today()
    c = supabase.admin_client or supabase.client

    try:
        if action == "still_have_it":
            expires = (today + timedelta(days=14)).isoformat()
            c.table("pantry_items").update(
                {
                    "confidence_override": 0.80,
                    "confidence_override_expires": expires,
                }
            ).eq("id", item_id).execute()
            return jsonify({"ok": True})

        reason = "USER_REMOVED" if action == "used_it_up" else "NEVER_HAD"
        purchase = _to_date(item.get("purchase_date"))
        _rpc_soft_delete_pantry_item(
            c,
            user_id=user_id,
            pantry_item_id=str(item_id),
            item_name=item.get("base_ingredient") or item.get("normalized_name") or "",
            depletion_class=item.get("depletion_class") or "STAPLE",
            purchase_date=purchase,
            today=today,
            reason=reason,
            was_cooked=False,
            put_back_count=int(item.get("put_back_count") or 0),
        )
        return jsonify({"ok": True})
    except Exception as e:
        logger.error(f"Error applying pantry correction: {e}")
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
    
    household_id = _optional_household_id_query()

    mismatch = _reject_household_scope_mismatch(supabase, user_id, household_id)
    if mismatch:
        return mismatch

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

    supabase = get_supabase_service()
    if not supabase:
        return jsonify({"error": "Database service not available"}), 503

    mismatch = _reject_household_scope_mismatch(
        supabase, user_id, _optional_household_id_body(data)
    )
    if mismatch:
        return mismatch
    
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
    
    household_id = _optional_household_id_body(data)
    
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

    supabase = get_supabase_service()
    if not supabase:
        return jsonify({"error": "Database service not available"}), 503

    household_id = _optional_household_id_body(data)
    mismatch = _reject_household_scope_mismatch(supabase, user_id, household_id)
    if mismatch:
        return mismatch
    
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

    supabase = get_supabase_service()
    if not supabase:
        return jsonify({"error": "Database service not available"}), 503

    household_id = _optional_household_id_body(data)
    mismatch = _reject_household_scope_mismatch(supabase, user_id, household_id)
    if mismatch:
        return mismatch
    
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
