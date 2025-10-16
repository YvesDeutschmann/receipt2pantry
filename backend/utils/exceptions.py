"""Custom exception classes for GrocerySync"""


class GrocerySyncException(Exception):
    """Base exception for all GrocerySync errors"""
    pass


class ProviderException(GrocerySyncException):
    """Exception for provider-related errors"""
    pass


class AuthenticationException(ProviderException):
    """Exception for authentication failures"""
    pass


class MFARequiredException(AuthenticationException):
    """Exception raised when MFA is required but not provided"""
    pass


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

