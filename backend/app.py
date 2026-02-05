"""Flask application factory"""

import os
from flask import Flask, send_file
from flask_cors import CORS
from backend.config import get_config
from backend.utils.logger import setup_logger, get_logger
from backend.utils.exceptions import GrocerySyncException

    # Import routes
from backend.routes.health import health_bp
from backend.routes.receipts import receipts_bp
from backend.routes.providers import providers_bp
from backend.routes.parsers import parsers_bp
from backend.routes.households import households_bp
from backend.routes.pantry import pantry_bp
from backend.routes.recipes import recipes_bp
from backend.routes.meal_plan import meal_plan_bp


def create_app(config=None):
    """
    Flask application factory
    
    Args:
        config: Configuration object (optional, uses get_config() if not provided)
    
    Returns:
        Configured Flask application
    """
    app = Flask(__name__)
    
    # Load configuration
    if config is None:
        config = get_config()
    
    app.config.from_object(config)
    
    # Setup logging
    log_level = config.LOG_LEVEL
    logger = setup_logger("grocerysync", log_level)
    logger.info("Starting GrocerySync backend")
    
    # Setup CORS
    cors_origins = config.get_cors_origins()
    CORS(app, resources={r"/api/*": {"origins": cors_origins}})
    logger.info(f"CORS enabled for origins: {cors_origins}")
    
    # Initialize AI service if configured (do this first so other services can use it)
    ai_service = None
    if config.OPENAI_API_KEY:
        try:
            from backend.services.ai_service import create_ai_service
            ai_service = create_ai_service(config)
            app.config["AI_SERVICE"] = ai_service
            logger.info("AI service initialized")
        except Exception as e:
            logger.warning(f"Failed to initialize AI service: {e}")
    else:
        logger.info("OpenAI not configured (AI features disabled)")
    
    # Initialize services (only if in production or explicitly configured)
    if config.SUPABASE_URL and config.SUPABASE_KEY:
        try:
            from backend.services.supabase_service import create_supabase_service
            from backend.services.pantry_service import create_pantry_service
            from backend.services.normalization_service import create_normalization_service
            from backend.services.receipt_processor import create_receipt_processor
            from backend.services.household_service import create_household_service
            
            # Initialize Supabase service
            supabase_service = create_supabase_service(
                config.SUPABASE_URL,
                config.SUPABASE_KEY,
                config.SUPABASE_SERVICE_ROLE_KEY
            )
            app.config["SUPABASE_SERVICE"] = supabase_service
            logger.info("Supabase service initialized")
            
            # Initialize household service
            household_service = create_household_service(supabase_service)
            app.config["HOUSEHOLD_SERVICE"] = household_service
            logger.info("Household service initialized")
            
            # Initialize pantry management services
            pantry_service = create_pantry_service(supabase_service)
            app.config["PANTRY_SERVICE"] = pantry_service
            logger.info("Pantry service initialized")
            
            # Initialize recipe service (requires pantry service)
            recipe_service = None
            if config.SPOONACULAR_API_KEY:
                try:
                    from backend.services.recipe_service import create_recipe_service
                    recipe_service = create_recipe_service(pantry_service, config)
                    app.config["RECIPE_SERVICE"] = recipe_service
                    logger.info("Recipe service initialized")
                except Exception as e:
                    logger.warning(f"Failed to initialize Recipe service: {e}")
            else:
                logger.info("Spoonacular API key not configured (Recipe features disabled)")
            
            # Initialize meal plan service (requires pantry, recipe, and household services)
            if recipe_service:
                try:
                    from backend.services.meal_plan_service import create_meal_plan_service
                    from backend.services.shopping_list_service import create_shopping_list_service
                    
                    meal_plan_service = create_meal_plan_service(
                        supabase_service, pantry_service, recipe_service, household_service
                    )
                    app.config["MEAL_PLAN_SERVICE"] = meal_plan_service
                    logger.info("Meal plan service initialized")
                    
                    shopping_list_service = create_shopping_list_service(supabase_service)
                    app.config["SHOPPING_LIST_SERVICE"] = shopping_list_service
                    logger.info("Shopping list service initialized")
                except Exception as e:
                    logger.warning(f"Failed to initialize Meal plan services: {e}")
            else:
                logger.info("Meal plan features disabled (Recipe service required)")
            
            # Initialize normalization service with AI if available
            normalization_service = create_normalization_service(supabase_service, ai_service)
            app.config["NORMALIZATION_SERVICE"] = normalization_service
            logger.info("Normalization service initialized" + (" with AI" if ai_service else ""))
            
            receipt_processor = create_receipt_processor(
                supabase_service,
                normalization_service,
                pantry_service
            )
            app.config["RECEIPT_PROCESSOR"] = receipt_processor
            logger.info("Receipt processor initialized")
            
        except Exception as e:
            logger.warning(f"Failed to initialize Supabase services: {e}")
    else:
        logger.info("Supabase not configured (development mode)")
    
    # Initialize secrets service
    if config.AWS_ACCESS_KEY_ID and config.AWS_SECRET_ACCESS_KEY:
        try:
            from backend.services.secrets_service import create_secrets_service
            secrets_service = create_secrets_service(
                use_mock=False,
                region=config.AWS_REGION,
                access_key_id=config.AWS_ACCESS_KEY_ID,
                secret_access_key=config.AWS_SECRET_ACCESS_KEY
            )
            app.config["SECRETS_SERVICE"] = secrets_service
            logger.info("AWS Secrets Manager initialized")
        except Exception as e:
            logger.warning(f"Failed to initialize Secrets Manager: {e}")
            # Fallback to Supabase Vault if available, otherwise mock
            supabase_service = app.config.get("SUPABASE_SERVICE")
            if supabase_service and supabase_service.admin_client:
                from backend.services.secrets_service import SupabaseVaultService
                secrets_service = SupabaseVaultService(supabase_service.admin_client)
                app.config["SECRETS_SERVICE"] = secrets_service
                logger.info("Using Supabase Vault Service")
            else:
                from backend.services.secrets_service import create_secrets_service
                secrets_service = create_secrets_service(use_mock=True)
                app.config["SECRETS_SERVICE"] = secrets_service
                logger.info("Using mock Secrets Service")
    else:
        # Use Supabase Vault if available, otherwise mock service
        supabase_service = app.config.get("SUPABASE_SERVICE")
        if supabase_service and supabase_service.admin_client:
            from backend.services.secrets_service import SupabaseVaultService
            secrets_service = SupabaseVaultService(supabase_service.admin_client)
            app.config["SECRETS_SERVICE"] = secrets_service
            logger.info("Using Supabase Vault Service (development mode)")
        else:
            from backend.services.secrets_service import create_secrets_service
            secrets_service = create_secrets_service(use_mock=True)
            app.config["SECRETS_SERVICE"] = secrets_service
            logger.info("Using mock Secrets Service (development mode)")
    
    # Initialize Login Session Manager for MFA flows
    from backend.services.login_session_manager import LoginSessionManager
    session_manager = LoginSessionManager(default_timeout=config.MFA_SESSION_TIMEOUT)
    app.config["LOGIN_SESSION_MANAGER"] = session_manager
    logger.info("Login session manager initialized")
    
    # Start session cleanup worker
    from backend.workers.session_cleanup import SessionCleanupWorker
    cleanup_worker = SessionCleanupWorker(
        session_manager=session_manager,
        cleanup_interval=config.SESSION_CLEANUP_INTERVAL
    )
    cleanup_worker.start()
    app.config["SESSION_CLEANUP_WORKER"] = cleanup_worker
    logger.info("Session cleanup worker started")
    
    # Store config values
    app.config["PLAYWRIGHT_HEADLESS"] = config.PLAYWRIGHT_HEADLESS
    app.config["PLAYWRIGHT_TIMEOUT"] = config.PLAYWRIGHT_TIMEOUT
    app.config["MFA_SESSION_TIMEOUT"] = config.MFA_SESSION_TIMEOUT
    app.config["MFA_MAX_RETRY_ATTEMPTS"] = config.MFA_MAX_RETRY_ATTEMPTS
    
    # Import providers and parsers to register them
    # This ensures @register_provider and @register_parser decorators are executed
    from backend.providers import safeway_provider  # noqa: F401
    from backend.providers import costco_provider  # noqa: F401
    from backend.parsers import safeway_parser  # noqa: F401
    from backend.parsers import costco_parser  # noqa: F401
    from backend.parsers import ai_parser  # noqa: F401
    
    # Register blueprints
    app.register_blueprint(health_bp, url_prefix="/api")
    app.register_blueprint(receipts_bp, url_prefix="/api")
    app.register_blueprint(providers_bp, url_prefix="/api")
    app.register_blueprint(parsers_bp, url_prefix="/api")
    app.register_blueprint(households_bp, url_prefix="/api")
    app.register_blueprint(pantry_bp, url_prefix="/api")
    app.register_blueprint(recipes_bp, url_prefix="/api")
    app.register_blueprint(meal_plan_bp, url_prefix="/api")
    
    # Register static HTML routes for token submitter
    register_static_routes(app)
    
    logger.info("Routes registered")
    
    # Register error handlers
    register_error_handlers(app)
    
    logger.info("GrocerySync backend initialized successfully")
    return app


def register_static_routes(app):
    """Register routes for serving static HTML pages"""
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    
    @app.route("/token-submitter")
    def token_submitter():
        """Serve the token submitter page"""
        return send_file(os.path.join(backend_dir, "token_submitter.html"))
    
    @app.route("/connection-monitor")
    def connection_monitor():
        """Serve the connection monitor page"""
        return send_file(os.path.join(backend_dir, "connection_monitor.html"))


def register_error_handlers(app):
    """Register error handlers for the application"""
    logger = get_logger(__name__)
    
    @app.errorhandler(GrocerySyncException)
    def handle_grocerysync_exception(e):
        """Handle custom GrocerySync exceptions"""
        logger.error(f"GrocerySync exception: {e}")
        return {"error": str(e)}, 500
    
    @app.errorhandler(404)
    def handle_not_found(e):
        """Handle 404 errors"""
        return {"error": "Resource not found"}, 404
    
    @app.errorhandler(500)
    def handle_internal_error(e):
        """Handle 500 errors"""
        logger.error(f"Internal server error: {e}")
        return {"error": "Internal server error"}, 500


def main():
    """Main entry point for running the Flask app"""
    config = get_config()
    app = create_app(config)
    
    logger = get_logger(__name__)
    logger.info(f"Starting Flask server on port {config.FLASK_PORT}")
    
    try:
        app.run(
            host="0.0.0.0",
            port=config.FLASK_PORT,
            debug=config.DEBUG,
            threaded=True,  # Enable threading for concurrent requests
            use_reloader=False  # Disable reloader to prevent double initialization
        )
    finally:
        # Cleanup on shutdown
        cleanup_worker = app.config.get("SESSION_CLEANUP_WORKER")
        if cleanup_worker:
            logger.info("Stopping session cleanup worker...")
            cleanup_worker.stop()
        
        # Cleanup any remaining sessions
        session_manager = app.config.get("LOGIN_SESSION_MANAGER")
        if session_manager:
            logger.info("Cleaning up remaining login sessions...")
            session_manager.cleanup_expired_sessions()


if __name__ == "__main__":
    main()

