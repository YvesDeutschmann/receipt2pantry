"""Household management service for sharing pantry and recipes"""

import random
import string
from typing import Dict, List, Optional

from backend.services.supabase_service import SupabaseService
from backend.utils.exceptions import (
    DatabaseException,
    ValidationException,
    AuthorizationException,
)
from backend.utils.logger import get_logger

logger = get_logger(__name__)

# Characters for join code generation (excluding confusing chars like 0,O,1,I)
JOIN_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
JOIN_CODE_LENGTH = 6


class HouseholdService:
    """Service for managing household membership and sharing"""
    
    def __init__(self, supabase: SupabaseService):
        """
        Initialize HouseholdService
        
        Args:
            supabase: Supabase service instance
        """
        self.supabase = supabase
    
    def _generate_join_code(self) -> str:
        """
        Generate a unique 6-character join code
        
        Returns:
            Unique join code string
        """
        max_attempts = 10
        for _ in range(max_attempts):
            code = ''.join(random.choices(JOIN_CODE_CHARS, k=JOIN_CODE_LENGTH))
            if self.supabase.is_join_code_unique(code):
                return code
        
        # If we can't generate a unique code, raise an error
        raise DatabaseException("Failed to generate unique join code")
    
    def create_household(self, user_id: str, name: str) -> Dict:
        """
        Create a new household with the user as owner
        
        Args:
            user_id: User ID of the creator
            name: Name for the household
        
        Returns:
            Created household dictionary
        
        Raises:
            ValidationException: If user already in a household
        """
        # Check if user already has a household
        existing = self.supabase.get_user_household(user_id)
        if existing:
            raise ValidationException(
                "You are already a member of a household. "
                "Please leave your current household first."
            )
        
        # Validate name
        if not name or not name.strip():
            raise ValidationException("Household name is required")
        
        name = name.strip()
        if len(name) > 100:
            raise ValidationException("Household name must be 100 characters or less")
        
        # Generate join code
        join_code = self._generate_join_code()
        
        # Create household
        household = self.supabase.create_household(user_id, name, join_code)
        
        logger.info(f"User {user_id} created household '{name}' with code {join_code}")
        
        return {
            "id": household["id"],
            "name": household["name"],
            "join_code": household["join_code"],
            "role": "owner",
            "created_at": household["created_at"]
        }
    
    def join_household(self, user_id: str, join_code: str) -> Dict:
        """
        Join an existing household using a join code
        
        Args:
            user_id: User ID
            join_code: Household join code
        
        Returns:
            Joined household dictionary
        
        Raises:
            ValidationException: If code invalid or user already in household
        """
        # Check if user already has a household
        existing = self.supabase.get_user_household(user_id)
        if existing:
            raise ValidationException(
                "You are already a member of a household. "
                "Please leave your current household first."
            )
        
        # Validate join code format
        if not join_code or len(join_code.strip()) != JOIN_CODE_LENGTH:
            raise ValidationException(f"Join code must be {JOIN_CODE_LENGTH} characters")
        
        join_code = join_code.strip().upper()
        
        # Find household by code
        household = self.supabase.get_household_by_code(join_code)
        if not household:
            raise ValidationException("Invalid join code. Please check and try again.")
        
        # Add user as member
        self.supabase.add_household_member(household["id"], user_id, "member")
        
        logger.info(f"User {user_id} joined household '{household['name']}'")
        
        return {
            "id": household["id"],
            "name": household["name"],
            "join_code": household["join_code"],
            "role": "member",
            "created_at": household["created_at"]
        }
    
    def leave_household(self, user_id: str) -> None:
        """
        Leave the current household
        
        Args:
            user_id: User ID
        
        Raises:
            ValidationException: If user not in a household
            AuthorizationException: If owner tries to leave with other members
        """
        # Get user's household
        household = self.supabase.get_user_household(user_id)
        if not household:
            raise ValidationException("You are not a member of any household")
        
        household_id = household["id"]
        role = household["role"]
        
        # If user is owner, check if there are other members
        if role == "owner":
            members = self.supabase.get_household_members(household_id)
            if len(members) > 1:
                raise AuthorizationException(
                    "Cannot leave as owner while other members exist. "
                    "Transfer ownership or remove all members first."
                )
            
            # Owner is only member, delete the household
            self.supabase.delete_household(household_id)
            logger.info(f"User {user_id} deleted household {household_id} (was sole owner)")
        else:
            # Regular member, just remove
            self.supabase.remove_household_member(user_id)
            logger.info(f"User {user_id} left household {household_id}")
    
    def get_household(self, user_id: str) -> Optional[Dict]:
        """
        Get the user's current household
        
        Args:
            user_id: User ID
        
        Returns:
            Household dictionary or None
        """
        return self.supabase.get_user_household(user_id)
    
    def get_household_id(self, user_id: str) -> Optional[str]:
        """
        Get just the household ID for a user
        
        Args:
            user_id: User ID
        
        Returns:
            Household ID or None
        """
        household = self.supabase.get_user_household(user_id)
        return household["id"] if household else None
    
    def get_members(self, user_id: str) -> List[Dict]:
        """
        Get all members of the user's household
        
        Args:
            user_id: User ID
        
        Returns:
            List of member dictionaries
        
        Raises:
            ValidationException: If user not in a household
        """
        household = self.supabase.get_user_household(user_id)
        if not household:
            raise ValidationException("You are not a member of any household")
        
        return self.supabase.get_household_members(household["id"])
    
    def regenerate_join_code(self, user_id: str) -> str:
        """
        Generate a new join code for the household (owner only)
        
        Args:
            user_id: User ID (must be owner)
        
        Returns:
            New join code
        
        Raises:
            ValidationException: If user not in a household
            AuthorizationException: If user is not the owner
        """
        household = self.supabase.get_user_household(user_id)
        if not household:
            raise ValidationException("You are not a member of any household")
        
        if household["role"] != "owner":
            raise AuthorizationException("Only the household owner can regenerate the join code")
        
        # Generate new code
        new_code = self._generate_join_code()
        
        # Update household
        self.supabase.update_household(household["id"], {"join_code": new_code})
        
        logger.info(f"User {user_id} regenerated join code for household {household['id']}")
        
        return new_code
    
    def remove_member(self, owner_user_id: str, target_user_id: str) -> None:
        """
        Remove a member from the household (owner only)
        
        Args:
            owner_user_id: User ID of the owner
            target_user_id: User ID of the member to remove
        
        Raises:
            ValidationException: If users not in same household
            AuthorizationException: If requester is not owner
        """
        # Get owner's household
        household = self.supabase.get_user_household(owner_user_id)
        if not household:
            raise ValidationException("You are not a member of any household")
        
        if household["role"] != "owner":
            raise AuthorizationException("Only the household owner can remove members")
        
        # Can't remove self (use leave_household instead)
        if owner_user_id == target_user_id:
            raise ValidationException("Cannot remove yourself. Use leave household instead.")
        
        # Check target is in same household
        target_household = self.supabase.get_user_household(target_user_id)
        if not target_household or target_household["id"] != household["id"]:
            raise ValidationException("User is not a member of your household")
        
        # Remove member
        self.supabase.remove_household_member(target_user_id)
        
        logger.info(
            f"Owner {owner_user_id} removed user {target_user_id} "
            f"from household {household['id']}"
        )
    
    def update_household_name(self, user_id: str, new_name: str) -> Dict:
        """
        Update the household name (owner only)
        
        Args:
            user_id: User ID (must be owner)
            new_name: New household name
        
        Returns:
            Updated household dictionary
        
        Raises:
            ValidationException: If name invalid or user not in household
            AuthorizationException: If user is not the owner
        """
        household = self.supabase.get_user_household(user_id)
        if not household:
            raise ValidationException("You are not a member of any household")
        
        if household["role"] != "owner":
            raise AuthorizationException("Only the household owner can update the name")
        
        # Validate name
        if not new_name or not new_name.strip():
            raise ValidationException("Household name is required")
        
        new_name = new_name.strip()
        if len(new_name) > 100:
            raise ValidationException("Household name must be 100 characters or less")
        
        # Update household
        self.supabase.update_household(household["id"], {"name": new_name})
        
        logger.info(f"User {user_id} renamed household {household['id']} to '{new_name}'")
        
        return {
            "id": household["id"],
            "name": new_name,
            "join_code": household["join_code"],
            "role": household["role"]
        }


def create_household_service(supabase: SupabaseService) -> HouseholdService:
    """
    Factory function to create HouseholdService
    
    Args:
        supabase: Supabase service instance
    
    Returns:
        Initialized HouseholdService instance
    """
    return HouseholdService(supabase)
