"""Provider registry for dynamic provider discovery and instantiation"""

from typing import Dict, Type, Optional
from backend.providers.base_provider import BaseProvider
from backend.utils.exceptions import ProviderNotFoundException
from backend.utils.logger import get_logger

logger = get_logger(__name__)


class ProviderRegistry:
    """Registry for managing provider implementations"""
    
    _providers: Dict[str, Type[BaseProvider]] = {}
    
    @classmethod
    def register(cls, provider_name: str, provider_class: Type[BaseProvider]) -> None:
        """
        Register a provider
        
        Args:
            provider_name: Name of the provider (e.g., 'safeway', 'qfc')
            provider_class: Provider class implementing BaseProvider
        """
        if not issubclass(provider_class, BaseProvider):
            raise ValueError(
                f"Provider {provider_class} must implement BaseProvider interface"
            )
        
        cls._providers[provider_name.lower()] = provider_class
        logger.info(f"Registered provider: {provider_name}")
    
    @classmethod
    def get_provider(cls, provider_name: str, **kwargs) -> BaseProvider:
        """
        Get an instance of a provider
        
        Args:
            provider_name: Name of the provider
            **kwargs: Arguments to pass to provider constructor
        
        Returns:
            Provider instance
        
        Raises:
            ProviderNotFoundException: If provider not found
        """
        provider_class = cls._providers.get(provider_name.lower())
        
        if not provider_class:
            available = ", ".join(cls._providers.keys())
            raise ProviderNotFoundException(
                f"Provider '{provider_name}' not found. Available providers: {available}"
            )
        
        logger.info(f"Creating provider instance: {provider_name}")
        return provider_class(**kwargs)
    
    @classmethod
    def list_providers(cls) -> list[str]:
        """
        List all registered providers
        
        Returns:
            List of provider names
        """
        return list(cls._providers.keys())
    
    @classmethod
    def is_registered(cls, provider_name: str) -> bool:
        """
        Check if a provider is registered
        
        Args:
            provider_name: Name of the provider
        
        Returns:
            True if provider is registered
        """
        return provider_name.lower() in cls._providers


# Decorator for auto-registration
def register_provider(provider_name: str):
    """
    Decorator to automatically register a provider
    
    Usage:
        @register_provider('safeway')
        class SafewayProvider(BaseProvider):
            ...
    """
    def decorator(provider_class: Type[BaseProvider]):
        # Set provider_name as a class attribute for use in browser profiles
        provider_class.provider_name = provider_name
        ProviderRegistry.register(provider_name, provider_class)
        return provider_class
    return decorator

