"""Seed test data for product mappings and substitutions"""

import os
import sys
from dotenv import load_dotenv

# Add backend to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from backend.services.supabase_service import create_supabase_service
from backend.utils.logger import setup_logger, get_logger

# Load environment variables
load_dotenv()

logger = get_logger(__name__)


def seed_product_mappings(supabase):
    """Seed common product mappings"""
    mappings = [
        {
            'raw_name': 'Land O Lakes Salted Butter 1 lb',
            'base_ingredient': 'butter',
            'variant': 'salted',
            'normalized_name': 'butter (salted)',
            'product_type': 'dairy product',
            'category': 'dairy',
            'tags': ['salted', 'dairy', 'baking'],
            'quantity_info': {'amount': 1, 'unit': 'lb'},
            'confidence_score': 0.95,
            'source': 'manual',
            'verified': True
        },
        {
            'raw_name': 'Land O Lakes Unsalted Butter 1 lb',
            'base_ingredient': 'butter',
            'variant': 'unsalted',
            'normalized_name': 'butter (unsalted)',
            'product_type': 'dairy product',
            'category': 'dairy',
            'tags': ['unsalted', 'dairy', 'baking'],
            'quantity_info': {'amount': 1, 'unit': 'lb'},
            'confidence_score': 0.95,
            'source': 'manual',
            'verified': True
        },
        {
            'raw_name': 'Lucerne Whole Milk 1 Gallon',
            'base_ingredient': 'milk',
            'variant': 'whole',
            'normalized_name': 'milk (whole)',
            'product_type': 'dairy product',
            'category': 'dairy',
            'tags': ['whole', 'dairy'],
            'quantity_info': {'amount': 1, 'unit': 'gallon'},
            'confidence_score': 0.95,
            'source': 'manual',
            'verified': True
        },
        {
            'raw_name': 'Lucerne 2% Milk 1 Gallon',
            'base_ingredient': 'milk',
            'variant': '2%',
            'normalized_name': 'milk (2%)',
            'product_type': 'dairy product',
            'category': 'dairy',
            'tags': ['2%', 'reduced-fat', 'dairy'],
            'quantity_info': {'amount': 1, 'unit': 'gallon'},
            'confidence_score': 0.95,
            'source': 'manual',
            'verified': True
        },
        {
            'raw_name': 'Lucerne Cream Cheese Spread Whipped 8 Oz',
            'base_ingredient': 'cream cheese',
            'variant': None,
            'normalized_name': 'cream cheese',
            'product_type': 'dairy product',
            'category': 'dairy',
            'tags': ['whipped', 'spread', 'dairy'],
            'quantity_info': {'amount': 8, 'unit': 'oz'},
            'confidence_score': 0.95,
            'source': 'manual',
            'verified': True
        },
        {
            'raw_name': 'Large Eggs Grade AA 12 Count',
            'base_ingredient': 'eggs',
            'variant': None,
            'normalized_name': 'eggs',
            'product_type': 'dairy product',
            'category': 'dairy',
            'tags': ['grade-aa', 'large'],
            'quantity_info': {'amount': 12, 'unit': 'count'},
            'confidence_score': 0.95,
            'source': 'manual',
            'verified': True
        },
        {
            'raw_name': 'White Sugar 4 lb',
            'base_ingredient': 'sugar',
            'variant': 'white',
            'normalized_name': 'sugar (white)',
            'product_type': 'baking ingredient',
            'category': 'pantry',
            'tags': ['white', 'granulated', 'baking'],
            'quantity_info': {'amount': 4, 'unit': 'lb'},
            'confidence_score': 0.95,
            'source': 'manual',
            'verified': True
        },
        {
            'raw_name': 'Brown Sugar 2 lb',
            'base_ingredient': 'sugar',
            'variant': 'brown',
            'normalized_name': 'sugar (brown)',
            'product_type': 'baking ingredient',
            'category': 'pantry',
            'tags': ['brown', 'baking'],
            'quantity_info': {'amount': 2, 'unit': 'lb'},
            'confidence_score': 0.95,
            'source': 'manual',
            'verified': True
        }
    ]
    
    count = 0
    for mapping in mappings:
        try:
            # Check if already exists
            existing = supabase.get_product_mapping(mapping['raw_name'])
            if not existing:
                supabase.store_product_mapping(mapping)
                count += 1
                logger.info(f"Seeded mapping: {mapping['raw_name']}")
            else:
                logger.info(f"Mapping already exists: {mapping['raw_name']}")
        except Exception as e:
            logger.error(f"Failed to seed mapping {mapping['raw_name']}: {e}")
    
    return count


def seed_substitutions(supabase):
    """Seed common ingredient substitutions"""
    substitutions = [
        {
            'ingredient': 'butter (unsalted)',
            'substitute': 'butter (salted)',
            'substitution_type': 'variant',
            'ratio': 1.0,
            'category': 'dairy',
            'confidence': 0.9,
            'acceptable': False,
            'notes': 'Not recommended for baking - adjust salt in recipe',
            'source': 'manual',
            'verified': True
        },
        {
            'ingredient': 'butter (salted)',
            'substitute': 'butter (unsalted)',
            'substitution_type': 'variant',
            'ratio': 1.0,
            'category': 'dairy',
            'confidence': 0.9,
            'acceptable': True,
            'notes': 'Add 1/4 tsp salt per cup of butter',
            'source': 'manual',
            'verified': True
        },
        {
            'ingredient': 'milk (whole)',
            'substitute': 'milk (2%)',
            'substitution_type': 'variant',
            'ratio': 1.0,
            'category': 'dairy',
            'confidence': 0.95,
            'acceptable': True,
            'notes': 'Works well in most recipes',
            'source': 'manual',
            'verified': True
        },
        {
            'ingredient': 'milk (2%)',
            'substitute': 'milk (whole)',
            'substitution_type': 'variant',
            'ratio': 1.0,
            'category': 'dairy',
            'confidence': 0.95,
            'acceptable': True,
            'notes': 'Works well in most recipes',
            'source': 'manual',
            'verified': True
        },
        {
            'ingredient': 'sour cream',
            'substitute': 'greek yogurt',
            'substitution_type': 'ingredient',
            'ratio': 1.0,
            'category': 'dairy',
            'confidence': 0.85,
            'acceptable': True,
            'notes': 'Plain greek yogurt works well as substitute',
            'source': 'manual',
            'verified': True
        },
        {
            'ingredient': 'greek yogurt',
            'substitute': 'sour cream',
            'substitution_type': 'ingredient',
            'ratio': 1.0,
            'category': 'dairy',
            'confidence': 0.85,
            'acceptable': True,
            'notes': 'Sour cream can replace greek yogurt',
            'source': 'manual',
            'verified': True
        },
        {
            'ingredient': 'sugar (white)',
            'substitute': 'sugar (brown)',
            'substitution_type': 'variant',
            'ratio': 1.0,
            'category': 'pantry',
            'confidence': 0.7,
            'acceptable': False,
            'notes': 'Changes flavor and moisture - not ideal for all recipes',
            'source': 'manual',
            'verified': True
        }
    ]
    
    count = 0
    for sub in substitutions:
        try:
            # Check if already exists (use admin client to bypass RLS)
            client = supabase.admin_client if supabase.admin_client else supabase.client
            existing = client.table('ingredient_substitutions').select('*').match({
                'ingredient': sub['ingredient'],
                'substitute': sub['substitute']
            }).execute()
            
            if not existing.data or len(existing.data) == 0:
                supabase.store_substitution(sub)
                count += 1
                logger.info(f"Seeded substitution: {sub['ingredient']} -> {sub['substitute']}")
            else:
                logger.info(f"Substitution already exists: {sub['ingredient']} -> {sub['substitute']}")
        except Exception as e:
            logger.error(f"Failed to seed substitution {sub['ingredient']}: {e}")
    
    return count


def main():
    """Main function to seed test data"""
    setup_logger("seed_test_data", "INFO")
    logger.info("Starting test data seeding...")
    
    # Get Supabase credentials
    supabase_url = os.getenv('SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_KEY')
    supabase_service_role_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
    
    if not supabase_url or not supabase_key:
        logger.error("SUPABASE_URL and SUPABASE_KEY must be set in environment")
        return 1
    
    try:
        # Initialize Supabase service
        supabase = create_supabase_service(
            supabase_url,
            supabase_key,
            supabase_service_role_key
        )
        
        # Seed product mappings
        logger.info("Seeding product mappings...")
        mappings_count = seed_product_mappings(supabase)
        logger.info(f"Seeded {mappings_count} product mappings")
        
        # Seed substitutions
        logger.info("Seeding ingredient substitutions...")
        subs_count = seed_substitutions(supabase)
        logger.info(f"Seeded {subs_count} substitutions")
        
        logger.info("Test data seeding completed successfully!")
        return 0
        
    except Exception as e:
        logger.error(f"Failed to seed test data: {e}")
        return 1


if __name__ == '__main__':
    exit(main())


