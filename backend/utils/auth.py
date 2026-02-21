"""
Auth utilities for extracting and validating user identity from requests.

When SUPABASE_JWT_SECRET is set, validates the Authorization Bearer JWT and extracts user_id.
Otherwise falls back to X-User-Id header (for development).
"""

import os
from flask import request

try:
    import jwt
    HAS_PYJWT = True
except ImportError:
    HAS_PYJWT = False


def get_user_id_from_request():
    """
    Extract user ID from request.

    When SUPABASE_JWT_SECRET is set: validate Authorization Bearer JWT, return sub or None.
    When not set (dev): fall back to X-User-Id header, query param, or body.
    """
    jwt_secret = os.getenv("SUPABASE_JWT_SECRET")

    if jwt_secret and HAS_PYJWT:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header[7:]
            try:
                payload = jwt.decode(
                    token,
                    jwt_secret,
                    audience="authenticated",
                    algorithms=["HS256"],
                )
                return payload.get("sub")
            except Exception:
                return None
        return None

    # Fallback for development when JWT secret not set
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        user_id = request.args.get("user_id")
    if not user_id:
        data = request.get_json(silent=True) or {}
        user_id = data.get("user_id")
    return user_id
