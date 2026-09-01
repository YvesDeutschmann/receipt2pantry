"""Health check endpoints"""

from flask import Blueprint, current_app, jsonify

from backend.services.secrets_service import MockSecretsService

health_bp = Blueprint("health", __name__)


@health_bp.route("/health", methods=["GET"])
def health_check():
    """Liveness probe — no dependency checks."""
    return jsonify({
        "status": "healthy",
        "service": "grocerysync-backend",
        "version": "0.1.0"
    }), 200


@health_bp.route("/health/ready", methods=["GET"])
def readiness_check():
    """Readiness probe — verifies critical dependencies."""
    checks: dict[str, str] = {}
    ok = True

    supabase_service = current_app.config.get("SUPABASE_SERVICE")
    if not supabase_service:
        checks["supabase"] = "missing"
        ok = False
    else:
        try:
            client = supabase_service.admin_client or supabase_service.client
            client.table("app_config").select("key").limit(1).execute()
            checks["supabase"] = "ok"
        except Exception:
            checks["supabase"] = "unreachable"
            ok = False

    secrets_service = current_app.config.get("SECRETS_SERVICE")
    if isinstance(secrets_service, MockSecretsService):
        checks["secrets_backend"] = "mock"
        ok = False
    elif secrets_service is None:
        checks["secrets_backend"] = "missing"
        ok = False
    else:
        checks["secrets_backend"] = "ok"

    status_code = 200 if ok else 503
    return jsonify({
        "status": "ready" if ok else "not_ready",
        "checks": checks,
    }), status_code


@health_bp.route("/health/costco-config", methods=["GET"])
def costco_config_check():
    """Verify hardcoded Costco client-identifier is still valid.
    Intended to be called by a daily cron/monitor.
    """
    from backend.providers.costco_provider import verify_costco_client_identifier
    result = verify_costco_client_identifier()
    status = 200 if result["valid"] else 502
    return jsonify(result), status
