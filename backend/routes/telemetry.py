"""Activation funnel telemetry ingestion (no PII beyond opaque user id)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from flask import Blueprint, current_app, jsonify, request

from backend.utils.auth import get_user_id_from_request
from backend.utils.logger import get_logger

telemetry_bp = Blueprint("telemetry", __name__)
logger = get_logger(__name__)

ALLOWED_EVENTS = frozenset(
    {
        "funnel_sign_in",
        "funnel_store_connected",
        "funnel_receipts_synced",
        "funnel_staples_confirmed",
        "funnel_first_suggestion_viewed",
        "funnel_first_cook_logged",
        "recipe_detail_opened",
        "cook_logged",
    }
)

REPEATABLE_EVENTS = frozenset({"recipe_detail_opened", "cook_logged"})

MAX_BATCH_SIZE = 20
MAX_SYNC_BATCH_SIZE = 50
MAX_METADATA_KEYS = 10
MAX_METADATA_BYTES = 1024

ALLOWED_PROVIDERS = frozenset({"costco", "safeway"})

ALLOWED_SYNC_PHASES = frozenset(
    {
        "session_begin",
        "session_busy",
        "session_preempted",
        "webview_opened",
        "webview_open_failed",
        "auth_complete",
        "tokens_received",
        "receipts_received",
        "close_requested",
        "close_confirmed",
        "close_failed",
        "close_skipped_not_owner",
        "close_unconfirmed",
        "login_timeout",
        "silent_timeout",
        "closed_early",
        "loop_detected",
        "ingest_started",
        "ingest_failed",
        "sync_succeeded",
        "sync_failed",
        "sync_skipped",
        "needs_reconnect",
        "diagnostic_checkpoint",
        "token_exchange",
        "webview_orphan_closed",
    }
)

SYNC_ANOMALY_PHASES = frozenset(
    {
        "webview_open_failed",
        "close_failed",
        "close_skipped_not_owner",
        "close_unconfirmed",
        "login_timeout",
        "silent_timeout",
        "closed_early",
        "loop_detected",
        "ingest_failed",
        "sync_failed",
        "needs_reconnect",
    }
)


def _validate_metadata(metadata: Any) -> dict[str, Any] | None:
    if metadata is None:
        return {}
    if not isinstance(metadata, dict):
        return None
    if len(metadata) > MAX_METADATA_KEYS:
        return None

    out: dict[str, Any] = {}
    for key, value in metadata.items():
        if not isinstance(key, str) or not key:
            return None
        t = type(value)
        if t not in (str, int, float, bool):
            return None
        if isinstance(value, str) and len(value) > 200:
            return None
        out[key] = value

    try:
        encoded = json.dumps(out, separators=(",", ":"))
    except (TypeError, ValueError):
        return None
    if len(encoded.encode("utf-8")) > MAX_METADATA_BYTES:
        return None
    return out


def _is_sync_events_constraint_violation(exc: Exception) -> bool:
    """Postgres CHECK on sync_events.phase (e.g. unknown phase not in DB allowlist)."""
    msg = str(exc).lower()
    return (
        "23514" in msg
        or "check constraint" in msg
        or "sync_events_phase_check" in msg
    )


def _parse_occurred_at(raw: Any) -> str:
    if raw is None:
        return datetime.now(timezone.utc).isoformat()
    if isinstance(raw, (int, float)):
        return datetime.fromtimestamp(raw / 1000.0, tz=timezone.utc).isoformat()
    if isinstance(raw, str):
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()
        except ValueError:
            pass
    return datetime.now(timezone.utc).isoformat()


@telemetry_bp.route("/telemetry/funnel", methods=["POST"])
def ingest_funnel_events():
    """Accept batched funnel events; identity from JWT only."""
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Invalid JSON body"}), 400

    events = payload.get("events")
    if not isinstance(events, list) or not events:
        return jsonify({"error": "events must be a non-empty array"}), 400
    if len(events) > MAX_BATCH_SIZE:
        return jsonify({"error": f"events batch exceeds max size ({MAX_BATCH_SIZE})"}), 400

    supabase_service = current_app.config.get("SUPABASE_SERVICE")
    if not supabase_service or not supabase_service.admin_client:
        return jsonify({"error": "Telemetry service unavailable"}), 503

    accepted = 0
    skipped = 0
    rows: list[dict[str, Any]] = []

    for item in events:
        if not isinstance(item, dict):
            return jsonify({"error": "Each event must be an object"}), 400

        event_name = item.get("event")
        if event_name not in ALLOWED_EVENTS:
            return jsonify({"error": f"Unknown event: {event_name}"}), 400

        metadata = _validate_metadata(item.get("metadata"))
        if metadata is None:
            return jsonify({"error": "Invalid metadata"}), 400

        session_id = item.get("sessionId") or item.get("session_id")
        if session_id is not None and not isinstance(session_id, str):
            return jsonify({"error": "sessionId must be a string"}), 400

        rows.append(
            {
                "user_id": user_id,
                "event": event_name,
                "session_id": session_id,
                "occurred_at": _parse_occurred_at(item.get("timestamp") or item.get("occurred_at")),
                "metadata": metadata,
            }
        )

    client = supabase_service.admin_client
    for row in rows:
        try:
            if row["event"] in REPEATABLE_EVENTS:
                client.table("funnel_repeatable_events").insert(row).execute()
                accepted += 1
                continue
            client.table("funnel_events").upsert(
                row,
                on_conflict="user_id,event",
                ignore_duplicates=True,
            ).execute()
            accepted += 1
        except Exception as exc:
            msg = str(exc).lower()
            if "duplicate" in msg or "unique" in msg or "23505" in msg:
                skipped += 1
            else:
                logger.error("Failed to ingest funnel event: %s", exc)
                return jsonify({"error": "Failed to store telemetry"}), 500

    return jsonify({"accepted": accepted, "skipped": skipped}), 200


@telemetry_bp.route("/telemetry/sync", methods=["POST"])
def ingest_sync_events():
    """Accept batched provider sync lifecycle events; identity from JWT only."""
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Invalid JSON body"}), 400

    events = payload.get("events")
    if not isinstance(events, list) or not events:
        return jsonify({"error": "events must be a non-empty array"}), 400
    if len(events) > MAX_SYNC_BATCH_SIZE:
        return jsonify({"error": f"events batch exceeds max size ({MAX_SYNC_BATCH_SIZE})"}), 400

    supabase_service = current_app.config.get("SUPABASE_SERVICE")
    if not supabase_service or not supabase_service.admin_client:
        return jsonify({"error": "Telemetry service unavailable"}), 503

    rows: list[dict[str, Any]] = []

    for item in events:
        if not isinstance(item, dict):
            return jsonify({"error": "Each event must be an object"}), 400

        provider = item.get("provider")
        if provider not in ALLOWED_PROVIDERS:
            return jsonify({"error": f"Unknown provider: {provider}"}), 400

        phase = item.get("phase")
        if phase not in ALLOWED_SYNC_PHASES:
            return jsonify({"error": f"Unknown phase: {phase}"}), 400

        sync_id = item.get("syncId") or item.get("sync_id")
        if not sync_id or not isinstance(sync_id, str):
            return jsonify({"error": "syncId is required"}), 400

        metadata = _validate_metadata(item.get("metadata"))
        if metadata is None:
            raw_meta = item.get("metadata")
            nkeys = len(raw_meta) if isinstance(raw_meta, dict) else -1
            key_names = list(raw_meta.keys())[:12] if isinstance(raw_meta, dict) else type(raw_meta).__name__
            logger.warning(
                "sync_telemetry invalid_metadata phase=%s nkeys=%s keys=%s",
                phase,
                nkeys,
                key_names,
            )
            return jsonify({"error": "Invalid metadata"}), 400

        session_id = item.get("sessionId") or item.get("session_id")
        if session_id is not None and not isinstance(session_id, str):
            return jsonify({"error": "sessionId must be a string"}), 400

        mode = item.get("mode")
        if mode is not None and mode not in ("login", "silent"):
            return jsonify({"error": "mode must be login or silent"}), 400

        reason = item.get("reason")
        if reason is not None and not isinstance(reason, str):
            return jsonify({"error": "reason must be a string"}), 400
        if isinstance(reason, str) and len(reason) > 500:
            return jsonify({"error": "reason too long"}), 400

        rows.append(
            {
                "user_id": user_id,
                "provider": provider,
                "phase": phase,
                "sync_id": sync_id,
                "session_id": session_id,
                "mode": mode,
                "reason": reason,
                "occurred_at": _parse_occurred_at(item.get("timestamp") or item.get("occurred_at")),
                "metadata": metadata,
            }
        )

    client = supabase_service.admin_client
    try:
        client.table("sync_events").insert(rows).execute()
    except Exception as exc:
        if _is_sync_events_constraint_violation(exc):
            logger.warning("sync_telemetry constraint violation: %s", exc)
            return jsonify({"error": "Invalid phase or constraint"}), 400
        logger.error("Failed to ingest sync events: %s", exc)
        return jsonify({"error": "Failed to store telemetry"}), 500

    for row in rows:
        if row["phase"] in SYNC_ANOMALY_PHASES:
            logger.warning(
                "sync_anomaly provider=%s phase=%s sync_id=%s reason=%s",
                row["provider"],
                row["phase"],
                row["sync_id"],
                row.get("reason") or "",
            )

    return jsonify({"accepted": len(rows)}), 200
