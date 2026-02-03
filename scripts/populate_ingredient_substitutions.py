#!/usr/bin/env python3
"""
Populate ingredient substitutions table with common cooking substitutions.

This script adds realistic ingredient substitutions that the meal planning wizard
can use to suggest alternatives when exact ingredients aren't available.
"""

import os
import sys
from typing import Dict, List

# Add project root to path
project_root = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, project_root)

from backend.services.supabase_service import SupabaseService
from backend.config import Config

def get_ingredient_substitutions() -> List[Dict]:
    """
    Generate common ingredient substitutions for cooking.
    
    Returns:
        List of substitution dictionaries with ingredient, substitute, type, ratio, etc.
    """
    
    substitutions = []
    
    # Dairy substitutions
    dairy_subs = [
        # Milk variants
        {"ingredient": "milk", "substitute": "milk (whole)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "dairy"},
        {"ingredient": "milk", "substitute": "milk (2%)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "dairy"},
        {"ingredient": "milk", "substitute": "milk (skim)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "dairy"},
        {"ingredient": "whole milk", "substitute": "milk (whole)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "dairy"},
        
        # Butter variants
        {"ingredient": "butter", "substitute": "butter (salted)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "dairy"},
        {"ingredient": "butter", "substitute": "butter (unsalted)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "dairy"},
        {"ingredient": "salted butter", "substitute": "butter (salted)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "dairy"},
        {"ingredient": "unsalted butter", "substitute": "butter (unsalted)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "dairy"},
        
        # Butter alternatives
        {"ingredient": "butter", "substitute": "vegetable oil", "type": "ingredient", "ratio": 0.75, "acceptable": True, "category": "dairy", "notes": "Use 3/4 the amount of oil"},
        {"ingredient": "butter", "substitute": "olive oil", "type": "ingredient", "ratio": 0.75, "acceptable": True, "category": "dairy", "notes": "Use 3/4 the amount of oil"},
        
        # Cheese variants
        {"ingredient": "cheddar cheese", "substitute": "cheddar cheese (sharp)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "dairy"},
        {"ingredient": "mozzarella", "substitute": "mozzarella cheese (shredded)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "dairy"},
        
        # Cream substitutions
        {"ingredient": "heavy cream", "substitute": "milk", "type": "ingredient", "ratio": 1.0, "acceptable": False, "category": "dairy", "notes": "Will not whip, less rich"},
        {"ingredient": "sour cream", "substitute": "greek yogurt", "type": "ingredient", "ratio": 1.0, "acceptable": True, "category": "dairy"},
        {"ingredient": "cream cheese", "substitute": "greek yogurt", "type": "ingredient", "ratio": 1.0, "acceptable": False, "category": "dairy", "notes": "Different texture"},
    ]
    
    # Protein substitutions
    protein_subs = [
        # Chicken variants
        {"ingredient": "chicken breast", "substitute": "chicken breast (boneless skinless)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "meat"},
        {"ingredient": "chicken thighs", "substitute": "chicken thighs (bone-in skin-on)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "meat"},
        {"ingredient": "chicken", "substitute": "chicken breast (boneless skinless)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "meat"},
        {"ingredient": "chicken", "substitute": "chicken thighs (bone-in skin-on)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "meat"},
        
        # Protein swaps
        {"ingredient": "chicken breast", "substitute": "chicken thighs", "type": "ingredient", "ratio": 1.0, "acceptable": True, "category": "meat", "notes": "Thighs are more flavorful"},
        {"ingredient": "chicken thighs", "substitute": "chicken breast", "type": "ingredient", "ratio": 1.0, "acceptable": True, "category": "meat", "notes": "Breast is leaner"},
        {"ingredient": "ground beef", "substitute": "ground chicken", "type": "ingredient", "ratio": 1.0, "acceptable": True, "category": "meat"},
        {"ingredient": "ground chicken", "substitute": "ground beef", "type": "ingredient", "ratio": 1.0, "acceptable": True, "category": "meat"},
        
        # Ground beef variants
        {"ingredient": "ground beef", "substitute": "ground beef (80/20)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "meat"},
        {"ingredient": "ground beef", "substitute": "ground chicken (93/7 lean)", "type": "ingredient", "ratio": 1.0, "acceptable": True, "category": "meat"},
        
        # Seafood
        {"ingredient": "salmon", "substitute": "salmon fillets (atlantic)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "seafood"},
        {"ingredient": "shrimp", "substitute": "shrimp (large peeled deveined)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "seafood"},
        {"ingredient": "white fish", "substitute": "cod fillets", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "seafood"},
        {"ingredient": "fish", "substitute": "salmon fillets (atlantic)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "seafood"},
        {"ingredient": "fish", "substitute": "cod fillets", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "seafood"},
    ]
    
    # Vegetable substitutions
    vegetable_subs = [
        # Onion variants
        {"ingredient": "onions", "substitute": "onions (yellow)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "vegetables"},
        {"ingredient": "yellow onion", "substitute": "onions (yellow)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "vegetables"},
        {"ingredient": "onion", "substitute": "onions (yellow)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "vegetables"},
        
        # Bell pepper variants
        {"ingredient": "bell pepper", "substitute": "bell peppers (red)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "vegetables"},
        {"ingredient": "bell pepper", "substitute": "bell peppers (green)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "vegetables"},
        {"ingredient": "red bell pepper", "substitute": "bell peppers (red)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "vegetables"},
        {"ingredient": "green bell pepper", "substitute": "bell peppers (green)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "vegetables"},
        
        # Fresh vs frozen vegetables
        {"ingredient": "broccoli", "substitute": "broccoli (frozen florets)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "vegetables"},
        {"ingredient": "fresh broccoli", "substitute": "broccoli (frozen florets)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "vegetables"},
        {"ingredient": "spinach", "substitute": "spinach (baby)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "vegetables"},
        {"ingredient": "spinach", "substitute": "spinach (frozen chopped)", "type": "variant", "ratio": 0.5, "acceptable": True, "category": "vegetables", "notes": "Frozen is more concentrated"},
        {"ingredient": "fresh spinach", "substitute": "spinach (frozen chopped)", "type": "variant", "ratio": 0.5, "acceptable": True, "category": "vegetables"},
        
        # Tomato variants
        {"ingredient": "tomatoes", "substitute": "tomatoes (roma)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "vegetables"},
        {"ingredient": "fresh tomatoes", "substitute": "diced tomatoes (canned)", "type": "ingredient", "ratio": 1.0, "acceptable": True, "category": "vegetables"},
        {"ingredient": "tomatoes", "substitute": "diced tomatoes (canned)", "type": "ingredient", "ratio": 1.0, "acceptable": True, "category": "vegetables"},
        
        # Potato variants
        {"ingredient": "potatoes", "substitute": "potatoes (russet)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "vegetables"},
        {"ingredient": "russet potatoes", "substitute": "potatoes (russet)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "vegetables"},
        {"ingredient": "potatoes", "substitute": "sweet potatoes", "type": "ingredient", "ratio": 1.0, "acceptable": True, "category": "vegetables"},
        
        # Mushroom variants
        {"ingredient": "mushrooms", "substitute": "mushrooms (white button)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "vegetables"},
        {"ingredient": "button mushrooms", "substitute": "mushrooms (white button)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "vegetables"},
    ]
    
    # Grain substitutions
    grain_subs = [
        # Rice variants
        {"ingredient": "rice", "substitute": "rice (jasmine)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "grains"},
        {"ingredient": "rice", "substitute": "rice (brown)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "grains"},
        {"ingredient": "white rice", "substitute": "rice (jasmine)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "grains"},
        {"ingredient": "brown rice", "substitute": "rice (brown)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "grains"},
        {"ingredient": "jasmine rice", "substitute": "rice (jasmine)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "grains"},
        
        # Grain alternatives
        {"ingredient": "rice", "substitute": "quinoa", "type": "ingredient", "ratio": 1.0, "acceptable": True, "category": "grains"},
        {"ingredient": "quinoa", "substitute": "rice (brown)", "type": "ingredient", "ratio": 1.0, "acceptable": True, "category": "grains"},
        
        # Pasta variants
        {"ingredient": "pasta", "substitute": "pasta (spaghetti)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "grains"},
        {"ingredient": "pasta", "substitute": "pasta (penne)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "grains"},
        {"ingredient": "spaghetti", "substitute": "pasta (spaghetti)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "grains"},
        {"ingredient": "penne", "substitute": "pasta (penne)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "grains"},
        
        # Bread variants
        {"ingredient": "bread", "substitute": "bread (whole wheat)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "grains"},
        {"ingredient": "whole wheat bread", "substitute": "bread (whole wheat)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "grains"},
        
        # Flour variants
        {"ingredient": "flour", "substitute": "flour (all purpose)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "grains"},
        {"ingredient": "all purpose flour", "substitute": "flour (all purpose)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "grains"},
    ]
    
    # Bean and legume substitutions
    legume_subs = [
        # Bean variants
        {"ingredient": "black beans", "substitute": "black beans (canned)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "legumes"},
        {"ingredient": "kidney beans", "substitute": "kidney beans (canned)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "legumes"},
        {"ingredient": "chickpeas", "substitute": "chickpeas (canned)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "legumes"},
        {"ingredient": "garbanzo beans", "substitute": "chickpeas (canned)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "legumes"},
        
        # Bean swaps
        {"ingredient": "black beans", "substitute": "kidney beans (canned)", "type": "ingredient", "ratio": 1.0, "acceptable": True, "category": "legumes"},
        {"ingredient": "kidney beans", "substitute": "black beans (canned)", "type": "ingredient", "ratio": 1.0, "acceptable": True, "category": "legumes"},
        
        # Lentil variants
        {"ingredient": "lentils", "substitute": "lentils (red)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "legumes"},
        {"ingredient": "lentils", "substitute": "lentils (green)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "legumes"},
        {"ingredient": "red lentils", "substitute": "lentils (red)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "legumes"},
        {"ingredient": "green lentils", "substitute": "lentils (green)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "legumes"},
    ]
    
    # Oil and fat substitutions
    oil_subs = [
        # Oil variants
        {"ingredient": "olive oil", "substitute": "olive oil (extra virgin)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "oils"},
        {"ingredient": "extra virgin olive oil", "substitute": "olive oil (extra virgin)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "oils"},
        
        # Oil alternatives
        {"ingredient": "vegetable oil", "substitute": "olive oil (extra virgin)", "type": "ingredient", "ratio": 1.0, "acceptable": True, "category": "oils"},
        {"ingredient": "olive oil", "substitute": "vegetable oil", "type": "ingredient", "ratio": 1.0, "acceptable": True, "category": "oils"},
        {"ingredient": "coconut oil", "substitute": "vegetable oil", "type": "ingredient", "ratio": 1.0, "acceptable": True, "category": "oils"},
    ]
    
    # Spice and seasoning substitutions
    spice_subs = [
        # Fresh vs dried herbs
        {"ingredient": "fresh basil", "substitute": "basil (dried)", "type": "ingredient", "ratio": 0.33, "acceptable": True, "category": "seasonings", "notes": "Use 1/3 the amount of dried"},
        {"ingredient": "fresh oregano", "substitute": "oregano (dried)", "type": "ingredient", "ratio": 0.33, "acceptable": True, "category": "seasonings", "notes": "Use 1/3 the amount of dried"},
        {"ingredient": "fresh thyme", "substitute": "thyme (dried)", "type": "ingredient", "ratio": 0.33, "acceptable": True, "category": "seasonings", "notes": "Use 1/3 the amount of dried"},
        
        # Spice variants
        {"ingredient": "garlic", "substitute": "garlic powder", "type": "ingredient", "ratio": 0.125, "acceptable": True, "category": "seasonings", "notes": "1 clove = 1/8 tsp powder"},
        {"ingredient": "onion", "substitute": "onion powder", "type": "ingredient", "ratio": 0.25, "acceptable": False, "category": "seasonings", "notes": "Different texture, emergency only"},
        
        # Salt variants
        {"ingredient": "salt", "substitute": "salt (kosher)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "seasonings"},
        {"ingredient": "kosher salt", "substitute": "salt (kosher)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "seasonings"},
        
        # Pepper variants
        {"ingredient": "black pepper", "substitute": "black pepper (ground)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "seasonings"},
        {"ingredient": "ground black pepper", "substitute": "black pepper (ground)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "seasonings"},
    ]
    
    # Broth substitutions
    broth_subs = [
        # Broth variants
        {"ingredient": "chicken broth", "substitute": "chicken broth (low sodium)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "broth"},
        {"ingredient": "beef broth", "substitute": "beef broth (low sodium)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "broth"},
        {"ingredient": "vegetable broth", "substitute": "vegetable broth (low sodium)", "type": "variant", "ratio": 1.0, "acceptable": True, "category": "broth"},
        
        # Broth swaps
        {"ingredient": "chicken broth", "substitute": "vegetable broth (low sodium)", "type": "ingredient", "ratio": 1.0, "acceptable": True, "category": "broth"},
        {"ingredient": "beef broth", "substitute": "chicken broth (low sodium)", "type": "ingredient", "ratio": 1.0, "acceptable": True, "category": "broth"},
        {"ingredient": "vegetable broth", "substitute": "chicken broth (low sodium)", "type": "ingredient", "ratio": 1.0, "acceptable": True, "category": "broth"},
    ]
    
    # Combine all substitutions
    all_substitutions = (
        dairy_subs + protein_subs + vegetable_subs + grain_subs + 
        legume_subs + oil_subs + spice_subs + broth_subs
    )
    
    # Add metadata to each substitution
    for sub in all_substitutions:
        sub["source"] = "test_script"
        sub["verified"] = True
        sub["confidence"] = 0.9 if sub["acceptable"] else 0.6
    
    return all_substitutions

def populate_substitutions():
    """Populate the ingredient substitutions table."""
    
    # Initialize Supabase service
    config = Config()
    supabase = SupabaseService(
        url=config.SUPABASE_URL,
        key=config.SUPABASE_KEY,
        service_role_key=config.SUPABASE_SERVICE_ROLE_KEY
    )
    
    print("🔄 Populating ingredient substitutions...")
    
    # Get substitutions
    substitutions = get_ingredient_substitutions()
    
    print(f"📝 Generated {len(substitutions)} substitutions")
    
    # Group by type for summary
    type_counts = {}
    acceptable_counts = {"acceptable": 0, "not_recommended": 0}
    
    for sub in substitutions:
        sub_type = sub["type"]
        type_counts[sub_type] = type_counts.get(sub_type, 0) + 1
        
        if sub["acceptable"]:
            acceptable_counts["acceptable"] += 1
        else:
            acceptable_counts["not_recommended"] += 1
    
    print(f"   • Variants: {type_counts.get('variant', 0)}")
    print(f"   • Ingredient swaps: {type_counts.get('ingredient', 0)}")
    print(f"   • Acceptable: {acceptable_counts['acceptable']}")
    print(f"   • Not recommended: {acceptable_counts['not_recommended']}")
    
    # Clear existing substitutions (test data only)
    print("\n🧹 Clearing existing test substitutions...")
    try:
        # Use admin client to bypass RLS
        existing = supabase.admin_client.table("ingredient_substitutions").select("id").eq("source", "test_script").execute()
        if existing.data:
            sub_ids = [item["id"] for item in existing.data]
            supabase.admin_client.table("ingredient_substitutions").delete().in_("id", sub_ids).execute()
            print(f"   Removed {len(sub_ids)} existing test substitutions")
    except Exception as e:
        print(f"   Warning: Could not clear existing substitutions: {e}")
    
    # Insert new substitutions
    print("\n📥 Adding substitutions...")
    success_count = 0
    error_count = 0
    
    for i, sub in enumerate(substitutions, 1):
        try:
            # Prepare substitution data
            sub_data = {
                "ingredient": sub["ingredient"],
                "substitute": sub["substitute"],
                "substitution_type": sub["type"],
                "ratio": sub["ratio"],
                "category": sub["category"],
                "confidence": sub["confidence"],
                "acceptable": sub["acceptable"],
                "notes": sub.get("notes"),
                "source": sub["source"],
                "verified": sub["verified"]
            }
            
            # Use admin client to bypass RLS
            response = supabase.admin_client.table("ingredient_substitutions").insert(sub_data).execute()
            
            if response.data:
                success_count += 1
                if i % 50 == 0:  # Progress indicator
                    print(f"   Added {i}/{len(substitutions)} substitutions...")
            else:
                error_count += 1
                print(f"   ❌ Failed to add: {sub['ingredient']} → {sub['substitute']}")
                
        except Exception as e:
            error_count += 1
            print(f"   ❌ Error adding {sub['ingredient']} → {sub['substitute']}: {e}")
    
    print(f"\n✅ Substitution population complete!")
    print(f"   Successfully added: {success_count} substitutions")
    if error_count > 0:
        print(f"   Errors: {error_count} substitutions")
    
    # Verify the results
    print("\n🔍 Verifying substitutions...")
    try:
        all_subs = supabase.admin_client.table("ingredient_substitutions").select("*").eq("source", "test_script").execute()
        total_subs = len(all_subs.data) if all_subs.data else 0
        
        print(f"   Total substitutions in database: {total_subs}")
        
        if all_subs.data:
            # Count by type
            type_counts_db = {}
            for sub in all_subs.data:
                sub_type = sub.get("substitution_type", "unknown")
                type_counts_db[sub_type] = type_counts_db.get(sub_type, 0) + 1
            
            print("   Substitutions by type:")
            for sub_type, count in sorted(type_counts_db.items()):
                print(f"     • {sub_type}: {count}")
    
    except Exception as e:
        print(f"   ⚠️  Could not verify substitutions: {e}")
    
    print(f"\n🎉 Ingredient substitutions are ready!")

if __name__ == "__main__":
    populate_substitutions()