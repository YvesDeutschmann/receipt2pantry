"""Provider management endpoints"""

import uuid
from datetime import datetime, timezone
from flask import Blueprint, jsonify, request, current_app
from backend.providers.provider_registry import ProviderRegistry
from backend.services.receipt_service import store_fetched_receipts
from backend.services.connection_code_manager import get_connection_code_manager
from backend.utils.logger import get_logger
from backend.utils.exceptions import AuthenticationException, ProviderException
from backend.utils.costco_receipt_types import is_non_grocery_costco_receipt_type, receipt_type_from_payload

logger = get_logger(__name__)
providers_bp = Blueprint("providers", __name__)


def _is_valid_user_id(user_id: str) -> bool:
    """Return True if user_id is a non-empty, non-anonymous UUID."""
    if not user_id or user_id.strip() == "" or user_id == "anonymous":
        return False
    try:
        uuid.UUID(user_id)
        return True
    except (ValueError, TypeError):
        return False


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
        user_id = request.args.get("user_id")
        if not user_id:
            return jsonify({"error": "user_id is required"}), 400
        
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


@providers_bp.route("/providers/<provider_name>/fetch-receipts", methods=["POST"])
def fetch_receipts_with_stored_credentials(provider_name):
    """
    Fetch receipts using stored credentials (for token-based providers like Costco)
    
    Body:
        {
            "user_id": "uuid",     // Required
            "days": 90             // Optional: days of history (default: 90)
        }
    """
    try:
        data = request.get_json(silent=True) or {}
        user_id = data.get("user_id")
        days = data.get("days", 90)
        
        if not user_id:
            return jsonify({"error": "user_id is required"}), 400
        
        # Check if provider is registered
        if not ProviderRegistry.is_registered(provider_name):
            return jsonify({"error": f"Provider {provider_name} not found"}), 404
        
        # Get stored credentials
        supabase_service = current_app.config.get("SUPABASE_SERVICE")
        secrets_service = current_app.config.get("SECRETS_SERVICE")
        
        if not supabase_service or not secrets_service:
            return jsonify({"error": "Required services not available"}), 503
        
        account = supabase_service.get_grocery_account(user_id, provider_name)
        if not account or not account.get("is_active"):
            return jsonify({"error": f"No active {provider_name} account found. Please connect your account first."}), 404
        
        vault_key_id = account.get("vault_key_id")
        if not vault_key_id:
            return jsonify({"error": "Account credentials not found"}), 404
        
        # Get credentials from secrets service
        credentials = secrets_service.retrieve_user_credentials(user_id, provider_name)
        if not credentials:
            return jsonify({"error": "Failed to retrieve stored credentials"}), 500
        
        # For Costco, use the token-based API
        if provider_name == "costco":
            provider = ProviderRegistry.get_provider(provider_name)
            id_token = credentials.get("idToken")
            client_identifier = credentials.get("clientIdentifier")
            
            if not id_token:
                return jsonify({"error": "Stored credentials missing required token"}), 500
            
            logger.info(f"Fetching {provider_name} receipts with stored credentials (days={days})")

            token_updates: dict = {}
            try:
                receipts = provider.fetch_receipts_via_api(
                    id_token,
                    days=days,
                    client_identifier=client_identifier,
                    refresh_token=credentials.get("refreshToken"),
                    refresh_token_client_id=credentials.get("refreshTokenClientId"),
                    token_refresh_sink=token_updates,
                )
            except (AuthenticationException, ProviderException) as e:
                error_str = str(e).lower()
                is_auth_error = "403" in str(e) or "401" in str(e) or "expired" in error_str or "invalid" in error_str
                
                if is_auth_error:
                    token_is_expired = provider._is_token_expired(id_token, buffer_seconds=0)
                    try:
                        payload = provider._decode_jwt_payload(id_token)
                        exp = payload.get('exp')
                        if exp:
                            expiry_time = datetime.fromtimestamp(exp)
                            time_until_expiry = expiry_time - datetime.now()
                            logger.info(f"Token expiry check - Expires at: {expiry_time}, Time until expiry: {time_until_expiry}, Is expired: {token_is_expired}")
                        else:
                            logger.warning("Token has no expiry claim")
                    except Exception as log_error:
                        logger.debug(f"Could not log token expiry details: {log_error}")
                    
                    if not token_is_expired:
                        logger.error(f"Costco API returned auth error (status: {str(e)}) but token is still valid. This may be due to bot detection or rate limiting.")
                        raise
                    
                    refresh_token = credentials.get("refreshToken")
                    if not refresh_token:
                        logger.warning(f"Token expired but no refresh token available for user {user_id}")
                        return jsonify({
                            "error": "Token expired and no refresh token available. Please reconnect your account.",
                            "expired_credentials": True
                        }), 401
                    
                    logger.info(f"Token expired, attempting refresh for user {user_id}")
                    try:
                        refresh_token_client_id = credentials.get("refreshTokenClientId")
                        new_tokens = provider._refresh_id_token(refresh_token, id_token=id_token, client_id=refresh_token_client_id)
                        credentials.update(new_tokens)
                        if "refreshTokenClientId" not in new_tokens and refresh_token_client_id:
                            credentials["refreshTokenClientId"] = refresh_token_client_id
                        secrets_service.store_user_credentials(user_id, provider_name, credentials)
                        logger.info(f"Successfully refreshed and stored new tokens for user {user_id}")
                        route_token_updates: dict = {}
                        receipts = provider.fetch_receipts_via_api(
                            new_tokens["idToken"],
                            days=days,
                            client_identifier=client_identifier,
                            refresh_token=credentials.get("refreshToken"),
                            refresh_token_client_id=credentials.get("refreshTokenClientId"),
                            token_refresh_sink=route_token_updates,
                        )
                        if route_token_updates:
                            credentials.update(route_token_updates)
                            secrets_service.store_user_credentials(user_id, provider_name, credentials)
                    except AuthenticationException as refresh_error:
                        logger.error(f"Token refresh failed for user {user_id}: {refresh_error}")
                        return jsonify({
                            "error": f"Token refresh failed: {str(refresh_error)}. Please reconnect your account.",
                            "expired_credentials": True
                        }), 401
                else:
                    raise

            if token_updates:
                credentials.update(token_updates)
                secrets_service.store_user_credentials(user_id, provider_name, credentials)

            store_result = _store_and_process_fetched_receipts(user_id, provider_name, receipts)
            return jsonify({
                "status": "success",
                "provider": provider_name,
                "receipts": receipts,
                "count": len(receipts),
                "receipts_stored": store_result["receipts_stored"],
                "items_added_to_pantry": store_result["items_added_to_pantry"]
            }), 200
        else:
            return jsonify({"error": f"Stored credential fetching not yet supported for {provider_name}"}), 501
    
    except AuthenticationException as e:
        logger.error(f"Authentication error: {e}")
        return jsonify({"error": str(e), "expired_credentials": True}), 401
    except Exception as e:
        logger.error(f"Error fetching receipts with stored credentials: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@providers_bp.route("/providers/costco/fetch-receipts-with-token", methods=["POST"])
def fetch_costco_receipts_with_token():
    """
    Fetch Costco receipts directly using a provided idToken (bypasses login/bot detection)
    
    Body:
        idToken (required), clientIdentifier (optional), days (optional, default 90), userId (optional)
    
    Returns:
        status, receipts, count, receipts_stored, items_added_to_pantry
    """
    try:
        data = request.get_json() or {}
        id_token = data.get("idToken") or data.get("id_token")
        if not id_token:
            return jsonify({
                "error": "idToken is required. Get it from the costco-x-authorization header in browser network requests"
            }), 400
        
        days = data.get("days", 90)
        user_id = data.get("userId") or data.get("user_id")
        client_identifier = data.get("clientIdentifier") or data.get("client_identifier")
        
        from backend.providers.costco_provider import CostcoProvider
        provider = CostcoProvider(headless=True)
        
        try:
            logger.info(f"Fetching Costco receipts via API with provided token (days={days}, client_id={'provided' if client_identifier else 'random'})")
            receipts = provider.fetch_receipts_via_api(id_token, days=days, client_identifier=client_identifier)
            logger.info(f"Fetched {len(receipts)} receipts via direct API")
            
            if _is_valid_user_id(user_id):
                store_result = _store_and_process_fetched_receipts(user_id, "costco", receipts)
                return jsonify({
                    "status": "success",
                    "provider": "costco",
                    "receipts": receipts,
                    "count": len(receipts),
                    "receipts_stored": store_result["receipts_stored"],
                    "receipt_ids": store_result["receipt_ids"],
                    "items_added_to_pantry": store_result["items_added_to_pantry"],
                    "errors": store_result.get("errors", []),
                }), 200
            else:
                return jsonify({
                    "status": "success",
                    "provider": "costco",
                    "receipts": receipts,
                    "count": len(receipts),
                    "message": "Receipts fetched but not stored (no valid userId provided)"
                }), 200
        except AuthenticationException as auth_err:
            return jsonify({
                "error": str(auth_err),
                "hint": "Your token may have expired. Get a fresh idToken from localStorage on costco.com after logging in."
            }), 401
        except Exception as e:
            logger.error(f"Error fetching receipts via API: {e}", exc_info=True)
            return jsonify({"error": f"Failed to fetch receipts: {str(e)}"}), 500
    except Exception as e:
        logger.error(f"Unexpected error: {e}", exc_info=True)
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
        user_id = data.get("user_id") or data.get("userId")

        if not _is_valid_user_id(user_id):
            return jsonify({"error": "user_id is required and must be a valid UUID"}), 400
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


@providers_bp.route("/providers/costco/connection-code", methods=["GET"])
def get_costco_connection_code():
    """
    Generate a connection code for user-assisted Costco token extraction
    
    Query params:
        user_id: User ID (required)
    
    Returns:
        {
            "connection_code": "abc123...",
            "expires_at": "2025-02-04T12:00:00Z",
            "expires_in_seconds": 600
        }
    """
    try:
        user_id = request.args.get("user_id")
        if not user_id:
            return jsonify({"error": "user_id is required"}), 400
        
        if not _is_valid_user_id(user_id):
            return jsonify({"error": "Invalid user_id format"}), 400
        
        # Generate connection code
        code_manager = get_connection_code_manager()
        connection_code = code_manager.generate_code(user_id)
        code_info = code_manager.get_code_info(connection_code)
        
        expires_at = code_info["expires_at"]
        expires_in_seconds = int((expires_at - datetime.now(timezone.utc)).total_seconds())
        
        logger.info(f"Generated connection code for user {user_id}")
        
        return jsonify({
            "connection_code": connection_code,
            "expires_at": expires_at.isoformat(),
            "expires_in_seconds": expires_in_seconds
        }), 200
    
    except Exception as e:
        logger.error(f"Error generating connection code: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500


@providers_bp.route("/providers/costco/connect", methods=["POST"])
def connect_costco_with_tokens():
    """
    Connect Costco account using tokens extracted from user's browser
    
    Body:
        {
            "connection_code": "abc123...",  // Required: connection code from /connection-code
            "idToken": "eyJ...",              // Required: JWT idToken from localStorage
            "clientId": "uuid",               // Optional: clientID from localStorage
            "refreshToken": "...",            // Optional: refresh token from MSAL storage
            "refreshTokenClientId": "uuid"    // Optional: client ID for refresh token
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
        
        connection_code = data.get("connection_code")
        id_token = data.get("idToken") or data.get("id_token")
        
        if not connection_code:
            return jsonify({"error": "connection_code is required"}), 400
        
        if not id_token:
            return jsonify({"error": "idToken is required"}), 400
        
        # Validate connection code
        code_manager = get_connection_code_manager()
        code_info = code_manager.get_code_info(connection_code)
        
        if not code_info:
            return jsonify({"error": "Invalid or expired connection code"}), 404
        
        if code_info["status"] == "expired":
            return jsonify({"error": "Connection code has expired"}), 410
        
        if code_info["status"] == "connected":
            return jsonify({"error": "Connection code already used"}), 400
        
        user_id = code_info["user_id"]
        
        # Validate JWT token (decode to check structure)
        try:
            from backend.providers.costco_provider import CostcoProvider
            provider = CostcoProvider(headless=True)
            
            # Decode JWT to extract username/email
            payload = provider._decode_jwt_payload(id_token)
            if not payload:
                raise AuthenticationException("Invalid token format")
            
            # Extract username from token (email is typically in 'email' or 'preferred_username' claim)
            username = payload.get("email") or payload.get("preferred_username") or payload.get("sub", "unknown")
            
            # Check if token is expired
            if provider._is_token_expired(id_token):
                return jsonify({
                    "error": "Token has expired. Please get a fresh token from Costco.com"
                }), 400
            
            # Prepare credentials for storage
            credentials = {
                "idToken": id_token,
            }
            
            # Add optional fields
            if data.get("clientId"):
                credentials["clientId"] = data["clientId"]
            if data.get("clientIdentifier"):
                credentials["clientIdentifier"] = data["clientIdentifier"]
            if data.get("refreshToken"):
                credentials["refreshToken"] = data["refreshToken"]
            if data.get("refreshTokenClientId"):
                credentials["refreshTokenClientId"] = data["refreshTokenClientId"]
            
            # Store credentials using secrets service
            secrets_service = current_app.config.get("SECRETS_SERVICE")
            if not secrets_service:
                return jsonify({"error": "Secrets service not configured"}), 503
            
            vault_key_id = secrets_service.store_user_credentials(
                user_id=user_id,
                provider="costco",
                credentials=credentials
            )
            
            # Create or update grocery account
            supabase_service = current_app.config.get("SUPABASE_SERVICE")
            if not supabase_service:
                return jsonify({"error": "Database service not available"}), 503
            
            account_id = supabase_service.create_or_update_grocery_account(
                user_id=user_id,
                provider="costco",
                username=str(username),
                vault_key_id=vault_key_id
            )
            
            # Update login timestamp
            supabase_service.update_grocery_account_login(account_id, success=True, mfa_required=False)
            
            # Mark connection code as connected
            code_manager.mark_connected(connection_code)
            
            logger.info(f"Successfully connected Costco account for user {user_id}")
            
            return jsonify({
                "status": "success",
                "message": "Costco account connected successfully",
                "account_id": account_id
            }), 200
            
        except AuthenticationException as auth_err:
            logger.error(f"Authentication error: {auth_err}")
            return jsonify({"error": str(auth_err)}), 401
        except Exception as e:
            logger.error(f"Error connecting Costco account: {e}", exc_info=True)
            return jsonify({"error": f"Failed to connect account: {str(e)}"}), 500
    
    except Exception as e:
        logger.error(f"Unexpected error: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500


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

        user_id = data.get("user_id")
        id_token = data.get("idToken") or data.get("id_token")

        if not user_id:
            return jsonify({"error": "user_id is required"}), 400
        if not _is_valid_user_id(user_id):
            return jsonify({"error": "user_id must be a valid UUID"}), 400
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
                return jsonify({
                    "error": "Token has expired. Please sign in again."
                }), 400

            credentials = {"idToken": id_token}
            if data.get("clientId"):
                credentials["clientId"] = data["clientId"]
            if data.get("clientIdentifier"):
                credentials["clientIdentifier"] = data["clientIdentifier"]
            if data.get("refreshToken"):
                credentials["refreshToken"] = data["refreshToken"]
            if data.get("refreshTokenClientId"):
                credentials["refreshTokenClientId"] = data["refreshTokenClientId"]

            secrets_service = current_app.config.get("SECRETS_SERVICE")
            if not secrets_service:
                return jsonify({"error": "Secrets service not configured"}), 503

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
            return jsonify({"error": str(auth_err)}), 401
        except Exception as e:
            logger.error(f"Error connecting Costco account: {e}", exc_info=True)
            return jsonify({"error": f"Failed to connect account: {str(e)}"}), 500

    except Exception as e:
        logger.error(f"Unexpected error: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500


@providers_bp.route("/providers/costco/connection/<connection_code>/status", methods=["GET"])
def get_costco_connection_status(connection_code):
    """
    Get the status of a Costco connection code
    
    Returns:
        {
            "status": "pending" | "connected" | "expired" | "not_found",
            "expires_at": "2025-02-04T12:00:00Z",
            "time_remaining_seconds": 300
        }
    """
    try:
        code_manager = get_connection_code_manager()
        code_info = code_manager.get_code_info(connection_code)
        
        if not code_info:
            return jsonify({
                "status": "not_found",
                "message": "Connection code not found"
            }), 404
        
        status = code_info["status"]
        expires_at = code_info["expires_at"]
        
        # Calculate time remaining
        now = datetime.now(timezone.utc)
        if now > expires_at:
            time_remaining = 0
            status = "expired"
        else:
            time_remaining = int((expires_at - now).total_seconds())
        
        response_data = {
            "status": status,
            "expires_at": expires_at.isoformat(),
            "time_remaining_seconds": max(0, time_remaining)
        }
        
        if code_info.get("connected_at"):
            response_data["connected_at"] = code_info["connected_at"].isoformat()
        
        return jsonify(response_data), 200
    
    except Exception as e:
        logger.error(f"Error getting connection status: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

