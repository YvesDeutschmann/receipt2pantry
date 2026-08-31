"""Secrets storage via Supabase Vault (production) or in-memory mock (local dev)."""

import json
from typing import Dict

from backend.utils.exceptions import SecretsNotFoundException, ConfigurationException
from backend.utils.logger import get_logger

logger = get_logger(__name__)


class SupabaseVaultService:
    """Secrets service using Supabase Vault for encrypted storage"""

    def __init__(self, supabase_client):
        """
        Initialize Supabase Vault service

        Args:
            supabase_client: Supabase client instance (should be admin_client for vault access)
        """
        self.client = supabase_client
        logger.info("Supabase Vault Service initialized")

    def _generate_secret_name(self, user_id: str, provider: str) -> str:
        """Generate unique name for secret"""
        return f"grocerysync:{user_id}:{provider}"

    def store_user_credentials(
        self, user_id: str, provider: str, credentials: Dict
    ) -> str:
        """
        Store user credentials in Supabase Vault

        Args:
            user_id: User ID
            provider: Provider name (e.g., 'costco', 'safeway')
            credentials: Dictionary containing credentials

        Returns:
            Secret name (vault key ID)
        """
        secret_name = self._generate_secret_name(user_id, provider)
        secret_value = json.dumps(credentials)

        try:
            # Check if secret already exists by trying to retrieve it
            try:
                result = self.client.rpc(
                    "vault_get_secret_by_name", {"secret_name": secret_name}
                ).execute()
                secret_text = (
                    result.data[0]
                    if isinstance(result.data, list) and result.data
                    else result.data
                )
                if secret_text:
                    # Update existing secret
                    self.client.rpc(
                        "vault_update_secret_by_name",
                        {"secret_name": secret_name, "new_secret": secret_value},
                    ).execute()
                    logger.info(f"Updated vault secret: {secret_name}")
                else:
                    # Create new secret
                    self.client.rpc(
                        "vault_create_secret",
                        {
                            "secret": secret_value,
                            "unique_name": secret_name,
                            "description": f"Credentials for {provider} (user: {user_id})",
                        },
                    ).execute()
                    logger.info(f"Created vault secret: {secret_name}")
            except Exception:
                # If get fails, try to create (might not exist)
                try:
                    self.client.rpc(
                        "vault_create_secret",
                        {
                            "secret": secret_value,
                            "unique_name": secret_name,
                            "description": f"Credentials for {provider} (user: {user_id})",
                        },
                    ).execute()
                    logger.info(f"Created vault secret: {secret_name}")
                except Exception:
                    # If create fails, try update (might already exist)
                    self.client.rpc(
                        "vault_update_secret_by_name",
                        {"secret_name": secret_name, "new_secret": secret_value},
                    ).execute()
                    logger.info(f"Updated vault secret: {secret_name}")

            logger.info(f"Stored credentials in vault for {user_id}/{provider}")
            return secret_name
        except Exception as e:
            logger.error(f"Failed to store credentials in vault: {e}")
            raise ConfigurationException(f"Failed to store credentials: {e}")

    def retrieve_user_credentials(self, user_id: str, provider: str) -> Dict:
        """
        Retrieve user credentials from Supabase Vault

        Args:
            user_id: User ID
            provider: Provider name

        Returns:
            Dictionary containing credentials
        """
        secret_name = self._generate_secret_name(user_id, provider)

        try:
            result = self.client.rpc(
                "vault_get_secret_by_name", {"secret_name": secret_name}
            ).execute()

            # Handle scalar return value (text type)
            secret_text = (
                result.data[0]
                if isinstance(result.data, list) and result.data
                else result.data
            )

            if not secret_text:
                raise SecretsNotFoundException(
                    f"Credentials not found for user {user_id} and provider {provider}"
                )

            credentials = json.loads(secret_text)
            logger.info(f"Retrieved credentials from vault for {user_id}/{provider}")
            return credentials
        except SecretsNotFoundException:
            raise
        except Exception as e:
            logger.error(f"Failed to retrieve credentials from vault: {e}")
            raise SecretsNotFoundException(
                f"Credentials not found for user {user_id} and provider {provider}"
            )

    def rotate_credentials(
        self, user_id: str, provider: str, new_credentials: Dict
    ) -> bool:
        """
        Rotate user credentials

        Args:
            user_id: User ID
            provider: Provider name
            new_credentials: New credentials dictionary

        Returns:
            True if successful
        """
        try:
            self.store_user_credentials(user_id, provider, new_credentials)
            logger.info(f"Rotated credentials in vault for {user_id}/{provider}")
            return True
        except Exception as e:
            logger.error(f"Failed to rotate credentials: {e}")
            return False

    def delete_user_credentials(self, user_id: str, provider: str) -> bool:
        """
        Delete user credentials from Supabase Vault

        Args:
            user_id: User ID
            provider: Provider name

        Returns:
            True if successful
        """
        secret_name = self._generate_secret_name(user_id, provider)

        try:
            self.client.rpc(
                "vault_delete_secret_by_name", {"secret_name": secret_name}
            ).execute()
            logger.info(f"Deleted credentials from vault: {secret_name}")
            return True
        except Exception as e:
            logger.warning(f"Failed to delete credentials from vault: {e}")
            return False


class MockSecretsService:
    """Mock secrets service for local development"""

    def __init__(self):
        self._secrets: Dict[str, Dict] = {}
        logger.info("Mock Secrets Service initialized (development only)")

    def _generate_key(self, user_id: str, provider: str) -> str:
        return f"{user_id}:{provider}"

    def store_user_credentials(
        self, user_id: str, provider: str, credentials: Dict
    ) -> str:
        key = self._generate_key(user_id, provider)
        self._secrets[key] = credentials
        logger.info(f"[MOCK] Stored credentials for {user_id}/{provider}")
        return f"mock-arn-{key}"

    def retrieve_user_credentials(self, user_id: str, provider: str) -> Dict:
        key = self._generate_key(user_id, provider)
        if key not in self._secrets:
            raise SecretsNotFoundException(
                f"Credentials not found for user {user_id} and provider {provider}"
            )
        logger.info(f"[MOCK] Retrieved credentials for {user_id}/{provider}")
        return self._secrets[key]

    def rotate_credentials(
        self, user_id: str, provider: str, new_credentials: Dict
    ) -> bool:
        self.store_user_credentials(user_id, provider, new_credentials)
        return True

    def delete_user_credentials(self, user_id: str, provider: str) -> bool:
        key = self._generate_key(user_id, provider)
        if key in self._secrets:
            del self._secrets[key]
        logger.info(f"[MOCK] Deleted credentials for {user_id}/{provider}")
        return True


def create_mock_secrets_service() -> MockSecretsService:
    """Factory for local development mock secrets service."""
    return MockSecretsService()
