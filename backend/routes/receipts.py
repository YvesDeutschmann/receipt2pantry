"""Receipt management endpoints"""

import uuid
from flask import Blueprint, jsonify, request, current_app
from backend.parsers.parser_registry import ParserRegistry, ParserNotFoundException
from backend.services.receipt_service import store_fetched_receipts
from backend.utils.logger import get_logger
from backend.utils.auth import get_user_id_from_request
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
        
        # Validate and constrain limit parameter
        try:
            limit = int(request.args.get("limit", 50))
            limit = min(max(limit, 1), 100)  # Constrain between 1 and 100
        except ValueError:
            return jsonify({"error": "limit must be an integer"}), 400
        
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
        
        # Get parser from registry
        try:
            parser = ParserRegistry.get_parser(provider)
        except ParserNotFoundException as e:
            logger.error(f"Parser not found: {e}")
            return jsonify({"error": str(e)}), 404
        
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


@receipts_bp.route("/receipts/ingest", methods=["POST"])
def ingest_receipts():
    """
    Ingest receipts from native client (WebView bridge). Used when receipts are
    fetched on-device via WebView and submitted for storage and pantry processing.
    Body: { "provider": "safeway"|"costco", "receipts": [...], "user_id": "uuid" }
    """
    try:
        data = request.get_json() or {}
        provider = data.get("provider")
        receipts = data.get("receipts") or data.get("receipt_data") or []
        user_id = data.get("user_id") or data.get("userId")

        if not provider or provider not in ("safeway", "costco"):
            return jsonify({"error": "provider is required and must be 'safeway' or 'costco'"}), 400
        if not user_id or user_id.strip() in ("", "anonymous"):
            return jsonify({"error": "user_id is required and must be a valid UUID"}), 400
        try:
            uuid.UUID(user_id)
        except (ValueError, TypeError):
            return jsonify({"error": "user_id is required and must be a valid UUID"}), 400
        if not isinstance(receipts, list):
            return jsonify({"error": "receipts must be an array"}), 400

        supabase_service = current_app.config.get("SUPABASE_SERVICE")
        receipt_processor = current_app.config.get("RECEIPT_PROCESSOR")
        if not supabase_service:
            return jsonify({"error": "Database service not available"}), 503

        store_result = store_fetched_receipts(user_id, provider, receipts, supabase_service)
        items_added = 0
        if receipt_processor and store_result.get("receipt_ids"):
            from backend.routes.pantry import run_async
            for receipt_id in store_result["receipt_ids"]:
                try:
                    proc_result = run_async(receipt_processor.process_receipt(receipt_id, user_id))
                    items_added += proc_result.get("items_added_to_pantry", 0)
                except Exception as e:
                    logger.warning(f"Failed to process receipt {receipt_id} into pantry: {e}")
                    store_result.setdefault("errors", []).append(f"Process {receipt_id}: {str(e)}")

        return jsonify({
            "status": "success",
            "receipts_stored": store_result["receipts_stored"],
            "receipt_ids": store_result["receipt_ids"],
            "items_added_to_pantry": items_added,
            "errors": store_result.get("errors", []),
        }), 200
    except Exception as e:
        logger.error(f"Error ingesting receipts: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@receipts_bp.route("/receipts/<receipt_id>", methods=["DELETE"])
def delete_receipt(receipt_id):
    """
    Delete a receipt and its items (receipt_items cascade automatically).
    
    Path params:
        receipt_id: Receipt ID
    """
    user_id = get_user_id_from_request()
    if not user_id:
        return jsonify({"error": "User ID required"}), 401
    
    supabase_service = current_app.config.get("SUPABASE_SERVICE")
    if not supabase_service:
        return jsonify({"error": "Database service not available"}), 503
    
    try:
        supabase_service.delete_receipt(receipt_id, user_id)
        return jsonify({"message": "Receipt deleted"}), 200
    except DatabaseException as e:
        if "not found" in str(e).lower() or "not owned" in str(e).lower():
            return jsonify({"error": str(e)}), 404
        logger.error(f"Database error deleting receipt: {e}")
        return jsonify({"error": "Database error"}), 500
    except Exception as e:
        logger.error(f"Unexpected error deleting receipt: {e}")
        return jsonify({"error": "Internal server error"}), 500

