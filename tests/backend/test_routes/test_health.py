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

