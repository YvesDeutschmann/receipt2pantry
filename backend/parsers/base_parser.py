"""Abstract base class for receipt parsers"""

from abc import ABC, abstractmethod
from typing import Dict, List


class BaseParser(ABC):
    """Abstract base class for parsing receipts"""
    
    @abstractmethod
    def parse(self, raw_data: str) -> Dict:
        """
        Parse raw receipt data into structured format
        
        Args:
            raw_data: Raw receipt data (email content, HTML, JSON, etc.)
        
        Returns:
            Dictionary containing parsed receipt data with structure:
            {
                'order_id': str,
                'order_date': str (ISO format),
                'total_amount': float,
                'items': List[Dict],
                'metadata': Dict
            }
        
        Raises:
            ParserException: If parsing fails
        """
        pass
    
    @abstractmethod
    def validate(self, parsed_data: Dict) -> bool:
        """
        Validate parsed receipt data
        
        Args:
            parsed_data: Parsed receipt dictionary
        
        Returns:
            True if valid, False otherwise
        """
        pass
    
    @property
    @abstractmethod
    def parser_name(self) -> str:
        """
        Get the parser name
        
        Returns:
            Parser name (e.g., 'safeway', 'qfc')
        """
        pass

