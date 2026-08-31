"""Tests for request correlation ID middleware."""

import json


def test_request_id_echoed_when_provided(client):
    response = client.get("/api/health", headers={"X-Request-Id": "corr-123"})
    assert response.status_code == 200
    assert response.headers.get("X-Request-Id") == "corr-123"


def test_request_id_minted_when_missing(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    request_id = response.headers.get("X-Request-Id")
    assert request_id
    assert len(request_id) >= 8


def test_request_id_in_error_body(client):
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    data = json.loads(response.data)
    assert "request_id" in data
    assert data["request_id"] == response.headers.get("X-Request-Id")
