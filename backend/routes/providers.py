"""Provider management endpoints"""

import uuid
from flask import Blueprint, jsonify, request, current_app
from backend.providers.provider_registry import ProviderRegistry
from backend.services.receipt_service import store_fetched_receipts
from backend.utils.logger import get_logger
from backend.utils.auth import get_user_id_from_request
from backend.utils.exceptions import AuthenticationException
from backend.utils.costco_receipt_types import is_non_grocery_costco_receipt_type, receipt_type_from_payload

logger = get_logger(__name__)
providers_bp = Blueprint("providers", __name__)

_RECONNECT_REASONS = frozenset({
    "expired_credentials",
    "token_refresh_failed",
    "bot_detection",
})

_RECONNECT_MESSAGES = {
    "expired_credentials": "Token has expired. Please sign in again.",
    "token_refresh_failed": "Unable to refresh credentials. Please sign in again.",
    "bot_detection": "Connection blocked. Please sign in again.",
}


def _reconnect_response(provider: str, reason: str, detail: str = "") -> tuple:
    """
    Build the standardized 401 reconnect response.

    Args:
        provider: Provider name (e.g. "costco", "safeway")
        reason: One of expired_credentials, token_refresh_failed, bot_detection
        detail: Internal log context only; never included in the JSON body

    Returns:
        (flask Response, 401)
    """
    if reason not in _RECONNECT_REASONS:
        raise ValueError(f"Unknown reconnect reason: {reason}")
    if detail:
        logger.info(f"Reconnect required for {provider} ({reason}): {detail}")
    return jsonify({
        "error": _RECONNECT_MESSAGES[reason],
        "needs_reconnect": True,
        "provider": provider,
        "reason": reason,
    }), 401


def _store_and_process_fetched_receipts(user_id: str, provider_name: str, receipts: list) -> dict:
    """
    Store fetched receipts in the DB and process each into the digital pantry
    (normalize items and add to pantry). Uses current_app for services.
    """
    supabase_service = current_app.config.get("SUPABASE_SERVICE")
    receipt_processor = current_app.config.get("RECEIPT_PROCESSOR")
    if not supabase_service:
        return {"receipt_ids": [], "receipts_stored": 0, "errors": ["Database service not available"], "items_added_to_pantry": 0}
    if not receipt_processor:
        # Store only; processing requires RECEIPT_PROCESSOR
        store_result = store_fetched_receipts(user_id, provider_name, receipts, supabase_service)
        return {
            "receipt_ids": store_result["receipt_ids"],
            "receipts_stored": store_result["receipts_stored"],
            "errors": store_result["errors"],
            "items_added_to_pantry": 0,
        }
    store_result = store_fetched_receipts(user_id, provider_name, receipts, supabase_service)
    if not store_result["receipt_ids"]:
        return {
            "receipt_ids": [],
            "receipts_stored": 0,
            "errors": store_result["errors"],
            "items_added_to_pantry": 0,
        }
    # Run async process_receipt for each stored receipt (normalize -> add to pantry)
    from backend.routes.pantry import run_async
    total_added = 0
    for receipt_id in store_result["receipt_ids"]:
        try:
            proc_result = run_async(receipt_processor.process_receipt(receipt_id, user_id))
            total_added += proc_result.get("items_added_to_pantry", 0)
        except Exception as e:
            logger.warning(f"Failed to process receipt {receipt_id} into pantry: {e}")
            store_result["errors"].append(f"Process {receipt_id}: {str(e)}")
    return {
        "receipt_ids": store_result["receipt_ids"],
        "receipts_stored": store_result["receipts_stored"],
        "errors": store_result["errors"],
        "items_added_to_pantry": total_added,
    }


# Native WebView bridge providers (no Playwright; not in ProviderRegistry)
_NATIVE_PROVIDERS = ["safeway"]


@providers_bp.route("/providers", methods=["GET"])
def list_providers():
    """List all available providers"""
    try:
        providers = list(ProviderRegistry.list_providers())
        for p in _NATIVE_PROVIDERS:
            if p not in providers:
                providers.append(p)
        return jsonify({
            "providers": providers,
            "count": len(providers)
        }), 200
    except Exception as e:
        logger.error(f"Error listing providers: {e}")
        return jsonify({"error": "Internal server error"}), 500


@providers_bp.route("/providers/<provider_name>/status", methods=["GET"])
def get_provider_status(provider_name):
    """
    Get status of a provider
    
    Query params:
        user_id: User ID (required)
    """
    try:
        user_id = get_user_id_from_request()
        if not user_id:
            return jsonify({"error": "User ID required"}), 401
        try:
            uuid.UUID(user_id)
        except (ValueError, TypeError):
            return jsonify({"error": "User ID required"}), 401

        # Native providers (WebView bridge) - no backend-stored credentials
        if provider_name in _NATIVE_PROVIDERS:
            return jsonify({
                "provider": provider_name,
                "configured": False,
                "active": False,
            }), 200

        # Check if provider is registered
        if not ProviderRegistry.is_registered(provider_name):
            return jsonify({"error": f"Provider {provider_name} not found"}), 404

        # Get grocery account from database
        supabase_service = current_app.config.get("SUPABASE_SERVICE")
        if not supabase_service:
            return jsonify({"error": "Database service not available"}), 503
        
        account = supabase_service.get_grocery_account(user_id, provider_name)
        
        if not account:
            return jsonify({
                "provider": provider_name,
                "configured": False,
                "active": False
            }), 200
        
        return jsonify({
            "provider": provider_name,
            "configured": True,
            "active": account.get("is_active", False),
            "last_successful_login": account.get("last_successful_login"),
            "mfa_required": account.get("mfa_required", False)
        }), 200
    
    except Exception as e:
        logger.error(f"Error getting provider status: {e}")
        return jsonify({"error": "Internal server error"}), 500


@providers_bp.route("/providers/costco/store-receipts", methods=["POST"])
def store_costco_receipts():
    """
    Store pre-fetched Costco receipts (from One-Tap Sync spike).
    Used when receipts are fetched on-device via native HTTP, then submitted for storage.
    Body: { "receipts": [...], "user_id": "uuid" }
    """
    try:
        data = request.get_json() or {}
        receipts = data.get("receipts") or data.get("receipt_data") or []
        user_id = get_user_id_from_request()

        if not user_id:
            return jsonify({"error": "User ID required"}), 401
        try:
            uuid.UUID(user_id)
        except (ValueError, TypeError):
            return jsonify({"error": "User ID required"}), 401
        if not isinstance(receipts, list):
            return jsonify({"error": "receipts must be an array"}), 400

        # Exclude gas / car wash only (API uses spaced/hyphenated types e.g. "In-Warehouse", "Gas Station")
        all_count = len(receipts)
        incoming_types = [receipt_type_from_payload(r) for r in receipts]
        logger.debug(
            "store-costco-receipts incoming receipt_type values: %s",
            incoming_types,
        )
        grocery = [r for r in receipts if not is_non_grocery_costco_receipt_type(receipt_type_from_payload(r))]
        filtered_count = all_count - len(grocery)
        receipts = grocery
        if filtered_count:
            logger.info(
                "Filtered %s non-grocery receipts (gas/carwash) from store-receipts",
                filtered_count,
            )

        store_result = _store_and_process_fetched_receipts(user_id, "costco", receipts)
        return jsonify({
            "status": "success",
            "receipts_stored": store_result["receipts_stored"],
            "receipt_ids": store_result["receipt_ids"],
            "items_added_to_pantry": store_result["items_added_to_pantry"],
            "errors": store_result.get("errors", []),
        }), 200
    except Exception as e:
        logger.error(f"Error storing Costco receipts: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@providers_bp.route("/providers/costco/connect-from-app", methods=["POST"])
def connect_costco_from_app():
    """
    Connect Costco account from app after WebView login. No connection code needed.
    Request must be authenticated (Bearer token). Used by One-Tap Sync flow.

    Body:
        {
            "user_id": "uuid",              // Required: must match authenticated user
            "idToken": "eyJ...",            // Required: JWT idToken from WebView
            "clientId": "uuid",             // Optional: clientID from localStorage
            "wcsClientId": "uuid",          // Optional: WCS client ID
            "refreshToken": "...",          // Optional: refresh token from MSAL
            "refreshTokenClientId": "uuid"   // Optional: client ID for refresh token
        }

    Returns:
        {
            "status": "success",
            "message": "Costco account connected successfully"
        }
    """
    try:
        if not request.is_json:
            return jsonify({"error": "Request body must be JSON"}), 400

        data = request.get_json(silent=True)
        if not data:
            return jsonify({"error": "Request body is required"}), 400

        user_id = get_user_id_from_request()
        id_token = data.get("idToken") or data.get("id_token")

        if not user_id:
            return jsonify({"error": "User ID required"}), 401
        try:
            uuid.UUID(user_id)
        except (ValueError, TypeError):
            return jsonify({"error": "User ID required"}), 401
        if not id_token:
            return jsonify({"error": "idToken is required"}), 400

        try:
            from backend.providers.costco_provider import CostcoProvider
            provider = CostcoProvider(headless=True)

            payload = provider._decode_jwt_payload(id_token)
            if not payload:
                raise AuthenticationException("Invalid token format")

            username = payload.get("email") or payload.get("preferred_username") or payload.get("sub", "unknown")

            if provider._is_token_expired(id_token):
                return _reconnect_response("costco", "expired_credentials")

            credentials = {"idToken": id_token}
            if data.get("clientId"):
                credentials["clientId"] = data["clientId"]
            if data.get("clientIdentifier"):
                credentials["clientIdentifier"] = data["clientIdentifier"]
            if data.get("wcsClientId"):
                credentials["wcsClientId"] = data["wcsClientId"]
            if data.get("refreshToken"):
                credentials["refreshToken"] = data["refreshToken"]
            if data.get("refreshTokenClientId"):
                credentials["refreshTokenClientId"] = data["refreshTokenClientId"]
            if data.get("userAgent"):
                credentials["userAgent"] = data["userAgent"]

            secrets_service = current_app.config.get("SECRETS_SERVICE")
            if not secrets_service:
                return jsonify({"error": "Secrets service not configured"}), 503

            try:
                existing = secrets_service.retrieve_user_credentials(user_id, "costco")
                if isinstance(existing, dict):
                    merged = dict(existing)
                    for key, value in credentials.items():
                        if value is not None and value != "":
                            merged[key] = value
                    credentials = merged
            except Exception:
                pass

            vault_key_id = secrets_service.store_user_credentials(
                user_id=user_id,
                provider="costco",
                credentials=credentials
            )

            supabase_service = current_app.config.get("SUPABASE_SERVICE")
            if not supabase_service:
                return jsonify({"error": "Database service not available"}), 503

            account_id = supabase_service.create_or_update_grocery_account(
                user_id=user_id,
                provider="costco",
                username=str(username),
                vault_key_id=vault_key_id
            )

            supabase_service.update_grocery_account_login(account_id, success=True, mfa_required=False)

            logger.info(f"Costco account connected from app for user {user_id}")

            return jsonify({
                "status": "success",
                "message": "Costco account connected successfully",
                "account_id": account_id
            }), 200

        except AuthenticationException as auth_err:
            logger.error(f"Authentication error: {auth_err}")
            return _reconnect_response("costco", "expired_credentials", str(auth_err))
        except Exception as e:
            logger.error(f"Error connecting Costco account: {e}", exc_info=True)
            return jsonify({"error": f"Failed to connect account: {str(e)}"}), 500

    except Exception as e:
        logger.error(f"Unexpected error: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500
