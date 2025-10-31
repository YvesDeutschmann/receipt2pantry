"""Provider management endpoints"""

from datetime import datetime, timezone
from flask import Blueprint, jsonify, request, current_app
from backend.providers.provider_registry import ProviderRegistry
from backend.utils.logger import get_logger
from backend.utils.exceptions import ProviderNotFoundException, AuthenticationException, MFARequiredException

logger = get_logger(__name__)
providers_bp = Blueprint("providers", __name__)


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
            session_manager.terminate_session(session_id)
            return jsonify({"error": "Login session interrupted"}), 500
        
        # Verify provider name matches
        if session["provider"] != provider_name:
            return jsonify({"error": "Provider mismatch"}), 400
        
        # Process MFA code synchronously on the main thread (required for Playwright)
        try:
            # Check retry count
            retry_count = session.get("retry_count", 0)
            max_retries = current_app.config.get("MFA_MAX_RETRY_ATTEMPTS", 3)
            
            if retry_count >= max_retries:
                session_manager.update_session_state(session_id, "failed", "Maximum retry attempts reached")
                session_manager.terminate_session(session_id)
                return jsonify({
                    "status": "error",
                    "error": "Maximum retry attempts reached",
                    "can_retry": False
                }), 400
            
            # Perform MFA verification using the provider (on main thread where browser exists)
            logger.info(f"Processing MFA code for session {session_id} (attempt {retry_count + 1}/{max_retries})")
            success = provider._perform_mfa_verification(code)
            
            if success:
                # MFA successful
                session_manager.update_session_state(session_id, "completed")
                session_manager.terminate_session(session_id)
                
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
                    session_manager.terminate_session(session_id)
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
            session_manager.terminate_session(session_id)
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
        if session and session["provider"] != provider_name:
            return jsonify({"error": "Provider mismatch"}), 400
        
        # Terminate session
        terminated = session_manager.terminate_session(session_id)
        
        if not terminated:
            return jsonify({"error": "Session not found"}), 404
        
        logger.info(f"Login session {session_id} cancelled")
        return "", 204
    
    except Exception as e:
        logger.error(f"Error cancelling login: {e}")
        return jsonify({"error": "Internal server error"}), 500

