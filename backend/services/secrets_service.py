"""AWS Secrets Manager integration"""

import json
from typing import Dict, Optional
import boto3
from botocore.exceptions import ClientError
from backend.utils.exceptions import SecretsNotFoundException, ConfigurationException
from backend.utils.logger import get_logger

logger = get_logger(__name__)


class SecretsService:
    """Service for managing encrypted credentials via AWS Secrets Manager"""
    
    def __init__(
        self,
        region: str,
        access_key_id: Optional[str] = None,
        secret_access_key: Optional[str] = None,
    ):
        """
        Initialize AWS Secrets Manager client
        
        Args:
            region: AWS region
            access_key_id: AWS access key ID (optional, uses IAM role if not provided)
            secret_access_key: AWS secret access key
        """
        try:
            if access_key_id and secret_access_key:
                self.client = boto3.client(
                    "secretsmanager",
                    region_name=region,
                    aws_access_key_id=access_key_id,
                    aws_secret_access_key=secret_access_key,
                )
            else:
                # Use IAM role or default credentials
                self.client = boto3.client("secretsmanager", region_name=region)
            
            logger.info("AWS Secrets Manager client initialized")
        except Exception as e:
            logger.error(f"Failed to initialize Secrets Manager client: {e}")
            raise ConfigurationException(f"Secrets Manager initialization failed: {e}")
    
    def _generate_secret_name(self, user_id: str, provider: str) -> str:
        """Generate secret name for user and provider"""
        return f"grocerysync/{user_id}/{provider}/credentials"
    
    def store_user_credentials(
        self, user_id: str, provider: str, credentials: Dict
    ) -> str:
        """
        Store user credentials for a provider
        
        Args:
            user_id: User ID
            provider: Provider name (e.g., 'safeway', 'qfc')
            credentials: Dictionary containing credentials
        
        Returns:
            Secret ARN (vault key ID)
        """
        secret_name = self._generate_secret_name(user_id, provider)
        secret_value = json.dumps(credentials)
        
        try:
            # Try to create new secret
            response = self.client.create_secret(
                Name=secret_name,
                SecretString=secret_value,
                Description=f"Credentials for {provider} (user: {user_id})",
            )
            logger.info(f"Created secret: {secret_name}")
            return response["ARN"]
        except self.client.exceptions.ResourceExistsException:
            # Secret already exists, update it
            response = self.client.update_secret(
                SecretId=secret_name, SecretString=secret_value
            )
            logger.info(f"Updated secret: {secret_name}")
            return response["ARN"]
        except ClientError as e:
            logger.error(f"Failed to store credentials: {e}")
            raise ConfigurationException(f"Failed to store credentials: {e}")
    
    def retrieve_user_credentials(self, user_id: str, provider: str) -> Dict:
        """
        Retrieve user credentials for a provider
        
        Args:
            user_id: User ID
            provider: Provider name
        
        Returns:
            Dictionary containing credentials
        """
        secret_name = self._generate_secret_name(user_id, provider)
        
        try:
            response = self.client.get_secret_value(SecretId=secret_name)
            credentials = json.loads(response["SecretString"])
            logger.info(f"Retrieved credentials for {user_id}/{provider}")
            return credentials
        except self.client.exceptions.ResourceNotFoundException:
            logger.error(f"Credentials not found: {secret_name}")
            raise SecretsNotFoundException(
                f"Credentials not found for user {user_id} and provider {provider}"
            )
        except ClientError as e:
            logger.error(f"Failed to retrieve credentials: {e}")
            raise ConfigurationException(f"Failed to retrieve credentials: {e}")
    
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
            logger.info(f"Rotated credentials for {user_id}/{provider}")
            return True
        except Exception as e:
            logger.error(f"Failed to rotate credentials: {e}")
            return False
    
    def delete_user_credentials(self, user_id: str, provider: str) -> bool:
        """
        Delete user credentials
        
        Args:
            user_id: User ID
            provider: Provider name
        
        Returns:
            True if successful
        """
        secret_name = self._generate_secret_name(user_id, provider)
        
        try:
            self.client.delete_secret(
                SecretId=secret_name, ForceDeleteWithoutRecovery=True
            )
            logger.info(f"Deleted credentials: {secret_name}")
            return True
        except self.client.exceptions.ResourceNotFoundException:
            logger.warning(f"Secret not found when deleting: {secret_name}")
            return True  # Already deleted
        except ClientError as e:
            logger.error(f"Failed to delete credentials: {e}")
            return False


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
                result = self.client.rpc('vault_get_secret_by_name', {'secret_name': secret_name}).execute()
                secret_text = result.data[0] if isinstance(result.data, list) and result.data else result.data
                if secret_text:
                    # Update existing secret
                    self.client.rpc('vault_update_secret_by_name', {
                        'secret_name': secret_name,
                        'new_secret': secret_value
                    }).execute()
                    logger.info(f"Updated vault secret: {secret_name}")
                else:
                    # Create new secret
                    create_result = self.client.rpc('vault_create_secret', {
                        'secret': secret_value,
                        'unique_name': secret_name,
                        'description': f'Credentials for {provider} (user: {user_id})'
                    }).execute()
                    logger.info(f"Created vault secret: {secret_name}")
            except Exception as e:
                # If get fails, try to create (might not exist)
                try:
                    create_result = self.client.rpc('vault_create_secret', {
                        'secret': secret_value,
                        'unique_name': secret_name,
                        'description': f'Credentials for {provider} (user: {user_id})'
                    }).execute()
                    logger.info(f"Created vault secret: {secret_name}")
                except Exception as create_error:
                    # If create fails, try update (might already exist)
                    self.client.rpc('vault_update_secret_by_name', {
                        'secret_name': secret_name,
                        'new_secret': secret_value
                    }).execute()
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
            result = self.client.rpc('vault_get_secret_by_name', {'secret_name': secret_name}).execute()
            
            # Handle scalar return value (text type)
            secret_text = result.data[0] if isinstance(result.data, list) and result.data else result.data
            
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
            self.client.rpc('vault_delete_secret_by_name', {'secret_name': secret_name}).execute()
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


def create_secrets_service(
    use_mock: bool = False,
    region: str = "us-west-2",
    access_key_id: Optional[str] = None,
    secret_access_key: Optional[str] = None,
) -> SecretsService | MockSecretsService:
    """
    Factory function to create secrets service
    
    Args:
        use_mock: Use mock service for development
        region: AWS region
        access_key_id: AWS access key ID
        secret_access_key: AWS secret access key
    
    Returns:
        SecretsService or MockSecretsService instance
    """
    if use_mock:
        return MockSecretsService()
    return SecretsService(region, access_key_id, secret_access_key)

