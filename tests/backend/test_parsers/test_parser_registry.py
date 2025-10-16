"""Tests for parser registry"""

import pytest
from backend.parsers.parser_registry import ParserRegistry, ParserNotFoundException, register_parser
from backend.parsers.base_parser import BaseParser


def test_parser_registry_has_safeway():
    """Test that Safeway parser is registered"""
    assert ParserRegistry.is_registered("safeway")
    assert "safeway" in ParserRegistry.list_parsers()


def test_get_parser_safeway():
    """Test getting Safeway parser from registry"""
    parser = ParserRegistry.get_parser("safeway")
    assert parser is not None
    assert parser.parser_name == "safeway"


def test_get_parser_not_found():
    """Test getting non-existent parser raises exception"""
    with pytest.raises(ParserNotFoundException) as exc_info:
        ParserRegistry.get_parser("nonexistent")
    
    assert "nonexistent" in str(exc_info.value)
    assert "not found" in str(exc_info.value).lower()


def test_list_parsers():
    """Test listing all registered parsers"""
    parsers = ParserRegistry.list_parsers()
    assert isinstance(parsers, list)
    assert len(parsers) >= 1  # At least safeway should be registered
    assert "safeway" in parsers


def test_register_parser_decorator():
    """Test that register_parser decorator works"""
    
    @register_parser("test_parser")
    class TestParser(BaseParser):
        @property
        def parser_name(self):
            return "test_parser"
        
        def parse(self, raw_data):
            return {"test": "data"}
        
        def validate(self, parsed_data):
            return True
    
    # Should be registered
    assert ParserRegistry.is_registered("test_parser")
    
    # Should be able to get instance
    parser = ParserRegistry.get_parser("test_parser")
    assert parser.parser_name == "test_parser"
    
    # Cleanup
    if "test_parser" in ParserRegistry._parsers:
        del ParserRegistry._parsers["test_parser"]


def test_register_invalid_parser():
    """Test that registering non-BaseParser class raises error"""
    
    class NotAParser:
        pass
    
    with pytest.raises(ValueError) as exc_info:
        ParserRegistry.register("invalid", NotAParser)
    
    assert "BaseParser" in str(exc_info.value)

