"""Flask application factory"""

from flask import Flask
from flask_cors import CORS
from backend.config import get_config
from backend.utils.logger import setup_logger, get_logger
from backend.utils.exceptions import GrocerySyncException

# Import routes
from backend.routes.health import health_bp
from backend.routes.receipts import receipts_bp
from backend.routes.providers import providers_bp


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
    
    # Initialize services (only if in production or explicitly configured)
    if config.SUPABASE_URL and config.SUPABASE_KEY:
        try:
            from backend.services.supabase_service import create_supabase_service
            supabase_service = create_supabase_service(
                config.SUPABASE_URL,
                config.SUPABASE_KEY,
                config.SUPABASE_SERVICE_ROLE_KEY
            )
            app.config["SUPABASE_SERVICE"] = supabase_service
            logger.info("Supabase service initialized")
        except Exception as e:
            logger.warning(f"Failed to initialize Supabase: {e}")
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
            # Fallback to mock
            from backend.services.secrets_service import create_secrets_service
            secrets_service = create_secrets_service(use_mock=True)
            app.config["SECRETS_SERVICE"] = secrets_service
            logger.info("Using mock Secrets Service")
    else:
        # Use mock service for development
        from backend.services.secrets_service import create_secrets_service
        secrets_service = create_secrets_service(use_mock=True)
        app.config["SECRETS_SERVICE"] = secrets_service
        logger.info("Using mock Secrets Service (development mode)")
    
    # Store config values
    app.config["PLAYWRIGHT_HEADLESS"] = config.PLAYWRIGHT_HEADLESS
    app.config["PLAYWRIGHT_TIMEOUT"] = config.PLAYWRIGHT_TIMEOUT
    
    # Import providers to register them
    # This ensures @register_provider decorators are executed
    from backend.providers import safeway_provider  # noqa: F401
    
    # Register blueprints
    app.register_blueprint(health_bp, url_prefix="/api")
    app.register_blueprint(receipts_bp, url_prefix="/api")
    app.register_blueprint(providers_bp, url_prefix="/api")
    logger.info("Routes registered")
    
    # Register error handlers
    register_error_handlers(app)
    
    logger.info("GrocerySync backend initialized successfully")
    return app


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
    
    app.run(
        host="0.0.0.0",
        port=config.FLASK_PORT,
        debug=config.DEBUG
    )


if __name__ == "__main__":
    main()

