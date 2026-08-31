"""Area 1 route security: IDOR prevention and dev endpoint gating."""

import json

import pytest

TEST_USER_ID = "11111111-1111-1111-1111-111111111111"
OTHER_USER_ID = "22222222-2222-2222-2222-222222222222"


def _auth_headers(user_id: str = TEST_USER_ID) -> dict:
    return {"X-User-Id": user_id}


def test_dev_log_forbidden_when_not_debug(client):
    """dev_log returns 403 outside Flask debug mode."""
    client.application.debug = False
    response = client.post(
        "/api/dev/log",
        data=json.dumps({"tag": "test", "msg": "hello"}),
        content_type="application/json",
    )
    assert response.status_code == 403


def test_dev_log_allowed_in_debug(client):
    """dev_log accepts messages when Flask debug mode is on."""
    client.application.debug = True
    response = client.post(
        "/api/dev/log",
        data=json.dumps({"tag": "test", "msg": "hello"}),
        content_type="application/json",
    )
    assert response.status_code == 200


def test_get_receipts_requires_auth(client, mock_supabase_service):
    """GET /receipts must not accept unauthenticated requests."""
    client.application.config["SUPABASE_SERVICE"] = mock_supabase_service
    response = client.get("/api/receipts")
    assert response.status_code == 401


def test_get_receipts_ignores_forged_query_user_id(client, mock_supabase_service):
    """Forged query user_id must not override authenticated identity."""
    client.application.config["SUPABASE_SERVICE"] = mock_supabase_service
    response = client.get(
        f"/api/receipts?user_id={OTHER_USER_ID}",
        headers=_auth_headers(TEST_USER_ID),
    )
    assert response.status_code == 200
    mock_supabase_service.get_user_receipts.assert_called_once_with(TEST_USER_ID, 50)


def test_get_provider_status_requires_auth(client):
    response = client.get("/api/providers/costco/status")
    assert response.status_code == 401


def test_get_provider_status_ignores_forged_query_user_id(client, mock_supabase_service):
    client.application.config["SUPABASE_SERVICE"] = mock_supabase_service
    response = client.get(
        f"/api/providers/costco/status?user_id={OTHER_USER_ID}",
        headers=_auth_headers(TEST_USER_ID),
    )
    assert response.status_code == 200
    mock_supabase_service.get_grocery_account.assert_called_once_with(
        TEST_USER_ID, "costco"
    )


def test_store_costco_receipts_ignores_forged_body_user_id(
    client, mock_supabase_service, mocker
):
    """Body user_id must not override X-User-Id identity."""
    client.application.config["SUPABASE_SERVICE"] = mock_supabase_service
    mocker.patch(
        "backend.routes.providers._store_and_process_fetched_receipts",
        return_value={
            "receipt_ids": [],
            "receipts_stored": 0,
            "errors": [],
            "items_added_to_pantry": 0,
        },
    )
    payload = {
        "receipts": [],
        "user_id": OTHER_USER_ID,
    }
    response = client.post(
        "/api/providers/costco/store-receipts",
        data=json.dumps(payload),
        content_type="application/json",
        headers=_auth_headers(TEST_USER_ID),
    )
    assert response.status_code == 200
