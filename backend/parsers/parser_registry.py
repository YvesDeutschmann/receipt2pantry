"""Parser registry for dynamic parser discovery and instantiation"""

from typing import Dict, Type, Optional
from backend.parsers.base_parser import BaseParser
from backend.utils.exceptions import GrocerySyncException
from backend.utils.logger import get_logger

logger = get_logger(__name__)


class ParserNotFoundException(GrocerySyncException):
    """Exception raised when a parser is not found in registry"""
    pass


class ParserRegistry:
    """Registry for managing parser implementations"""
    
    _parsers: Dict[str, Type[BaseParser]] = {}
    
    @classmethod
    def register(cls, parser_name: str, parser_class: Type[BaseParser]) -> None:
        """
        Register a parser
        
        Args:
            parser_name: Name of the parser (e.g., 'safeway', 'qfc')
            parser_class: Parser class implementing BaseParser
        """
        if not issubclass(parser_class, BaseParser):
            raise ValueError(
                f"Parser {parser_class} must implement BaseParser interface"
            )
        
        cls._parsers[parser_name.lower()] = parser_class
        logger.info(f"Registered parser: {parser_name}")
    
    @classmethod
    def get_parser(cls, parser_name: str, **kwargs) -> BaseParser:
        """
        Get an instance of a parser
        
        Args:
            parser_name: Name of the parser
            **kwargs: Arguments to pass to parser constructor
        
        Returns:
            Parser instance
        
        Raises:
            ParserNotFoundException: If parser not found
        """
        parser_class = cls._parsers.get(parser_name.lower())
        
        if not parser_class:
            available = ", ".join(cls._parsers.keys())
            raise ParserNotFoundException(
                f"Parser '{parser_name}' not found. Available parsers: {available}"
            )
        
        logger.info(f"Creating parser instance: {parser_name}")
        return parser_class(**kwargs)
    
    @classmethod
    def list_parsers(cls) -> list[str]:
        """
        List all registered parsers
        
        Returns:
            List of parser names
        """
        return list(cls._parsers.keys())
    
    @classmethod
    def is_registered(cls, parser_name: str) -> bool:
        """
        Check if a parser is registered
        
        Args:
            parser_name: Name of the parser
        
        Returns:
            True if parser is registered
        """
        return parser_name.lower() in cls._parsers


# Decorator for auto-registration
def register_parser(parser_name: str):
    """
    Decorator to automatically register a parser
    
    Usage:
        @register_parser('safeway')
        class SafewayParser(BaseParser):
            ...
    """
    def decorator(parser_class: Type[BaseParser]):
        ParserRegistry.register(parser_name, parser_class)
        return parser_class
    return decorator

