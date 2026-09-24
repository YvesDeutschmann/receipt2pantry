"""Public staple recipe hero images (no auth; catalog allowlist)."""

import re
from pathlib import Path

from flask import Blueprint, abort, send_from_directory

from backend.services.staple_catalog import staple_recipe_ids

staples_static_bp = Blueprint("staples_static", __name__)

_STATIC_DIR = Path(__file__).resolve().parent.parent / "static" / "staples"
_FILENAME_RE = re.compile(r"^staple_[a-z0-9_]+\.webp$")

_STAPLE_HEADERS = {
    "Cache-Control": "public, max-age=86400",
    "X-Content-Type-Options": "nosniff",
}


@staples_static_bp.route("/staples/<path:filename>", methods=["GET"])
def serve_staple_image(filename: str):
    """Serve a catalog staple image by basename only (lock 7)."""
    if not filename or "/" in filename or "\\" in filename or ".." in filename:
        abort(404)
    if not _FILENAME_RE.fullmatch(filename):
        abort(404)
    stem = filename[: -len(".webp")]
    if stem not in staple_recipe_ids():
        abort(404)
    if not _STATIC_DIR.is_dir():
        abort(404)
    path = (_STATIC_DIR / filename).resolve()
    try:
        path.relative_to(_STATIC_DIR.resolve())
    except ValueError:
        abort(404)
    if not path.is_file():
        abort(404)
    response = send_from_directory(_STATIC_DIR, filename, mimetype="image/webp")
    for key, value in _STAPLE_HEADERS.items():
        response.headers[key] = value
    return response
