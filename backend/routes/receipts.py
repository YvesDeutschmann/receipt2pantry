"""Receipt management endpoints"""

from flask import Blueprint, jsonify, request, current_app
from backend.utils.logger import get_logger
from backend.utils.exceptions import ParserException, DatabaseException

logger = get_logger(__name__)
receipts_bp = Blueprint("receipts", __name__)


@receipts_bp.route("/receipts", methods=["GET"])
def get_receipts():
    """
    Get receipts for a user
    
    Query params:
        user_id: User ID (required)
        limit: Maximum number of receipts (default 50)
    """
    try:
        user_id = request.args.get("user_id")
        if not user_id:
            return jsonify({"error": "user_id is required"}), 400
        
        limit = int(request.args.get("limit", 50))
        
        # Get Supabase service from app context
        supabase_service = current_app.config.get("SUPABASE_SERVICE")
        if not supabase_service:
            return jsonify({"error": "Database service not available"}), 503
        
        receipts = supabase_service.get_user_receipts(user_id, limit)
        
        return jsonify({
            "receipts": receipts,
            "count": len(receipts)
        }), 200
    
    except DatabaseException as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Database error"}), 500
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        return jsonify({"error": "Internal server error"}), 500


@receipts_bp.route("/receipts/parse", methods=["POST"])
def parse_receipt():
    """
    Parse a receipt from email content
    
    Body:
        provider: Provider name (e.g., 'safeway')
        email_content: Raw email content
    """
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({"error": "Request body is required"}), 400
        
        provider = data.get("provider")
        email_content = data.get("email_content")
        
        if not provider or not email_content:
            return jsonify({"error": "provider and email_content are required"}), 400
        
        # Get parser (placeholder - would use parser registry)
        # For now, hardcode Safeway parser
        if provider.lower() != "safeway":
            return jsonify({"error": f"Parser for {provider} not available"}), 400
        
        from backend.parsers.safeway_parser import SafewayParser
        parser = SafewayParser()
        
        parsed_data = parser.parse(email_content)
        
        if not parser.validate(parsed_data):
            return jsonify({"error": "Parsed data validation failed"}), 400
        
        return jsonify({
            "status": "success",
            "receipt": parsed_data
        }), 200
    
    except ParserException as e:
        logger.error(f"Parser error: {e}")
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        return jsonify({"error": "Internal server error"}), 500

