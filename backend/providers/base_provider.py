"""Abstract base class for grocery providers"""

from abc import ABC, abstractmethod
from typing import Dict, List
from datetime import datetime


class BaseProvider(ABC):
    """Abstract base class defining the provider interface"""
    
    @abstractmethod
    def login(self, credentials: Dict) -> bool:
        """
        Login to the provider portal
        
        Args:
            credentials: Dictionary containing login credentials
                         (e.g., {'username': 'user@example.com', 'password': 'pass'})
        
        Returns:
            True if login successful, False otherwise
        
        Raises:
            AuthenticationException: If authentication fails
            MFARequiredException: If MFA is required
        """
        pass
    
    @abstractmethod
    def fetch_receipts(self, since: datetime) -> List[Dict]:
        """
        Fetch receipts from the provider since a given date
        
        Args:
            since: Fetch receipts from this date onwards
        
        Returns:
            List of receipt dictionaries with raw data
        
        Raises:
            ProviderException: If fetching fails
        """
        pass
    
    @abstractmethod
    def handle_mfa(self, mfa_code: str) -> bool:
        """
        Handle multi-factor authentication
        
        Args:
            mfa_code: MFA code from user
        
        Returns:
            True if MFA verification successful
        
        Raises:
            AuthenticationException: If MFA verification fails
        """
        pass
    
    @property
    @abstractmethod
    def provider_name(self) -> str:
        """
        Get the provider name
        
        Returns:
            Provider name (e.g., 'safeway', 'qfc', 'costco')
        """
        pass
    
    @abstractmethod
    def cleanup(self) -> None:
        """
        Cleanup resources (browser, sessions, etc.)
        """
        pass

