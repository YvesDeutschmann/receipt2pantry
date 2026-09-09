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
            client = self.admin_client if self.admin_client else self.client
            response = (
                client.table("receipts")
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
    
    def get_receipt_by_order_id(self, order_id: str) -> Optional[Dict]:
        """
        Get receipt by order_id
        
        Args:
            order_id: Order ID to search for
            
        Returns:
            Receipt dict or None if not found
        """
        try:
            client = self.admin_client if self.admin_client else self.client
            result = client.table("receipts").select("*").eq("order_id", order_id).execute()
            return result.data[0] if result.data else None
        except Exception as e:
            logger.error(f"Failed to get receipt by order_id {order_id}: {e}")
            raise DatabaseException(f"Failed to get receipt by order_id: {e}")
    
    def delete_receipt(self, receipt_id: str, user_id: str) -> None:
        """
        Delete a receipt and its items (receipt_items cascade automatically).
        
        Args:
            receipt_id: Receipt ID
            user_id: User ID (required for authorization — only deletes if receipt belongs to user)
        """
        try:
            client = self.admin_client if self.admin_client else self.client
            response = (
                client.table("receipts")
                .delete()
                .eq("id", receipt_id)
                .eq("user_id", user_id)
                .execute()
            )
            if response.data and len(response.data) > 0:
                logger.info(f"Deleted receipt {receipt_id}")
            else:
                # No rows deleted — receipt not found or not owned by user
                raise DatabaseException(f"Receipt {receipt_id} not found or not owned by user")
        except DatabaseException:
            raise
        except Exception as e:
            logger.error(f"Failed to delete receipt {receipt_id}: {e}")
            raise DatabaseException(f"Failed to delete receipt: {e}")
    
    def delete_user_receipts(self, user_id: str) -> None:
        """
        Delete all receipts for a user (receipt_items cascade via FK).

        Args:
            user_id: User ID
        """
        try:
            client = self.admin_client if self.admin_client else self.client
            client.table("receipts").delete().eq("user_id", user_id).execute()
            logger.info(f"Deleted all receipts for user {user_id}")
        except Exception as e:
            logger.error(f"Failed to delete receipts for user {user_id}: {e}")
            raise DatabaseException(f"Failed to delete user receipts: {e}")
    
    def store_receipt(self, receipt_data: Dict) -> str:
        """
        Store a receipt in the database
        
        Args:
            receipt_data: Receipt data dictionary
        
        Returns:
            Receipt ID
        """
        try:
            # Use admin_client to bypass RLS for server-side receipt inserts
            client = self.admin_client if self.admin_client else self.client
            response = (
                client.table("receipts")
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

    def store_receipt_with_items(self, receipt_data: Dict, items: List[Dict]) -> Optional[str]:
        """
        Store a receipt and its items in a single transaction.
        Returns None when the receipt already exists (idempotent duplicate).

        Args:
            receipt_data: Receipt row as dict (user_id, provider, order_id, etc.)
            items: List of receipt item dicts (name, category, price, quantity, etc.)

        Returns:
            Receipt ID (UUID string), or None if duplicate (user_id, provider, order_id)
        """
        try:
            client = self.admin_client if self.admin_client else self.client
            response = client.rpc(
                "store_receipt_with_items",
                {"p_receipt": receipt_data, "p_items": items},
            ).execute()
            if response.data is None:
                return None
            # PostgREST may return scalar or single-element array
            raw = response.data[0] if isinstance(response.data, list) and response.data else response.data
            if raw is None:
                return None
            receipt_id = str(raw)
            logger.info(f"Stored receipt with items in transaction, ID: {receipt_id}")
            return receipt_id
        except Exception as e:
            logger.error(f"Failed to store receipt with items: {e}")
            raise DatabaseException(f"Failed to store receipt with items: {e}")
    
    def store_receipt_items(self, items: List[Dict]) -> int:
        """
        Store receipt items in bulk
        
        Args:
            items: List of receipt item dictionaries
        
        Returns:
            Number of items stored
        """
        try:
            # Use admin_client to bypass RLS for server-side receipt item inserts
            client = self.admin_client if self.admin_client else self.client
            response = (
                client.table("receipt_items")
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
            # Use admin_client to bypass RLS for server-side operations
            client = self.admin_client if self.admin_client else self.client
            response = (
                client.table("grocery_accounts")
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
    
    def create_or_update_grocery_account(
        self, user_id: str, provider: str, username: str, vault_key_id: str
    ) -> str:
        """
        Create or update a grocery account using UPSERT
        
        Args:
            user_id: User ID
            provider: Provider name (e.g., 'costco', 'safeway')
            username: Username/email for the account
            vault_key_id: Supabase Vault secret name for encrypted credentials
        
        Returns:
            Grocery account ID
        """
        try:
            # Use admin_client to bypass RLS for server-side operations
            client = self.admin_client if self.admin_client else self.client
            
            # Use upsert to handle both create and update in one operation
            account_data = {
                "user_id": user_id,
                "provider": provider,
                "username": username,
                "vault_key_id": vault_key_id,
                "is_active": True,
                "mfa_required": False,
                "updated_at": datetime.utcnow().isoformat(),
            }
            
            # Upsert: Insert or update on conflict (user_id, provider)
            response = (
                client.table("grocery_accounts")
                .upsert(account_data, on_conflict="user_id,provider")
                .execute()
            )
            
            if response.data and len(response.data) > 0:
                account_id = response.data[0]["id"]
                logger.info(f"Upserted grocery account {account_id} for {user_id}/{provider}")
            else:
                raise DatabaseException("No data returned after upsert")
            
            return account_id
        except Exception as e:
            logger.error(f"Failed to create/update grocery account: {e}")
            raise DatabaseException(f"Failed to create/update grocery account: {e}")
    
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
            # Use admin_client to bypass RLS for server-side operations
            client = self.admin_client if self.admin_client else self.client
            update_data = {
                "mfa_required": mfa_required,
                "updated_at": datetime.utcnow().isoformat(),
            }
            
            if success:
                update_data["last_successful_login"] = datetime.utcnow().isoformat()
            
            client.table("grocery_accounts").update(update_data).eq(
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
            
            client = self.admin_client if self.admin_client else self.client
            response = (
                client.table("automation_logs")
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
            
            client = self.admin_client if self.admin_client else self.client
            client.table("login_sessions").insert(session_data).execute()
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
            
            client = self.admin_client if self.admin_client else self.client
            client.table("login_sessions").update(update_data).eq(
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
            client = self.admin_client if self.admin_client else self.client
            response = (
                client.table("login_sessions")
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
            
            client = self.admin_client if self.admin_client else self.client
            response = (
                client.table("login_sessions")
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
            client = self.admin_client if self.admin_client else self.client
            response = (
                client.table("product_mappings")
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
            client = self.admin_client if self.admin_client else self.client
            response = (
                client.table("product_mappings")
                .select("*")
                .limit(limit)
                .execute()
            )
            return response.data if response.data else []
        except Exception as e:
            logger.error(f"Failed to get product mappings: {e}")
            raise DatabaseException(f"Failed to retrieve product mappings: {e}")
    
    # Pantry Items Methods
    
    def get_user_pantry(self, user_id: str, *, include_deleted: bool = False) -> List[Dict]:
        """
        Get all pantry items for a user
        
        Args:
            user_id: User ID
            include_deleted: When False (default), exclude soft-deleted rows
        
        Returns:
            List of pantry item dictionaries
        """
        try:
            client = self.admin_client if self.admin_client else self.client
            query = (
                client.table("pantry_items")
                .select("*")
                .eq("user_id", user_id)
            )
            if not include_deleted:
                query = query.gt("quantity", 0).is_("deleted_at", "null")
            response = query.order("base_ingredient", desc=False).execute()
            return response.data if response.data else []
        except Exception as e:
            logger.error(f"Failed to get pantry for user {user_id}: {e}")
            raise DatabaseException(f"Failed to retrieve pantry: {e}")

    def get_receipt(self, receipt_id: str) -> Optional[Dict]:
        """
        Get a receipt row by ID.

        Args:
            receipt_id: Receipt ID

        Returns:
            Receipt dict or None if not found
        """
        try:
            client = self.admin_client if self.admin_client else self.client
            response = (
                client.table("receipts")
                .select("*")
                .eq("id", receipt_id)
                .limit(1)
                .execute()
            )
            if response.data and len(response.data) > 0:
                return response.data[0]
            return None
        except Exception as e:
            logger.error(f"Failed to get receipt {receipt_id}: {e}")
            raise DatabaseException(f"Failed to retrieve receipt: {e}")
    
    def get_receipt_items(self, receipt_id: str) -> List[Dict]:
        """
        Get all items for a receipt
        
        Args:
            receipt_id: Receipt ID
        
        Returns:
            List of receipt item dictionaries
        """
        try:
            # Use admin_client to bypass RLS when called from backend (no user JWT)
            client = self.admin_client if self.admin_client else self.client
            response = (
                client.table("receipt_items")
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
        
        Uses the appropriate conflict target:
        - household_id set: unique_household_ingredient_variant (005)
          ON (household_id, base_ingredient, variant, unit) WHERE household_id IS NOT NULL
        - household_id NULL: unique_user_ingredient_variant_null_household (008)
          ON (user_id, base_ingredient, variant, unit) WHERE household_id IS NULL
        
        Args:
            item_data: Pantry item dictionary (must include user_id when household_id is None)
        
        Returns:
            Item ID
        """
        try:
            if self.admin_client is None:
                raise DatabaseException(
                    "SUPABASE_SERVICE_ROLE_KEY is required for upsert_pantry_item"
                )
            response = (
                self.admin_client.rpc("upsert_pantry_item", {"p_item": item_data})
                .execute()
            )
            if response.data is None:
                raise DatabaseException("No data returned after upsert")
            # PostgREST may return scalar uuid or a single-element array
            raw = (
                response.data[0]
                if isinstance(response.data, list) and response.data
                else response.data
            )
            if raw is None:
                raise DatabaseException("No data returned after upsert")
            if isinstance(raw, dict):
                raw = raw.get("id")
            if raw is None:
                raise DatabaseException("No data returned after upsert")
            item_id = str(raw)
            logger.info(f"Upserted pantry item: {item_data.get('normalized_name')}")
            return item_id
        except DatabaseException:
            raise
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
            client = self.admin_client if self.admin_client else self.client
            client.table("pantry_items").update({
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
            client = self.admin_client if self.admin_client else self.client
            client.table("pantry_items").delete().eq("id", item_id).execute()
            logger.info(f"Deleted pantry item {item_id}")
        except Exception as e:
            logger.error(f"Failed to delete pantry item: {e}")
            raise DatabaseException(f"Failed to delete pantry item: {e}")
    
    def reset_pantry(self, user_id: str, household_id: Optional[str] = None) -> None:
        """
        Delete all pantry items for a user, optionally scoped to a household.
        Used for testing re-import workflows.
        
        Args:
            user_id: User ID
            household_id: Optional household ID to scope deletion
        """
        try:
            client = self.admin_client if self.admin_client else self.client
            query = client.table("pantry_items").delete().eq("user_id", user_id)
            if household_id is not None:
                query = query.eq("household_id", household_id)
            query.execute()
            logger.info(f"Reset pantry for user {user_id}" + (f" (household {household_id})" if household_id else ""))
        except Exception as e:
            logger.error(f"Failed to reset pantry: {e}")
            raise DatabaseException(f"Failed to reset pantry: {e}")

    def reset_household_pantry(self, household_id: str) -> None:
        """Delete live pantry rows for a household. Leaves graveyard (RESTRICT on depletion_history)."""
        try:
            client = self.admin_client if self.admin_client else self.client
            client.table("pantry_items").delete().eq(
                "household_id", household_id
            ).is_("deleted_at", "null").execute()
            logger.info(f"Reset live household pantry for {household_id}")
        except Exception as e:
            logger.error(f"Failed to reset household pantry: {e}")
            raise DatabaseException(f"Failed to reset household pantry: {e}")

    def delete_recipe_cooking_log(self, household_id: str, recipe_id: str) -> None:
        """Delete cooking_log rows for one household + recipe (DEV cook-loop teardown)."""
        try:
            client = self.admin_client if self.admin_client else self.client
            client.table("cooking_log").delete().eq(
                "household_id", household_id
            ).eq("recipe_id", str(recipe_id)).execute()
        except Exception as e:
            logger.error(f"Failed to delete cooking_log for {recipe_id}: {e}")
            raise DatabaseException(f"Failed to delete cooking_log: {e}")

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
            client = self.admin_client if self.admin_client else self.client
            response = (
                client.table("cooking_log")
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
            client = self.admin_client if self.admin_client else self.client
            response = (
                client.table("cooking_log")
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
            client = self.admin_client if self.admin_client else self.client
            query = (
                client.table("ingredient_substitutions")
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
            client = self.admin_client if self.admin_client else self.client
            client.table("receipts").update({
                "status": status,
                "processed_at": datetime.utcnow().isoformat() if status == "processed" else None
            }).eq("id", receipt_id).execute()
            
            logger.info(f"Updated receipt {receipt_id} status to {status}")
        except Exception as e:
            logger.error(f"Failed to update receipt status: {e}")
            raise DatabaseException(f"Failed to update receipt status: {e}")
    
    # =========================================================================
    # Household Management Methods
    # =========================================================================
    
    def get_user_household(self, user_id: str) -> Optional[Dict]:
        """
        Get the household a user belongs to
        
        Args:
            user_id: User ID
        
        Returns:
            Household dictionary with membership info or None
        """
        # Use admin_client to bypass RLS for backend operations
        client = self.admin_client if self.admin_client else self.client
        try:
            # Get membership first
            member_response = (
                client.table("household_members")
                .select("*, households(*)")
                .eq("user_id", user_id)
                .execute()
            )
            
            if member_response.data and len(member_response.data) > 0:
                membership = member_response.data[0]
                household = membership.get("households", {})
                return {
                    "id": household.get("id"),
                    "name": household.get("name"),
                    "join_code": household.get("join_code"),
                    "created_by": household.get("created_by"),
                    "created_at": household.get("created_at"),
                    "size": household.get("size", 2),
                    "dietary_restrictions": household.get("dietary_restrictions") or [],
                    "suggestion_meal_slots": household.get("suggestion_meal_slots")
                    or {"breakfast": True, "lunch": True, "dinner": True},
                    "role": membership.get("role"),
                    "joined_at": membership.get("joined_at")
                }
            return None
        except Exception as e:
            logger.error(f"Failed to get household for user {user_id}: {e}")
            raise DatabaseException(f"Failed to get user household: {e}")
    
    def get_household_by_code(self, join_code: str) -> Optional[Dict]:
        """
        Get a household by its join code
        
        Args:
            join_code: Household join code
        
        Returns:
            Household dictionary or None
        """
        try:
            client = self.admin_client if self.admin_client else self.client
            response = (
                client.table("households")
                .select("*")
                .eq("join_code", join_code.upper())
                .execute()
            )
            
            if response.data and len(response.data) > 0:
                return response.data[0]
            return None
        except Exception as e:
            logger.error(f"Failed to get household by code: {e}")
            raise DatabaseException(f"Failed to get household by code: {e}")
    
    def get_household_by_id(self, household_id: str) -> Optional[Dict]:
        """
        Get a household by its ID
        
        Args:
            household_id: Household UUID
        
        Returns:
            Household dictionary or None
        """
        try:
            client = self.admin_client if self.admin_client else self.client
            response = (
                client.table("households")
                .select("*")
                .eq("id", household_id)
                .execute()
            )
            
            if response.data and len(response.data) > 0:
                return response.data[0]
            return None
        except Exception as e:
            logger.error(f"Failed to get household {household_id}: {e}")
            raise DatabaseException(f"Failed to get household: {e}")
    
    def create_household(
        self,
        user_id: str,
        name: str,
        join_code: str,
        size: int = 2,
        dietary_restrictions: Optional[List[str]] = None,
    ) -> Dict:
        """
        Create a new household

        Creates household and adds creator as owner. If membership creation fails,
        the household is rolled back to prevent orphaned records.

        Args:
            user_id: User ID of the creator
            name: Household name
            join_code: Generated join code
            size: Number of people in household (1-99), default 2
            dietary_restrictions: List of restriction codes, default empty

        Returns:
            Created household dictionary
        """
        household_id = None
        # Use admin_client to bypass RLS for backend operations
        client = self.admin_client if self.admin_client else self.client
        try:
            household_data = {
                "name": name,
                "join_code": join_code.upper(),
                "created_by": user_id,
                "size": max(1, min(99, size)),
                "dietary_restrictions": dietary_restrictions if dietary_restrictions is not None else [],
            }
            # Create the household
            household_response = (
                client.table("households")
                .insert(household_data)
                .execute()
            )
            
            if not household_response.data or len(household_response.data) == 0:
                raise DatabaseException("No data returned after household creation")
            
            household = household_response.data[0]
            household_id = household["id"]
            
            # Add creator as owner
            try:
                client.table("household_members").insert({
                    "household_id": household_id,
                    "user_id": user_id,
                    "role": "owner"
                }).execute()
            except Exception as member_error:
                # Membership insert failed - rollback by deleting the household
                logger.error(f"Failed to add owner to household, rolling back: {member_error}")
                try:
                    client.table("households").delete().eq(
                        "id", household_id
                    ).execute()
                    logger.info(f"Rolled back household {household_id} after membership failure")
                except Exception as rollback_error:
                    logger.error(
                        f"Failed to rollback household {household_id}: {rollback_error}. "
                        "Manual cleanup may be required."
                    )
                raise DatabaseException(f"Failed to create household membership: {member_error}")
            
            logger.info(f"Created household {household_id} for user {user_id}")
            return household
            
        except DatabaseException:
            # Re-raise DatabaseExceptions as-is
            raise
        except Exception as e:
            # Clean up household if it was created but something else failed
            if household_id:
                try:
                    client.table("households").delete().eq(
                        "id", household_id
                    ).execute()
                    logger.info(f"Cleaned up household {household_id} after error")
                except Exception as cleanup_error:
                    logger.error(
                        f"Failed to cleanup household {household_id}: {cleanup_error}. "
                        "Manual cleanup may be required."
                    )
            logger.error(f"Failed to create household: {e}")
            raise DatabaseException(f"Failed to create household: {e}")
    
    def add_household_member(
        self, household_id: str, user_id: str, role: str = "member"
    ) -> str:
        """
        Add a user to a household
        
        Args:
            household_id: Household ID
            user_id: User ID to add
            role: Member role ('owner' or 'member')
        
        Returns:
            Membership ID
        """
        try:
            client = self.admin_client if self.admin_client else self.client
            response = (
                client.table("household_members")
                .insert({
                    "household_id": household_id,
                    "user_id": user_id,
                    "role": role
                })
                .execute()
            )
            
            if response.data and len(response.data) > 0:
                member_id = response.data[0]["id"]
                logger.info(f"Added user {user_id} to household {household_id}")
                return member_id
            else:
                raise DatabaseException("No data returned after adding member")
                
        except Exception as e:
            logger.error(f"Failed to add household member: {e}")
            raise DatabaseException(f"Failed to add household member: {e}")
    
    def remove_household_member(self, user_id: str) -> None:
        """
        Remove a user from their household
        
        Args:
            user_id: User ID to remove
        """
        try:
            client = self.admin_client if self.admin_client else self.client
            client.table("household_members").delete().eq(
                "user_id", user_id
            ).execute()
            
            logger.info(f"Removed user {user_id} from household")
        except Exception as e:
            logger.error(f"Failed to remove household member: {e}")
            raise DatabaseException(f"Failed to remove household member: {e}")
    
    def get_household_members(self, household_id: str) -> List[Dict]:
        """
        Get all members of a household
        
        Args:
            household_id: Household ID
        
        Returns:
            List of member dictionaries
        """
        try:
            client = self.admin_client if self.admin_client else self.client
            response = (
                client.table("household_members")
                .select("*")
                .eq("household_id", household_id)
                .order("joined_at", desc=False)
                .execute()
            )
            return response.data if response.data else []
        except Exception as e:
            logger.error(f"Failed to get household members: {e}")
            raise DatabaseException(f"Failed to get household members: {e}")
    
    def update_household(self, household_id: str, updates: Dict) -> None:
        """
        Update household details
        
        Args:
            household_id: Household ID
            updates: Dictionary of fields to update
        """
        try:
            client = self.admin_client if self.admin_client else self.client
            client.table("households").update(updates).eq(
                "id", household_id
            ).execute()
            
            logger.info(f"Updated household {household_id}")
        except Exception as e:
            logger.error(f"Failed to update household: {e}")
            raise DatabaseException(f"Failed to update household: {e}")
    
    def delete_household(self, household_id: str) -> None:
        """
        Delete a household and all associated memberships
        
        Args:
            household_id: Household ID
        """
        try:
            client = self.admin_client if self.admin_client else self.client
            client.table("households").delete().eq(
                "id", household_id
            ).execute()
            
            logger.info(f"Deleted household {household_id}")
        except Exception as e:
            logger.error(f"Failed to delete household: {e}")
            raise DatabaseException(f"Failed to delete household: {e}")
    
    def is_join_code_unique(self, join_code: str) -> bool:
        """
        Check if a join code is unique
        
        Args:
            join_code: Join code to check
        
        Returns:
            True if unique, False otherwise
        """
        try:
            client = self.admin_client if self.admin_client else self.client
            response = (
                client.table("households")
                .select("id")
                .eq("join_code", join_code.upper())
                .execute()
            )
            return not response.data or len(response.data) == 0
        except Exception as e:
            logger.error(f"Failed to check join code uniqueness: {e}")
            return False
    
    # =========================================================================
    # Household-aware Data Access Methods
    # =========================================================================
    
    def get_household_pantry(
        self, household_id: str, *, include_deleted: bool = False
    ) -> List[Dict]:
        """
        Get all pantry items for a household
        
        Args:
            household_id: Household ID
            include_deleted: When False (default), exclude soft-deleted rows
        
        Returns:
            List of pantry item dictionaries
        """
        # Use admin_client to bypass RLS for backend operations
        client = self.admin_client if self.admin_client else self.client
        try:
            query = (
                client.table("pantry_items")
                .select("*")
                .eq("household_id", household_id)
            )
            if not include_deleted:
                query = query.gt("quantity", 0).is_("deleted_at", "null")
            response = query.order("base_ingredient", desc=False).execute()
            return response.data if response.data else []
        except Exception as e:
            logger.error(f"Failed to get pantry for household {household_id}: {e}")
            raise DatabaseException(f"Failed to retrieve household pantry: {e}")
    
    def get_household_receipts(self, household_id: str, limit: int = 50) -> List[Dict]:
        """
        Get receipts for a household
        
        Args:
            household_id: Household ID
            limit: Maximum number of receipts to return
        
        Returns:
            List of receipt dictionaries
        """
        try:
            client = self.admin_client if self.admin_client else self.client
            response = (
                client.table("receipts")
                .select("*")
                .eq("household_id", household_id)
                .order("order_date", desc=True)
                .limit(limit)
                .execute()
            )
            return response.data if response.data else []
        except Exception as e:
            logger.error(f"Failed to get receipts for household {household_id}: {e}")
            raise DatabaseException(f"Failed to retrieve household receipts: {e}")
    
    def get_household_cooking_history(
        self, household_id: str, limit: int = 50
    ) -> List[Dict]:
        """
        Get cooking history for a household
        
        Args:
            household_id: Household ID
            limit: Maximum number of entries to return
        
        Returns:
            List of cooking log dictionaries
        """
        try:
            client = self.admin_client if self.admin_client else self.client
            response = (
                client.table("cooking_log")
                .select("*")
                .eq("household_id", household_id)
                .order("cooked_at", desc=True)
                .limit(limit)
                .execute()
            )
            return response.data if response.data else []
        except Exception as e:
            logger.error(f"Failed to get cooking history for household {household_id}: {e}")
            raise DatabaseException(f"Failed to retrieve household cooking history: {e}")

    def get_staples_template_rows(self, active_only: bool = True) -> List[Dict]:
        """
        Load staples template rows for cold-start pantry setup (Layer 1).
        """
        try:
            client = self.admin_client if self.admin_client else self.client
            q = client.table("staples_template").select("*")
            if active_only:
                q = q.eq("active", True)
            response = q.execute()
            rows = response.data if response.data else []
            rows.sort(key=lambda r: (r.get("category") or "", r.get("sort_order") or 0))
            return rows
        except Exception as e:
            logger.error(f"Failed to load staples template: {e}")
            raise DatabaseException(f"Failed to load staples template: {e}")

    def get_receipt_items_for_household(
        self, household_id: str, receipt_limit: int = 80
    ) -> List[Dict]:
        """
        Receipt line items for a household, each dict includes receipt order_date for enrichment.
        """
        try:
            receipts = self.get_household_receipts(household_id, limit=receipt_limit)
            if not receipts:
                return []
            client = self.admin_client if self.admin_client else self.client
            out: List[Dict] = []
            for rec in receipts:
                rid = rec.get("id")
                order_date = rec.get("order_date")
                if not rid:
                    continue
                r2 = (
                    client.table("receipt_items")
                    .select("*")
                    .eq("receipt_id", rid)
                    .execute()
                )
                for row in r2.data or []:
                    row = dict(row)
                    row["_receipt_order_date"] = order_date
                    row["_receipt_id"] = rid
                    out.append(row)
            return out
        except Exception as e:
            logger.error(f"Failed to load receipt items for household {household_id}: {e}")
            raise DatabaseException(f"Failed to load receipt items for household: {e}")

    def update_pantry_item_fields(self, item_id: str, fields: Dict) -> None:
        """Partial update of a pantry row (service role)."""
        try:
            client = self.admin_client if self.admin_client else self.client
            client.table("pantry_items").update(fields).eq("id", item_id).execute()
            logger.info(f"Updated pantry item {item_id} fields: {list(fields.keys())}")
        except Exception as e:
            logger.error(f"Failed to update pantry item {item_id}: {e}")
            raise DatabaseException(f"Failed to update pantry item: {e}")

    def search_canonical_ingredients(
        self,
        query: str,
        limit: int = 6,
        exclude_bases: Optional[List[str]] = None,
    ) -> List[Dict]:
        """
        Layer 2: autocomplete against canonical_ingredients via RPC.
        """
        try:
            client = self.admin_client if self.admin_client else self.client
            q = (query or "").strip()
            if len(q) < 2:
                return []
            ex = exclude_bases or []
            response = client.rpc(
                "search_canonical_ingredients",
                {
                    "p_query": q,
                    "p_limit": min(max(limit, 1), 25),
                    "p_exclude": ex,
                },
            ).execute()
            return response.data if response.data else []
        except Exception as e:
            logger.error(f"Failed search_canonical_ingredients: {e}")
            raise DatabaseException(f"Failed to search ingredients: {e}")

    def list_active_canonical_ingredients_compact(self) -> List[Dict]:
        """
        All active canonical rows for voice extraction prompt (base_ingredient + display_name).
        """
        try:
            client = self.admin_client if self.admin_client else self.client
            response = (
                client.table("canonical_ingredients")
                .select("base_ingredient, display_name")
                .eq("active", True)
                .order("display_name")
                .execute()
            )
            return response.data if response.data else []
        except Exception as e:
            logger.error(f"Failed list_active_canonical_ingredients_compact: {e}")
            raise DatabaseException(f"Failed to load canonical ingredients: {e}")

    def get_canonical_ingredient_by_base(self, base_ingredient: str) -> Optional[Dict]:
        """Return one active canonical row by base_ingredient (normalized lowercase)."""
        try:
            key = (base_ingredient or "").strip().lower()
            if not key:
                return None
            client = self.admin_client if self.admin_client else self.client
            response = (
                client.table("canonical_ingredients")
                .select("base_ingredient, display_name, category")
                .eq("active", True)
                .eq("base_ingredient", key)
                .limit(1)
                .execute()
            )
            rows = response.data or []
            return rows[0] if rows else None
        except Exception as e:
            logger.error(f"Failed get_canonical_ingredient_by_base: {e}")
            raise DatabaseException(f"Failed to load canonical ingredient: {e}")

    def get_pantry_item_by_id(self, item_id: str) -> Optional[Dict]:
        try:
            client = self.admin_client if self.admin_client else self.client
            response = (
                client.table("pantry_items")
                .select("*")
                .eq("id", item_id)
                .limit(1)
                .execute()
            )
            rows = response.data if response.data else []
            return rows[0] if rows else None
        except Exception as e:
            logger.error(f"Failed get_pantry_item_by_id: {e}")
            raise DatabaseException(f"Failed to get pantry item: {e}")

    def insert_pantry_item_row(self, row: Dict) -> str:
        """Insert a pantry row as-is (restore after deplete). Returns id."""
        try:
            client = self.admin_client if self.admin_client else self.client
            response = client.table("pantry_items").insert(row).execute()
            if response.data and len(response.data) > 0:
                return response.data[0]["id"]
            raise DatabaseException("No data returned after pantry insert")
        except Exception as e:
            logger.error(f"Failed insert_pantry_item_row: {e}")
            raise DatabaseException(f"Failed to restore pantry item: {e}")

    def get_user_preferences(self, user_id: str) -> Optional[Dict]:
        """Depletion user_preferences row (household_size, depletion_multiplier)."""
        try:
            client = self.admin_client if self.admin_client else self.client
            response = (
                client.table("user_preferences")
                .select("*")
                .eq("user_id", user_id)
                .limit(1)
                .execute()
            )
            rows = response.data if response.data else []
            return rows[0] if rows else None
        except Exception as e:
            logger.error(f"Failed get_user_preferences: {e}")
            raise DatabaseException(f"Failed to get user preferences: {e}")

    def get_item_classifications_by_names(
        self, item_names: List[str]
    ) -> Dict[str, Dict]:
        """Map item_name -> item_classification row (empty if none)."""
        if not item_names:
            return {}
        try:
            client = self.admin_client if self.admin_client else self.client
            response = (
                client.table("item_classification")
                .select("*")
                .in_("item_name", list(dict.fromkeys(item_names)))
                .execute()
            )
            rows = response.data if response.data else []
            return {r["item_name"]: r for r in rows}
        except Exception as e:
            logger.error(f"Failed get_item_classifications_by_names: {e}")
            raise DatabaseException(f"Failed to get item classifications: {e}")

    def get_ingredient_signal_counts(self, user_id: str) -> Dict[str, int]:
        """Map item_name -> dismiss_count for Phase 3 aspirational signal."""
        try:
            client = self.admin_client if self.admin_client else self.client
            response = (
                client.table("ingredient_signals")
                .select("item_name, dismiss_count")
                .eq("user_id", user_id)
                .execute()
            )
            rows = response.data if response.data else []
            return {r["item_name"]: int(r.get("dismiss_count") or 0) for r in rows}
        except Exception as e:
            logger.error(f"Failed get_ingredient_signal_counts: {e}")
            raise DatabaseException(f"Failed to get ingredient signals: {e}")

    def increment_ingredient_dismiss_counts(
        self, user_id: str, item_names: List[str]
    ) -> None:
        """Increment dismiss_count per item_name (insert at 1 if missing)."""
        if not item_names:
            return
        client = self.admin_client if self.admin_client else self.client
        for name in dict.fromkeys(item_names):
            try:
                resp = (
                    client.table("ingredient_signals")
                    .select("id, dismiss_count")
                    .eq("user_id", user_id)
                    .eq("item_name", name)
                    .limit(1)
                    .execute()
                )
                rows = resp.data if resp.data else []
                if rows:
                    new_c = int(rows[0].get("dismiss_count") or 0) + 1
                    client.table("ingredient_signals").update(
                        {"dismiss_count": new_c}
                    ).eq("id", rows[0]["id"]).execute()
                else:
                    client.table("ingredient_signals").insert(
                        {
                            "user_id": user_id,
                            "item_name": name,
                            "dismiss_count": 1,
                        }
                    ).execute()
            except Exception as e:
                logger.error(f"increment_ingredient_dismiss_counts failed for {name}: {e}")
                raise DatabaseException(f"Failed to update ingredient signal: {e}")


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

