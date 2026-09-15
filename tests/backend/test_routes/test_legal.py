"""Tests for public legal pages (/privacy, /terms)."""

import json


def _assert_legal_response(response, expected_h1: str):
    assert response.status_code == 200
    assert response.content_type.startswith("text/html")
    assert "charset=utf-8" in response.content_type

    body = response.get_data(as_text=True)
    assert f"<h1>{expected_h1}</h1>" in body
    assert "<script" not in body.lower()

    assert response.headers.get("Cache-Control") == "no-cache"
    assert response.headers.get("X-Content-Type-Options") == "nosniff"
    assert response.headers.get("X-Frame-Options") == "DENY"
    assert "default-src 'none'" in response.headers.get("Content-Security-Policy", "")
    assert "Set-Cookie" not in response.headers


def test_privacy_page(client):
    response = client.get("/privacy")
    _assert_legal_response(response, "Privacy Policy")


def test_terms_page(client):
    response = client.get("/terms")
    _assert_legal_response(response, "Terms of Service")


def test_legal_pages_do_not_require_auth(client):
    for path in ("/privacy", "/terms"):
        response = client.get(path, headers={"Authorization": "Bearer invalid"})
        assert response.status_code == 200


def test_legal_pages_head(client):
    for path in ("/privacy", "/terms"):
        response = client.head(path)
        assert response.status_code == 200
        assert response.content_type.startswith("text/html")


def test_unknown_path_still_json_404(client):
    response = client.get("/not-a-legal-page")
    assert response.status_code == 404
    data = json.loads(response.data)
    assert "error" in data
