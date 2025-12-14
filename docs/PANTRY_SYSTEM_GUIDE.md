# Pantry System Implementation Guide

## Overview

The pantry management system has been implemented with the following components:

1. **Database Schema** - Tables for product mappings, pantry inventory, cooking logs, and substitutions
2. **Python Services** - PantryService, NormalizationService, ReceiptProcessor
3. **Enhanced Parser** - SafewayParser now extracts quantity information
4. **Test Suite** - Comprehensive tests for all components

## Quick Start

### 1. Run Database Migration

Apply the migration to your Supabase database:

```bash
# Via Supabase CLI
supabase migration up

# Or via Supabase Dashboard:
# - Go to SQL Editor
# - Copy contents of supabase/migrations/001_pantry_data_model.sql
# - Execute the SQL
```

### 2. Seed Test Data

Populate the database with common product mappings and substitutions:

```bash
cd backend
python scripts/seed_test_data.py
```

This will add mappings for common items like butter (salted/unsalted), milk (whole/2%), eggs, sugar, etc.

### 3. Run Tests

```bash
# Run all tests
pytest tests/ -v

# Run specific test suites
pytest tests/services/ -v
pytest tests/parsers/ -v
pytest tests/test_integration_workflow.py -v
```

## How It Works

### Data Flow

```
Receipt Email (.eml)
    ↓
SafewayParser.parse()
    ↓
Receipt Items (with quantity_info)
    ↓
NormalizationService.normalize_product()
    ↓
Normalized Items (base_ingredient + variant)
    ↓
PantryService.add_to_pantry()
    ↓
User's Pantry (ingredient inventory)
```

### Key Concepts

**Variant Handling:**
- Items with different variants are stored separately
- Example: "butter (salted)" and "butter (unsalted)" are separate pantry items
- This ensures recipe accuracy (especially for baking)

**Substitutions:**
- The `ingredient_substitutions` table tracks both:
  - **Variants**: Same base ingredient (e.g., salted ↔ unsalted butter)
  - **Ingredients**: Different ingredients (e.g., sour cream ↔ greek yogurt)
- The `acceptable` field flags non-recommended swaps

## Usage Examples

### Process a Receipt

```python
from backend.services.receipt_processor import ReceiptProcessor

# Initialize services (already done in app.py)
processor = app.config["RECEIPT_PROCESSOR"]

# Process a receipt
result = await processor.process_receipt(
    receipt_id='receipt-123',
    user_id='user-456'
)

print(f"Processed {result['items_added_to_pantry']} items")
```

### Check Pantry

```python
from backend.services.pantry_service import PantryService

pantry = app.config["PANTRY_SERVICE"]

# Get user's pantry
summary = await pantry.get_pantry_summary(user_id='user-456')

print(f"Total items: {summary['total_items']}")
print(f"Unique ingredients: {summary['unique_ingredients']}")

# View grouped items
for group in summary['grouped']:
    print(f"\n{group['base_ingredient']}:")
    for variant in group['variants']:
        print(f"  - {variant['normalized_name']}: {variant['quantity']} {variant['unit']}")
```

### Cook a Recipe

```python
pantry = app.config["PANTRY_SERVICE"]

# Consume ingredients when cooking
ingredients = [
    {'name': 'butter (unsalted)', 'amount': 0.5, 'unit': 'lb'},
    {'name': 'sugar (white)', 'amount': 1.0, 'unit': 'cup'},
    {'name': 'eggs', 'amount': 2, 'unit': 'count'}
]

result = await pantry.consume_ingredients(
    user_id='user-456',
    recipe_id='spoonacular-123',
    recipe_name='Chocolate Chip Cookies',
    servings=24,
    ingredients=ingredients
)

print(f"Consumed {len(result['consumed'])} ingredients")
for warning in result['warnings']:
    print(f"Warning: {warning}")
```

### Check Recipe Availability

```python
pantry = app.config["PANTRY_SERVICE"]

required = [
    {'name': 'butter (unsalted)', 'amount': 0.5, 'unit': 'lb'},
    {'name': 'flour', 'amount': 2.0, 'unit': 'cup'}
]

result = await pantry.check_ingredient_availability(
    user_id='user-456',
    required_ingredients=required
)

if result['can_make']:
    print("✅ You can make this recipe!")
elif result['can_make_with_substitutions']:
    print("⚠️ You can make this with substitutions:")
    for sub in result['substitutable']:
        print(f"  - Use {sub['substitutes'][0]['substitute']} instead of {sub['ingredient']}")
else:
    print("❌ Missing ingredients:")
    for missing in result['missing']:
        print(f"  - {missing['ingredient']}")
```

## Database Tables

### product_mappings
Caches normalized product names to avoid re-processing:
- Maps raw receipt names → normalized ingredients
- Includes variant information (salted, unsalted, etc.)
- Confidence scores for quality tracking

### pantry_items
User's current ingredient inventory:
- Organized by base_ingredient + variant
- Tracks quantities and units
- Links to source receipt

### cooking_log
History of cooked recipes:
- Tracks what was cooked and when
- Records ingredients consumed
- Used for analytics and recommendations

### ingredient_substitutions
Unified substitution table:
- Variant swaps (salted ↔ unsalted butter)
- Ingredient swaps (sour cream ↔ greek yogurt)
- Includes acceptability flags and notes

## Next Steps

### Add AI Normalization (Future Enhancement)

Replace the basic rule-based normalization with OpenAI:

1. Add OpenAI configuration to `backend/config.py`
2. Update `NormalizationService._basic_normalization()` to use OpenAI API
3. Keep the cache mechanism for efficiency

### Add API Routes (For Frontend)

Create new routes in `backend/routes/`:
- `GET /api/pantry` - Get user's pantry
- `POST /api/pantry/consume` - Mark recipe as cooked
- `GET /api/pantry/check-recipe` - Check if recipe is cookable
- `POST /api/receipts/:id/process` - Process a receipt

### Connect to Recipe API

Integrate with Spoonacular for recipe matching:
1. Add Spoonacular API key to config
2. Create `RecipeMatcherService`
3. Implement ingredient matching with substitutions

## Troubleshooting

### Migration Fails

If the migration fails, check:
- Supabase connection is configured
- Tables don't already exist (migrations are idempotent but may have conflicts)
- Service role key has admin permissions

### Tests Fail

If tests fail:
- Ensure pytest is installed: `pip install pytest pytest-asyncio`
- Check that mock fixtures are properly configured in `tests/conftest.py`
- Run with verbose output: `pytest tests/ -v -s`

### Normalization Issues

If products aren't normalizing well:
- Review and update the rule patterns in `NormalizationService._basic_normalization()`
- Add more manual mappings via seed script
- Consider implementing AI normalization for better accuracy


