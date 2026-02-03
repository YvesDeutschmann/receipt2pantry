#!/usr/bin/env python3
"""
Fix household membership for test user.
"""

import os
import sys

# Add project root to path
project_root = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, project_root)

from backend.services.supabase_service import SupabaseService
from backend.config import Config

# Test user and household IDs
TEST_USER_ID = "00000000-0000-0000-0000-000000000001"
TEST_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000002"

def fix_membership():
    """Fix household membership."""
    
    config = Config()
    supabase = SupabaseService(
        url=config.SUPABASE_URL,
        key=config.SUPABASE_KEY,
        service_role_key=config.SUPABASE_SERVICE_ROLE_KEY
    )
    
    admin_client = supabase.admin_client
    
    print("🔧 Fixing household membership...")
    
    try:
        # Delete any existing membership first
        admin_client.table("household_members").delete().eq("user_id", TEST_USER_ID).execute()
        print("   Cleared existing membership")
        
        # Add fresh membership
        member_data = {
            "household_id": TEST_HOUSEHOLD_ID,
            "user_id": TEST_USER_ID,
            "role": "owner"
        }
        
        result = admin_client.table("household_members").insert(member_data).execute()
        if result.data:
            print("   ✅ Membership added successfully")
            return True
        else:
            print("   ❌ Failed to add membership")
            return False
            
    except Exception as e:
        print(f"   ❌ Error: {e}")
        return False

if __name__ == "__main__":
    fix_membership()