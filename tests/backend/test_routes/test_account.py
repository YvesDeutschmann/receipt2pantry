"""Tests for account deletion API routes."""

import json
from unittest.mock import Mock

import pytest

from backend.utils.exceptions import DatabaseException


class TestAccountRoutes:
    @pytest.fixture
    def mock_deletion_service(self):
        return Mock()

    @pytest.fixture
    def app_with_service(self, app, mock_deletion_service):
        app.config["ACCOUNT_DELETION_SERVICE"] = mock_deletion_service
        return app

    @pytest.fixture
    def client_with_service(self, app_with_service):
        return app_with_service.test_client()

    def test_delete_account_success(self, client_with_service, mock_deletion_service):
        mock_deletion_service.delete_account.return_value = {
            "deleted": True,
            "household": "deleted",
        }

        response = client_with_service.delete(
            "/api/account",
            headers={"X-User-Id": "user-1"},
        )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["deleted"] is True
        assert data["household"] == "deleted"
        mock_deletion_service.delete_account.assert_called_once_with("user-1")

    def test_delete_account_no_user_id(self, client_with_service, mock_deletion_service):
        response = client_with_service.delete("/api/account")

        assert response.status_code == 401
        mock_deletion_service.delete_account.assert_not_called()

    def test_delete_account_service_unavailable(self, app, client):
        app.config["ACCOUNT_DELETION_SERVICE"] = None
        response = client.delete(
            "/api/account",
            headers={"X-User-Id": "user-1"},
        )

        assert response.status_code == 503

    def test_delete_account_database_error(
        self, client_with_service, mock_deletion_service
    ):
        mock_deletion_service.delete_account.side_effect = DatabaseException(
            "vault failed"
        )

        response = client_with_service.delete(
            "/api/account",
            headers={"X-User-Id": "user-1"},
        )

        assert response.status_code == 500
        data = json.loads(response.data)
        assert "vault failed" in data["error"]
