"""Configuration management for Meald backend"""

import os
import re
from typing import Optional
from urllib.parse import urlparse
from dotenv import load_dotenv
from backend.utils.exceptions import ConfigurationException

# Load environment variables from .env file
load_dotenv()

# Capacitor / Ionic WebView origins are production-safe despite containing "localhost".
_CAPACITOR_SAFE_ORIGINS = frozenset({"capacitor://localhost", "ionic://localhost"})

# Private IPv4 ranges (RFC1918) for production CORS guard.
_PRIVATE_LAN_RE = re.compile(
    r"^(?:"
    r"192\.168\.\d{1,3}\.\d{1,3}"
    r"|10\.\d{1,3}\.\d{1,3}\.\d{1,3}"
    r"|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}"
    r")$"
)


def is_unsafe_production_cors_origin(origin: str) -> bool:
    """Return True if origin must not appear in production CORS_ORIGINS."""
    origin = origin.strip()
    if not origin:
        return True
    if origin in _CAPACITOR_SAFE_ORIGINS:
        return False

    parsed = urlparse(origin)
    scheme = (parsed.scheme or "").lower()
    host = (parsed.hostname or "").lower()

    if scheme in ("http", "https"):
        if host in ("localhost", "127.0.0.1", "::1"):
            return True
        if host and _PRIVATE_LAN_RE.match(host):
            return True

    return False


class Config:
    """Base configuration class"""
    
    # Flask
    FLASK_ENV: str = os.getenv("FLASK_ENV", "development")
    # Unused today: not mapped to Flask's SECRET_KEY, and auth uses Supabase JWTs
    # (backend/utils/auth.py), not flask.session. Kept for ProductionConfig hygiene /
    # future cookie sessions; empty or any non-default value is fine.
    FLASK_SECRET_KEY: str = os.getenv("FLASK_SECRET_KEY", "dev-secret-key-change-in-production")
    FLASK_PORT: int = int(os.getenv("FLASK_PORT", "5000"))
    
    # Supabase (supports both legacy anon/service_role keys and new publishable/secret keys)
    # Prefer new key names only when old key is not in environment (avoid masking empty-string config)
    SUPABASE_URL: Optional[str] = os.getenv("SUPABASE_URL")
    _supabase_key = os.getenv("SUPABASE_KEY")
    SUPABASE_KEY: Optional[str] = _supabase_key if _supabase_key is not None else os.getenv("SUPABASE_PUBLIC_KEY")
    _service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    SUPABASE_SERVICE_ROLE_KEY: Optional[str] = _service_role_key if _service_role_key is not None else os.getenv("SUPABASE_SECRET_KEY")
    
    # Logging
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")

    # Monitoring (GlitchTip / Sentry-wire-compatible)
    SENTRY_DSN: Optional[str] = os.getenv("SENTRY_DSN")
    SENTRY_ENVIRONMENT: str = os.getenv("SENTRY_ENVIRONMENT") or os.getenv("FLASK_ENV", "development")
    SENTRY_TRACES_SAMPLE_RATE: float = float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.05"))
    SENTRY_RELEASE: Optional[str] = os.getenv("SENTRY_RELEASE")
    
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
    SPOONACULAR_CALL_BUDGET: int = int(os.getenv("SPOONACULAR_CALL_BUDGET", "500"))
    SPOONACULAR_CALL_BUDGET_PERIOD_SECONDS: int = int(
        os.getenv("SPOONACULAR_CALL_BUDGET_PERIOD_SECONDS", "3600")
    )

    # Feature flags (default off; set to 1 or true to enable)
    FEATURE_MEAL_PLANNER: bool = os.getenv("FEATURE_MEAL_PLANNER", "0") in ("1", "true", "True")
    DEV_LOG_ENABLED: bool = os.getenv("DEV_LOG_ENABLED", "0") in ("1", "true", "True")
    
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
        """Get CORS origins as a list (reads CORS_ORIGINS from env at call time)."""
        raw = os.getenv("CORS_ORIGINS")
        if raw is None:
            raw = cls.CORS_ORIGINS
        return [origin.strip() for origin in raw.split(",") if origin.strip()]


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

        if not os.getenv("SUPABASE_JWT_SECRET"):
            raise ConfigurationException(
                "SUPABASE_JWT_SECRET is required in production"
            )

        unsafe_origins = [
            origin for origin in cls.get_cors_origins()
            if is_unsafe_production_cors_origin(origin)
        ]
        if unsafe_origins:
            raise ConfigurationException(
                "CORS_ORIGINS must not include localhost or LAN origins in production "
                f"(unsafe: {', '.join(unsafe_origins)})"
            )

        if not os.getenv("SENTRY_DSN"):
            raise ConfigurationException(
                "SENTRY_DSN is required in production (GlitchTip or Sentry-compatible DSN)"
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

