#!/usr/bin/env python3
"""
Comprehensive test data setup script for meal planning wizard.

This script populates:
1. Test pantry with realistic ingredients
2. Ingredient substitutions for flexible meal planning
3. Product mappings for better normalization

Run this script to prepare a complete test environment for the meal planning wizard.
"""

import os
import sys
import subprocess
from pathlib import Path

def run_script(script_name: str) -> bool:
    """
    Run a Python script and return success status.
    
    Args:
        script_name: Name of the script to run
        
    Returns:
        True if successful, False otherwise
    """
    script_path = Path(__file__).parent / script_name
    
    if not script_path.exists():
        print(f"❌ Script not found: {script_path}")
        return False
    
    try:
        print(f"\n{'='*60}")
        print(f"🚀 Running {script_name}")
        print(f"{'='*60}")
        
        # Run the script
        result = subprocess.run([
            sys.executable, str(script_path)
        ], capture_output=False, text=True)
        
        if result.returncode == 0:
            print(f"✅ {script_name} completed successfully")
            return True
        else:
            print(f"❌ {script_name} failed with exit code {result.returncode}")
            return False
            
    except Exception as e:
        print(f"❌ Error running {script_name}: {e}")
        return False

def main():
    """Main setup function."""
    
    print("🏠 Receipt2Pantry - Comprehensive Test Data Setup")
    print("=" * 60)
    print("This script will populate your test database with:")
    print("• Realistic pantry ingredients (100+ items)")
    print("• Ingredient substitutions for flexible cooking")
    print("• Product mappings for better normalization")
    print("=" * 60)
    
    # Confirm before proceeding (skip if non-interactive)
    try:
        response = input("\n🤔 Continue with test data setup? (y/N): ").strip().lower()
        if response not in ['y', 'yes']:
            print("❌ Setup cancelled by user")
            return
    except EOFError:
        # Non-interactive mode, proceed automatically
        print("\n🤖 Running in non-interactive mode, proceeding automatically...")
    
    scripts_to_run = [
        "populate_test_pantry.py",
        "populate_ingredient_substitutions.py",
        "populate_product_mappings.py"
    ]
    
    success_count = 0
    total_scripts = len(scripts_to_run)
    
    for script in scripts_to_run:
        if run_script(script):
            success_count += 1
        else:
            print(f"\n⚠️  {script} failed - continuing with remaining scripts...")
    
    print(f"\n{'='*60}")
    print("📊 SETUP SUMMARY")
    print(f"{'='*60}")
    print(f"Scripts run: {total_scripts}")
    print(f"Successful: {success_count}")
    print(f"Failed: {total_scripts - success_count}")
    
    if success_count == total_scripts:
        print("\n🎉 ALL SETUP COMPLETE!")
        print("\n✅ Your test environment is ready for meal planning wizard testing!")
        print("\n📋 What's been set up:")
        print("   • Test user: 00000000-0000-0000-0000-000000000001")
        print("   • Test household: 00000000-0000-0000-0000-000000000002")
        print("   • Comprehensive pantry with 100+ realistic ingredients")
        print("   • Ingredient substitutions for flexible recipe matching")
        print("   • Product mappings for better receipt normalization")
        print("   • Categories: meat, dairy, vegetables, fruits, grains, etc.")
        print("   • Product types: fresh, frozen, refrigerated, shelf-stable")
        print("   • Expiration dates for perishable items")
        
        print("\n🧪 Testing suggestions:")
        print("   • Test meal planning with various dietary preferences")
        print("   • Try recipes that require substitutions")
        print("   • Test with ingredients near expiration")
        print("   • Verify household-scoped pantry access")
        
    elif success_count > 0:
        print("\n⚠️  PARTIAL SETUP COMPLETE")
        print(f"   {success_count}/{total_scripts} scripts succeeded")
        print("   Some test data may be missing - check the logs above")
        
    else:
        print("\n❌ SETUP FAILED")
        print("   No scripts completed successfully")
        print("   Check your database connection and configuration")
    
    print(f"\n{'='*60}")

if __name__ == "__main__":
    main()