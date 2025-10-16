"""Provider management endpoints"""

from flask import Blueprint, jsonify, request, current_app
from backend.providers.provider_registry import ProviderRegistry
from backend.utils.logger import get_logger
from backend.utils.exceptions import ProviderNotFoundException, AuthenticationException

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

