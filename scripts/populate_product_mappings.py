#!/usr/bin/env python3
"""
Populate product mappings for better ingredient normalization.

This script adds common product name mappings that help normalize
raw receipt data to standardized ingredient names.
"""

import os
import sys
from typing import Dict, List

# Add project root to path
project_root = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, project_root)

from backend.services.supabase_service import SupabaseService
from backend.config import Config

def get_product_mappings() -> List[Dict]:
    """
    Generate common product name mappings for normalization.
    
    Returns:
        List of product mapping dictionaries
    """
    
    mappings = []
    
    # Meat products
    meat_mappings = [
        # Chicken
        {"raw_name": "Boneless Skinless Chicken Breast", "base_ingredient": "chicken breast", "variant": "boneless skinless", "normalized_name": "chicken breast (boneless skinless)", "category": "meat", "product_type": "fresh"},
        {"raw_name": "Chicken Breast Boneless", "base_ingredient": "chicken breast", "variant": "boneless skinless", "normalized_name": "chicken breast (boneless skinless)", "category": "meat", "product_type": "fresh"},
        {"raw_name": "Chicken Thighs Bone-In", "base_ingredient": "chicken thighs", "variant": "bone-in skin-on", "normalized_name": "chicken thighs (bone-in skin-on)", "category": "meat", "product_type": "fresh"},
        {"raw_name": "Ground Chicken 93/7", "base_ingredient": "ground chicken", "variant": "93/7 lean", "normalized_name": "ground chicken (93/7 lean)", "category": "meat", "product_type": "fresh"},
        
        # Beef
        {"raw_name": "Ground Beef 80/20", "base_ingredient": "ground beef", "variant": "80/20", "normalized_name": "ground beef (80/20)", "category": "meat", "product_type": "fresh"},
        {"raw_name": "80/20 Ground Beef", "base_ingredient": "ground beef", "variant": "80/20", "normalized_name": "ground beef (80/20)", "category": "meat", "product_type": "fresh"},
        {"raw_name": "Ribeye Steak", "base_ingredient": "ribeye steak", "variant": None, "normalized_name": "ribeye steak", "category": "meat", "product_type": "fresh"},
        {"raw_name": "Chuck Roast", "base_ingredient": "beef chuck roast", "variant": None, "normalized_name": "beef chuck roast", "category": "meat", "product_type": "fresh"},
        
        # Pork
        {"raw_name": "Thick Cut Bacon", "base_ingredient": "bacon", "variant": "thick cut", "normalized_name": "bacon (thick cut)", "category": "meat", "product_type": "refrigerated"},
        {"raw_name": "Pork Chops Bone-In", "base_ingredient": "pork chops", "variant": "bone-in", "normalized_name": "pork chops (bone-in)", "category": "meat", "product_type": "fresh"},
        {"raw_name": "Italian Sausage Mild", "base_ingredient": "italian sausage", "variant": "mild", "normalized_name": "italian sausage (mild)", "category": "meat", "product_type": "fresh"},
    ]
    
    # Dairy products
    dairy_mappings = [
        {"raw_name": "Whole Milk Gallon", "base_ingredient": "milk", "variant": "whole", "normalized_name": "milk (whole)", "category": "dairy", "product_type": "refrigerated"},
        {"raw_name": "2% Milk", "base_ingredient": "milk", "variant": "2%", "normalized_name": "milk (2%)", "category": "dairy", "product_type": "refrigerated"},
        {"raw_name": "Large Eggs 18ct", "base_ingredient": "eggs", "variant": "large", "normalized_name": "eggs (large)", "category": "dairy", "product_type": "refrigerated"},
        {"raw_name": "Unsalted Butter", "base_ingredient": "butter", "variant": "unsalted", "normalized_name": "butter (unsalted)", "category": "dairy", "product_type": "refrigerated"},
        {"raw_name": "Salted Butter", "base_ingredient": "butter", "variant": "salted", "normalized_name": "butter (salted)", "category": "dairy", "product_type": "refrigerated"},
        {"raw_name": "Sharp Cheddar Cheese", "base_ingredient": "cheddar cheese", "variant": "sharp", "normalized_name": "cheddar cheese (sharp)", "category": "dairy", "product_type": "refrigerated"},
        {"raw_name": "Shredded Mozzarella", "base_ingredient": "mozzarella cheese", "variant": "shredded", "normalized_name": "mozzarella cheese (shredded)", "category": "dairy", "product_type": "refrigerated"},
        {"raw_name": "Greek Yogurt Plain", "base_ingredient": "greek yogurt", "variant": "plain", "normalized_name": "greek yogurt (plain)", "category": "dairy", "product_type": "refrigerated"},
    ]
    
    # Produce
    produce_mappings = [
        {"raw_name": "Yellow Onions 3lb", "base_ingredient": "onions", "variant": "yellow", "normalized_name": "onions (yellow)", "category": "vegetables", "product_type": "fresh"},
        {"raw_name": "Red Bell Peppers", "base_ingredient": "bell peppers", "variant": "red", "normalized_name": "bell peppers (red)", "category": "vegetables", "product_type": "fresh"},
        {"raw_name": "Green Bell Peppers", "base_ingredient": "bell peppers", "variant": "green", "normalized_name": "bell peppers (green)", "category": "vegetables", "product_type": "fresh"},
        {"raw_name": "Roma Tomatoes", "base_ingredient": "tomatoes", "variant": "roma", "normalized_name": "tomatoes (roma)", "category": "vegetables", "product_type": "fresh"},
        {"raw_name": "Russet Potatoes 5lb", "base_ingredient": "potatoes", "variant": "russet", "normalized_name": "potatoes (russet)", "category": "vegetables", "product_type": "fresh"},
        {"raw_name": "Baby Spinach", "base_ingredient": "spinach", "variant": "baby", "normalized_name": "spinach (baby)", "category": "vegetables", "product_type": "fresh"},
        {"raw_name": "Baby Carrots", "base_ingredient": "carrots", "variant": "baby", "normalized_name": "carrots (baby)", "category": "vegetables", "product_type": "fresh"},
        {"raw_name": "Hass Avocados", "base_ingredient": "avocados", "variant": "hass", "normalized_name": "avocados (hass)", "category": "vegetables", "product_type": "fresh"},
        {"raw_name": "White Button Mushrooms", "base_ingredient": "mushrooms", "variant": "white button", "normalized_name": "mushrooms (white button)", "category": "vegetables", "product_type": "fresh"},
    ]
    
    # Fruits
    fruit_mappings = [
        {"raw_name": "Gala Apples", "base_ingredient": "apples", "variant": "gala", "normalized_name": "apples (gala)", "category": "fruits", "product_type": "fresh"},
        {"raw_name": "Navel Oranges", "base_ingredient": "oranges", "variant": "navel", "normalized_name": "oranges (navel)", "category": "fruits", "product_type": "fresh"},
        {"raw_name": "Red Seedless Grapes", "base_ingredient": "grapes", "variant": "red seedless", "normalized_name": "grapes (red seedless)", "category": "fruits", "product_type": "fresh"},
        {"raw_name": "Fresh Strawberries", "base_ingredient": "strawberries", "variant": None, "normalized_name": "strawberries", "category": "fruits", "product_type": "fresh"},
        {"raw_name": "Fresh Blueberries", "base_ingredient": "blueberries", "variant": None, "normalized_name": "blueberries", "category": "fruits", "product_type": "fresh"},
    ]
    
    # Pantry staples
    pantry_mappings = [
        {"raw_name": "Extra Virgin Olive Oil", "base_ingredient": "olive oil", "variant": "extra virgin", "normalized_name": "olive oil (extra virgin)", "category": "oils", "product_type": "shelf-stable"},
        {"raw_name": "Jasmine Rice 5lb", "base_ingredient": "rice", "variant": "jasmine", "normalized_name": "rice (jasmine)", "category": "grains", "product_type": "shelf-stable"},
        {"raw_name": "Brown Rice", "base_ingredient": "rice", "variant": "brown", "normalized_name": "rice (brown)", "category": "grains", "product_type": "shelf-stable"},
        {"raw_name": "Spaghetti Pasta", "base_ingredient": "pasta", "variant": "spaghetti", "normalized_name": "pasta (spaghetti)", "category": "grains", "product_type": "shelf-stable"},
        {"raw_name": "Penne Pasta", "base_ingredient": "pasta", "variant": "penne", "normalized_name": "pasta (penne)", "category": "grains", "product_type": "shelf-stable"},
        {"raw_name": "All Purpose Flour 5lb", "base_ingredient": "flour", "variant": "all purpose", "normalized_name": "flour (all purpose)", "category": "grains", "product_type": "shelf-stable"},
        {"raw_name": "Kosher Salt", "base_ingredient": "salt", "variant": "kosher", "normalized_name": "salt (kosher)", "category": "seasonings", "product_type": "shelf-stable"},
        {"raw_name": "Ground Black Pepper", "base_ingredient": "black pepper", "variant": "ground", "normalized_name": "black pepper (ground)", "category": "seasonings", "product_type": "shelf-stable"},
    ]
    
    # Canned goods
    canned_mappings = [
        {"raw_name": "Diced Tomatoes Can", "base_ingredient": "diced tomatoes", "variant": "canned", "normalized_name": "diced tomatoes (canned)", "category": "vegetables", "product_type": "shelf-stable"},
        {"raw_name": "Black Beans Can", "base_ingredient": "black beans", "variant": "canned", "normalized_name": "black beans (canned)", "category": "legumes", "product_type": "shelf-stable"},
        {"raw_name": "Chickpeas Can", "base_ingredient": "chickpeas", "variant": "canned", "normalized_name": "chickpeas (canned)", "category": "legumes", "product_type": "shelf-stable"},
        {"raw_name": "Low Sodium Chicken Broth", "base_ingredient": "chicken broth", "variant": "low sodium", "normalized_name": "chicken broth (low sodium)", "category": "broth", "product_type": "shelf-stable"},
        {"raw_name": "Tuna in Water", "base_ingredient": "tuna", "variant": "canned in water", "normalized_name": "tuna (canned in water)", "category": "seafood", "product_type": "shelf-stable"},
    ]
    
    # Frozen foods
    frozen_mappings = [
        {"raw_name": "Frozen Broccoli Florets", "base_ingredient": "broccoli", "variant": "frozen florets", "normalized_name": "broccoli (frozen florets)", "category": "vegetables", "product_type": "frozen"},
        {"raw_name": "Frozen Mixed Vegetables", "base_ingredient": "mixed vegetables", "variant": "frozen", "normalized_name": "mixed vegetables (frozen)", "category": "vegetables", "product_type": "frozen"},
        {"raw_name": "Frozen Corn Kernels", "base_ingredient": "corn", "variant": "frozen kernels", "normalized_name": "corn (frozen kernels)", "category": "vegetables", "product_type": "frozen"},
        {"raw_name": "Frozen Mixed Berries", "base_ingredient": "mixed berries", "variant": "frozen", "normalized_name": "mixed berries (frozen)", "category": "fruits", "product_type": "frozen"},
        {"raw_name": "Atlantic Salmon Fillets", "base_ingredient": "salmon fillets", "variant": "atlantic", "normalized_name": "salmon fillets (atlantic)", "category": "seafood", "product_type": "frozen"},
    ]
    
    # Combine all mappings
    all_mappings = (
        meat_mappings + dairy_mappings + produce_mappings + 
        fruit_mappings + pantry_mappings + canned_mappings + frozen_mappings
    )
    
    # Add metadata to each mapping
    for mapping in all_mappings:
        mapping["tags"] = [mapping["category"]]
        if mapping["product_type"] == "frozen":
            mapping["tags"].append("frozen")
        elif mapping["product_type"] == "fresh":
            mapping["tags"].append("fresh")
        elif mapping["product_type"] == "shelf-stable":
            mapping["tags"].append("pantry-staple")
        
        mapping["confidence_score"] = 0.95
        mapping["source"] = "test_script"
        mapping["verified"] = True
        
        # Add quantity info if detectable from raw name
        if "5lb" in mapping["raw_name"]:
            mapping["quantity_info"] = {"amount": 5, "unit": "lbs"}
        elif "3lb" in mapping["raw_name"]:
            mapping["quantity_info"] = {"amount": 3, "unit": "lbs"}
        elif "18ct" in mapping["raw_name"]:
            mapping["quantity_info"] = {"amount": 18, "unit": "count"}
        elif "Gallon" in mapping["raw_name"]:
            mapping["quantity_info"] = {"amount": 1, "unit": "gallon"}
        elif "Can" in mapping["raw_name"]:
            mapping["quantity_info"] = {"amount": 1, "unit": "can"}
    
    return all_mappings

def populate_product_mappings():
    """Populate the product mappings table."""
    
    # Initialize Supabase service
    config = Config()
    supabase = SupabaseService(
        url=config.SUPABASE_URL,
        key=config.SUPABASE_KEY,
        service_role_key=config.SUPABASE_SERVICE_ROLE_KEY
    )
    
    print("🗂️  Populating product mappings...")
    
    # Get mappings
    mappings = get_product_mappings()
    
    print(f"📝 Generated {len(mappings)} product mappings")
    
    # Group by category for summary
    category_counts = {}
    for mapping in mappings:
        category = mapping["category"]
        category_counts[category] = category_counts.get(category, 0) + 1
    
    print("   Mappings by category:")
    for category, count in sorted(category_counts.items()):
        print(f"     • {category}: {count}")
    
    # Clear existing test mappings
    print("\n🧹 Clearing existing test mappings...")
    try:
        # Use admin client to bypass RLS
        existing = supabase.admin_client.table("product_mappings").select("id").eq("source", "test_script").execute()
        if existing.data:
            mapping_ids = [item["id"] for item in existing.data]
            supabase.admin_client.table("product_mappings").delete().in_("id", mapping_ids).execute()
            print(f"   Removed {len(mapping_ids)} existing test mappings")
    except Exception as e:
        print(f"   Warning: Could not clear existing mappings: {e}")
    
    # Insert new mappings
    print("\n📥 Adding product mappings...")
    success_count = 0
    error_count = 0
    
    for i, mapping in enumerate(mappings, 1):
        try:
            # Use admin client to bypass RLS
            response = supabase.admin_client.table("product_mappings").insert(mapping).execute()
            
            if response.data:
                success_count += 1
                if i % 20 == 0:  # Progress indicator
                    print(f"   Added {i}/{len(mappings)} mappings...")
            else:
                error_count += 1
                print(f"   ❌ Failed to add: {mapping['raw_name']}")
                
        except Exception as e:
            error_count += 1
            print(f"   ❌ Error adding {mapping['raw_name']}: {e}")
    
    print(f"\n✅ Product mapping population complete!")
    print(f"   Successfully added: {success_count} mappings")
    if error_count > 0:
        print(f"   Errors: {error_count} mappings")
    
    # Verify the results
    print("\n🔍 Verifying product mappings...")
    try:
        all_mappings = supabase.admin_client.table("product_mappings").select("*").eq("source", "test_script").execute()
        total_mappings = len(all_mappings.data) if all_mappings.data else 0
        
        print(f"   Total mappings in database: {total_mappings}")
        
        if all_mappings.data:
            # Count by category
            category_counts_db = {}
            for mapping in all_mappings.data:
                cat = mapping.get("category", "unknown")
                category_counts_db[cat] = category_counts_db.get(cat, 0) + 1
            
            print("   Mappings by category:")
            for category, count in sorted(category_counts_db.items()):
                print(f"     • {category}: {count}")
    
    except Exception as e:
        print(f"   ⚠️  Could not verify mappings: {e}")
    
    print(f"\n🎉 Product mappings are ready!")

if __name__ == "__main__":
    populate_product_mappings()