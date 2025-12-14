"""Product normalization service for mapping raw product names to normalized ingredients"""

import re
from typing import Dict, Optional
from backend.services.supabase_service import SupabaseService
from backend.utils.logger import get_logger

logger = get_logger(__name__)


class NormalizationService:
    """Service for normalizing product names to standard ingredients"""
    
    def __init__(self, supabase: SupabaseService):
        """
        Initialize NormalizationService
        
        Args:
            supabase: Supabase service instance
        """
        self.supabase = supabase
        self.cache = {}  # In-memory cache for frequently used mappings
    
    def normalize_product(self, raw_name: str, category: str) -> Dict:
        """
        Normalize product name (basic version without AI)
        
        Args:
            raw_name: Raw product name from receipt
            category: Product category (GROCERY, MEAT, etc.)
        
        Returns:
            Normalized product dictionary with:
            - base_ingredient: Core ingredient name
            - variant: Variant identifier (salted, unsalted, etc.)
            - normalized_name: Full normalized name
            - product_type: Type of product
            - category: Food category
            - tags: List of relevant tags
        """
        # Check in-memory cache first
        if raw_name in self.cache:
            return self.cache[raw_name]
        
        # Check product_mappings table
        cached = self.supabase.get_product_mapping(raw_name)
        if cached:
            self.cache[raw_name] = cached
            return cached
        
        # Basic normalization rules
        normalized = self._basic_normalization(raw_name, category)
        
        # Store for future use
        try:
            normalized['raw_name'] = raw_name
            normalized['created_at'] = None  # Will be set by database
            normalized['updated_at'] = None  # Will be set by database
            self.supabase.store_product_mapping(normalized)
            self.cache[raw_name] = normalized
        except Exception as e:
            logger.warning(f"Failed to store product mapping for {raw_name}: {e}")
        
        return normalized
    
    def _basic_normalization(self, raw_name: str, category: str) -> Dict:
        """
        Simple rule-based normalization
        
        Args:
            raw_name: Raw product name
            category: Product category
        
        Returns:
            Normalized product dictionary
        """
        # Clean the name
        name_lower = raw_name.lower()
        
        # Extract base ingredient and variant
        base_ingredient = None
        variant = None
        tags = []
        
        # Common patterns for variants
        variant_patterns = {
            'salted': r'\bsalted\b',
            'unsalted': r'\bunsalted\b',
            'whole': r'\bwhole\b',
            '2%': r'\b2%\b',
            'skim': r'\bskim\b',
            'low-fat': r'\blow[\s-]?fat\b',
            'non-fat': r'\bnon[\s-]?fat\b',
            'organic': r'\borganic\b',
            'fresh': r'\bfresh\b',
            'dried': r'\bdried\b',
            'frozen': r'\bfrozen\b',
            'canned': r'\bcanned\b',
            'shredded': r'\bshredded\b',
            'sliced': r'\bsliced\b',
            'diced': r'\bdiced\b',
            'whipped': r'\bwhipped\b',
        }
        
        # Detect variants
        detected_variants = []
        for variant_name, pattern in variant_patterns.items():
            if re.search(pattern, name_lower):
                detected_variants.append(variant_name)
                tags.append(variant_name)
        
        # Common ingredient keywords
        ingredient_keywords = {
            'butter': ['butter'],
            'milk': ['milk'],
            'cheese': ['cheese', 'cheddar', 'mozzarella', 'parmesan', 'swiss'],
            'bread': ['bread', 'loaf'],
            'eggs': ['egg', 'eggs'],
            'chicken': ['chicken'],
            'beef': ['beef', 'steak', 'ground beef'],
            'pork': ['pork', 'ham', 'bacon'],
            'turkey': ['turkey'],
            'fish': ['fish', 'salmon', 'tuna', 'cod'],
            'rice': ['rice'],
            'pasta': ['pasta', 'spaghetti', 'penne', 'macaroni'],
            'yogurt': ['yogurt', 'yoghurt'],
            'cream cheese': ['cream cheese'],
            'sour cream': ['sour cream'],
            'ice cream': ['ice cream'],
            'oil': ['oil', 'olive oil', 'vegetable oil'],
            'sugar': ['sugar'],
            'flour': ['flour'],
            'salt': ['salt'],
            'pepper': ['pepper'],
            'tomato': ['tomato', 'tomatoes'],
            'onion': ['onion', 'onions'],
            'garlic': ['garlic'],
            'potato': ['potato', 'potatoes'],
            'carrot': ['carrot', 'carrots'],
            'lettuce': ['lettuce'],
            'apple': ['apple', 'apples'],
            'orange': ['orange', 'oranges'],
            'banana': ['banana', 'bananas'],
        }
        
        # Find base ingredient
        for base, keywords in ingredient_keywords.items():
            for keyword in keywords:
                if keyword in name_lower:
                    base_ingredient = base
                    break
            if base_ingredient:
                break
        
        # If no match, use first word as base ingredient
        if not base_ingredient:
            words = re.findall(r'\b[a-z]+\b', name_lower)
            # Skip brand names and common modifiers
            skip_words = {'organic', 'fresh', 'frozen', 'select', 'signature', 'choice', 'grade'}
            for word in words:
                if word not in skip_words and len(word) > 2:
                    base_ingredient = word
                    break
            if not base_ingredient:
                base_ingredient = words[0] if words else name_lower
        
        # Determine primary variant for critical ingredients
        # For butter, salted vs unsalted matters
        if base_ingredient == 'butter':
            if 'unsalted' in detected_variants:
                variant = 'unsalted'
            elif 'salted' in detected_variants:
                variant = 'salted'
            # If neither specified, assume salted (more common)
            elif not variant:
                variant = 'salted'
                tags.append('salted')
        
        # For milk, fat content matters
        elif base_ingredient == 'milk':
            if 'whole' in detected_variants:
                variant = 'whole'
            elif '2%' in detected_variants:
                variant = '2%'
            elif 'skim' in detected_variants or 'non-fat' in detected_variants:
                variant = 'skim'
            elif 'low-fat' in detected_variants:
                variant = 'low-fat'
        
        # Build normalized name
        if variant:
            normalized_name = f"{base_ingredient} ({variant})"
        else:
            normalized_name = base_ingredient
        
        # Determine product type and category
        product_type = self._determine_product_type(base_ingredient, category)
        food_category = self._determine_food_category(base_ingredient, category)
        
        # Extract quantity info if present
        quantity_info = self._extract_quantity_info(raw_name)
        
        return {
            'base_ingredient': base_ingredient,
            'variant': variant,
            'normalized_name': normalized_name,
            'product_type': product_type,
            'category': food_category,
            'tags': tags,
            'quantity_info': quantity_info,
            'confidence_score': 0.6,  # Basic rules have lower confidence
            'source': 'rule_based',
            'verified': False
        }
    
    def _determine_product_type(self, base_ingredient: str, category: str) -> str:
        """Determine product type based on ingredient and category"""
        dairy_items = ['milk', 'cheese', 'butter', 'yogurt', 'cream cheese', 'sour cream', 'ice cream']
        meat_items = ['chicken', 'beef', 'pork', 'turkey', 'fish', 'ham', 'bacon']
        produce_items = ['tomato', 'onion', 'garlic', 'potato', 'carrot', 'lettuce', 'apple', 'orange', 'banana']
        grain_items = ['bread', 'rice', 'pasta', 'flour']
        
        if base_ingredient in dairy_items:
            return 'dairy product'
        elif base_ingredient in meat_items:
            return 'meat product'
        elif base_ingredient in produce_items:
            return 'produce'
        elif base_ingredient in grain_items:
            return 'grain product'
        else:
            return 'grocery item'
    
    def _determine_food_category(self, base_ingredient: str, category: str) -> str:
        """Determine food category"""
        dairy_items = ['milk', 'cheese', 'butter', 'yogurt', 'cream cheese', 'sour cream', 'ice cream']
        meat_items = ['chicken', 'beef', 'pork', 'turkey', 'fish', 'ham', 'bacon']
        produce_items = ['tomato', 'onion', 'garlic', 'potato', 'carrot', 'lettuce', 'apple', 'orange', 'banana']
        pantry_items = ['rice', 'pasta', 'flour', 'sugar', 'salt', 'pepper', 'oil']
        
        if base_ingredient in dairy_items:
            return 'dairy'
        elif base_ingredient in meat_items:
            return 'meat'
        elif base_ingredient in produce_items:
            return 'produce'
        elif base_ingredient in pantry_items:
            return 'pantry'
        else:
            # Use original category if available
            if category:
                return category.lower().replace('refrig/frozen', 'frozen')
            return 'grocery'
    
    def _extract_quantity_info(self, product_name: str) -> Optional[Dict]:
        """Extract quantity information from product name"""
        patterns = [
            r'(\d+\.?\d*)\s*(oz|ounce|lb|pound|kg|g|ml|l)\b',
            r'(\d+)\s*pack\b',
            r'(\d+)\s*count\b',
            r'(\d+)-(\d+)\s*(oz|fz)\b',  # Pattern like "4-12oz"
        ]
        
        for pattern in patterns:
            match = re.search(pattern, product_name, re.IGNORECASE)
            if match:
                groups = match.groups()
                if len(groups) == 3:  # Pattern like "4-12oz"
                    # Use second number as the unit amount
                    return {
                        'amount': float(groups[1]),
                        'unit': groups[2].lower()
                    }
                elif len(groups) >= 2:
                    return {
                        'amount': float(groups[0]),
                        'unit': groups[1].lower() if len(groups) > 1 else 'count'
                    }
        
        return None


def create_normalization_service(supabase: SupabaseService) -> NormalizationService:
    """
    Factory function to create NormalizationService
    
    Args:
        supabase: Supabase service instance
    
    Returns:
        Initialized NormalizationService instance
    """
    return NormalizationService(supabase)


