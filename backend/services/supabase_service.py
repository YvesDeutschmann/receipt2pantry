"""Supabase database service"""

from typing import Dict, List, Optional
from datetime import datetime
from supabase import create_client, Client
from backend.utils.exceptions import DatabaseException
from backend.utils.logger import get_logger

logger = get_logger(__name__)


class SupabaseService:
    """Service for interacting with Supabase database"""
    
    def __init__(self, url: str, key: str, service_role_key: Optional[str] = None):
        """
        Initialize Supabase client
        
        Args:
            url: Supabase project URL
            key: Supabase anon/public key
            service_role_key: Supabase service role key (for admin operations)
        """
        try:
            self.client: Client = create_client(url, key)
            if service_role_key:
                self.admin_client: Client = create_client(url, service_role_key)
            else:
                self.admin_client = None
            logger.info("Supabase client initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize Supabase client: {e}")
            raise DatabaseException(f"Supabase initialization failed: {e}")
    
    def get_user_receipts(self, user_id: str, limit: int = 50) -> List[Dict]:
        """
        Get receipts for a user
        
        Args:
            user_id: User ID
            limit: Maximum number of receipts to return
        
        Returns:
            List of receipt dictionaries
        """
        try:
            response = (
                self.client.table("receipts")
                .select("*")
                .eq("user_id", user_id)
                .order("order_date", desc=True)
                .limit(limit)
                .execute()
            )
            return response.data if response.data else []
        except Exception as e:
            logger.error(f"Failed to get receipts for user {user_id}: {e}")
            raise DatabaseException(f"Failed to retrieve receipts: {e}")
    
    def store_receipt(self, receipt_data: Dict) -> str:
        """
        Store a receipt in the database
        
        Args:
            receipt_data: Receipt data dictionary
        
        Returns:
            Receipt ID
        """
        try:
            response = (
                self.client.table("receipts")
                .insert(receipt_data)
                .execute()
            )
            if response.data and len(response.data) > 0:
                receipt_id = response.data[0]["id"]
                logger.info(f"Stored receipt with ID: {receipt_id}")
                return receipt_id
            else:
                raise DatabaseException("No data returned after insert")
        except Exception as e:
            logger.error(f"Failed to store receipt: {e}")
            raise DatabaseException(f"Failed to store receipt: {e}")
    
    def store_receipt_items(self, items: List[Dict]) -> int:
        """
        Store receipt items in bulk
        
        Args:
            items: List of receipt item dictionaries
        
        Returns:
            Number of items stored
        """
        try:
            response = (
                self.client.table("receipt_items")
                .insert(items)
                .execute()
            )
            count = len(response.data) if response.data else 0
            logger.info(f"Stored {count} receipt items")
            return count
        except Exception as e:
            logger.error(f"Failed to store receipt items: {e}")
            raise DatabaseException(f"Failed to store receipt items: {e}")
    
    def get_grocery_account(self, user_id: str, provider: str) -> Optional[Dict]:
        """
        Get grocery account for a user and provider
        
        Args:
            user_id: User ID
            provider: Provider name (e.g., 'safeway', 'qfc')
        
        Returns:
            Grocery account dictionary or None if not found
        """
        try:
            response = (
                self.client.table("grocery_accounts")
                .select("*")
                .eq("user_id", user_id)
                .eq("provider", provider)
                .eq("is_active", True)
                .execute()
            )
            if response.data and len(response.data) > 0:
                return response.data[0]
            return None
        except Exception as e:
            logger.error(f"Failed to get grocery account: {e}")
            raise DatabaseException(f"Failed to retrieve grocery account: {e}")
    
    def update_grocery_account_login(
        self, account_id: str, success: bool, mfa_required: bool = False
    ) -> None:
        """
        Update grocery account last login timestamp
        
        Args:
            account_id: Grocery account ID
            success: Whether login was successful
            mfa_required: Whether MFA was required
        """
        try:
            update_data = {
                "mfa_required": mfa_required,
                "updated_at": datetime.utcnow().isoformat(),
            }
            
            if success:
                update_data["last_successful_login"] = datetime.utcnow().isoformat()
            
            self.client.table("grocery_accounts").update(update_data).eq(
                "id", account_id
            ).execute()
            
            logger.info(f"Updated grocery account {account_id} login status")
        except Exception as e:
            logger.error(f"Failed to update grocery account login: {e}")
            raise DatabaseException(f"Failed to update login status: {e}")
    
    def log_automation_run(
        self,
        user_id: str,
        grocery_account_id: str,
        status: str,
        receipts_fetched: int = 0,
        error_message: Optional[str] = None,
    ) -> str:
        """
        Log an automation run
        
        Args:
            user_id: User ID
            grocery_account_id: Grocery account ID
            status: Status ('success', 'failure', 'mfa_required')
            receipts_fetched: Number of receipts fetched
            error_message: Error message if failed
        
        Returns:
            Log entry ID
        """
        try:
            log_data = {
                "user_id": user_id,
                "grocery_account_id": grocery_account_id,
                "status": status,
                "receipts_fetched": receipts_fetched,
                "error_message": error_message,
                "started_at": datetime.utcnow().isoformat(),
                "completed_at": datetime.utcnow().isoformat(),
            }
            
            response = (
                self.client.table("automation_logs")
                .insert(log_data)
                .execute()
            )
            
            if response.data and len(response.data) > 0:
                log_id = response.data[0]["id"]
                logger.info(f"Logged automation run: {log_id}")
                return log_id
            else:
                raise DatabaseException("No data returned after log insert")
        except Exception as e:
            logger.error(f"Failed to log automation run: {e}")
            raise DatabaseException(f"Failed to log automation run: {e}")
    
    # Login Session Management Methods
    
    def create_login_session(
        self, user_id: str, provider: str, session_id: str, expires_at: datetime
    ) -> None:
        """
        Create a login session record in the database
        
        Args:
            user_id: User ID
            provider: Provider name
            session_id: Session UUID
            expires_at: Session expiration time
        """
        try:
            session_data = {
                "id": session_id,
                "user_id": user_id,
                "provider": provider,
                "state": "awaiting_code",
                "created_at": datetime.utcnow().isoformat(),
                "expires_at": expires_at.isoformat(),
            }
            
            self.client.table("login_sessions").insert(session_data).execute()
            logger.info(f"Created login session record: {session_id}")
        except Exception as e:
            logger.error(f"Failed to create login session: {e}")
            # Don't raise - this is optional persistence
    
    def update_login_session_state(
        self, session_id: str, state: str, error_message: Optional[str] = None
    ) -> None:
        """
        Update the state of a login session
        
        Args:
            session_id: Session UUID
            state: New state
            error_message: Optional error message
        """
        try:
            update_data = {"state": state}
            
            if error_message:
                update_data["error_message"] = error_message
            
            if state == "completed":
                update_data["completed_at"] = datetime.utcnow().isoformat()
            
            self.client.table("login_sessions").update(update_data).eq(
                "id", session_id
            ).execute()
            
            logger.info(f"Updated login session {session_id} to state: {state}")
        except Exception as e:
            logger.error(f"Failed to update login session state: {e}")
            # Don't raise - this is optional persistence
    
    def get_login_session(self, session_id: str) -> Optional[Dict]:
        """
        Get a login session by ID
        
        Args:
            session_id: Session UUID
        
        Returns:
            Session dictionary or None if not found
        """
        try:
            response = (
                self.client.table("login_sessions")
                .select("*")
                .eq("id", session_id)
                .execute()
            )
            
            if response.data and len(response.data) > 0:
                return response.data[0]
            return None
        except Exception as e:
            logger.error(f"Failed to get login session: {e}")
            return None
    
    def cleanup_expired_sessions(self) -> int:
        """
        Delete expired login sessions from the database
        
        Returns:
            Number of sessions deleted
        """
        try:
            now = datetime.utcnow().isoformat()
            
            # Delete expired sessions
            response = (
                self.client.table("login_sessions")
                .delete()
                .lt("expires_at", now)
                .execute()
            )
            
            count = len(response.data) if response.data else 0
            if count > 0:
                logger.info(f"Cleaned up {count} expired login sessions from database")
            return count
        except Exception as e:
            logger.error(f"Failed to cleanup expired sessions: {e}")
            return 0


def create_supabase_service(
    url: str, key: str, service_role_key: Optional[str] = None
) -> SupabaseService:
    """
    Factory function to create Supabase service
    
    Args:
        url: Supabase project URL
        key: Supabase anon/public key
        service_role_key: Supabase service role key
    
    Returns:
        Initialized SupabaseService instance
    """
    return SupabaseService(url, key, service_role_key)

