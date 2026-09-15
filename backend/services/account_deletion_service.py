"""Orchestrates full account deletion: household detach, vault wipe, auth user delete."""

from typing import Any, Dict, Optional

from backend.services.secrets_service import SupabaseVaultService
from backend.services.supabase_service import SupabaseService
from backend.utils.exceptions import DatabaseException
from backend.utils.logger import get_logger

logger = get_logger(__name__)

_KNOWN_PROVIDERS = ("safeway", "costco")


class AccountDeletionService:
    """Delete a user account and associated secrets."""

    def __init__(
        self,
        supabase: SupabaseService,
        secrets_service: SupabaseVaultService,
    ):
        self.supabase = supabase
        self.secrets_service = secrets_service

    def delete_account(self, user_id: str) -> Dict[str, Any]:
        """
        Delete account in order: detach household RPC, vault secrets, auth user.

        Returns:
            { "deleted": True, "household": "none"|"deleted"|"left"|"promoted" }

        Raises:
            DatabaseException: if admin_client missing, vault wipe fails, or auth delete fails
        """
        if not self.supabase.admin_client:
            raise DatabaseException("Account deletion requires admin client")

        household_outcome = self._detach_household(user_id)
        self._wipe_vault_credentials(user_id)
        self._delete_auth_user(user_id)

        return {"deleted": True, "household": household_outcome}

    def _detach_household(self, user_id: str) -> str:
        client = self.supabase.admin_client
        try:
            response = client.rpc(
                "detach_user_for_account_deletion", {"p_user_id": user_id}
            ).execute()
        except Exception as e:
            logger.error(f"detach_user_for_account_deletion failed for {user_id}: {e}")
            raise DatabaseException(f"Failed to detach household data: {e}") from e

        outcome = response.data
        if outcome is None:
            return "none"
        if isinstance(outcome, str):
            return outcome
        return str(outcome)

    def _wipe_vault_credentials(self, user_id: str) -> None:
        providers = set(_KNOWN_PROVIDERS)
        try:
            listed = self.supabase.list_grocery_account_providers(user_id)
            providers.update(listed)
        except Exception as e:
            logger.error(f"Failed to list grocery accounts for {user_id}: {e}")
            raise DatabaseException(f"Failed to list grocery accounts: {e}") from e

        for provider in sorted(providers):
            ok = self.secrets_service.delete_user_credentials(user_id, provider)
            if not ok:
                raise DatabaseException(
                    f"Failed to delete vault credentials for provider {provider}"
                )

    def _delete_auth_user(self, user_id: str) -> None:
        admin = self.supabase.admin_client
        try:
            admin.auth.admin.delete_user(user_id)
            logger.info(f"Deleted auth user {user_id}")
        except Exception as e:
            msg = str(e).lower()
            if "not found" in msg or "404" in msg or "user not found" in msg:
                logger.info(f"Auth user {user_id} already deleted")
                return
            logger.error(f"auth.admin.delete_user failed for {user_id}: {e}")
            raise DatabaseException(f"Failed to delete auth user: {e}") from e


def create_account_deletion_service(
    supabase: SupabaseService,
    secrets_service: SupabaseVaultService,
) -> AccountDeletionService:
    return AccountDeletionService(supabase, secrets_service)
