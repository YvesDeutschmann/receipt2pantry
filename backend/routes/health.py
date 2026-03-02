"""Health check endpoints"""

from flask import Blueprint, jsonify

health_bp = Blueprint("health", __name__)


@health_bp.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "service": "grocerysync-backend",
        "version": "0.1.0"
    }), 200


@health_bp.route("/health/costco-config", methods=["GET"])
def costco_config_check():
    """Verify hardcoded Costco client-identifier is still valid.
    Intended to be called by a daily cron/monitor.
    """
    from backend.providers.costco_provider import verify_costco_client_identifier
    result = verify_costco_client_identifier()
    status = 200 if result["valid"] else 502
    return jsonify(result), status

