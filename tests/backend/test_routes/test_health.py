"""Tests for health check endpoint"""

import json


def test_health_check(client):
    """Test health check endpoint returns 200"""
    response = client.get('/api/health')
    
    assert response.status_code == 200
    
    data = json.loads(response.data)
    assert data["status"] == "healthy"
    assert data["service"] == "grocerysync-backend"
    assert "version" in data


def test_health_check_json_response(client):
    """Test health check returns valid JSON"""
    response = client.get('/api/health')
    
    assert response.content_type == "application/json"
    
    data = json.loads(response.data)
    assert isinstance(data, dict)
    assert "status" in data


def test_readiness_without_supabase(client):
    """Readiness returns 503 when Supabase is not configured (test env)."""
    response = client.get('/api/health/ready')
    assert response.status_code == 503
    data = json.loads(response.data)
    assert data["status"] == "not_ready"
    assert "checks" in data


def test_readiness_ok_with_dependencies(client, mocker):
    mock_supabase = mocker.MagicMock()
    mock_client = mocker.MagicMock()
    mock_supabase.admin_client = mock_client
    mock_supabase.client = mock_client
    mock_client.table.return_value.select.return_value.limit.return_value.execute.return_value = mocker.MagicMock()

    from backend.services.secrets_service import SupabaseVaultService

    mock_vault = mocker.MagicMock(spec=SupabaseVaultService)
    client.application.config["SUPABASE_SERVICE"] = mock_supabase
    client.application.config["SECRETS_SERVICE"] = mock_vault

    response = client.get('/api/health/ready')
    assert response.status_code == 200
    data = json.loads(response.data)
    assert data["status"] == "ready"
    assert data["checks"]["supabase"] == "ok"
    assert data["checks"]["secrets_backend"] == "ok"

