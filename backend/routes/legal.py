"""Public legal pages (privacy, terms, account deletion instructions)."""

from pathlib import Path

from flask import Blueprint, Response

LEGAL_DIR = Path(__file__).resolve().parent.parent / "legal"

PRIVACY_FILE = LEGAL_DIR / "privacy.html"
TERMS_FILE = LEGAL_DIR / "terms.html"
DELETE_ACCOUNT_FILE = LEGAL_DIR / "delete-account.html"

for _path in (PRIVACY_FILE, TERMS_FILE, DELETE_ACCOUNT_FILE):
    if not _path.is_file():
        raise FileNotFoundError(f"Legal page missing at startup: {_path}")

PRIVACY_HTML = PRIVACY_FILE.read_text(encoding="utf-8")
TERMS_HTML = TERMS_FILE.read_text(encoding="utf-8")
DELETE_ACCOUNT_HTML = DELETE_ACCOUNT_FILE.read_text(encoding="utf-8")

LEGAL_HEADERS = {
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": (
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'"
    ),
}

legal_bp = Blueprint("legal", __name__)


def _html_response(body: str) -> Response:
    response = Response(body, mimetype="text/html")
    response.charset = "utf-8"
    for key, value in LEGAL_HEADERS.items():
        response.headers[key] = value
    return response


@legal_bp.route("/privacy", methods=["GET"])
def privacy_page():
    """Public privacy policy."""
    return _html_response(PRIVACY_HTML)


@legal_bp.route("/terms", methods=["GET"])
def terms_page():
    """Public terms of service."""
    return _html_response(TERMS_HTML)


@legal_bp.route("/delete-account", methods=["GET"])
def delete_account_page():
    """Public account deletion instructions (Play / App Store listing URL)."""
    return _html_response(DELETE_ACCOUNT_HTML)
