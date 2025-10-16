"""Configuration management for GrocerySync backend"""

import os
from typing import Optional
from dotenv import load_dotenv
from backend.utils.exceptions import ConfigurationException

# Load environment variables from .env file
load_dotenv()


class Config:
    """Base configuration class"""
    
    # Flask
    FLASK_ENV: str = os.getenv("FLASK_ENV", "development")
    FLASK_SECRET_KEY: str = os.getenv("FLASK_SECRET_KEY", "dev-secret-key-change-in-production")
    FLASK_PORT: int = int(os.getenv("FLASK_PORT", "5000"))
    
    # Supabase
    SUPABASE_URL: Optional[str] = os.getenv("SUPABASE_URL")
    SUPABASE_KEY: Optional[str] = os.getenv("SUPABASE_KEY")
    SUPABASE_SERVICE_ROLE_KEY: Optional[str] = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    
    # AWS Secrets Manager
    AWS_REGION: str = os.getenv("AWS_REGION", "us-west-2")
    AWS_ACCESS_KEY_ID: Optional[str] = os.getenv("AWS_ACCESS_KEY_ID")
    AWS_SECRET_ACCESS_KEY: Optional[str] = os.getenv("AWS_SECRET_ACCESS_KEY")
    
    # Logging
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    
    # Playwright
    PLAYWRIGHT_HEADLESS: bool = os.getenv("PLAYWRIGHT_HEADLESS", "true").lower() == "true"
    PLAYWRIGHT_TIMEOUT: int = int(os.getenv("PLAYWRIGHT_TIMEOUT", "30000"))
    
    # CORS
    CORS_ORIGINS: str = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000")
    
    @classmethod
    def validate(cls) -> None:
        """Validate that required configuration is present"""
        errors = []
        
        # Only validate Supabase in production
        if cls.FLASK_ENV == "production":
            if not cls.SUPABASE_URL:
                errors.append("SUPABASE_URL is required in production")
            if not cls.SUPABASE_KEY:
                errors.append("SUPABASE_KEY is required in production")
            if not cls.SUPABASE_SERVICE_ROLE_KEY:
                errors.append("SUPABASE_SERVICE_ROLE_KEY is required in production")
        
        if errors:
            raise ConfigurationException(
                f"Configuration validation failed: {'; '.join(errors)}"
            )
    
    @classmethod
    def get_cors_origins(cls) -> list[str]:
        """Get CORS origins as a list"""
        return [origin.strip() for origin in cls.CORS_ORIGINS.split(",")]


class DevelopmentConfig(Config):
    """Development configuration"""
    DEBUG = True


class ProductionConfig(Config):
    """Production configuration"""
    DEBUG = False
    
    @classmethod
    def validate(cls) -> None:
        """Additional production validation"""
        super().validate()
        
        if cls.FLASK_SECRET_KEY == "dev-secret-key-change-in-production":
            raise ConfigurationException(
                "FLASK_SECRET_KEY must be changed in production"
            )


def get_config() -> Config:
    """Get configuration based on environment"""
    env = os.getenv("FLASK_ENV", "development")
    
    if env == "production":
        config = ProductionConfig()
    else:
        config = DevelopmentConfig()
    
    config.validate()
    return config

