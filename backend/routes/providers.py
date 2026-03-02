"""Provider management endpoints"""

import concurrent.futures
import uuid
from datetime import datetime, timezone, timedelta
from flask import Blueprint, jsonify, request, current_app
from backend.providers.provider_registry import ProviderRegistry
from backend.services.receipt_service import store_fetched_receipts
from backend.services.connection_code_manager import get_connection_code_manager
from backend.utils.logger import get_logger
from backend.utils.exceptions import ProviderNotFoundException, AuthenticationException, MFARequiredException, ProviderException

# Thread pool for running Playwright operations (avoids asyncio conflicts)
_playwright_executor = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix="playwright")

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


def _cleanup_session_in_executor(session: dict) -> None:
    """
    Run browser cleanup in the Playwright executor thread.
    Swallow exceptions and log warnings; do not re-raise.
    """
    try:
        browser_context = session.get("browser_context")
        provider_instance = session.get("provider_instance")
        if browser_context:
            try:
                browser_context.close()
            except Exception as e:
                logger.warning(f"Error closing browser context: {e}")
        if provider_instance and hasattr(provider_instance, "cleanup"):
            try:
                provider_instance.cleanup()
            except Exception as e:
                logger.warning(f"Error calling provider cleanup: {e}")
    except Exception as e:
        logger.warning(f"Error during executor session cleanup: {e}")


def _terminate_session_with_executor_cleanup(session_manager, session_id: str, session: dict) -> bool:
    """
    Run session cleanup in the executor, then remove session from storage.
    Use when terminating from Flask thread to avoid Playwright thread-affinity errors.
    """
    try:
        future = _playwright_executor.submit(_cleanup_session_in_executor, session)
        future.result(timeout=10)
    except concurrent.futures.TimeoutError:
        logger.warning("Session cleanup timed out in executor; terminating session anyway")
    except Exception as e:
        logger.warning(f"Executor cleanup failed: {e}; terminating session anyway")
    return session_manager.terminate_session(session_id, skip_browser_cleanup=True)


@providers_bp.route("/providers", methods=["GET"])
def list_providers():
    """List all available providers"""
    try:
        providers = ProviderRegistry.list_providers()
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
        data = request.get_json() or {}
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
            
            try:
                receipts = provider.fetch_receipts_via_api(id_token, days=days, client_identifier=client_identifier)
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
                        receipts = provider.fetch_receipts_via_api(
                            new_tokens["idToken"],
                            days=days,
                            client_identifier=client_identifier
                        )
                    except AuthenticationException as refresh_error:
                        logger.error(f"Token refresh failed for user {user_id}: {refresh_error}")
                        return jsonify({
                            "error": f"Token refresh failed: {str(refresh_error)}. Please reconnect your account.",
                            "expired_credentials": True
                        }), 401
                else:
                    raise
            
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


@providers_bp.route("/providers/<provider_name>/test", methods=["POST"])
def test_provider_connection(provider_name):
    """
    Test provider connection with credentials
    
    Body:
        username: Provider username
        password: Provider password
        user_id: User ID (optional, required for MFA)
    """
    try:
        # Handle missing or invalid content-type
        if not request.is_json:
            return jsonify({"error": "Request body must be JSON"}), 400
        
        data = request.get_json(silent=True)
        
        if not data:
            return jsonify({"error": "Request body is required"}), 400
        
        username = data.get("username")
        password = data.get("password")
        user_id = data.get("user_id", "anonymous")  # Default for testing without auth
        
        if not username or not password:
            return jsonify({"error": "username and password are required"}), 400
        
        # Check if provider exists
        if not ProviderRegistry.is_registered(provider_name):
            return jsonify({"error": f"Provider {provider_name} not found"}), 404
        
        # Get provider instance
        headless = current_app.config.get("PLAYWRIGHT_HEADLESS", True)
        timeout = current_app.config.get("PLAYWRIGHT_TIMEOUT", 30000)
        
        provider = ProviderRegistry.get_provider(
            provider_name,
            headless=headless,
            timeout=timeout
        )
        
        # Test login
        credentials = {"username": username, "password": password}
        success = provider.login(credentials)
        
        # Cleanup
        provider.cleanup()
        
        return jsonify({
            "status": "success" if success else "failure",
            "provider": provider_name,
            "message": "Connection successful" if success else "Connection failed"
        }), 200 if success else 401
    
    except MFARequiredException:
        # MFA is required - create login session and return session ID
        logger.info(f"MFA required for {provider_name}")
        
        # Get login session manager
        session_manager = current_app.config.get("LOGIN_SESSION_MANAGER")
        if not session_manager:
            logger.error("Login session manager not available")
            provider.cleanup()
            return jsonify({"error": "MFA support not configured"}), 503
        
        # Create session - wrap in try-except to ensure cleanup on failure
        try:
            session_id = session_manager.create_session(
                user_id=user_id,
                provider=provider_name,
                browser_context=provider.context,
                page=None,  # Don't pass page object to avoid thread issues
                provider_instance=provider
            )
            
            # Get session info for response
            session = session_manager.get_session(session_id)
            
            # Device verification has already been handled during login
            # Update session state to indicate awaiting MFA code
            session_manager.update_session_state(session_id, "awaiting_code")
            logger.info(f"MFA session created for session {session_id}, awaiting code")
            
            return jsonify({
                "status": "mfa_required",
                "session_id": session_id,
                "message": "Multi-factor authentication required",
                "provider": provider_name,
                "expires_at": session["expires_at"].isoformat()
            }), 202
        except Exception as session_err:
            logger.error(f"Failed to create MFA session: {session_err}", exc_info=True)
            provider.cleanup()
            return jsonify({"error": "Failed to initialize MFA session"}), 500
    
    except AuthenticationException as e:
        logger.error(f"Authentication error: {e}")
        return jsonify({
            "status": "failure",
            "error": str(e)
        }), 401
    except ProviderNotFoundException as e:
        logger.error(f"Provider not found: {e}")
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        return jsonify({"error": "Internal server error"}), 500


@providers_bp.route("/providers/<provider_name>/login/<session_id>/status", methods=["GET"])
def get_login_status(provider_name, session_id):
    """
    Get the status of a login session
    
    Returns session state, expiration time, and other metadata
    """
    try:
        # Get login session manager
        session_manager = current_app.config.get("LOGIN_SESSION_MANAGER")
        if not session_manager:
            return jsonify({"error": "Session manager not available"}), 503
        
        # Get session
        session = session_manager.get_session(session_id)
        if not session:
            return jsonify({"error": "Login session not found or expired"}), 404
        
        # Calculate time remaining
        now = datetime.now(timezone.utc)
        time_remaining = int((session["expires_at"] - now).total_seconds())
        
        return jsonify({
            "session_id": session_id,
            "status": session["state"],
            "provider": session["provider"],
            "created_at": session["created_at"].isoformat(),
            "expires_at": session["expires_at"].isoformat(),
            "time_remaining_seconds": max(0, time_remaining),
            "error_message": session.get("error_message")
        }), 200
    
    except Exception as e:
        logger.error(f"Error getting login status: {e}")
        return jsonify({"error": "Internal server error"}), 500


@providers_bp.route("/providers/<provider_name>/login/<session_id>/device-verification", methods=["GET"])
def get_device_verification_options(provider_name: str, session_id: str):
    """
    Get available device verification options for a session.
    """
    try:
        session_manager = current_app.config.get("LOGIN_SESSION_MANAGER")
        if not session_manager:
            return jsonify({"error": "MFA support not configured"}), 503
        
        # Get session
        session = session_manager.get_session(session_id)
        if not session:
            return jsonify({"error": "Session not found"}), 404
        
        # Verify provider name matches
        if session["provider"] != provider_name:
            return jsonify({"error": "Provider mismatch"}), 400
        
        # Get provider instance
        provider = session["provider_instance"]
        if not provider:
            return jsonify({"error": "Provider instance not available"}), 400
        
        # Get device verification options
        try:
            options = provider.get_device_verification_options()
            return jsonify({
                "status": "success",
                "options": options
            }), 200
        except Exception as e:
            logger.error(f"Error getting device verification options: {e}", exc_info=True)
            return jsonify({"error": str(e)}), 400
            
    except Exception as e:
        logger.error(f"Error in get_device_verification_options: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

@providers_bp.route("/providers/<provider_name>/login/<session_id>/device-verification", methods=["POST"])
def select_device_verification_method(provider_name: str, session_id: str):
    """
    Select device verification method for a session.
    """
    try:
        data = request.get_json()
        if not data or "method" not in data:
            return jsonify({"error": "Method is required"}), 400
        
        method = data["method"]
        if method not in ["sms", "email"]:
            return jsonify({"error": "Method must be 'sms' or 'email'"}), 400
        
        session_manager = current_app.config.get("LOGIN_SESSION_MANAGER")
        if not session_manager:
            return jsonify({"error": "MFA support not configured"}), 503
        
        # Get session
        session = session_manager.get_session(session_id)
        if not session:
            return jsonify({"error": "Session not found"}), 404
        
        # Verify provider name matches
        if session["provider"] != provider_name:
            return jsonify({"error": "Provider mismatch"}), 400
        
        # Get provider instance
        provider = session["provider_instance"]
        if not provider:
            return jsonify({"error": "Provider instance not available"}), 400
        
        # Select device verification method
        try:
            success = provider.select_device_verification_method(method)
            
            if success:
                # Update session state to indicate device verification completed
                session_manager.update_session_state(session_id, "awaiting_code")
                return jsonify({
                    "status": "success",
                    "message": f"Device verification method '{method}' selected successfully"
                }), 200
            else:
                return jsonify({
                    "status": "error",
                    "message": "Failed to select device verification method"
                }), 400
                
        except Exception as e:
            logger.error(f"Error selecting device verification method: {e}", exc_info=True)
            session_manager.update_session_state(session_id, "failed", str(e))
            return jsonify({"error": str(e)}), 400
            
    except Exception as e:
        logger.error(f"Error in select_device_verification_method: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

@providers_bp.route("/providers/<provider_name>/login/<session_id>/mfa", methods=["POST"])
def submit_mfa_code(provider_name, session_id):
    """
    Submit MFA code for a login session
    
    Body:
        code: MFA verification code (typically 6 digits)
    """
    try:
        # Validate request
        if not request.is_json:
            return jsonify({"error": "Request body must be JSON"}), 400
        
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"error": "Request body is required"}), 400
        
        code = data.get("code")
        if not code:
            return jsonify({"error": "code is required"}), 400
        
        # Get login session manager
        session_manager = current_app.config.get("LOGIN_SESSION_MANAGER")
        if not session_manager:
            return jsonify({"error": "Session manager not available"}), 503
        
        # Get session
        session = session_manager.get_session(session_id)
        if not session:
            return jsonify({"error": "Login session not found or expired"}), 404
        
        # Check if session is in the right state
        if session["state"] == "expired":
            return jsonify({"error": "Login session has expired"}), 410
        
        if session["state"] == "completed":
            return jsonify({"error": "Login already completed"}), 400
        
        # Get provider instance from session
        provider = session.get("provider_instance")
        if not provider:
            session_manager.update_session_state(session_id, "failed", "Provider instance lost")
            _terminate_session_with_executor_cleanup(session_manager, session_id, session)
            return jsonify({"error": "Login session interrupted"}), 500
        
        # Verify provider name matches
        if session["provider"] != provider_name:
            return jsonify({"error": "Provider mismatch"}), 400
        
        # Process MFA code in the SAME thread pool where the browser was created
        # (Playwright has thread affinity - browser objects must be used from the same thread)
        try:
            # Check retry count
            retry_count = session.get("retry_count", 0)
            max_retries = current_app.config.get("MFA_MAX_RETRY_ATTEMPTS", 3)
            
            if retry_count >= max_retries:
                session_manager.update_session_state(session_id, "failed", "Maximum retry attempts reached")
                _terminate_session_with_executor_cleanup(session_manager, session_id, session)
                return jsonify({
                    "status": "error",
                    "error": "Maximum retry attempts reached",
                    "can_retry": False
                }), 400
            
            # Perform MFA verification in thread pool (same pool where browser was created)
            logger.info(f"Processing MFA code for session {session_id} (attempt {retry_count + 1}/{max_retries})")
            future = _playwright_executor.submit(provider._perform_mfa_verification, code)
            try:
                success = future.result(timeout=60)  # 60 second timeout for MFA verification
            except concurrent.futures.TimeoutError:
                logger.error(f"MFA verification timed out for session {session_id}")
                session_manager.update_session_state(session_id, "failed", "MFA verification timed out")
                _terminate_session_with_executor_cleanup(session_manager, session_id, session)
                return jsonify({
                    "status": "error",
                    "error": "MFA verification timed out",
                    "can_retry": False
                }), 408
            
            if success:
                # MFA successful - mark as completed
                session_manager.update_session_state(session_id, "completed")
                session = session_manager.get_session(session_id)
                # If this was a test connection (no fetch after MFA), terminate immediately
                # to avoid leaking browser resources until cleanup worker runs
                if not session.get("fetch_receipts_after_mfa"):
                    _terminate_session_with_executor_cleanup(session_manager, session_id, session)
                # Otherwise session is left for fetch_receipts_after_mfa to use and terminate

                logger.info(f"MFA verification successful for session {session_id}")
                return jsonify({
                    "status": "success",
                    "message": "Login completed successfully"
                }), 200
            else:
                # MFA failed - increment retry count
                retry_count = session_manager.increment_retry_count(session_id)
                
                if retry_count >= max_retries:
                    session_manager.update_session_state(session_id, "failed", "Maximum retry attempts reached")
                    _terminate_session_with_executor_cleanup(session_manager, session_id, session)
                    return jsonify({
                        "status": "error",
                        "error": "Maximum retry attempts reached",
                        "can_retry": False
                    }), 400
                
                return jsonify({
                    "status": "error",
                    "error": "MFA verification failed",
                    "can_retry": True,
                    "attempts_remaining": max_retries - retry_count
                }), 400
        
        except Exception as e:
            # Unexpected error
            logger.error(f"MFA verification error: {e}", exc_info=True)
            session_manager.update_session_state(session_id, "failed", str(e))
            _terminate_session_with_executor_cleanup(session_manager, session_id, session)
            return jsonify({
                "status": "error",
                "error": f"MFA verification failed: {str(e)}"
            }), 500
    
    except Exception as e:
        logger.error(f"Error submitting MFA code: {e}")
        return jsonify({"error": "Internal server error"}), 500


@providers_bp.route("/providers/<provider_name>/login/<session_id>", methods=["DELETE"])
def cancel_login(provider_name, session_id):
    """
    Cancel a login session and cleanup resources
    """
    try:
        # Get login session manager
        session_manager = current_app.config.get("LOGIN_SESSION_MANAGER")
        if not session_manager:
            return jsonify({"error": "Session manager not available"}), 503
        
        # Get session to verify provider
        session = session_manager.get_session(session_id)
        if not session:
            return jsonify({"error": "Session not found"}), 404
        if session["provider"] != provider_name:
            return jsonify({"error": "Provider mismatch"}), 400
        
        terminated = _terminate_session_with_executor_cleanup(
            session_manager, session_id, session
        )
        if not terminated:
            return jsonify({"error": "Session not found"}), 404
        
        logger.info(f"Login session {session_id} cancelled")
        return "", 204
    
    except Exception as e:
        logger.error(f"Error cancelling login: {e}")
        return jsonify({"error": "Internal server error"}), 500


def _run_provider_login_and_fetch(provider_name, username, password, days, headless, timeout):
    """
    Run provider login and fetch in a separate thread (avoids asyncio conflicts with Playwright)
    
    Returns dict with status and data
    """
    provider = ProviderRegistry.get_provider(
        provider_name,
        headless=headless,
        timeout=timeout
    )
    
    credentials = {"username": username, "password": password}
    try:
        success = provider.login(credentials)
    except MFARequiredException:
        # Return MFA required with provider instance for session creation
        return {"status": "mfa_required", "provider": provider}
    except Exception as e:
        provider.cleanup()
        raise e
    
    if not success:
        provider.cleanup()
        return {"status": "login_failed"}
    
    # Login successful - fetch receipts
    logger.info(f"Login successful, fetching receipts for last {days} days")
    since = datetime.now() - timedelta(days=days)
    
    try:
        receipts = provider.fetch_receipts(since)
        provider.cleanup()
        return {"status": "success", "receipts": receipts, "since": since}
    except Exception as e:
        provider.cleanup()
        raise e


@providers_bp.route("/providers/<provider_name>/fetch-receipts", methods=["POST"])
def fetch_receipts(provider_name):
    """
    Login to provider and fetch receipts (full flow)
    
    Body:
        username: Provider username
        password: Provider password
        days: Number of days to fetch (default 14)
    
    Returns:
        Receipts fetched from provider, or MFA required status
    """
    try:
        # Validate request
        if not request.is_json:
            return jsonify({"error": "Request body must be JSON"}), 400
        
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"error": "Request body is required"}), 400
        
        username = data.get("username")
        password = data.get("password")
        days = data.get("days", 14)
        user_id = data.get("user_id", "anonymous")
        if not username or not password:
            return jsonify({"error": "username and password are required"}), 400
        
        # Check if provider exists
        if not ProviderRegistry.is_registered(provider_name):
            return jsonify({"error": f"Provider {provider_name} not found"}), 404
        
        # Get config
        headless = current_app.config.get("PLAYWRIGHT_HEADLESS", True)
        timeout = current_app.config.get("PLAYWRIGHT_TIMEOUT", 30000)
        
        # Run Playwright operations in a thread to avoid asyncio conflicts
        future = _playwright_executor.submit(
            _run_provider_login_and_fetch,
            provider_name, username, password, days, headless, timeout
        )
        
        try:
            result = future.result(timeout=300)  # 5 minute timeout
        except concurrent.futures.TimeoutError:
            return jsonify({"error": "Operation timed out"}), 504
        except Exception as e:
            logger.error(f"Error in provider thread: {e}", exc_info=True)
            return jsonify({"error": f"Login failed: {str(e)}"}), 500
        
        if result["status"] == "mfa_required":
            # MFA required - create session for MFA flow
            provider = result["provider"]
            logger.info(f"MFA required for {provider_name} fetch-receipts")
            
            session_manager = current_app.config.get("LOGIN_SESSION_MANAGER")
            if not session_manager:
                provider.cleanup()
                return jsonify({"error": "MFA support not configured"}), 503
            
            try:
                session_id = session_manager.create_session(
                    user_id=user_id,
                    provider=provider_name,
                    browser_context=provider.context,
                    page=None,
                    provider_instance=provider
                )
                
                session = session_manager.get_session(session_id)
                session_manager.update_session_state(session_id, "awaiting_code")
                session_manager.update_session_metadata(
                    session_id, fetch_receipts_after_mfa=True, fetch_days=days
                )
                
                return jsonify({
                    "status": "mfa_required",
                    "session_id": session_id,
                    "message": "Complete MFA, then call fetch-receipts-session endpoint",
                    "provider": provider_name,
                    "expires_at": session["expires_at"].isoformat()
                }), 202
            except Exception as e:
                logger.error(f"Failed to create MFA session: {e}")
                provider.cleanup()
                return jsonify({"error": "Failed to initialize MFA session"}), 500
        
        if result["status"] == "login_failed":
            return jsonify({"error": "Login failed"}), 401
        
        # Success - store receipts and process into digital pantry
        if not _is_valid_user_id(user_id):
            return jsonify({"error": "User ID is required to store receipts. Please sign in and try again."}), 400
        receipts = result["receipts"]
        since = result["since"]
        store_result = _store_and_process_fetched_receipts(user_id, provider_name, receipts)
        
        return jsonify({
            "status": "success",
            "provider": provider_name,
            "receipts": receipts,
            "count": len(receipts),
            "since": since.isoformat(),
            "receipts_stored": store_result["receipts_stored"],
            "receipt_ids": store_result["receipt_ids"],
            "items_added_to_pantry": store_result["items_added_to_pantry"],
            "errors": store_result.get("errors", []),
        }), 200
    
    except AuthenticationException as e:
        logger.error(f"Authentication error: {e}")
        return jsonify({"error": str(e)}), 401
    except Exception as e:
        logger.error(f"Unexpected error in fetch-receipts: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500


@providers_bp.route("/providers/<provider_name>/login/<session_id>/fetch-receipts", methods=["POST"])
def fetch_receipts_after_mfa(provider_name, session_id):
    """
    Fetch receipts using an existing MFA-authenticated session
    
    Body:
        days: Number of days to fetch (default 14)
    """
    try:
        data = request.get_json(silent=True) or {}
        
        # Get session manager
        session_manager = current_app.config.get("LOGIN_SESSION_MANAGER")
        if not session_manager:
            return jsonify({"error": "Session manager not available"}), 503
        
        # Get session
        session = session_manager.get_session(session_id)
        if not session:
            return jsonify({"error": "Session not found or expired"}), 404
        
        # Check session state
        if session["state"] != "completed":
            return jsonify({"error": f"Session not ready, state: {session['state']}"}), 400
        
        # Get provider instance
        provider = session.get("provider_instance")
        if not provider:
            return jsonify({"error": "Provider instance not available"}), 400
        
        days = data.get("days") or session.get("fetch_days") or 14
        
        # Fetch receipts and cleanup in same executor task (Playwright must close from creating thread)
        logger.info(f"Fetching receipts for session {session_id}, last {days} days")
        since = datetime.now() - timedelta(days=days)

        def fetch_receipts_then_cleanup():
            try:
                return provider.fetch_receipts(since)
            finally:
                try:
                    provider.cleanup()
                except Exception as e:
                    logger.warning(f"Error during provider cleanup in executor: {e}")

        try:
            future = _playwright_executor.submit(fetch_receipts_then_cleanup)
            try:
                receipts = future.result(timeout=300)  # 5 minute timeout for receipt fetching
            except concurrent.futures.TimeoutError:
                logger.error(f"Receipt fetching timed out for session {session_id}")
                _playwright_executor.submit(provider.cleanup).result(timeout=10)
                session_manager.terminate_session(session_id, skip_browser_cleanup=True)
                return jsonify({"error": "Receipt fetching timed out"}), 408
            except Exception as thread_err:
                try:
                    _playwright_executor.submit(provider.cleanup).result(timeout=10)
                except Exception:
                    pass
                session_manager.terminate_session(session_id, skip_browser_cleanup=True)
                raise thread_err

            # Cleanup already done in executor; only remove session from storage
            session_manager.terminate_session(session_id, skip_browser_cleanup=True)

            # Store receipts and process into digital pantry
            user_id = session.get("user_id", "anonymous")
            if not _is_valid_user_id(user_id):
                return jsonify({
                    "error": "User ID is required to store receipts. Please sign in and try again.",
                    "receipts": receipts,
                    "count": len(receipts),
                }), 400
            store_result = _store_and_process_fetched_receipts(user_id, provider_name, receipts)

            return jsonify({
                "status": "success",
                "provider": provider_name,
                "receipts": receipts,
                "count": len(receipts),
                "since": since.isoformat(),
                "receipts_stored": store_result["receipts_stored"],
                "receipt_ids": store_result["receipt_ids"],
                "items_added_to_pantry": store_result["items_added_to_pantry"],
                "errors": store_result.get("errors", []),
            }), 200
        except Exception as e:
            logger.error(f"Error fetching receipts: {e}", exc_info=True)
            # Cleanup in executor to avoid "Cannot switch to a different thread"
            sess = session_manager.get_session(session_id)
            if sess:
                prov = sess.get("provider_instance")
                if prov:
                    try:
                        _playwright_executor.submit(prov.cleanup).result(timeout=10)
                    except Exception:
                        pass
            session_manager.terminate_session(session_id, skip_browser_cleanup=True)
            return jsonify({"error": f"Failed to fetch receipts: {str(e)}"}), 500
    
    except Exception as e:
        logger.error(f"Unexpected error: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500


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

