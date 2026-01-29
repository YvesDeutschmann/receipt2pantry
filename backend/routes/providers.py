"""Provider management endpoints"""

import concurrent.futures
import uuid
from datetime import datetime, timezone, timedelta
from flask import Blueprint, jsonify, request, current_app
from backend.providers.provider_registry import ProviderRegistry
from backend.services.receipt_service import store_fetched_receipts
from backend.utils.logger import get_logger
from backend.utils.exceptions import ProviderNotFoundException, AuthenticationException, MFARequiredException

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

