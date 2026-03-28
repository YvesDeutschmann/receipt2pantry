"""Configuration management for Meald backend"""

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
    
    # Supabase (supports both legacy anon/service_role keys and new publishable/secret keys)
    # Prefer new key names only when old key is not in environment (avoid masking empty-string config)
    SUPABASE_URL: Optional[str] = os.getenv("SUPABASE_URL")
    _supabase_key = os.getenv("SUPABASE_KEY")
    SUPABASE_KEY: Optional[str] = _supabase_key if _supabase_key is not None else os.getenv("SUPABASE_PUBLIC_KEY")
    _service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    SUPABASE_SERVICE_ROLE_KEY: Optional[str] = _service_role_key if _service_role_key is not None else os.getenv("SUPABASE_SECRET_KEY")
    
    # AWS Secrets Manager
    AWS_REGION: str = os.getenv("AWS_REGION", "us-west-2")
    AWS_ACCESS_KEY_ID: Optional[str] = os.getenv("AWS_ACCESS_KEY_ID")
    AWS_SECRET_ACCESS_KEY: Optional[str] = os.getenv("AWS_SECRET_ACCESS_KEY")
    
    # Logging
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    
    # Playwright
    PLAYWRIGHT_HEADLESS: bool = os.getenv("PLAYWRIGHT_HEADLESS", "true").lower() == "true"
    PLAYWRIGHT_TIMEOUT: int = int(os.getenv("PLAYWRIGHT_TIMEOUT", "30000"))
    
    # MFA Settings
    MFA_SESSION_TIMEOUT: int = int(os.getenv("MFA_SESSION_TIMEOUT", "300"))  # 5 minutes
    SESSION_CLEANUP_INTERVAL: int = int(os.getenv("SESSION_CLEANUP_INTERVAL", "60"))  # 1 minute
    MFA_MAX_RETRY_ATTEMPTS: int = int(os.getenv("MFA_MAX_RETRY_ATTEMPTS", "3"))
    
    # CORS
    CORS_ORIGINS: str = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000")
    
    # OpenAI
    OPENAI_API_KEY: Optional[str] = os.getenv("OPENAI_API_KEY")
    OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    OPENAI_BATCH_SIZE: int = int(os.getenv("OPENAI_BATCH_SIZE", "20"))
    OPENAI_MAX_RETRIES: int = int(os.getenv("OPENAI_MAX_RETRIES", "3"))
    OPENAI_TIMEOUT: int = int(os.getenv("OPENAI_TIMEOUT", "60"))
    WHISPER_MODEL: str = os.getenv("WHISPER_MODEL", "whisper-1")
    
    # Google Gemini
    GEMINI_API_KEY: Optional[str] = os.getenv("GEMINI_API_KEY")
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
    COSTCO_AI_MODEL: str = os.getenv("COSTCO_AI_MODEL", "auto")  # openai, gemini, or auto
    
    # Costco Contentstack (read-only CMS verification)
    CONTENTSTACK_ACCESS_TOKEN: Optional[str] = os.getenv("CONTENTSTACK_ACCESS_TOKEN")

    # Spoonacular
    SPOONACULAR_API_KEY: Optional[str] = os.getenv("SPOONACULAR_API_KEY")
    SPOONACULAR_BASE_URL: str = os.getenv("SPOONACULAR_BASE_URL", "https://api.spoonacular.com")
    SPOONACULAR_TIMEOUT: int = int(os.getenv("SPOONACULAR_TIMEOUT", "30"))
    
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

