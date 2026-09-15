"""Tests for AccountDeletionService."""

from unittest.mock import MagicMock, Mock

import pytest

from backend.services.account_deletion_service import AccountDeletionService
from backend.utils.exceptions import DatabaseException


@pytest.fixture
def mock_supabase():
    mock = Mock()
    mock.admin_client = MagicMock()
    return mock


@pytest.fixture
def mock_secrets():
    mock = Mock()
    mock.delete_user_credentials.return_value = True
    return mock


@pytest.fixture
def service(mock_supabase, mock_secrets):
    return AccountDeletionService(mock_supabase, mock_secrets)


class TestAccountDeletionService:
    def test_delete_account_happy_path(self, service, mock_supabase, mock_secrets):
        rpc_chain = MagicMock()
        rpc_chain.execute.return_value = MagicMock(data="deleted")
        mock_supabase.admin_client.rpc.return_value = rpc_chain
        mock_supabase.list_grocery_account_providers.return_value = ["costco"]

        result = service.delete_account("user-1")

        assert result == {"deleted": True, "household": "deleted"}
        mock_supabase.admin_client.rpc.assert_called_once_with(
            "detach_user_for_account_deletion", {"p_user_id": "user-1"}
        )
        assert mock_secrets.delete_user_credentials.call_count >= 2
        mock_supabase.admin_client.auth.admin.delete_user.assert_called_once_with(
            "user-1"
        )

    def test_delete_account_no_admin_client(self, mock_secrets):
        supabase = Mock(admin_client=None)
        svc = AccountDeletionService(supabase, mock_secrets)

        with pytest.raises(DatabaseException, match="admin client"):
            svc.delete_account("user-1")

    def test_vault_false_aborts_before_delete_user(
        self, service, mock_supabase, mock_secrets
    ):
        rpc_chain = MagicMock()
        rpc_chain.execute.return_value = MagicMock(data="none")
        mock_supabase.admin_client.rpc.return_value = rpc_chain
        mock_supabase.list_grocery_account_providers.return_value = []
        mock_secrets.delete_user_credentials.return_value = False

        with pytest.raises(DatabaseException, match="vault credentials"):
            service.delete_account("user-1")

        mock_supabase.admin_client.auth.admin.delete_user.assert_not_called()

    def test_delete_user_404_is_success(self, service, mock_supabase, mock_secrets):
        rpc_chain = MagicMock()
        rpc_chain.execute.return_value = MagicMock(data="left")
        mock_supabase.admin_client.rpc.return_value = rpc_chain
        mock_supabase.list_grocery_account_providers.return_value = []
        mock_supabase.admin_client.auth.admin.delete_user.side_effect = Exception(
            "User not found"
        )

        result = service.delete_account("user-1")

        assert result["deleted"] is True
        assert result["household"] == "left"

    def test_detach_rpc_failure_aborts(self, service, mock_supabase, mock_secrets):
        mock_supabase.admin_client.rpc.side_effect = Exception("rpc failed")

        with pytest.raises(DatabaseException, match="detach household"):
            service.delete_account("user-1")

        mock_secrets.delete_user_credentials.assert_not_called()
        mock_supabase.admin_client.auth.admin.delete_user.assert_not_called()
