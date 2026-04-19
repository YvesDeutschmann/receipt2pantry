"""Custom exception classes for Meald"""

from typing import Any, Dict, Optional


class GrocerySyncException(Exception):
    """Base exception for all Meald errors"""
    pass


class ProviderException(GrocerySyncException):
    """Exception for provider-related errors"""
    pass


class AuthenticationException(ProviderException):
    """Exception for authentication failures"""
    pass


class MFARequiredException(AuthenticationException):
    """Exception raised when MFA is required but not provided."""

    def __init__(
        self,
        message: str,
        *,
        session_id: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(message)
        self.session_id = session_id
        self.options = options


class ParserException(GrocerySyncException):
    """Exception for receipt parsing errors"""
    pass


class ConfigurationException(GrocerySyncException):
    """Exception for configuration errors"""
    pass


class DatabaseException(GrocerySyncException):
    """Exception for database operation errors"""
    pass


class SecretsNotFoundException(GrocerySyncException):
    """Exception raised when secrets are not found"""
    pass


class ProviderNotFoundException(GrocerySyncException):
    """Exception raised when a provider is not found in registry"""
    pass


class AIServiceException(GrocerySyncException):
    """Exception for AI service errors (OpenAI, etc.)"""
    pass


class AIRateLimitException(AIServiceException):
    """Exception raised when AI API rate limit is exceeded"""
    pass


class ValidationException(GrocerySyncException):
    """Exception raised when input validation fails"""
    pass


class AuthorizationException(GrocerySyncException):
    """Exception raised when user is not authorized for an action"""
    pass
