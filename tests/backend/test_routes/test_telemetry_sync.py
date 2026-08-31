"""Tests for provider sync telemetry ingestion route."""

import json

import pytest


@pytest.fixture
def sync_telemetry_client(app, mocker):
    mock_admin = mocker.MagicMock()
    table_mock = mocker.MagicMock()
    mock_admin.table.return_value = table_mock
    insert_mock = table_mock.insert.return_value
    insert_mock.execute.return_value = mocker.MagicMock(data=[{"id": "row-1"}])

    mock_supabase = mocker.MagicMock()
    mock_supabase.admin_client = mock_admin
    app.config["SUPABASE_SERVICE"] = mock_supabase
    return app.test_client()


def test_sync_telemetry_requires_auth(sync_telemetry_client):
    response = sync_telemetry_client.post(
        "/api/telemetry/sync",
        data=json.dumps(
            {
                "events": [
                    {
                        "provider": "costco",
                        "phase": "session_begin",
                        "syncId": "11111111-1111-1111-1111-111111111111",
                    }
                ]
            }
        ),
        content_type="application/json",
    )
    assert response.status_code == 401


def test_sync_telemetry_rejects_unknown_phase(sync_telemetry_client, mocker):
    mocker.patch(
        "backend.routes.telemetry.get_user_id_from_request",
        return_value="jwt-user-id",
    )
    response = sync_telemetry_client.post(
        "/api/telemetry/sync",
        data=json.dumps(
            {
                "events": [
                    {
                        "provider": "costco",
                        "phase": "not_a_real_phase",
                        "syncId": "11111111-1111-1111-1111-111111111111",
                    }
                ]
            }
        ),
        content_type="application/json",
    )
    assert response.status_code == 400


def test_sync_telemetry_rejects_unknown_provider(sync_telemetry_client, mocker):
    mocker.patch(
        "backend.routes.telemetry.get_user_id_from_request",
        return_value="jwt-user-id",
    )
    response = sync_telemetry_client.post(
        "/api/telemetry/sync",
        data=json.dumps(
            {
                "events": [
                    {
                        "provider": "kroger",
                        "phase": "session_begin",
                        "syncId": "11111111-1111-1111-1111-111111111111",
                    }
                ]
            }
        ),
        content_type="application/json",
    )
    assert response.status_code == 400


def test_sync_telemetry_accepts_valid_batch(sync_telemetry_client, mocker):
    mocker.patch(
        "backend.routes.telemetry.get_user_id_from_request",
        return_value="jwt-user-id",
    )
    response = sync_telemetry_client.post(
        "/api/telemetry/sync",
        data=json.dumps(
            {
                "events": [
                    {
                        "provider": "costco",
                        "phase": "close_unconfirmed",
                        "syncId": "11111111-1111-1111-1111-111111111111",
                        "mode": "login",
                        "reason": "no_close_event",
                        "metadata": {"last_url": "https://www.costco.com"},
                    }
                ]
            }
        ),
        content_type="application/json",
    )
    assert response.status_code == 200
    data = json.loads(response.data)
    assert data["accepted"] == 1

    insert_call = sync_telemetry_client.application.config[
        "SUPABASE_SERVICE"
    ].admin_client.table("sync_events").insert.call_args
    assert insert_call is not None
    rows = insert_call[0][0]
    assert rows[0]["user_id"] == "jwt-user-id"
    assert rows[0]["phase"] == "close_unconfirmed"


def test_sync_telemetry_accepts_diagnostic_phases(sync_telemetry_client, mocker):
    mocker.patch(
        "backend.routes.telemetry.get_user_id_from_request",
        return_value="jwt-user-id",
    )
    response = sync_telemetry_client.post(
        "/api/telemetry/sync",
        data=json.dumps(
            {
                "events": [
                    {
                        "provider": "costco",
                        "phase": "diagnostic_checkpoint",
                        "syncId": "11111111-1111-1111-1111-111111111111",
                        "reason": "a0",
                        "metadata": {"censusSeen": 0, "checkpoint": "a0"},
                    },
                    {
                        "provider": "costco",
                        "phase": "token_exchange",
                        "syncId": "11111111-1111-1111-1111-111111111111",
                        "metadata": {"tokenFired": True, "tokenStatus": 200},
                    },
                ]
            }
        ),
        content_type="application/json",
    )
    assert response.status_code == 200
    assert json.loads(response.data)["accepted"] == 2


def test_sync_telemetry_accepts_webview_orphan_closed(sync_telemetry_client, mocker):
    mocker.patch(
        "backend.routes.telemetry.get_user_id_from_request",
        return_value="jwt-user-id",
    )
    response = sync_telemetry_client.post(
        "/api/telemetry/sync",
        data=json.dumps(
            {
                "events": [
                    {
                        "provider": "costco",
                        "phase": "webview_orphan_closed",
                        "syncId": "11111111-1111-1111-1111-111111111111",
                        "mode": "silent",
                        "reason": "foreign_event",
                        "metadata": {"instanceAgeMs": 1200},
                    }
                ]
            }
        ),
        content_type="application/json",
    )
    assert response.status_code == 200
    assert json.loads(response.data)["accepted"] == 1


def test_sync_telemetry_rejects_oversized_batch(sync_telemetry_client, mocker):
    mocker.patch(
        "backend.routes.telemetry.get_user_id_from_request",
        return_value="jwt-user-id",
    )
    events = [
        {
            "provider": "costco",
            "phase": "session_begin",
            "syncId": f"{i:08d}-1111-1111-1111-111111111111",
        }
        for i in range(51)
    ]
    response = sync_telemetry_client.post(
        "/api/telemetry/sync",
        data=json.dumps({"events": events}),
        content_type="application/json",
    )
    assert response.status_code == 400


def test_sync_telemetry_rejects_too_many_metadata_keys(sync_telemetry_client, mocker):
    mocker.patch(
        "backend.routes.telemetry.get_user_id_from_request",
        return_value="jwt-user-id",
    )
    metadata = {f"k{i}": i for i in range(11)}
    response = sync_telemetry_client.post(
        "/api/telemetry/sync",
        data=json.dumps(
            {
                "events": [
                    {
                        "provider": "costco",
                        "phase": "needs_reconnect",
                        "syncId": "11111111-1111-1111-1111-111111111111",
                        "mode": "silent",
                        "reason": "refresh_invalid_grant",
                        "metadata": metadata,
                    }
                ]
            }
        ),
        content_type="application/json",
    )
    assert response.status_code == 400
