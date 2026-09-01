"""Tests for funnel telemetry ingestion route."""

import json

import pytest


@pytest.fixture
def telemetry_client(app, mocker):
    mock_admin = mocker.MagicMock()
    table_mock = mocker.MagicMock()
    mock_admin.table.return_value = table_mock
    upsert_mock = table_mock.upsert.return_value
    upsert_mock.execute.return_value = mocker.MagicMock(data=[{"event": "funnel_sign_in"}])

    mock_supabase = mocker.MagicMock()
    mock_supabase.admin_client = mock_admin
    app.config["SUPABASE_SERVICE"] = mock_supabase
    return app.test_client()


def test_telemetry_requires_auth(telemetry_client):
    response = telemetry_client.post(
        "/api/telemetry/funnel",
        data=json.dumps({"events": [{"event": "funnel_sign_in"}]}),
        content_type="application/json",
    )
    assert response.status_code == 401


def test_telemetry_ignores_body_user_id_spoof(telemetry_client, mocker):
    mocker.patch(
        "backend.routes.telemetry.get_user_id_from_request",
        return_value="jwt-user-id",
    )
    response = telemetry_client.post(
        "/api/telemetry/funnel",
        data=json.dumps(
            {
                "events": [
                    {
                        "event": "funnel_sign_in",
                        "userId": "attacker-id",
                        "metadata": {"source": "test"},
                    }
                ]
            }
        ),
        content_type="application/json",
        headers={"Authorization": "Bearer fake"},
    )
    assert response.status_code == 200
    upsert_call = telemetry_client.application.config["SUPABASE_SERVICE"].admin_client.table(
        "funnel_events"
    ).upsert.call_args
    assert upsert_call is not None
    row = upsert_call[0][0]
    assert row["user_id"] == "jwt-user-id"


def test_telemetry_rejects_unknown_event(telemetry_client, mocker):
    mocker.patch(
        "backend.routes.telemetry.get_user_id_from_request",
        return_value="jwt-user-id",
    )
    response = telemetry_client.post(
        "/api/telemetry/funnel",
        data=json.dumps({"events": [{"event": "funnel_unknown_step"}]}),
        content_type="application/json",
    )
    assert response.status_code == 400


def test_telemetry_rejects_nested_metadata(telemetry_client, mocker):
    mocker.patch(
        "backend.routes.telemetry.get_user_id_from_request",
        return_value="jwt-user-id",
    )
    response = telemetry_client.post(
        "/api/telemetry/funnel",
        data=json.dumps(
            {
                "events": [
                    {
                        "event": "funnel_sign_in",
                        "metadata": {"nested": {"bad": True}},
                    }
                ]
            }
        ),
        content_type="application/json",
    )
    assert response.status_code == 400


def test_telemetry_accepts_valid_batch(telemetry_client, mocker):
    mocker.patch(
        "backend.routes.telemetry.get_user_id_from_request",
        return_value="jwt-user-id",
    )
    response = telemetry_client.post(
        "/api/telemetry/funnel",
        data=json.dumps(
            {
                "events": [
                    {
                        "event": "funnel_sign_in",
                        "timestamp": 1_700_000_000_000,
                        "sessionId": "11111111-1111-1111-1111-111111111111",
                        "metadata": {"source": "test"},
                    }
                ]
            }
        ),
        content_type="application/json",
    )
    assert response.status_code == 200
    data = json.loads(response.data)
    assert data["accepted"] == 1
