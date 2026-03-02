"""Debug log ingest endpoint - captures One-Tap sync logs when Cursor ingest is unreachable."""

import json
import os
from flask import Blueprint, request, jsonify

debug_ingest_bp = Blueprint("debug_ingest", __name__)

# Log file in project root (same path Cursor ingest would use)
LOG_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "debug-392e90.log")


@debug_ingest_bp.route("/debug-ingest", methods=["POST"])
def ingest():
    """Accept debug log payload and append as NDJSON line."""
    try:
        payload = request.get_json() or {}
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(payload, default=str) + "\n")
        return jsonify({"ok": True}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
