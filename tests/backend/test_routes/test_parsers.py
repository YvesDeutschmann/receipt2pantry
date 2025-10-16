"""Tests for parser endpoints"""

import json


def test_list_parsers(client):
    """Test listing all parsers"""
    response = client.get('/api/parsers')
    
    assert response.status_code == 200
    
    data = json.loads(response.data)
    assert "parsers" in data
    assert "count" in data
    assert isinstance(data["parsers"], list)
    
    # Safeway should be registered
    assert "safeway" in data["parsers"]


def test_get_parser_status_registered(client):
    """Test getting status of a registered parser"""
    response = client.get('/api/parsers/safeway/status')
    
    assert response.status_code == 200
    
    data = json.loads(response.data)
    assert data["parser"] == "safeway"
    assert data["available"] is True


def test_get_parser_status_unregistered(client):
    """Test getting status of an unregistered parser"""
    response = client.get('/api/parsers/nonexistent/status')
    
    assert response.status_code == 200
    
    data = json.loads(response.data)
    assert data["parser"] == "nonexistent"
    assert data["available"] is False

