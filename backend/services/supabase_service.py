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
    
    # Product Mappings Methods
    
    def get_product_mapping(self, raw_name: str) -> Optional[Dict]:
        """
        Get normalized product mapping by raw product name
        
        Args:
            raw_name: Raw product name from receipt
        
        Returns:
            Product mapping dictionary or None if not found
        """
        try:
            response = (
                self.client.table("product_mappings")
                .select("*")
                .eq("raw_name", raw_name)
                .execute()
            )
            
            if response.data and len(response.data) > 0:
                return response.data[0]
            return None
        except Exception as e:
            logger.error(f"Failed to get product mapping for {raw_name}: {e}")
            return None
    
    def store_product_mapping(self, mapping_data: Dict) -> str:
        """
        Store a product normalization mapping
        
        Args:
            mapping_data: Product mapping dictionary
        
        Returns:
            Mapping ID
        """
        try:
            # Use admin client for inserts (bypasses RLS)
            client = self.admin_client if self.admin_client else self.client
            
            response = (
                client.table("product_mappings")
                .insert(mapping_data)
                .execute()
            )
            
            if response.data and len(response.data) > 0:
                mapping_id = response.data[0]["id"]
                logger.info(f"Stored product mapping: {mapping_data.get('raw_name')} -> {mapping_data.get('normalized_name')}")
                return mapping_id
            else:
                raise DatabaseException("No data returned after insert")
        except Exception as e:
            logger.error(f"Failed to store product mapping: {e}")
            raise DatabaseException(f"Failed to store product mapping: {e}")
    
    def get_all_product_mappings(self, limit: int = 1000) -> List[Dict]:
        """
        Get all product mappings
        
        Args:
            limit: Maximum number of mappings to return
        
        Returns:
            List of product mapping dictionaries
        """
        try:
            response = (
                self.client.table("product_mappings")
                .select("*")
                .limit(limit)
                .execute()
            )
            return response.data if response.data else []
        except Exception as e:
            logger.error(f"Failed to get product mappings: {e}")
            raise DatabaseException(f"Failed to retrieve product mappings: {e}")
    
    # Pantry Items Methods
    
    def get_user_pantry(self, user_id: str) -> List[Dict]:
        """
        Get all pantry items for a user
        
        Args:
            user_id: User ID
        
        Returns:
            List of pantry item dictionaries
        """
        try:
            response = (
                self.client.table("pantry_items")
                .select("*")
                .eq("user_id", user_id)
                .gt("quantity", 0)
                .order("base_ingredient", desc=False)
                .execute()
            )
            return response.data if response.data else []
        except Exception as e:
            logger.error(f"Failed to get pantry for user {user_id}: {e}")
            raise DatabaseException(f"Failed to retrieve pantry: {e}")
    
    def get_receipt_items(self, receipt_id: str) -> List[Dict]:
        """
        Get all items for a receipt
        
        Args:
            receipt_id: Receipt ID
        
        Returns:
            List of receipt item dictionaries
        """
        try:
            response = (
                self.client.table("receipt_items")
                .select("*")
                .eq("receipt_id", receipt_id)
                .execute()
            )
            return response.data if response.data else []
        except Exception as e:
            logger.error(f"Failed to get items for receipt {receipt_id}: {e}")
            raise DatabaseException(f"Failed to retrieve receipt items: {e}")
    
    def upsert_pantry_item(self, item_data: Dict) -> str:
        """
        Insert or update a pantry item
        
        Args:
            item_data: Pantry item dictionary
        
        Returns:
            Item ID
        """
        try:
            response = (
                self.client.table("pantry_items")
                .upsert(item_data, on_conflict="user_id,base_ingredient,variant,unit")
                .execute()
            )
            
            if response.data and len(response.data) > 0:
                item_id = response.data[0]["id"]
                logger.info(f"Upserted pantry item: {item_data.get('normalized_name')}")
                return item_id
            else:
                raise DatabaseException("No data returned after upsert")
        except Exception as e:
            logger.error(f"Failed to upsert pantry item: {e}")
            raise DatabaseException(f"Failed to upsert pantry item: {e}")
    
    def update_pantry_quantity(self, item_id: str, quantity: float) -> None:
        """
        Update quantity of a pantry item
        
        Args:
            item_id: Pantry item ID
            quantity: New quantity
        """
        try:
            self.client.table("pantry_items").update({
                "quantity": quantity
            }).eq("id", item_id).execute()
            
            logger.info(f"Updated pantry item {item_id} quantity to {quantity}")
        except Exception as e:
            logger.error(f"Failed to update pantry quantity: {e}")
            raise DatabaseException(f"Failed to update pantry quantity: {e}")
    
    def delete_pantry_item(self, item_id: str) -> None:
        """
        Delete a pantry item
        
        Args:
            item_id: Pantry item ID
        """
        try:
            self.client.table("pantry_items").delete().eq("id", item_id).execute()
            logger.info(f"Deleted pantry item {item_id}")
        except Exception as e:
            logger.error(f"Failed to delete pantry item: {e}")
            raise DatabaseException(f"Failed to delete pantry item: {e}")
    
    # Cooking Log Methods
    
    def log_cooking_event(self, log_data: Dict) -> str:
        """
        Log a cooking event
        
        Args:
            log_data: Cooking log dictionary
        
        Returns:
            Log entry ID
        """
        try:
            response = (
                self.client.table("cooking_log")
                .insert(log_data)
                .execute()
            )
            
            if response.data and len(response.data) > 0:
                log_id = response.data[0]["id"]
                logger.info(f"Logged cooking event: {log_data.get('recipe_name')}")
                return log_id
            else:
                raise DatabaseException("No data returned after insert")
        except Exception as e:
            logger.error(f"Failed to log cooking event: {e}")
            raise DatabaseException(f"Failed to log cooking event: {e}")
    
    def get_cooking_history(self, user_id: str, limit: int = 50) -> List[Dict]:
        """
        Get cooking history for a user
        
        Args:
            user_id: User ID
            limit: Maximum number of entries to return
        
        Returns:
            List of cooking log dictionaries
        """
        try:
            response = (
                self.client.table("cooking_log")
                .select("*")
                .eq("user_id", user_id)
                .order("cooked_at", desc=True)
                .limit(limit)
                .execute()
            )
            return response.data if response.data else []
        except Exception as e:
            logger.error(f"Failed to get cooking history for user {user_id}: {e}")
            raise DatabaseException(f"Failed to retrieve cooking history: {e}")
    
    # Ingredient Substitutions Methods
    
    def get_substitutions_for_ingredient(
        self, ingredient: str, substitution_type: Optional[str] = None
    ) -> List[Dict]:
        """
        Get substitutions for an ingredient
        
        Args:
            ingredient: Ingredient name
            substitution_type: Optional filter for type ('variant' or 'ingredient')
        
        Returns:
            List of substitution dictionaries
        """
        try:
            query = (
                self.client.table("ingredient_substitutions")
                .select("*")
                .eq("ingredient", ingredient)
            )
            
            if substitution_type:
                query = query.eq("substitution_type", substitution_type)
            
            response = query.execute()
            return response.data if response.data else []
        except Exception as e:
            logger.error(f"Failed to get substitutions for {ingredient}: {e}")
            raise DatabaseException(f"Failed to retrieve substitutions: {e}")
    
    def store_substitution(self, sub_data: Dict) -> str:
        """
        Store an ingredient substitution
        
        Args:
            sub_data: Substitution dictionary
        
        Returns:
            Substitution ID
        """
        try:
            # Use admin client for inserts (bypasses RLS)
            client = self.admin_client if self.admin_client else self.client
            
            response = (
                client.table("ingredient_substitutions")
                .insert(sub_data)
                .execute()
            )
            
            if response.data and len(response.data) > 0:
                sub_id = response.data[0]["id"]
                logger.info(f"Stored substitution: {sub_data.get('ingredient')} -> {sub_data.get('substitute')}")
                return sub_id
            else:
                raise DatabaseException("No data returned after insert")
        except Exception as e:
            logger.error(f"Failed to store substitution: {e}")
            raise DatabaseException(f"Failed to store substitution: {e}")
    
    def update_receipt_status(self, receipt_id: str, status: str) -> None:
        """
        Update receipt processing status
        
        Args:
            receipt_id: Receipt ID
            status: New status
        """
        try:
            self.client.table("receipts").update({
                "status": status,
                "processed_at": datetime.utcnow().isoformat() if status == "processed" else None
            }).eq("id", receipt_id).execute()
            
            logger.info(f"Updated receipt {receipt_id} status to {status}")
        except Exception as e:
            logger.error(f"Failed to update receipt status: {e}")
            raise DatabaseException(f"Failed to update receipt status: {e}")


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

