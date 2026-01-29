"""Pantry management service for tracking household ingredient inventory"""

from typing import Dict, List, Optional
from datetime import datetime
from backend.services.supabase_service import SupabaseService
from backend.utils.exceptions import DatabaseException, ValidationException
from backend.utils.logger import get_logger

logger = get_logger(__name__)


class PantryService:
    """Service for managing household pantry inventory"""
    
    def __init__(self, supabase: SupabaseService):
        """
        Initialize PantryService
        
        Args:
            supabase: Supabase service instance
        """
        self.supabase = supabase
    
    def _get_household_id_for_user(self, user_id: str) -> Optional[str]:
        """
        Get the household ID for a user
        
        Args:
            user_id: User ID
        
        Returns:
            Household ID or None if user has no household
        """
        household = self.supabase.get_user_household(user_id)
        return household["id"] if household else None
    
    def _get_pantry_items(
        self, user_id: str, household_id: Optional[str] = None
    ) -> List[Dict]:
        """
        Get pantry items, preferring household scope if available
        
        Args:
            user_id: User ID (for legacy fallback)
            household_id: Household ID (preferred)
        
        Returns:
            List of pantry items
        """
        if household_id:
            return self.supabase.get_household_pantry(household_id)
        else:
            # Fallback to user-scoped pantry (legacy)
            return self.supabase.get_user_pantry(user_id)
    
    async def add_to_pantry(
        self,
        user_id: str,
        normalized_item: Dict,
        quantity: float,
        unit: str,
        receipt_id: str,
        household_id: Optional[str] = None
    ) -> str:
        """
        Add or update pantry item with variant awareness
        
        Args:
            user_id: User ID (who added the item)
            normalized_item: Normalized product dictionary with base_ingredient, variant, etc.
            quantity: Quantity to add
            unit: Unit of measurement
            receipt_id: Source receipt ID
            household_id: Household ID (optional, will be looked up if not provided)
        
        Returns:
            Pantry item ID
        """
        try:
            # Get household ID if not provided
            if not household_id:
                household_id = self._get_household_id_for_user(user_id)
            
            # Get existing items (household-scoped if available)
            existing_items = self._get_pantry_items(user_id, household_id)
            
            existing_item = None
            for item in existing_items:
                if (item['base_ingredient'] == normalized_item.get('base_ingredient') and
                    item.get('variant') == normalized_item.get('variant') and
                    item.get('unit') == unit):
                    existing_item = item
                    break
            
            if existing_item:
                # Update existing item (add quantity)
                new_quantity = existing_item['quantity'] + quantity
                
                self.supabase.update_pantry_quantity(existing_item['id'], new_quantity)
                
                # Update last_receipt_id (only if provided)
                update_data = {'added_at': datetime.utcnow().isoformat()}
                if receipt_id:
                    update_data['last_receipt_id'] = receipt_id
                self.supabase.client.table('pantry_items').update(update_data).eq('id', existing_item['id']).execute()
                
                logger.info(
                    f"Updated pantry: {normalized_item.get('normalized_name')} "
                    f"quantity {existing_item['quantity']} → {new_quantity}"
                )
                return existing_item['id']
            else:
                # Insert new item
                item_data = {
                    'user_id': user_id,
                    'household_id': household_id,
                    'base_ingredient': normalized_item.get('base_ingredient'),
                    'variant': normalized_item.get('variant'),
                    'normalized_name': normalized_item.get('normalized_name'),
                    'quantity': quantity,
                    'unit': unit,
                    'product_type': normalized_item.get('product_type'),
                    'category': normalized_item.get('category'),
                    'tags': normalized_item.get('tags', []),
                    'metadata': {}
                }
                # Only set last_receipt_id if provided (not for manual entries)
                if receipt_id:
                    item_data['last_receipt_id'] = receipt_id
                
                item_id = self.supabase.upsert_pantry_item(item_data)
                
                logger.info(
                    f"Added to pantry: {normalized_item.get('normalized_name')} "
                    f"({quantity} {unit})"
                )
                return item_id
                
        except Exception as e:
            logger.error(f"Failed to add item to pantry: {e}")
            raise DatabaseException(f"Failed to add to pantry: {e}")
    
    async def get_pantry_summary(
        self, user_id: str, household_id: Optional[str] = None
    ) -> Dict:
        """
        Get organized pantry with variants grouped
        
        Args:
            user_id: User ID
            household_id: Household ID (optional, will be looked up if not provided)
        
        Returns:
            Dictionary with grouped pantry items
        """
        try:
            # Get household ID if not provided
            if not household_id:
                household_id = self._get_household_id_for_user(user_id)
            
            items = self._get_pantry_items(user_id, household_id)
            
            # Group by base_ingredient
            grouped = {}
            for item in items:
                base = item['base_ingredient']
                if base not in grouped:
                    grouped[base] = {
                        'base_ingredient': base,
                        'variants': []
                    }
                grouped[base]['variants'].append(item)
            
            return {
                'total_items': len(items),
                'unique_ingredients': len(grouped),
                'items': items,
                'grouped': list(grouped.values()),
                'household_id': household_id
            }
        except Exception as e:
            logger.error(f"Failed to get pantry summary: {e}")
            raise DatabaseException(f"Failed to get pantry summary: {e}")
    
    async def consume_ingredients(
        self,
        user_id: str,
        recipe_id: str,
        recipe_name: str,
        servings: int,
        ingredients: List[Dict],
        household_id: Optional[str] = None
    ) -> Dict:
        """
        Deduct ingredients when recipe is cooked
        
        Args:
            user_id: User ID (who cooked)
            recipe_id: Recipe ID
            recipe_name: Recipe name
            servings: Number of servings cooked
            ingredients: List of ingredient dicts with 'name', 'amount', 'unit'
            household_id: Household ID (optional, will be looked up if not provided)
        
        Returns:
            Dictionary with consumption results
        """
        try:
            # Get household ID if not provided
            if not household_id:
                household_id = self._get_household_id_for_user(user_id)
            
            pantry_items = self._get_pantry_items(user_id, household_id)
            consumed = []
            warnings = []
            
            for ingredient in ingredients:
                ing_name = ingredient['name']
                ing_amount = ingredient['amount']
                ing_unit = ingredient.get('unit', '')
                
                # Find matching pantry item
                matching_item = None
                for item in pantry_items:
                    if (item['normalized_name'].lower() == ing_name.lower() and
                        item.get('unit', '') == ing_unit):
                        matching_item = item
                        break
                
                if matching_item:
                    # Deduct quantity
                    new_quantity = max(0, matching_item['quantity'] - ing_amount)
                    self.supabase.update_pantry_quantity(matching_item['id'], new_quantity)
                    
                    consumed.append({
                        'ingredient': ing_name,
                        'amount_used': ing_amount,
                        'remaining': new_quantity,
                        'unit': ing_unit
                    })
                    
                    if new_quantity == 0:
                        warnings.append(f"{ing_name} is now depleted")
                else:
                    warnings.append(f"{ing_name} was not found in pantry (not deducted)")
            
            # Log cooking event (household-scoped)
            log_data = {
                'user_id': user_id,
                'household_id': household_id,
                'recipe_id': recipe_id,
                'recipe_name': recipe_name,
                'servings': servings,
                'ingredients_used': ingredients,
                'metadata': {
                    'consumed': consumed,
                    'warnings': warnings
                }
            }
            log_id = self.supabase.log_cooking_event(log_data)
            
            logger.info(f"Consumed ingredients for recipe: {recipe_name} (log ID: {log_id})")
            
            return {
                'log_id': log_id,
                'consumed': consumed,
                'warnings': warnings
            }
            
        except Exception as e:
            logger.error(f"Failed to consume ingredients: {e}")
            raise DatabaseException(f"Failed to consume ingredients: {e}")
    
    async def check_ingredient_availability(
        self,
        user_id: str,
        required_ingredients: List[Dict],
        household_id: Optional[str] = None
    ) -> Dict:
        """
        Check what's available, missing, or substitutable
        
        Args:
            user_id: User ID
            required_ingredients: List of required ingredient dicts with 'name', 'amount', 'unit'
            household_id: Household ID (optional, will be looked up if not provided)
        
        Returns:
            Dictionary with availability analysis
        """
        try:
            # Get household ID if not provided
            if not household_id:
                household_id = self._get_household_id_for_user(user_id)
            
            pantry_items = self._get_pantry_items(user_id, household_id)
            
            available = []
            insufficient = []
            missing = []
            substitutable = []
            
            for req_ing in required_ingredients:
                req_name = req_ing['name']
                req_amount = req_ing['amount']
                req_unit = req_ing.get('unit', '')
                
                # Find exact match
                matching_item = None
                for item in pantry_items:
                    if (item['normalized_name'].lower() == req_name.lower() and
                        item.get('unit', '') == req_unit):
                        matching_item = item
                        break
                
                if matching_item:
                    if matching_item['quantity'] >= req_amount:
                        available.append({
                            'ingredient': req_name,
                            'required': req_amount,
                            'available': matching_item['quantity'],
                            'unit': req_unit
                        })
                    else:
                        insufficient.append({
                            'ingredient': req_name,
                            'required': req_amount,
                            'available': matching_item['quantity'],
                            'shortage': req_amount - matching_item['quantity'],
                            'unit': req_unit
                        })
                else:
                    # Check for substitutions
                    substitutions = self.supabase.get_substitutions_for_ingredient(req_name)
                    
                    available_subs = []
                    for sub in substitutions:
                        # Check if substitute is in pantry
                        for item in pantry_items:
                            if item['normalized_name'].lower() == sub['substitute'].lower():
                                available_subs.append({
                                    'substitute': sub['substitute'],
                                    'type': sub['substitution_type'],
                                    'acceptable': sub.get('acceptable', True),
                                    'ratio': sub.get('ratio', 1.0),
                                    'notes': sub.get('notes'),
                                    'available_quantity': item['quantity']
                                })
                                break
                    
                    if available_subs:
                        substitutable.append({
                            'ingredient': req_name,
                            'required': req_amount,
                            'unit': req_unit,
                            'substitutes': available_subs
                        })
                    else:
                        missing.append({
                            'ingredient': req_name,
                            'required': req_amount,
                            'unit': req_unit
                        })
            
            can_make = len(missing) == 0 and len(insufficient) == 0
            can_make_with_subs = len(missing) == 0 and all(
                any(s['acceptable'] for s in item['substitutes'])
                for item in substitutable
            )
            
            return {
                'can_make': can_make,
                'can_make_with_substitutions': can_make_with_subs,
                'available': available,
                'insufficient': insufficient,
                'missing': missing,
                'substitutable': substitutable,
                'household_id': household_id
            }
            
        except Exception as e:
            logger.error(f"Failed to check ingredient availability: {e}")
            raise DatabaseException(f"Failed to check ingredient availability: {e}")


def create_pantry_service(supabase: SupabaseService) -> PantryService:
    """
    Factory function to create PantryService
    
    Args:
        supabase: Supabase service instance
    
    Returns:
        Initialized PantryService instance
    """
    return PantryService(supabase)
