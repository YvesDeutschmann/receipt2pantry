"""Parser management endpoints"""

from flask import Blueprint, jsonify
from backend.parsers.parser_registry import ParserRegistry
from backend.utils.logger import get_logger

logger = get_logger(__name__)
parsers_bp = Blueprint("parsers", __name__)


@parsers_bp.route("/parsers", methods=["GET"])
def list_parsers():
    """List all available parsers"""
    try:
        parsers = ParserRegistry.list_parsers()
        return jsonify({
            "parsers": parsers,
            "count": len(parsers)
        }), 200
    except Exception as e:
        logger.error(f"Error listing parsers: {e}")
        return jsonify({"error": "Internal server error"}), 500


@parsers_bp.route("/parsers/<parser_name>/status", methods=["GET"])
def get_parser_status(parser_name):
    """
    Get status of a parser
    
    Returns whether the parser is available
    """
    try:
        is_registered = ParserRegistry.is_registered(parser_name)
        
        return jsonify({
            "parser": parser_name,
            "available": is_registered
        }), 200
    
    except Exception as e:
        logger.error(f"Error getting parser status: {e}")
        return jsonify({"error": "Internal server error"}), 500

