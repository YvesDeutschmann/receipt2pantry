#!/usr/bin/env python3
"""
Create test user and household using Supabase service.

This script creates the test user and household needed for testing
the meal planning wizard with comprehensive ingredient data.
"""

import os
import sys
from datetime import datetime

# Add project root to path
project_root = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, project_root)

from backend.services.supabase_service import SupabaseService
from backend.config import Config

# Test user and household IDs
TEST_USER_ID = "00000000-0000-0000-0000-000000000001"
TEST_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000002"

def create_test_user_and_household():
    """Create test user and household in the database."""
    
    # Initialize Supabase service
    config = Config()
    supabase = SupabaseService(
        url=config.SUPABASE_URL,
        key=config.SUPABASE_KEY,
        service_role_key=config.SUPABASE_SERVICE_ROLE_KEY
    )
    
    print("👤 Creating test user and household...")
    
    try:
        # Use admin client to bypass RLS and access auth tables
        admin_client = supabase.admin_client
        
        if not admin_client:
            print("❌ Admin client not available. Please set SUPABASE_SERVICE_ROLE_KEY.")
            return False
        
        # Check if test user already exists
        print("\n🔍 Checking if test user exists...")
        try:
            existing_user = admin_client.table("auth.users").select("id").eq("id", TEST_USER_ID).execute()
            if existing_user.data:
                print("   ✅ Test user already exists")
            else:
                print("   ℹ️  Test user not found, will create via household")
        except Exception as e:
            print(f"   ⚠️  Could not check existing user: {e}")
        
        # Check if test household exists
        print("\n🏠 Checking if test household exists...")
        try:
            existing_household = admin_client.table("households").select("*").eq("id", TEST_HOUSEHOLD_ID).execute()
            if existing_household.data:
                print("   ✅ Test household already exists")
                household_exists = True
            else:
                print("   ❌ Test household not found, creating...")
                household_exists = False
        except Exception as e:
            print(f"   ❌ Error checking household: {e}")
            household_exists = False
        
        # Create household if it doesn't exist
        if not household_exists:
            try:
                household_data = {
                    "id": TEST_HOUSEHOLD_ID,
                    "name": "Test Household",
                    "created_by": TEST_USER_ID,
                    "join_code": "TEST123"
                }
                
                result = admin_client.table("households").insert(household_data).execute()
                if result.data:
                    print("   ✅ Test household created successfully")
                else:
                    print("   ❌ Failed to create household - no data returned")
                    return False
                    
            except Exception as e:
                print(f"   ❌ Error creating household: {e}")
                return False
        
        # Check if test user is a member of the household
        print("\n👥 Checking household membership...")
        try:
            membership = admin_client.table("household_members").select("*").eq("user_id", TEST_USER_ID).execute()
            if membership.data:
                print("   ✅ Test user is already a household member")
            else:
                print("   ❌ Test user not a member, adding...")
                
                # Add user as household member
                member_data = {
                    "household_id": TEST_HOUSEHOLD_ID,
                    "user_id": TEST_USER_ID,
                    "role": "owner"
                }
                
                result = admin_client.table("household_members").insert(member_data).execute()
                if result.data:
                    print("   ✅ Test user added to household successfully")
                else:
                    print("   ❌ Failed to add user to household")
                    return False
            
            # Double-check membership by household_id
            household_membership = admin_client.table("household_members").select("*").eq("household_id", TEST_HOUSEHOLD_ID).execute()
            if household_membership.data:
                print(f"   ✅ Household has {len(household_membership.data)} member(s)")
                for member in household_membership.data:
                    print(f"      • User {member['user_id']}: {member['role']}")
            else:
                print("   ❌ No members found for household, attempting to add...")
                # Force add the membership
                member_data = {
                    "household_id": TEST_HOUSEHOLD_ID,
                    "user_id": TEST_USER_ID,
                    "role": "owner"
                }
                
                result = admin_client.table("household_members").upsert(member_data).execute()
                if result.data:
                    print("   ✅ Test user membership ensured")
                else:
                    print("   ❌ Failed to ensure membership")
                    
        except Exception as e:
            print(f"   ❌ Error managing household membership: {e}")
            return False
        
        # Verify the setup
        print("\n🔍 Verifying test setup...")
        try:
            # Check household
            household = admin_client.table("households").select("*").eq("id", TEST_HOUSEHOLD_ID).execute()
            if household.data:
                print(f"   ✅ Household: {household.data[0]['name']}")
                print(f"   ✅ Join Code: {household.data[0]['join_code']}")
            
            # Check membership
            members = admin_client.table("household_members").select("*").eq("household_id", TEST_HOUSEHOLD_ID).execute()
            if members.data:
                print(f"   ✅ Members: {len(members.data)}")
                for member in members.data:
                    print(f"      • User {member['user_id']}: {member['role']}")
            
        except Exception as e:
            print(f"   ⚠️  Could not verify setup: {e}")
        
        print(f"\n🎉 Test user and household setup complete!")
        print(f"   Test User ID: {TEST_USER_ID}")
        print(f"   Test Household ID: {TEST_HOUSEHOLD_ID}")
        print(f"   Join Code: TEST123")
        
        return True
        
    except Exception as e:
        print(f"❌ Failed to create test user and household: {e}")
        return False

if __name__ == "__main__":
    success = create_test_user_and_household()
    if success:
        print("\n✅ Ready to populate pantry data!")
    else:
        print("\n❌ Setup failed. Please check your database configuration.")
        sys.exit(1)