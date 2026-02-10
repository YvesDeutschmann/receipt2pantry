"""Tests for provider endpoints"""

import json


def test_list_providers(client):
    """Test listing all providers"""
    response = client.get('/api/providers')
    
    assert response.status_code == 200
    
    data = json.loads(response.data)
    assert "providers" in data
    assert "count" in data
    assert isinstance(data["providers"], list)
    
    # Safeway and Costco should be registered
    assert "safeway" in data["providers"]
    assert "costco" in data["providers"]


def test_get_provider_status_missing_user_id(client):
    """Test getting provider status without user_id"""
    response = client.get('/api/providers/safeway/status')
    
    assert response.status_code == 400
    
    data = json.loads(response.data)
    assert "error" in data
    assert "user_id" in data["error"].lower()


def test_test_provider_connection_missing_body(client):
    """Test testing provider connection without request body"""
    response = client.post('/api/providers/safeway/test')
    
    assert response.status_code == 400


def test_test_provider_connection_invalid_provider(client):
    """Test testing connection for non-existent provider"""
    response = client.post(
        '/api/providers/invalid-provider/test',
        data=json.dumps({
            "username": "test@example.com",
            "password": "test-password"
        }),
        content_type='application/json'
    )
    
    assert response.status_code == 404
    
    data = json.loads(response.data)
    assert "error" in data


def test_fetch_receipts_with_stored_credentials_missing_body(client):
    """Stored-credentials fetch should handle missing JSON body gracefully."""
    response = client.post('/api/providers/costco/fetch-receipts')

    assert response.status_code == 400

    data = json.loads(response.data)
    assert "error" in data


def test_fetch_receipts_with_stored_credentials_invalid_json(client):
    """Stored-credentials fetch should handle invalid JSON without 500s."""
    response = client.post(
        '/api/providers/costco/fetch-receipts',
        data='{',
        content_type='application/json'
    )

    assert response.status_code == 400

    data = json.loads(response.data)
    assert "error" in data

