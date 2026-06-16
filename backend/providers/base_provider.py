"""Abstract base class for grocery providers"""

from abc import ABC, abstractmethod


class BaseProvider(ABC):
    """Abstract base class defining the provider interface"""

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """
        Get the provider name

        Returns:
            Provider name (e.g., 'safeway', 'qfc', 'costco')
        """
        pass

    def cleanup(self) -> None:
        """Cleanup resources (browser, sessions, etc.)"""
        pass
