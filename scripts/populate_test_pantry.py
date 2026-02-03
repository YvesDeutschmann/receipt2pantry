#!/usr/bin/env python3
"""
Populate test pantry with comprehensive ingredient data for meal planning wizard testing.

This script creates a realistic, well-stocked pantry with ingredients commonly found
in households, including bulk items, frozen foods, fresh produce, dairy, and pantry staples.
"""

import os
import sys
from datetime import datetime, timedelta
from typing import Dict, List
import random

# Add project root to path
project_root = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, project_root)

from backend.services.supabase_service import SupabaseService
from backend.config import Config

# Test user and household IDs (from 010_create_test_user.sql)
TEST_USER_ID = "00000000-0000-0000-0000-000000000001"
TEST_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000002"

def get_comprehensive_ingredients() -> List[Dict]:
    """
    Generate a comprehensive list of pantry ingredients organized by category.
    Simulates a well-stocked household pantry, freezer, and refrigerator.
    """
    
    # Meat & Protein (Bulk purchased, mostly frozen)
    proteins = [
        # Chicken
        {"base_ingredient": "chicken breast", "variant": "boneless skinless", "quantity": 3.5, "unit": "lbs", "category": "meat", "product_type": "frozen"},
        {"base_ingredient": "chicken thighs", "variant": "bone-in skin-on", "quantity": 2.8, "unit": "lbs", "category": "meat", "product_type": "frozen"},
        {"base_ingredient": "chicken wings", "variant": "party wings", "quantity": 2.0, "unit": "lbs", "category": "meat", "product_type": "frozen"},
        {"base_ingredient": "ground chicken", "variant": "93/7 lean", "quantity": 1.0, "unit": "lbs", "category": "meat", "product_type": "frozen"},
        
        # Beef
        {"base_ingredient": "ground beef", "variant": "80/20", "quantity": 2.5, "unit": "lbs", "category": "meat", "product_type": "frozen"},
        {"base_ingredient": "beef chuck roast", "variant": None, "quantity": 3.2, "unit": "lbs", "category": "meat", "product_type": "frozen"},
        {"base_ingredient": "ribeye steak", "variant": None, "quantity": 1.5, "unit": "lbs", "category": "meat", "product_type": "frozen"},
        {"base_ingredient": "beef stew meat", "variant": None, "quantity": 2.0, "unit": "lbs", "category": "meat", "product_type": "frozen"},
        
        # Pork
        {"base_ingredient": "pork chops", "variant": "bone-in", "quantity": 2.0, "unit": "lbs", "category": "meat", "product_type": "frozen"},
        {"base_ingredient": "bacon", "variant": "thick cut", "quantity": 1.0, "unit": "lbs", "category": "meat", "product_type": "refrigerated"},
        {"base_ingredient": "italian sausage", "variant": "mild", "quantity": 1.5, "unit": "lbs", "category": "meat", "product_type": "frozen"},
        {"base_ingredient": "pork shoulder", "variant": None, "quantity": 4.0, "unit": "lbs", "category": "meat", "product_type": "frozen"},
        
        # Seafood
        {"base_ingredient": "salmon fillets", "variant": "atlantic", "quantity": 1.5, "unit": "lbs", "category": "seafood", "product_type": "frozen"},
        {"base_ingredient": "shrimp", "variant": "large peeled deveined", "quantity": 2.0, "unit": "lbs", "category": "seafood", "product_type": "frozen"},
        {"base_ingredient": "cod fillets", "variant": None, "quantity": 1.0, "unit": "lbs", "category": "seafood", "product_type": "frozen"},
        {"base_ingredient": "tuna", "variant": "canned in water", "quantity": 6.0, "unit": "cans", "category": "seafood", "product_type": "shelf-stable"},
    ]
    
    # Dairy & Eggs
    dairy = [
        {"base_ingredient": "milk", "variant": "whole", "quantity": 0.5, "unit": "gallon", "category": "dairy", "product_type": "refrigerated"},
        {"base_ingredient": "eggs", "variant": "large", "quantity": 18.0, "unit": "count", "category": "dairy", "product_type": "refrigerated"},
        {"base_ingredient": "butter", "variant": "unsalted", "quantity": 4.0, "unit": "sticks", "category": "dairy", "product_type": "refrigerated"},
        {"base_ingredient": "butter", "variant": "salted", "quantity": 4.0, "unit": "sticks", "category": "dairy", "product_type": "refrigerated"},
        {"base_ingredient": "cream cheese", "variant": "original", "quantity": 2.0, "unit": "packages", "category": "dairy", "product_type": "refrigerated"},
        {"base_ingredient": "sour cream", "variant": None, "quantity": 1.0, "unit": "container", "category": "dairy", "product_type": "refrigerated"},
        {"base_ingredient": "greek yogurt", "variant": "plain", "quantity": 32.0, "unit": "oz", "category": "dairy", "product_type": "refrigerated"},
        {"base_ingredient": "cheddar cheese", "variant": "sharp", "quantity": 8.0, "unit": "oz", "category": "dairy", "product_type": "refrigerated"},
        {"base_ingredient": "mozzarella cheese", "variant": "shredded", "quantity": 8.0, "unit": "oz", "category": "dairy", "product_type": "refrigerated"},
        {"base_ingredient": "parmesan cheese", "variant": "grated", "quantity": 6.0, "unit": "oz", "category": "dairy", "product_type": "refrigerated"},
        {"base_ingredient": "heavy cream", "variant": None, "quantity": 1.0, "unit": "pint", "category": "dairy", "product_type": "refrigerated"},
    ]
    
    # Fresh Vegetables
    fresh_vegetables = [
        {"base_ingredient": "onions", "variant": "yellow", "quantity": 3.0, "unit": "lbs", "category": "vegetables", "product_type": "fresh"},
        {"base_ingredient": "garlic", "variant": None, "quantity": 2.0, "unit": "heads", "category": "vegetables", "product_type": "fresh"},
        {"base_ingredient": "carrots", "variant": "baby", "quantity": 2.0, "unit": "lbs", "category": "vegetables", "product_type": "fresh"},
        {"base_ingredient": "celery", "variant": None, "quantity": 1.0, "unit": "bunch", "category": "vegetables", "product_type": "fresh"},
        {"base_ingredient": "bell peppers", "variant": "red", "quantity": 4.0, "unit": "count", "category": "vegetables", "product_type": "fresh"},
        {"base_ingredient": "bell peppers", "variant": "green", "quantity": 3.0, "unit": "count", "category": "vegetables", "product_type": "fresh"},
        {"base_ingredient": "tomatoes", "variant": "roma", "quantity": 2.0, "unit": "lbs", "category": "vegetables", "product_type": "fresh"},
        {"base_ingredient": "potatoes", "variant": "russet", "quantity": 5.0, "unit": "lbs", "category": "vegetables", "product_type": "fresh"},
        {"base_ingredient": "sweet potatoes", "variant": None, "quantity": 3.0, "unit": "lbs", "category": "vegetables", "product_type": "fresh"},
        {"base_ingredient": "broccoli", "variant": None, "quantity": 2.0, "unit": "heads", "category": "vegetables", "product_type": "fresh"},
        {"base_ingredient": "spinach", "variant": "baby", "quantity": 5.0, "unit": "oz", "category": "vegetables", "product_type": "fresh"},
        {"base_ingredient": "lettuce", "variant": "romaine", "quantity": 2.0, "unit": "heads", "category": "vegetables", "product_type": "fresh"},
        {"base_ingredient": "mushrooms", "variant": "white button", "quantity": 8.0, "unit": "oz", "category": "vegetables", "product_type": "fresh"},
        {"base_ingredient": "zucchini", "variant": None, "quantity": 3.0, "unit": "count", "category": "vegetables", "product_type": "fresh"},
        {"base_ingredient": "cucumber", "variant": None, "quantity": 2.0, "unit": "count", "category": "vegetables", "product_type": "fresh"},
        {"base_ingredient": "avocados", "variant": "hass", "quantity": 4.0, "unit": "count", "category": "vegetables", "product_type": "fresh"},
    ]
    
    # Frozen Vegetables
    frozen_vegetables = [
        {"base_ingredient": "broccoli", "variant": "frozen florets", "quantity": 2.0, "unit": "lbs", "category": "vegetables", "product_type": "frozen"},
        {"base_ingredient": "mixed vegetables", "variant": "frozen", "quantity": 2.0, "unit": "lbs", "category": "vegetables", "product_type": "frozen"},
        {"base_ingredient": "corn", "variant": "frozen kernels", "quantity": 1.0, "unit": "lbs", "category": "vegetables", "product_type": "frozen"},
        {"base_ingredient": "peas", "variant": "frozen", "quantity": 1.0, "unit": "lbs", "category": "vegetables", "product_type": "frozen"},
        {"base_ingredient": "green beans", "variant": "frozen cut", "quantity": 1.0, "unit": "lbs", "category": "vegetables", "product_type": "frozen"},
        {"base_ingredient": "spinach", "variant": "frozen chopped", "quantity": 10.0, "unit": "oz", "category": "vegetables", "product_type": "frozen"},
    ]
    
    # Fresh Fruits
    fruits = [
        {"base_ingredient": "bananas", "variant": None, "quantity": 6.0, "unit": "count", "category": "fruits", "product_type": "fresh"},
        {"base_ingredient": "apples", "variant": "gala", "quantity": 3.0, "unit": "lbs", "category": "fruits", "product_type": "fresh"},
        {"base_ingredient": "oranges", "variant": "navel", "quantity": 4.0, "unit": "count", "category": "fruits", "product_type": "fresh"},
        {"base_ingredient": "lemons", "variant": None, "quantity": 6.0, "unit": "count", "category": "fruits", "product_type": "fresh"},
        {"base_ingredient": "limes", "variant": None, "quantity": 4.0, "unit": "count", "category": "fruits", "product_type": "fresh"},
        {"base_ingredient": "strawberries", "variant": None, "quantity": 1.0, "unit": "lbs", "category": "fruits", "product_type": "fresh"},
        {"base_ingredient": "blueberries", "variant": None, "quantity": 12.0, "unit": "oz", "category": "fruits", "product_type": "fresh"},
        {"base_ingredient": "grapes", "variant": "red seedless", "quantity": 2.0, "unit": "lbs", "category": "fruits", "product_type": "fresh"},
    ]
    
    # Frozen Fruits
    frozen_fruits = [
        {"base_ingredient": "mixed berries", "variant": "frozen", "quantity": 1.0, "unit": "lbs", "category": "fruits", "product_type": "frozen"},
        {"base_ingredient": "mango chunks", "variant": "frozen", "quantity": 1.0, "unit": "lbs", "category": "fruits", "product_type": "frozen"},
    ]
    
    # Grains & Starches
    grains = [
        {"base_ingredient": "rice", "variant": "jasmine", "quantity": 5.0, "unit": "lbs", "category": "grains", "product_type": "shelf-stable"},
        {"base_ingredient": "rice", "variant": "brown", "quantity": 2.0, "unit": "lbs", "category": "grains", "product_type": "shelf-stable"},
        {"base_ingredient": "quinoa", "variant": None, "quantity": 1.0, "unit": "lbs", "category": "grains", "product_type": "shelf-stable"},
        {"base_ingredient": "pasta", "variant": "spaghetti", "quantity": 2.0, "unit": "lbs", "category": "grains", "product_type": "shelf-stable"},
        {"base_ingredient": "pasta", "variant": "penne", "quantity": 1.0, "unit": "lbs", "category": "grains", "product_type": "shelf-stable"},
        {"base_ingredient": "bread", "variant": "whole wheat", "quantity": 2.0, "unit": "loaves", "category": "grains", "product_type": "fresh"},
        {"base_ingredient": "tortillas", "variant": "flour", "quantity": 12.0, "unit": "count", "category": "grains", "product_type": "fresh"},
        {"base_ingredient": "oats", "variant": "old fashioned", "quantity": 18.0, "unit": "oz", "category": "grains", "product_type": "shelf-stable"},
        {"base_ingredient": "flour", "variant": "all purpose", "quantity": 5.0, "unit": "lbs", "category": "grains", "product_type": "shelf-stable"},
    ]
    
    # Legumes & Beans
    legumes = [
        {"base_ingredient": "black beans", "variant": "canned", "quantity": 4.0, "unit": "cans", "category": "legumes", "product_type": "shelf-stable"},
        {"base_ingredient": "kidney beans", "variant": "canned", "quantity": 2.0, "unit": "cans", "category": "legumes", "product_type": "shelf-stable"},
        {"base_ingredient": "chickpeas", "variant": "canned", "quantity": 3.0, "unit": "cans", "category": "legumes", "product_type": "shelf-stable"},
        {"base_ingredient": "lentils", "variant": "red", "quantity": 1.0, "unit": "lbs", "category": "legumes", "product_type": "shelf-stable"},
        {"base_ingredient": "lentils", "variant": "green", "quantity": 1.0, "unit": "lbs", "category": "legumes", "product_type": "shelf-stable"},
    ]
    
    # Pantry Staples & Condiments
    pantry_staples = [
        {"base_ingredient": "olive oil", "variant": "extra virgin", "quantity": 1.0, "unit": "bottle", "category": "oils", "product_type": "shelf-stable"},
        {"base_ingredient": "vegetable oil", "variant": None, "quantity": 1.0, "unit": "bottle", "category": "oils", "product_type": "shelf-stable"},
        {"base_ingredient": "coconut oil", "variant": None, "quantity": 14.0, "unit": "oz", "category": "oils", "product_type": "shelf-stable"},
        {"base_ingredient": "salt", "variant": "kosher", "quantity": 1.0, "unit": "box", "category": "seasonings", "product_type": "shelf-stable"},
        {"base_ingredient": "black pepper", "variant": "ground", "quantity": 1.0, "unit": "container", "category": "seasonings", "product_type": "shelf-stable"},
        {"base_ingredient": "garlic powder", "variant": None, "quantity": 1.0, "unit": "container", "category": "seasonings", "product_type": "shelf-stable"},
        {"base_ingredient": "onion powder", "variant": None, "quantity": 1.0, "unit": "container", "category": "seasonings", "product_type": "shelf-stable"},
        {"base_ingredient": "paprika", "variant": None, "quantity": 1.0, "unit": "container", "category": "seasonings", "product_type": "shelf-stable"},
        {"base_ingredient": "cumin", "variant": "ground", "quantity": 1.0, "unit": "container", "category": "seasonings", "product_type": "shelf-stable"},
        {"base_ingredient": "chili powder", "variant": None, "quantity": 1.0, "unit": "container", "category": "seasonings", "product_type": "shelf-stable"},
        {"base_ingredient": "oregano", "variant": "dried", "quantity": 1.0, "unit": "container", "category": "seasonings", "product_type": "shelf-stable"},
        {"base_ingredient": "basil", "variant": "dried", "quantity": 1.0, "unit": "container", "category": "seasonings", "product_type": "shelf-stable"},
        {"base_ingredient": "thyme", "variant": "dried", "quantity": 1.0, "unit": "container", "category": "seasonings", "product_type": "shelf-stable"},
        {"base_ingredient": "bay leaves", "variant": None, "quantity": 1.0, "unit": "container", "category": "seasonings", "product_type": "shelf-stable"},
        {"base_ingredient": "soy sauce", "variant": "low sodium", "quantity": 1.0, "unit": "bottle", "category": "condiments", "product_type": "shelf-stable"},
        {"base_ingredient": "hot sauce", "variant": "sriracha", "quantity": 1.0, "unit": "bottle", "category": "condiments", "product_type": "shelf-stable"},
        {"base_ingredient": "worcestershire sauce", "variant": None, "quantity": 1.0, "unit": "bottle", "category": "condiments", "product_type": "shelf-stable"},
        {"base_ingredient": "balsamic vinegar", "variant": None, "quantity": 1.0, "unit": "bottle", "category": "condiments", "product_type": "shelf-stable"},
        {"base_ingredient": "apple cider vinegar", "variant": None, "quantity": 1.0, "unit": "bottle", "category": "condiments", "product_type": "shelf-stable"},
        {"base_ingredient": "dijon mustard", "variant": None, "quantity": 1.0, "unit": "jar", "category": "condiments", "product_type": "shelf-stable"},
        {"base_ingredient": "mayonnaise", "variant": None, "quantity": 1.0, "unit": "jar", "category": "condiments", "product_type": "shelf-stable"},
        {"base_ingredient": "ketchup", "variant": None, "quantity": 1.0, "unit": "bottle", "category": "condiments", "product_type": "shelf-stable"},
    ]
    
    # Canned & Jarred Goods
    canned_goods = [
        {"base_ingredient": "diced tomatoes", "variant": "canned", "quantity": 6.0, "unit": "cans", "category": "vegetables", "product_type": "shelf-stable"},
        {"base_ingredient": "tomato paste", "variant": None, "quantity": 3.0, "unit": "cans", "category": "vegetables", "product_type": "shelf-stable"},
        {"base_ingredient": "tomato sauce", "variant": None, "quantity": 4.0, "unit": "cans", "category": "vegetables", "product_type": "shelf-stable"},
        {"base_ingredient": "chicken broth", "variant": "low sodium", "quantity": 6.0, "unit": "cans", "category": "broth", "product_type": "shelf-stable"},
        {"base_ingredient": "beef broth", "variant": "low sodium", "quantity": 4.0, "unit": "cans", "category": "broth", "product_type": "shelf-stable"},
        {"base_ingredient": "vegetable broth", "variant": "low sodium", "quantity": 4.0, "unit": "cans", "category": "broth", "product_type": "shelf-stable"},
        {"base_ingredient": "coconut milk", "variant": "canned", "quantity": 3.0, "unit": "cans", "category": "dairy", "product_type": "shelf-stable"},
    ]
    
    # Baking Essentials
    baking = [
        {"base_ingredient": "sugar", "variant": "granulated", "quantity": 4.0, "unit": "lbs", "category": "baking", "product_type": "shelf-stable"},
        {"base_ingredient": "brown sugar", "variant": "light", "quantity": 1.0, "unit": "lbs", "category": "baking", "product_type": "shelf-stable"},
        {"base_ingredient": "baking powder", "variant": None, "quantity": 1.0, "unit": "container", "category": "baking", "product_type": "shelf-stable"},
        {"base_ingredient": "baking soda", "variant": None, "quantity": 1.0, "unit": "box", "category": "baking", "product_type": "shelf-stable"},
        {"base_ingredient": "vanilla extract", "variant": "pure", "quantity": 1.0, "unit": "bottle", "category": "baking", "product_type": "shelf-stable"},
        {"base_ingredient": "honey", "variant": None, "quantity": 1.0, "unit": "jar", "category": "baking", "product_type": "shelf-stable"},
        {"base_ingredient": "maple syrup", "variant": "pure", "quantity": 1.0, "unit": "bottle", "category": "baking", "product_type": "shelf-stable"},
    ]
    
    # Nuts & Seeds
    nuts_seeds = [
        {"base_ingredient": "almonds", "variant": "raw", "quantity": 1.0, "unit": "lbs", "category": "nuts", "product_type": "shelf-stable"},
        {"base_ingredient": "walnuts", "variant": "halves", "quantity": 1.0, "unit": "lbs", "category": "nuts", "product_type": "shelf-stable"},
        {"base_ingredient": "peanut butter", "variant": "natural", "quantity": 1.0, "unit": "jar", "category": "nuts", "product_type": "shelf-stable"},
        {"base_ingredient": "sunflower seeds", "variant": "raw", "quantity": 1.0, "unit": "lbs", "category": "seeds", "product_type": "shelf-stable"},
        {"base_ingredient": "chia seeds", "variant": None, "quantity": 1.0, "unit": "lbs", "category": "seeds", "product_type": "shelf-stable"},
    ]
    
    # Frozen Prepared Foods
    frozen_prepared = [
        {"base_ingredient": "pizza", "variant": "frozen margherita", "quantity": 2.0, "unit": "count", "category": "prepared", "product_type": "frozen"},
        {"base_ingredient": "burrito", "variant": "frozen bean and cheese", "quantity": 4.0, "unit": "count", "category": "prepared", "product_type": "frozen"},
        {"base_ingredient": "french fries", "variant": "frozen", "quantity": 2.0, "unit": "lbs", "category": "prepared", "product_type": "frozen"},
        {"base_ingredient": "ice cream", "variant": "vanilla", "quantity": 1.0, "unit": "pint", "category": "dessert", "product_type": "frozen"},
    ]
    
    # Combine all categories
    all_ingredients = (
        proteins + dairy + fresh_vegetables + frozen_vegetables + 
        fruits + frozen_fruits + grains + legumes + pantry_staples + 
        canned_goods + baking + nuts_seeds + frozen_prepared
    )
    
    # Add normalized names and additional metadata
    for ingredient in all_ingredients:
        # Create normalized name
        base = ingredient["base_ingredient"]
        variant = ingredient.get("variant")
        if variant:
            ingredient["normalized_name"] = f"{base} ({variant})"
        else:
            ingredient["normalized_name"] = base
        
        # Add tags based on category and product type
        tags = [ingredient["category"]]
        if ingredient["product_type"] == "frozen":
            tags.append("frozen")
        elif ingredient["product_type"] == "fresh":
            tags.append("fresh")
        elif ingredient["product_type"] == "shelf-stable":
            tags.append("pantry-staple")
        
        ingredient["tags"] = tags
        
        # Add expiration dates for perishables
        if ingredient["product_type"] == "fresh":
            # Fresh items expire in 3-14 days
            days_to_expire = random.randint(3, 14)
            ingredient["expires_at"] = (datetime.now() + timedelta(days=days_to_expire)).isoformat()
        elif ingredient["product_type"] == "refrigerated":
            # Refrigerated items expire in 1-4 weeks
            days_to_expire = random.randint(7, 28)
            ingredient["expires_at"] = (datetime.now() + timedelta(days=days_to_expire)).isoformat()
        elif ingredient["product_type"] == "frozen":
            # Frozen items expire in 3-12 months
            days_to_expire = random.randint(90, 365)
            ingredient["expires_at"] = (datetime.now() + timedelta(days=days_to_expire)).isoformat()
        # Shelf-stable items don't get expiration dates
    
    return all_ingredients

def populate_pantry():
    """Populate the test user's pantry with comprehensive ingredient data."""
    
    # Initialize Supabase service
    config = Config()
    supabase = SupabaseService(
        url=config.SUPABASE_URL,
        key=config.SUPABASE_KEY,
        service_role_key=config.SUPABASE_SERVICE_ROLE_KEY
    )
    
    print(f"🏠 Populating pantry for test household: {TEST_HOUSEHOLD_ID}")
    
    # Get comprehensive ingredient list
    ingredients = get_comprehensive_ingredients()
    
    print(f"📦 Generated {len(ingredients)} ingredients across categories:")
    
    # Group by category for summary
    categories = {}
    for ingredient in ingredients:
        category = ingredient["category"]
        if category not in categories:
            categories[category] = 0
        categories[category] += 1
    
    for category, count in sorted(categories.items()):
        print(f"   • {category}: {count} items")
    
    # Clear existing test pantry items
    print("\n🧹 Clearing existing test pantry items...")
    try:
        # Use admin client to bypass RLS
        existing_items = supabase.admin_client.table("pantry_items").select("id").eq("household_id", TEST_HOUSEHOLD_ID).execute()
        if existing_items.data:
            item_ids = [item["id"] for item in existing_items.data]
            supabase.admin_client.table("pantry_items").delete().in_("id", item_ids).execute()
            print(f"   Removed {len(item_ids)} existing items")
    except Exception as e:
        print(f"   Warning: Could not clear existing items: {e}")
    
    # Insert new pantry items
    print("\n📥 Adding ingredients to pantry...")
    success_count = 0
    error_count = 0
    
    for i, ingredient in enumerate(ingredients, 1):
        try:
            # Prepare pantry item data
            item_data = {
                "user_id": TEST_USER_ID,
                "household_id": TEST_HOUSEHOLD_ID,
                "base_ingredient": ingredient["base_ingredient"],
                "variant": ingredient.get("variant"),
                "normalized_name": ingredient["normalized_name"],
                "quantity": ingredient["quantity"],
                "unit": ingredient["unit"],
                "product_type": ingredient.get("product_type"),
                "category": ingredient["category"],
                "tags": ingredient["tags"],
                "metadata": {
                    "populated_by": "test_script",
                    "created_at": datetime.now().isoformat()
                }
            }
            
            # Add expiration date if present
            if "expires_at" in ingredient:
                item_data["expires_at"] = ingredient["expires_at"]
            
            # Use admin client to bypass RLS
            response = supabase.admin_client.table("pantry_items").insert(item_data).execute()
            
            if response.data:
                success_count += 1
                if i % 20 == 0:  # Progress indicator
                    print(f"   Added {i}/{len(ingredients)} items...")
            else:
                error_count += 1
                print(f"   ❌ Failed to add: {ingredient['normalized_name']}")
                
        except Exception as e:
            error_count += 1
            print(f"   ❌ Error adding {ingredient['normalized_name']}: {e}")
    
    print(f"\n✅ Pantry population complete!")
    print(f"   Successfully added: {success_count} items")
    if error_count > 0:
        print(f"   Errors: {error_count} items")
    
    # Verify the results
    print("\n🔍 Verifying pantry contents...")
    try:
        pantry_items = supabase.admin_client.table("pantry_items").select("*").eq("household_id", TEST_HOUSEHOLD_ID).execute()
        total_items = len(pantry_items.data) if pantry_items.data else 0
        
        print(f"   Total items in pantry: {total_items}")
        
        # Summary by category
        if pantry_items.data:
            category_counts = {}
            for item in pantry_items.data:
                cat = item.get("category", "unknown")
                category_counts[cat] = category_counts.get(cat, 0) + 1
            
            print("   Items by category:")
            for category, count in sorted(category_counts.items()):
                print(f"     • {category}: {count}")
    
    except Exception as e:
        print(f"   ⚠️  Could not verify pantry: {e}")
    
    print(f"\n🎉 Test pantry is ready for meal planning wizard testing!")
    print(f"   Test user ID: {TEST_USER_ID}")
    print(f"   Test household ID: {TEST_HOUSEHOLD_ID}")

if __name__ == "__main__":
    populate_pantry()