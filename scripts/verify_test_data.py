#!/usr/bin/env python3
"""
Verify comprehensive test data setup.

This script checks that all test data has been properly populated
for the meal planning wizard testing.
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

def verify_test_data():
    """Verify all test data has been properly set up."""
    
    # Initialize Supabase service
    config = Config()
    supabase = SupabaseService(
        url=config.SUPABASE_URL,
        key=config.SUPABASE_KEY,
        service_role_key=config.SUPABASE_SERVICE_ROLE_KEY
    )
    
    print("🔍 Verifying comprehensive test data setup...")
    print("=" * 60)
    
    admin_client = supabase.admin_client
    if not admin_client:
        print("❌ Admin client not available")
        return False
    
    all_checks_passed = True
    
    # Check test household
    print("\n🏠 Checking test household...")
    try:
        household = admin_client.table("households").select("*").eq("id", TEST_HOUSEHOLD_ID).execute()
        if household.data:
            h = household.data[0]
            print(f"   ✅ Household: {h['name']}")
            print(f"   ✅ Join Code: {h['join_code']}")
            print(f"   ✅ Created By: {h['created_by']}")
        else:
            print("   ❌ Test household not found")
            all_checks_passed = False
    except Exception as e:
        print(f"   ❌ Error checking household: {e}")
        all_checks_passed = False
    
    # Check household membership
    print("\n👥 Checking household membership...")
    try:
        members = admin_client.table("household_members").select("*").eq("household_id", TEST_HOUSEHOLD_ID).execute()
        if members.data:
            print(f"   ✅ Members: {len(members.data)}")
            for member in members.data:
                print(f"      • User {member['user_id']}: {member['role']}")
        else:
            print("   ❌ No household members found")
            all_checks_passed = False
    except Exception as e:
        print(f"   ❌ Error checking membership: {e}")
        all_checks_passed = False
    
    # Check pantry items
    print("\n🥫 Checking pantry items...")
    try:
        pantry_items = admin_client.table("pantry_items").select("*").eq("household_id", TEST_HOUSEHOLD_ID).execute()
        if pantry_items.data:
            total_items = len(pantry_items.data)
            print(f"   ✅ Total pantry items: {total_items}")
            
            # Count by category
            category_counts = {}
            product_type_counts = {}
            
            for item in pantry_items.data:
                cat = item.get("category", "unknown")
                category_counts[cat] = category_counts.get(cat, 0) + 1
                
                ptype = item.get("product_type", "unknown")
                product_type_counts[ptype] = product_type_counts.get(ptype, 0) + 1
            
            print("   Categories:")
            for category, count in sorted(category_counts.items()):
                print(f"     • {category}: {count}")
            
            print("   Product types:")
            for ptype, count in sorted(product_type_counts.items()):
                print(f"     • {ptype}: {count}")
            
            # Check for items with expiration dates
            items_with_expiry = [item for item in pantry_items.data if item.get("expires_at")]
            print(f"   ✅ Items with expiration dates: {len(items_with_expiry)}")
            
            if total_items < 100:
                print(f"   ⚠️  Expected 100+ items, found {total_items}")
        else:
            print("   ❌ No pantry items found")
            all_checks_passed = False
    except Exception as e:
        print(f"   ❌ Error checking pantry: {e}")
        all_checks_passed = False
    
    # Check ingredient substitutions
    print("\n🔄 Checking ingredient substitutions...")
    try:
        substitutions = admin_client.table("ingredient_substitutions").select("*").eq("source", "test_script").execute()
        if substitutions.data:
            total_subs = len(substitutions.data)
            print(f"   ✅ Total substitutions: {total_subs}")
            
            # Count by type
            type_counts = {}
            acceptable_count = 0
            
            for sub in substitutions.data:
                sub_type = sub.get("substitution_type", "unknown")
                type_counts[sub_type] = type_counts.get(sub_type, 0) + 1
                
                if sub.get("acceptable", False):
                    acceptable_count += 1
            
            print("   Types:")
            for sub_type, count in sorted(type_counts.items()):
                print(f"     • {sub_type}: {count}")
            
            print(f"   ✅ Acceptable substitutions: {acceptable_count}")
            print(f"   ✅ Not recommended: {total_subs - acceptable_count}")
            
            if total_subs < 50:
                print(f"   ⚠️  Expected 50+ substitutions, found {total_subs}")
        else:
            print("   ❌ No ingredient substitutions found")
            all_checks_passed = False
    except Exception as e:
        print(f"   ❌ Error checking substitutions: {e}")
        all_checks_passed = False
    
    # Check product mappings
    print("\n🗂️  Checking product mappings...")
    try:
        mappings = admin_client.table("product_mappings").select("*").eq("source", "test_script").execute()
        if mappings.data:
            total_mappings = len(mappings.data)
            print(f"   ✅ Total product mappings: {total_mappings}")
            
            # Count by category
            category_counts = {}
            verified_count = 0
            
            for mapping in mappings.data:
                cat = mapping.get("category", "unknown")
                category_counts[cat] = category_counts.get(cat, 0) + 1
                
                if mapping.get("verified", False):
                    verified_count += 1
            
            print("   Categories:")
            for category, count in sorted(category_counts.items()):
                print(f"     • {category}: {count}")
            
            print(f"   ✅ Verified mappings: {verified_count}")
            
            if total_mappings < 30:
                print(f"   ⚠️  Expected 30+ mappings, found {total_mappings}")
        else:
            print("   ❌ No product mappings found")
            all_checks_passed = False
    except Exception as e:
        print(f"   ❌ Error checking mappings: {e}")
        all_checks_passed = False
    
    # Summary
    print("\n" + "=" * 60)
    print("📊 VERIFICATION SUMMARY")
    print("=" * 60)
    
    if all_checks_passed:
        print("🎉 ALL CHECKS PASSED!")
        print("\n✅ Your test environment is fully configured for meal planning wizard testing!")
        
        print("\n📋 Test Data Summary:")
        print(f"   • Test User ID: {TEST_USER_ID}")
        print(f"   • Test Household ID: {TEST_HOUSEHOLD_ID}")
        print(f"   • Join Code: TEST123")
        print("   • Comprehensive pantry with 100+ realistic ingredients")
        print("   • Ingredient substitutions for flexible recipe matching")
        print("   • Product mappings for better receipt normalization")
        print("   • Categories: meat, dairy, vegetables, fruits, grains, etc.")
        print("   • Product types: fresh, frozen, refrigerated, shelf-stable")
        print("   • Expiration dates for perishable items")
        
        print("\n🧪 Testing Suggestions:")
        print("   • Test meal planning with various dietary preferences")
        print("   • Try recipes that require ingredient substitutions")
        print("   • Test with ingredients near expiration dates")
        print("   • Verify household-scoped pantry access")
        print("   • Test recipe recommendations based on available ingredients")
        
    else:
        print("❌ SOME CHECKS FAILED")
        print("   Please review the errors above and re-run the setup scripts")
    
    print("=" * 60)
    
    return all_checks_passed

if __name__ == "__main__":
    success = verify_test_data()
    if not success:
        sys.exit(1)